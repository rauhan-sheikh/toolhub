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
  quantity: number;
  unit: string;
};

export type ResourceRow = {
  type: string;
  name: string;
  compartmentId: string;
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

async function fetchUsage(
  client: usageapi.UsageapiClient,
  tenant: string,
  start: Date,
  end: Date,
): Promise<UsageLine[]> {
  const response = await client.requestSummarizedUsages({
    requestSummarizedUsagesDetails: {
      tenantId: tenant,
      timeUsageStarted: start,
      timeUsageEnded: end,
      granularity:
        usageapi.models.RequestSummarizedUsagesDetails.Granularity.Monthly,
      queryType:
        usageapi.models.RequestSummarizedUsagesDetails.QueryType.UsageOnly,
      isAggregateByTime: true,
      groupBy: ["service", "skuName", "unit"],
    },
  });

  const lines = new Map<string, UsageLine>();
  for (const item of response.usageAggregation?.items ?? []) {
    if (item.isForecast) continue;
    const service = item.service ?? "Unknown";
    const sku = item.skuName ?? "—";
    const unit = item.unit ?? "";
    const key = `${service}|${sku}|${unit}`;
    const existing = lines.get(key);
    const quantity = item.computedQuantity ?? 0;
    if (existing) existing.quantity += quantity;
    else lines.set(key, { service, sku, quantity, unit });
  }

  return [...lines.values()]
    .filter((line) => line.quantity > 0)
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

let cache: { at: number; snapshot: OciSnapshot } | null = null;
const CACHE_MS = 5 * 60 * 1000;

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
  const cost = await fetchCost(usageClient, tenant, start, end);

  const [forecastCost, usage, resources, budgetRows] = await Promise.all([
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
