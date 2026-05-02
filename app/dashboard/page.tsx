// /dashboard — operational view of the outreach system.
// Server component, all queries via Promise.all. Auto-refresh every 30s via
// meta tag. Each section has a one-line explanation in italic gray.

import {
  getKPIs,
  getPipeline,
  getRecentSends,
  getSenderPool,
  getSendWindowState,
  getDiscoveryRuns,
  getSendsBreakdown,
  getCronHeartbeat,
} from "@/lib/insights";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// ─── Style primitives ──────────────────────────────────────────────────

const colors = {
  bg: "#0a0a0a",
  card: "#141414",
  border: "#262626",
  text: "#e5e5e5",
  textDim: "#888",
  textMuted: "#666",
  accent: "#3b82f6",
  ok: "#22c55e",
  warn: "#eab308",
  err: "#ef4444",
};

const styles = {
  page: {
    fontFamily: "system-ui, -apple-system, sans-serif",
    background: colors.bg,
    color: colors.text,
    padding: "1.5rem",
    maxWidth: 1200,
    margin: "0 auto",
  } as React.CSSProperties,
  h1: { fontSize: "1.5rem", margin: "0 0 0.5rem 0" } as React.CSSProperties,
  h2: {
    fontSize: "1.05rem",
    margin: "1.5rem 0 0.25rem 0",
    fontWeight: 600,
  } as React.CSSProperties,
  explain: {
    color: colors.textDim,
    fontSize: 12,
    fontStyle: "italic",
    margin: "0 0 0.75rem 0",
  } as React.CSSProperties,
  card: {
    background: colors.card,
    border: `1px solid ${colors.border}`,
    borderRadius: 8,
    padding: "1rem",
  } as React.CSSProperties,
  kpiGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 12,
  } as React.CSSProperties,
  kpiNum: { fontSize: "1.75rem", fontWeight: 600, lineHeight: 1.1 } as React.CSSProperties,
  kpiLbl: { color: colors.textDim, fontSize: 12, marginTop: 4 } as React.CSSProperties,
  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
    fontSize: 13,
  } as React.CSSProperties,
  th: {
    textAlign: "left" as const,
    color: colors.textDim,
    fontWeight: 500,
    padding: "8px 10px",
    borderBottom: `1px solid ${colors.border}`,
    fontSize: 11,
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
  } as React.CSSProperties,
  td: {
    padding: "8px 10px",
    borderBottom: `1px solid ${colors.border}`,
  } as React.CSSProperties,
  badge: (color: string): React.CSSProperties => ({
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 500,
    background: color + "22",
    color,
    border: `1px solid ${color}44`,
  }),
};

function fmtSubs(n: number | null): string {
  if (n === null || n === undefined) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function fmtAgo(ts: string | null): string {
  if (!ts) return "—";
  const t = new Date(String(ts).replace(" ", "T"));
  const ageMs = Date.now() - t.getTime();
  const m = Math.floor(ageMs / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function fmtTs(ts: string | null): string {
  if (!ts) return "—";
  return String(ts).slice(0, 19).replace("T", " ");
}

function statusBadge(status: string): React.CSSProperties {
  const map: Record<string, string> = {
    sent: colors.ok,
    queued: colors.accent,
    enriched: colors.textDim,
    pending: colors.warn,
    no_email: colors.textMuted,
    low_quality: colors.textMuted,
    bounced: colors.err,
    complained: colors.err,
    opted_out: colors.warn,
    failed: colors.err,
    sent_db_failed: colors.warn,
    active: colors.ok,
    warming: colors.warn,
    paused: colors.warn,
    burned: colors.err,
    provisioning: colors.textDim,
  };
  return styles.badge(map[status] ?? colors.textDim);
}

// ─── Page ──────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  const [
    kpis,
    pipeline,
    recent,
    senders,
    windowState,
    runs,
    breakdown,
    heartbeat,
  ] = await Promise.all([
    getKPIs(),
    getPipeline(),
    getRecentSends(20),
    getSenderPool(),
    Promise.resolve(getSendWindowState()),
    getDiscoveryRuns(10),
    getSendsBreakdown(),
    getCronHeartbeat(),
  ]);

  const utilization = kpis.totalDailyCapacity > 0
    ? Math.round((kpis.sent24h / kpis.totalDailyCapacity) * 100)
    : 0;

  return (
    <>
      <meta httpEquiv="refresh" content="30" />
      <main style={styles.page}>
        <h1 style={styles.h1}>Clipzi Outreach — operational dashboard</h1>
        <p style={styles.explain}>
          Auto-refreshes every 30s. All numbers come from Neon Postgres
          ({heartbeat.totalChannelsKnown.toLocaleString()} channels in DB).
          Last send {fmtAgo(heartbeat.lastSendAt)} · last discovery{" "}
          {fmtAgo(heartbeat.lastDiscoveryAt)}.
        </p>

        {/* ─── KPIs ──────────────────────────────────────────────── */}
        <h2 style={styles.h2}>Key numbers</h2>
        <p style={styles.explain}>
          Sent counts come from <code>sends</code> table (status='sent').
          Sendable = queued channels with email, not yet contacted, not opted-out.
          Capacity = sum of <code>daily_limit</code> across active senders.
        </p>
        <div style={styles.kpiGrid}>
          <KPICard label="Sent all-time" value={kpis.totalSent.toLocaleString()} />
          <KPICard
            label="Sent last 24h"
            value={`${kpis.sent24h} / ${kpis.totalDailyCapacity}`}
            sub={`${utilization}% of daily capacity`}
          />
          <KPICard label="Sent last 7d" value={kpis.sent7d.toLocaleString()} />
          <KPICard
            label="Queued sendable now"
            value={kpis.queuedSendable.toLocaleString()}
            sub={`~${(kpis.queuedSendable / Math.max(1, kpis.totalDailyCapacity)).toFixed(1)} days runway`}
          />
          <KPICard
            label="Failed all-time"
            value={kpis.failedAllTime}
            sub={kpis.failedAllTime > 0 ? "investigate" : "none"}
            color={kpis.failedAllTime > 0 ? colors.warn : undefined}
          />
        </div>

        {/* ─── Pipeline ─────────────────────────────────────────── */}
        <h2 style={styles.h2}>Pipeline funnel</h2>
        <p style={styles.explain}>
          Lifecycle of every channel ever discovered. Sum equals total channels in DB.
          A channel moves: <code>pending</code> → enriched (or no_email/low_quality)
          → if has email and meets threshold → <code>queued</code> → after send →{" "}
          <code>sent</code>.
        </p>
        <div style={styles.card}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Stage</th>
                <th style={{ ...styles.th, textAlign: "right" }}>Count</th>
                <th style={{ ...styles.th, width: "60%" }}>Distribution</th>
              </tr>
            </thead>
            <tbody>
              {pipeline.map((p) => {
                const total = pipeline.reduce((s, x) => s + x.cnt, 0);
                const pct = total > 0 ? (p.cnt / total) * 100 : 0;
                return (
                  <tr key={p.status}>
                    <td style={styles.td}>
                      <span style={statusBadge(p.status)}>{p.status}</span>
                    </td>
                    <td style={{ ...styles.td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {p.cnt.toLocaleString()}
                    </td>
                    <td style={styles.td}>
                      <div
                        style={{
                          background: colors.bg,
                          borderRadius: 4,
                          overflow: "hidden",
                          height: 8,
                        }}
                      >
                        <div
                          style={{
                            width: `${pct}%`,
                            height: "100%",
                            background: colors.accent + "aa",
                          }}
                        />
                      </div>
                      <div style={{ fontSize: 11, color: colors.textDim, marginTop: 2 }}>
                        {pct.toFixed(1)}%
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ─── Senders pool ─────────────────────────────────────── */}
        <h2 style={styles.h2}>Sender pool</h2>
        <p style={styles.explain}>
          Each row is one inbox configured via <code>SENDER_EMAIL_N</code> env.{" "}
          <code>sent_24h</code> is computed from <code>sends.sent_at</code> (rolling
          window, not midnight reset). When sent_24h hits daily_limit, that sender
          is skipped until older sends fall outside the 24h window.
        </p>
        <div style={styles.card}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Email</th>
                <th style={styles.th}>State</th>
                <th style={{ ...styles.th, textAlign: "right" }}>24h / limit</th>
                <th style={{ ...styles.th, textAlign: "right" }}>All-time</th>
                <th style={styles.th}>Last used</th>
              </tr>
            </thead>
            <tbody>
              {senders.map((s) => {
                const pct = (s.sent_24h / s.daily_limit) * 100;
                return (
                  <tr key={s.id}>
                    <td style={styles.td}>{s.email}</td>
                    <td style={styles.td}>
                      <span style={statusBadge(s.state)}>{s.state}</span>
                    </td>
                    <td
                      style={{
                        ...styles.td,
                        textAlign: "right",
                        fontVariantNumeric: "tabular-nums",
                        color: pct > 90 ? colors.warn : colors.text,
                      }}
                    >
                      {s.sent_24h} / {s.daily_limit}
                    </td>
                    <td
                      style={{
                        ...styles.td,
                        textAlign: "right",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {s.sent_total.toLocaleString()}
                    </td>
                    <td style={{ ...styles.td, color: colors.textDim }}>
                      {fmtAgo(s.last_used_at)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ─── Send window ──────────────────────────────────────── */}
        <h2 style={styles.h2}>Send window state (timezone gate)</h2>
        <p style={styles.explain}>
          Only countries whose local hour is within {windowState.window.start}:00–
          {windowState.window.end}:00 are eligible for the next send cron tick.
          Avoids 3 AM emails. <code>{windowState.active.length}</code> in window,{" "}
          <code>{windowState.outside.length}</code> outside. Override with{" "}
          <code>?ignoreWindow=1</code>.
        </p>
        <div style={{ ...styles.card, display: "flex", gap: 24, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 280 }}>
            <div style={{ color: colors.ok, fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
              ✓ IN WINDOW ({windowState.active.length})
            </div>
            <div style={{ fontSize: 11, color: colors.textDim, lineHeight: 1.6 }}>
              {windowState.active
                .map((c) => `${c.country} ${c.hour}:00`)
                .join(" · ")}
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 280 }}>
            <div style={{ color: colors.textMuted, fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
              ⏸ OUTSIDE ({windowState.outside.length})
            </div>
            <div style={{ fontSize: 11, color: colors.textMuted, lineHeight: 1.6 }}>
              {windowState.outside
                .map((c) => `${c.country} ${c.hour}:00`)
                .join(" · ")}
            </div>
          </div>
        </div>

        {/* ─── Recent sends ─────────────────────────────────────── */}
        <h2 style={styles.h2}>Recent sends (last 20)</h2>
        <p style={styles.explain}>
          Most recent rows from <code>sends</code> table. Status = the actual API
          outcome. Lang = which template was used. Sender = which inbox the email
          went out from.
        </p>
        <div style={styles.card}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>When</th>
                <th style={styles.th}>Channel</th>
                <th style={{ ...styles.th, textAlign: "right" }}>Subs</th>
                <th style={styles.th}>Country</th>
                <th style={styles.th}>Lang</th>
                <th style={styles.th}>Email</th>
                <th style={styles.th}>Sender</th>
                <th style={styles.th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {recent.length === 0 && (
                <tr>
                  <td style={styles.td} colSpan={8}>
                    <em style={{ color: colors.textDim }}>(no sends yet)</em>
                  </td>
                </tr>
              )}
              {recent.map((r, i) => (
                <tr key={r.channel_id + i}>
                  <td style={{ ...styles.td, color: colors.textDim, whiteSpace: "nowrap" }}>
                    {fmtAgo(r.sent_at)}
                  </td>
                  <td style={styles.td}>{r.clean_name || r.channel_title}</td>
                  <td
                    style={{
                      ...styles.td,
                      textAlign: "right",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {fmtSubs(r.subscribers)}
                  </td>
                  <td style={{ ...styles.td, color: colors.textDim }}>
                    {r.country ?? "—"}
                  </td>
                  <td style={{ ...styles.td, color: colors.textDim }}>
                    {r.language ?? "—"}
                  </td>
                  <td style={{ ...styles.td, fontSize: 11, color: colors.textDim }}>
                    {r.email}
                  </td>
                  <td style={{ ...styles.td, fontSize: 11, color: colors.textDim }}>
                    {r.sender ?? "—"}
                  </td>
                  <td style={styles.td}>
                    <span style={statusBadge(r.status)}>{r.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ─── Discovery runs ───────────────────────────────────── */}
        <h2 style={styles.h2}>Discovery runs (last 10)</h2>
        <p style={styles.explain}>
          Each row is one cron invocation of <code>/api/cron/discovery</code>.
          <strong> Freshness</strong> = % of seen channels that were truly NEW.
          <strong> Qualified</strong> = % of new channels that had email + score
          ≥ threshold (became <code>queued</code>). Errors here mean the run
          aborted.
        </p>
        <div style={styles.card}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>When</th>
                <th style={styles.th}>Source</th>
                <th style={{ ...styles.th, textAlign: "right" }}>Quota</th>
                <th style={{ ...styles.th, textAlign: "right" }}>Seen</th>
                <th style={{ ...styles.th, textAlign: "right" }}>New</th>
                <th style={{ ...styles.th, textAlign: "right" }}>Qualified</th>
                <th style={{ ...styles.th, textAlign: "right" }}>Fresh</th>
                <th style={{ ...styles.th, textAlign: "right" }}>Qual</th>
                <th style={{ ...styles.th, textAlign: "right" }}>Dur (s)</th>
                <th style={styles.th}>Error</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td style={{ ...styles.td, color: colors.textDim, whiteSpace: "nowrap" }}>
                    {fmtAgo(r.started_at)}
                  </td>
                  <td style={{ ...styles.td, fontSize: 11 }}>{r.source}</td>
                  <td style={{ ...styles.td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {r.quota_used}
                  </td>
                  <td style={{ ...styles.td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {r.channels_seen.toLocaleString()}
                  </td>
                  <td style={{ ...styles.td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {r.channels_new.toLocaleString()}
                  </td>
                  <td style={{ ...styles.td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {r.qualified_new.toLocaleString()}
                  </td>
                  <td
                    style={{
                      ...styles.td,
                      textAlign: "right",
                      fontVariantNumeric: "tabular-nums",
                      color: r.freshness_pct > 50 ? colors.ok : r.freshness_pct > 10 ? colors.warn : colors.textDim,
                    }}
                  >
                    {r.freshness_pct.toFixed(1)}%
                  </td>
                  <td
                    style={{
                      ...styles.td,
                      textAlign: "right",
                      fontVariantNumeric: "tabular-nums",
                      color: colors.textDim,
                    }}
                  >
                    {r.qualified_pct.toFixed(1)}%
                  </td>
                  <td style={{ ...styles.td, textAlign: "right", color: colors.textDim }}>
                    {r.duration_s ?? "—"}
                  </td>
                  <td
                    style={{
                      ...styles.td,
                      fontSize: 10,
                      color: r.error ? colors.err : colors.textDim,
                      maxWidth: 200,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {r.error ? r.error.slice(0, 60) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ─── Breakdown ────────────────────────────────────────── */}
        <h2 style={styles.h2}>Sends breakdown — last 7 days</h2>
        <p style={styles.explain}>
          Distribution of successful sends in the last 7 days. <code>?</code> =
          legacy migration sends without language metadata. <code>(null)</code> =
          channels without country in YT API.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <BreakdownCard title="By language" rows={breakdown.byLanguage} />
          <BreakdownCard title="By country (top 15)" rows={breakdown.byCountry} />
        </div>

        {/* ─── Cron heartbeat ───────────────────────────────────── */}
        <h2 style={styles.h2}>Cron heartbeat</h2>
        <p style={styles.explain}>
          Last successful invocation of each cron. If "last send" is &gt;90 min
          old, the hourly cron is broken (or all senders capped + no candidates
          in window).
        </p>
        <div style={styles.card}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: 13 }}>
            <div>
              <strong>Send cron</strong>
              <div style={{ color: colors.textDim, marginTop: 4 }}>
                Last fired: {fmtTs(heartbeat.lastSendAt)} ({fmtAgo(heartbeat.lastSendAt)})
              </div>
              <div style={{ color: colors.textDim }}>
                Sends in last 24h: {heartbeat.lastSendCount24h}
              </div>
              <div style={{ color: colors.textDim }}>
                Schedule: <code>19 * * * *</code> (HH:19 UTC each hour)
              </div>
            </div>
            <div>
              <strong>Discovery cron</strong>
              <div style={{ color: colors.textDim, marginTop: 4 }}>
                Last fired: {fmtTs(heartbeat.lastDiscoveryAt)} ({fmtAgo(heartbeat.lastDiscoveryAt)})
              </div>
              <div style={{ color: colors.textDim }}>
                Last run id: #{heartbeat.lastDiscoveryRunId}
              </div>
              <div style={{ color: colors.textDim }}>
                Schedule: <code>0 */6 * * *</code> (every 6h, on the hour)
              </div>
            </div>
          </div>
        </div>

        <p style={{ ...styles.explain, marginTop: "2rem", textAlign: "center" }}>
          Updated {new Date().toISOString().slice(11, 19)}Z · v.{process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev"}
        </p>
      </main>
    </>
  );
}

// ─── Components ────────────────────────────────────────────────────────

function KPICard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}) {
  return (
    <div style={styles.card}>
      <div style={{ ...styles.kpiNum, color: color ?? colors.text }}>{value}</div>
      <div style={styles.kpiLbl}>{label}</div>
      {sub && (
        <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 4 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function BreakdownCard({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ key: string; cnt: number }>;
}) {
  const total = rows.reduce((s, r) => s + r.cnt, 0);
  return (
    <div style={styles.card}>
      <div style={{ fontSize: 12, color: colors.textDim, marginBottom: 8 }}>
        {title} · total {total.toLocaleString()}
      </div>
      {rows.length === 0 && (
        <em style={{ color: colors.textDim, fontSize: 12 }}>(no data)</em>
      )}
      {rows.map((r) => {
        const pct = total > 0 ? (r.cnt / total) * 100 : 0;
        return (
          <div key={r.key} style={{ marginBottom: 4 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 12,
                marginBottom: 2,
              }}
            >
              <span>{r.key}</span>
              <span style={{ color: colors.textDim, fontVariantNumeric: "tabular-nums" }}>
                {r.cnt} <span style={{ fontSize: 10, color: colors.textMuted }}>({pct.toFixed(0)}%)</span>
              </span>
            </div>
            <div
              style={{
                background: colors.bg,
                borderRadius: 2,
                height: 4,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${pct}%`,
                  height: "100%",
                  background: colors.accent + "aa",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
