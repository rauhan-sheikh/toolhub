"use client";

import { useCallback, useEffect, useState } from "react";
import { Spinner } from "@/components/icons";
import type { OciSnapshot } from "@/lib/oci";

type Payload =
  | { available: true; snapshot: OciSnapshot }
  | { available: false; error: string };

export function CloudWatchTool() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);

  // Pure fetch, no setState: the effect below must not update state
  // synchronously in its body, or it triggers cascading renders.
  const fetchSnapshot = useCallback(
    async (refresh = false): Promise<Payload> => {
      try {
        const response = await fetch(
          `/api/oracle${refresh ? "?refresh=1" : ""}`,
          { cache: "no-store" },
        );
        return (await response.json()) as Payload;
      } catch {
        return { available: false, error: "Couldn't reach the server." };
      }
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    fetchSnapshot().then((payload) => {
      if (cancelled) return;
      setData(payload);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchSnapshot]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const payload = await fetchSnapshot(true);
    setData(payload);
    setLoading(false);
  }, [fetchSnapshot]);

  if (loading && !data) {
    return (
      <p className="flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-5 py-6 text-sm text-[var(--muted)]">
        <Spinner /> Asking Oracle what it has been charging…
      </p>
    );
  }

  if (!data || !data.available) {
    return <NotAvailable error={data?.error ?? "Unknown error"} />;
  }

  const s = data.snapshot;
  const billing = s.monthToDateCost > 0;
  const money = (n: number) =>
    `${s.currency === "USD" ? "$" : `${s.currency} `}${n.toFixed(2)}`;

  return (
    <div className="space-y-5">
      <Verdict billing={billing} amount={money(s.monthToDateCost)} />

      <BudgetGuard budgets={s.budgets} money={money} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Stat
          label="Month to date"
          value={money(s.monthToDateCost)}
          hint={new Date(s.periodStart).toLocaleDateString(undefined, {
            month: "long",
            year: "numeric",
          })}
          alarming={billing}
        />
        <Stat
          label="Forecast to month end"
          value={s.forecastCost === null ? "—" : money(s.forecastCost)}
          hint={
            s.forecastCost === null
              ? "Oracle won't forecast yet"
              : "Oracle's own projection"
          }
          alarming={(s.forecastCost ?? 0) > 0}
        />
      </div>

      {s.freeTier.length > 0 && (
        <Panel
          title="Always Free headroom"
          note="Cost stays at zero right up until an allowance is crossed. Projection extrapolates this month's rate to month end."
        >
          <div className="space-y-4">
            {s.freeTier.map((row) => (
              <Allowance key={row.label} row={row} />
            ))}
          </div>
        </Panel>
      )}

      {s.byService.length > 0 && (
        <Panel title="What is costing money">
          <Table
            head={["Service", "Cost"]}
            rows={s.byService.map((r) => [r.service, money(r.cost)])}
          />
        </Panel>
      )}

      {s.usage.length > 0 && (
        <Panel
          title="Metered usage"
          note="Quantities Oracle has metered this month. Free-tier usage appears here too — it simply costs nothing."
        >
          <Table
            head={["Service", "SKU", "Quantity"]}
            rows={s.usage.map((r) => [
              r.service,
              r.sku,
              `${r.quantity.toLocaleString(undefined, {
                maximumFractionDigits: 2,
              })}${r.unit ? ` ${r.unit}` : ""}`,
            ])}
          />
        </Panel>
      )}

      {s.resources.length > 0 && (
        <Panel
          title={`Everything in the tenancy (${s.resources.length})`}
          note="Anything here can potentially bill. If you don't recognise something, that's the thing to look at."
        >
          <Table
            head={["Type", "Name"]}
            rows={s.resources.map((r) => [r.type, r.name])}
          />
        </Panel>
      )}

      {s.warnings.length > 0 && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5">
          <h3 className="text-sm font-semibold text-amber-100">
            Partial data
          </h3>
          <ul className="mt-2 space-y-1">
            {s.warnings.map((w) => (
              <li key={w} className="text-sm text-amber-200/80">
                {w}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--muted)]">
        <span>
          Fetched {new Date(s.fetchedAt).toLocaleTimeString()} · cached 5 min
        </span>
        <button
          onClick={refresh}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-1.5 transition hover:border-white/25 hover:text-[var(--foreground)] disabled:opacity-50"
        >
          {loading && <Spinner className="h-3 w-3" />}
          Refresh
        </button>
      </div>
    </div>
  );
}

function Allowance({ row }: { row: OciSnapshot["freeTier"][number] }) {
  const danger = row.percentProjected >= 100;
  const warn = !danger && row.percentProjected >= 80;
  const bar = danger
    ? "bg-red-500"
    : warn
      ? "bg-amber-400"
      : "bg-emerald-500";

  const fmt = (n: number) =>
    n.toLocaleString(undefined, { maximumFractionDigits: 0 });

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
        <span>{row.label}</span>
        <span className="tabular-nums text-[var(--muted)]">
          {fmt(row.used)} / {fmt(row.limit)} {row.unit}
          <span className="ml-2 text-xs">
            ({row.percentUsed.toFixed(0)}%)
          </span>
        </span>
      </div>

      <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-white/10">
        {/* Projection sits behind as a ghost, actual usage in front. */}
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-white/15"
          style={{ width: `${Math.min(100, row.percentProjected)}%` }}
        />
        <div
          className={`absolute inset-y-0 left-0 rounded-full ${bar}`}
          style={{ width: `${Math.min(100, row.percentUsed)}%` }}
        />
      </div>

      <p
        className={`mt-1 text-xs ${
          danger ? "text-red-300" : warn ? "text-amber-300" : "text-[var(--muted)]"
        }`}
      >
        {danger
          ? `On track to exceed the free allowance — projected ${fmt(row.projected)} ${row.unit} (${row.percentProjected.toFixed(0)}%). This will bill.`
          : `Projected ${fmt(row.projected)} ${row.unit} by month end (${row.percentProjected.toFixed(0)}%).`}
      </p>
    </div>
  );
}

function Verdict({ billing, amount }: { billing: boolean; amount: string }) {
  return (
    <div
      className={`rounded-2xl border p-6 ${
        billing
          ? "border-red-500/40 bg-red-500/10"
          : "border-emerald-500/30 bg-emerald-500/10"
      }`}
    >
      <p
        className={`text-2xl font-semibold tracking-tight ${
          billing ? "text-red-200" : "text-emerald-200"
        }`}
      >
        {billing
          ? `You are being charged ${amount} this month`
          : "Nothing is being charged"}
      </p>
      <p
        className={`mt-2 text-sm leading-6 ${
          billing ? "text-red-200/80" : "text-emerald-200/70"
        }`}
      >
        {billing
          ? "Something outside the Always Free allowances is running. The breakdown below shows which service."
          : "Everything running is inside the Always Free allowances."}
      </p>
    </div>
  );
}

/**
 * The budget is the only thing that actually warns you when you're not looking,
 * so its absence is treated as a finding rather than an empty list.
 */
function BudgetGuard({
  budgets,
  money,
}: {
  budgets: OciSnapshot["budgets"];
  money: (n: number) => string;
}) {
  if (budgets.length === 0) {
    return (
      <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5">
        <h3 className="text-sm font-semibold text-amber-100">
          No budget alert is configured
        </h3>
        <p className="mt-2 text-sm leading-6 text-amber-200/80">
          This page only helps when you open it. An Oracle budget emails you
          within 24 hours of the first cent, even if this server is down — which
          is exactly when you&rsquo;d want to hear about it. Set one at Billing
          &rarr; Budgets with a $1 monthly amount and an alert at 1% of actual
          spend.
        </p>
      </div>
    );
  }

  return (
    <Panel title="Budget alerts">
      <Table
        head={["Budget", "Amount", "Spent", "Alert rules"]}
        rows={budgets.map((b) => [
          b.name,
          money(b.amount),
          money(b.spent),
          b.alertRules === 0 ? "none — will not notify" : String(b.alertRules),
        ])}
      />
    </Panel>
  );
}

function NotAvailable({ error }: { error: string }) {
  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-6">
      <h2 className="text-sm font-semibold text-amber-100">
        Cloud Watch isn&rsquo;t reading your tenancy yet
      </h2>
      <p className="mt-2 text-sm leading-6 text-amber-200/80">{error}</p>
      <p className="mt-4 text-sm leading-6 text-amber-200/70">
        This needs two things: <code className="rounded bg-black/30 px-1.5 py-0.5 text-xs">OCI_TENANCY_OCID</code>{" "}
        in the server&rsquo;s <code className="rounded bg-black/30 px-1.5 py-0.5 text-xs">.env</code>, and a Dynamic
        Group plus tenancy-wide read policy so the VM may read billing data.
        Setup steps are in <code className="rounded bg-black/30 px-1.5 py-0.5 text-xs">DEPLOY.md</code>.
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  alarming,
}: {
  label: string;
  value: string;
  hint: string;
  alarming?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
        {label}
      </p>
      <p
        className={`mt-2 text-2xl font-semibold break-words tabular-nums sm:text-3xl ${
          alarming ? "text-red-300" : ""
        }`}
      >
        {value}
      </p>
      <p className="mt-1 text-xs text-[var(--muted)]">{hint}</p>
    </div>
  );
}

function Panel({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
      {note && (
        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{note}</p>
      )}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <>
      {/* Phones get one card per row. Resource names like a full DNS zone are
          long and arbitrary, so a real table here would force the reader to
          scroll sideways inside the panel to see the values. */}
      <ul className="space-y-2.5 sm:hidden">
        {rows.map((row, i) => (
          <li
            key={i}
            className="rounded-xl border border-[var(--border)] bg-black/20 p-3"
          >
            {row.map((cell, j) => (
              <div
                key={j}
                className="flex items-baseline justify-between gap-3 py-0.5"
              >
                <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">
                  {head[j]}
                </span>
                <span
                  className={`min-w-0 break-words text-right text-sm ${
                    j === 0 ? "" : "tabular-nums"
                  }`}
                >
                  {cell}
                </span>
              </div>
            ))}
          </li>
        ))}
      </ul>

      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-left">
              {head.map((h) => (
                <th
                  key={h}
                  className="pb-2 text-xs font-medium uppercase tracking-wide text-[var(--muted)]"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={i}
                className="border-b border-[var(--border)]/50 last:border-0"
              >
                {row.map((cell, j) => (
                  <td
                    key={j}
                    className={`py-2 pr-4 align-top break-words ${
                      j === 0 ? "" : "tabular-nums text-[var(--muted)]"
                    }`}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

