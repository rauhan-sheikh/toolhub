import "server-only";

import * as common from "oci-common";
import * as usageapi from "oci-usageapi";
import * as resourcesearch from "oci-resourcesearch";
import * as budgets from "oci-budget";
import { optionalEnv } from "@/lib/env";

/**
 * Read-only view of everything on the Oracle tenancy that could cost money.
 *
 * Authentication is by *instance principal*: the VM proves its own identity via
 * the instance metadata service, so there is no API key on disk to leak or
 * rotate, and access dies with the instance. Scope is set by the IAM policy,
 * which is tenancy-wide — this reports on every service and compartment, not
 * just this machine.
 */

export type ServiceCost = { service: string; cost: number };

export type UsageLine = {
  service: string;
  sku: string;
  /** Month to date. */
  quantity: number;
  /** Month-end estimate from the latest complete day's rate. */
  projected: number;
  unit: string;
};

export type ResourceRow = {
  type: string;
  name: string;
  compartmentId: string;
};

export type FreeTierRow = {
  label: string;
  used: number;
  /** Month-to-date plus the latest daily rate carried to month end. */
  projected: number;
  limit: number;
  unit: string;
  percentUsed: number;
  percentProjected: number;
  /**
   * Metered on what is allocated, not what is used: an instance accrues its
   * full shape every hour it is powered on, busy or idle.
   */
  reserved: boolean;
};

export type BudgetRow = {
  name: string;
  amount: number;
  spent: number;
  forecast: number | null;
  alertRules: number;
};

export type OciSnapshot = {
  currency: string;
  monthToDateCost: number;
  /** Oracle's own projection to month end, when it will give one. */
  forecastCost: number | null;
  byService: ServiceCost[];
  usage: UsageLine[];
  resources: ResourceRow[];
  freeTier: FreeTierRow[];
  budgets: BudgetRow[];
  periodStart: string;
  periodEnd: string;
  fetchedAt: string;
  /** Non-fatal problems, e.g. one IAM policy missing. */
  warnings: string[];
};

export class OciUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OciUnavailableError";
  }
}

function tenancyId(): string {
  const id = optionalEnv("OCI_TENANCY_OCID");
  if (!id) {
    throw new OciUnavailableError(
      "OCI_TENANCY_OCID is not set. It is an identifier, not a secret.",
    );
  }
  return id;
}

export function isConfigured(): boolean {
  return Boolean(optionalEnv("OCI_TENANCY_OCID"));
}

let providerPromise: Promise<common.AuthenticationDetailsProvider> | null = null;

/**
 * Instance principals only work from inside an OCI compute instance; locally
 * this throws, which the route turns into an "unavailable" state rather than
 * an error page.
 */
function authProvider(): Promise<common.AuthenticationDetailsProvider> {
  if (!providerPromise) {
    providerPromise =
      new common.InstancePrincipalsAuthenticationDetailsProviderBuilder()
        .build()
        .catch((error: unknown) => {
          providerPromise = null;
          throw new OciUnavailableError(
            `Could not authenticate as the instance: ${describe(error)}. ` +
              "This only works when running on the Oracle VM.",
          );
        });
  }
  return providerPromise;
}

function monthWindow(): { start: Date; end: Date } {
  const now = new Date();
  // Usage API windows are UTC; the end is exclusive.
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
}

async function fetchCost(
  client: usageapi.UsageapiClient,
  tenant: string,
  start: Date,
  end: Date,
): Promise<{ total: number; currency: string; byService: ServiceCost[] }> {
  const response = await client.requestSummarizedUsages({
    requestSummarizedUsagesDetails: {
      tenantId: tenant,
      timeUsageStarted: start,
      timeUsageEnded: end,
      granularity:
        usageapi.models.RequestSummarizedUsagesDetails.Granularity.Monthly,
      queryType: usageapi.models.RequestSummarizedUsagesDetails.QueryType.Cost,
      isAggregateByTime: true,
      groupBy: ["service"],
    },
  });

  const items = response.usageAggregation?.items ?? [];
  const totals = new Map<string, number>();
  let currency = "USD";
  let total = 0;

  for (const item of items) {
    if (item.isForecast) continue;
    const amount = item.computedAmount ?? 0;
    if (item.currency) currency = item.currency;
    total += amount;
    const service = item.service ?? "Unknown";
    totals.set(service, (totals.get(service) ?? 0) + amount);
  }

  const byService = [...totals.entries()]
    .map(([service, cost]) => ({ service, cost }))
    // Zero-cost services are the normal case on Always Free; listing them all
    // would bury anything that actually bills.
    .filter((row) => row.cost > 0)
    .sort((a, b) => b.cost - a.cost);

  return { total, currency, byService };
}

async function fetchForecast(
  client: usageapi.UsageapiClient,
  tenant: string,
  start: Date,
  end: Date,
): Promise<number | null> {
  try {
    const response = await client.requestSummarizedUsages({
      requestSummarizedUsagesDetails: {
        tenantId: tenant,
        timeUsageStarted: start,
        timeUsageEnded: end,
        granularity:
          usageapi.models.RequestSummarizedUsagesDetails.Granularity.Monthly,
        queryType: usageapi.models.RequestSummarizedUsagesDetails.QueryType.Cost,
        isAggregateByTime: true,
        forecast: {
          timeForecastEnded: end,
        },
      },
    });

    const forecastTotal = (response.usageAggregation?.items ?? [])
      .filter((item) => item.isForecast)
      .reduce((sum, item) => sum + (item.computedAmount ?? 0), 0);

    return forecastTotal > 0 ? forecastTotal : null;
  } catch {
    // Oracle declines to forecast early in a month or without history.
    return null;
  }
}

const DAY_MS = 86_400_000;

/**
 * Daily rather than monthly, so the projection can use the current run rate.
 * Extrapolating the month-to-date average instead under-projects anything
 * created mid-month, and Oracle's reporting lag drags the average down too.
 */
async function fetchUsage(
  client: usageapi.UsageapiClient,
  tenant: string,
  start: Date,
  end: Date,
): Promise<UsageLine[]> {
  // A row per SKU per day adds up fast, so follow the pages rather than
  // silently under-counting a busy month.
  const items: usageapi.models.UsageSummary[] = [];
  let page: string | undefined;
  do {
    const response = await client.requestSummarizedUsages({
      requestSummarizedUsagesDetails: {
        tenantId: tenant,
        timeUsageStarted: start,
        timeUsageEnded: end,
        granularity:
          usageapi.models.RequestSummarizedUsagesDetails.Granularity.Daily,
        queryType:
          usageapi.models.RequestSummarizedUsagesDetails.QueryType.UsageOnly,
        isAggregateByTime: false,
        groupBy: ["service", "skuName", "unit"],
      },
      page,
    });
    items.push(...(response.usageAggregation?.items ?? []));
    page = response.opcNextPage || undefined;
  } while (page);

  const lines = new Map<
    string,
    { service: string; sku: string; unit: string; byDay: Map<number, number> }
  >();
  const reportedDays = new Set<number>();
  const today = Math.floor(Date.now() / DAY_MS);

  for (const item of items) {
    if (item.isForecast) continue;
    const quantity = item.computedQuantity ?? 0;
    if (quantity <= 0) continue;

    const service = item.service ?? "Unknown";
    const sku = item.skuName ?? "—";
    const unit = item.unit ?? "";
    const key = `${service}|${sku}|${unit}`;
    const day = Math.floor(new Date(item.timeUsageStarted).getTime() / DAY_MS);

    let line = lines.get(key);
    if (!line) {
      line = { service, sku, unit, byDay: new Map() };
      lines.set(key, line);
    }
    line.byDay.set(day, (line.byDay.get(day) ?? 0) + quantity);
    if (day < today) reportedDays.add(day);
  }

  // The rate comes from the last two days Oracle has reported before today.
  // Two, because the newest is often still partially ingested; taking the
  // larger errs towards warning early. That newest day is itself priced at
  // the rate, so its partial figure never drags the projection down.
  const rateDays = [...reportedDays].sort((a, b) => b - a).slice(0, 2);
  const anchor = rateDays[0];
  const lastDay = Math.floor(end.getTime() / DAY_MS) - 1;
  const daysAtRate = anchor === undefined ? 0 : Math.max(0, lastDay - anchor + 1);

  return [...lines.values()]
    .map(({ service, sku, unit, byDay }) => {
      let quantity = 0;
      let beforeAnchor = 0;
      for (const [day, value] of byDay) {
        quantity += value;
        if (anchor !== undefined && day < anchor) beforeAnchor += value;
      }
      const rate = Math.max(0, ...rateDays.map((day) => byDay.get(day) ?? 0));
      return {
        service,
        sku,
        unit,
        quantity,
        projected:
          anchor === undefined ? quantity : beforeAnchor + rate * daysAtRate,
      };
    })
    .sort(
      (a, b) =>
        a.service.localeCompare(b.service) || a.sku.localeCompare(b.sku),
    );
}

async function fetchResources(
  provider: common.AuthenticationDetailsProvider,
): Promise<ResourceRow[]> {
  const client = new resourcesearch.ResourceSearchClient({
    authenticationDetailsProvider: provider,
  });

  const response = await client.searchResources({
    searchDetails: {
      type: "Structured",
      query: "query all resources",
    } as resourcesearch.models.StructuredSearchDetails,
  });

  return (response.resourceSummaryCollection?.items ?? [])
    .map((item) => ({
      type: item.resourceType ?? "Unknown",
      name: item.displayName ?? item.identifier ?? "—",
      compartmentId: item.compartmentId ?? "",
    }))
    .sort(
      (a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name),
    );
}

async function fetchBudgets(
  provider: common.AuthenticationDetailsProvider,
  tenant: string,
): Promise<BudgetRow[]> {
  const client = new budgets.BudgetClient({
    authenticationDetailsProvider: provider,
  });

  const response = await client.listBudgets({ compartmentId: tenant });
  return (response.items ?? []).map((item) => ({
    name: item.displayName ?? "Unnamed budget",
    amount: item.amount ?? 0,
    spent: item.actualSpend ?? 0,
    forecast: item.forecastedSpend ?? null,
    alertRules: item.alertRuleCount ?? 0,
  }));
}

/**
 * Always Free allowances, keyed off the SKU/unit strings Oracle actually
 * returns. Cost alone can't warn you here: you sit at zero right up until you
 * cross an allowance, and then you don't.
 *
 * Compute figures were halved on 15 June 2026 (4 OCPU/24 GB -> 2/12), which is
 * 1,500 OCPU-hours and 9,000 GB-hours per month.
 */
const FREE_TIER: {
  label: string;
  limit: number;
  unit: string;
  reserved: boolean;
  match: (line: UsageLine) => boolean;
}[] = [
  {
    label: "Ampere A1 compute",
    limit: 1500,
    unit: "OCPU-hours",
    reserved: true,
    match: (l) => l.service === "Compute" && /OCPU Per Hour/i.test(l.unit),
  },
  {
    label: "Ampere A1 memory",
    limit: 9000,
    unit: "GB-hours",
    reserved: true,
    match: (l) => l.service === "Compute" && /Gigabyte Per Hour/i.test(l.unit),
  },
  {
    label: "Block storage",
    limit: 200,
    unit: "GB",
    reserved: true,
    // Capacity only. Performance units (VPUs) and backups are metered under
    // the same service in other units; adding them to GB is meaningless.
    match: (l) =>
      l.service === "Block Storage" &&
      !/Performance|Backup/i.test(`${l.sku} ${l.unit}`),
  },
  {
    label: "Outbound transfer",
    limit: 10240,
    unit: "GB",
    reserved: false,
    match: (l) => /Outbound Data Transfer/i.test(l.sku),
  },
];

function computeFreeTier(usage: UsageLine[]): FreeTierRow[] {
  return FREE_TIER.map(({ label, limit, unit, reserved, match }) => {
    const lines = usage.filter(match);
    const used = lines.reduce((sum, line) => sum + line.quantity, 0);
    const projected = lines.reduce((sum, line) => sum + line.projected, 0);
    return {
      label,
      used,
      projected,
      limit,
      unit,
      reserved,
      percentUsed: (used / limit) * 100,
      percentProjected: (projected / limit) * 100,
    };
  }).filter((row) => row.used > 0);
}

let cache: { at: number; snapshot: OciSnapshot } | null = null;
// Oracle refreshes usage data a few times a day; the Refresh button bypasses this.
const CACHE_MS = 30 * 60 * 1000;

export async function getSnapshot(force = false): Promise<OciSnapshot> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) {
    return cache.snapshot;
  }

  const tenant = tenancyId();
  const provider = await authProvider();
  const { start, end } = monthWindow();
  const warnings: string[] = [];

  const usageClient = new usageapi.UsageapiClient({
    authenticationDetailsProvider: provider,
  });

  // Cost is the headline number, so a failure there is fatal; the rest degrade
  // to warnings so one missing IAM policy doesn't blank the whole page.
  const [cost, forecastCost, usage, resources, budgetRows] = await Promise.all([
    fetchCost(usageClient, tenant, start, end),
    fetchForecast(usageClient, tenant, start, end),
    fetchUsage(usageClient, tenant, start, end).catch((error: unknown) => {
      warnings.push(`Usage quantities unavailable: ${describe(error)}`);
      return [] as UsageLine[];
    }),
    fetchResources(provider).catch((error: unknown) => {
      warnings.push(`Resource inventory unavailable: ${describe(error)}`);
      return [] as ResourceRow[];
    }),
    fetchBudgets(provider, tenant).catch((error: unknown) => {
      warnings.push(`Budgets unavailable: ${describe(error)}`);
      return [] as BudgetRow[];
    }),
  ]);

  const snapshot: OciSnapshot = {
    currency: cost.currency,
    monthToDateCost: cost.total,
    forecastCost,
    byService: cost.byService,
    usage,
    resources,
    freeTier: computeFreeTier(usage),
    budgets: budgetRows,
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    fetchedAt: new Date().toISOString(),
    warnings,
  };

  cache = { at: Date.now(), snapshot };
  return snapshot;
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    return /NotAuthorizedOrNotFound|401|403/.test(error.message)
      ? "IAM policy missing for this read"
      : error.message;
  }
  return String(error);
}
