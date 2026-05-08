// /dashboard — operador-friendly view, simplificado.
// Server component, queries en paralelo, auto-refresh cada 30s.

import {
  getKPIs,
  getPipeline,
  getRecentSends,
  getSenderPool,
  getSendWindowState,
  getDiscoveryRuns,
  getSendsBreakdown,
  getCronHeartbeat,
  getAgencyStats,
  getLastAgencyRun,
  getStandupStats,
  getLastStandupRun,
  getMediaOrgStats,
  getLastMediaOrgRun,
  getBouncerStats,
} from "@/lib/insights";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const c = {
  bg: "#0a0a0a",
  card: "#141414",
  cardHi: "#1a1a1a",
  border: "#262626",
  text: "#e8e8e8",
  dim: "#888",
  muted: "#5a5a5a",
  accent: "#3b82f6",
  ok: "#22c55e",
  warn: "#eab308",
  err: "#ef4444",
};

const s = {
  page: {
    fontFamily: "system-ui, -apple-system, sans-serif",
    background: c.bg,
    color: c.text,
    padding: "1.5rem",
    maxWidth: 1100,
    margin: "0 auto",
  } as React.CSSProperties,
  h1: {
    fontSize: "1.4rem",
    margin: 0,
    fontWeight: 600,
  } as React.CSSProperties,
  section: { marginTop: "2rem" } as React.CSSProperties,
  h2: {
    fontSize: "0.95rem",
    margin: "0 0 0.25rem 0",
    fontWeight: 600,
    color: c.text,
  } as React.CSSProperties,
  hint: {
    color: c.dim,
    fontSize: 12,
    margin: "0 0 0.75rem 0",
    lineHeight: 1.4,
  } as React.CSSProperties,
  card: {
    background: c.card,
    border: `1px solid ${c.border}`,
    borderRadius: 8,
    padding: "1rem",
  } as React.CSSProperties,
  num: {
    fontSize: "1.75rem",
    fontWeight: 600,
    fontVariantNumeric: "tabular-nums" as const,
    lineHeight: 1.1,
  } as React.CSSProperties,
  numLbl: { color: c.dim, fontSize: 12, marginTop: 4 } as React.CSSProperties,
  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
    fontSize: 13,
  } as React.CSSProperties,
  th: {
    textAlign: "left" as const,
    color: c.muted,
    fontWeight: 500,
    padding: "8px 10px",
    borderBottom: `1px solid ${c.border}`,
    fontSize: 11,
    textTransform: "uppercase" as const,
    letterSpacing: 0.4,
  } as React.CSSProperties,
  td: {
    padding: "8px 10px",
    borderBottom: `1px solid ${c.border}`,
  } as React.CSSProperties,
  chip: (color: string): React.CSSProperties => ({
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

function parseTs(ts: string | null | undefined): Date | null {
  if (!ts) return null;
  // neon-http returns Postgres timestamps like '2026-05-03 04:19:52.923+00'.
  // JS Date can't reliably parse '+00' as a timezone — needs '+00:00' or 'Z'.
  const normalized = String(ts)
    .replace(" ", "T")
    .replace(/([+-])(\d{2})$/, "$1$2:00");
  const t = new Date(normalized);
  return Number.isNaN(t.getTime()) ? null : t;
}

function ago(ts: string | null): string {
  if (!ts) return "nunca";
  const t = parseTs(ts);
  if (!t) return "?";
  const m = Math.floor((Date.now() - t.getTime()) / 60000);
  if (m < 1) return "ahora";
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${fmtDuration(m)}`;
  return `hace ${Math.floor(h / 24)}d`;
}

// Format minute count as "Xh Ym" or "Xh" or "Ym".
function fmtDuration(totalMinutes: number): string {
  if (totalMinutes < 1) return "menos de 1m";
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function langLabel(code: string | null): string {
  if (!code) return "—";
  const map: Record<string, string> = {
    en: "Inglés",
    es: "Español",
    pt: "Portugués",
    de: "Alemán",
    fr: "Francés",
    it: "Italiano",
  };
  return map[code] ?? code;
}

const COUNTRY_NAMES: Record<string, string> = {
  // Americas
  US: "Estados Unidos", CA: "Canadá", MX: "México", BR: "Brasil",
  AR: "Argentina", CO: "Colombia", CL: "Chile", PE: "Perú",
  EC: "Ecuador", VE: "Venezuela", UY: "Uruguay", PY: "Paraguay",
  BO: "Bolivia", CR: "Costa Rica", CU: "Cuba", DO: "República Dominicana",
  GT: "Guatemala", NI: "Nicaragua", PA: "Panamá", PR: "Puerto Rico",
  SV: "El Salvador", HN: "Honduras", JM: "Jamaica", TT: "Trinidad y Tobago",
  // Europe
  GB: "Reino Unido", IE: "Irlanda", DE: "Alemania", FR: "Francia",
  IT: "Italia", ES: "España", PT: "Portugal", NL: "Países Bajos",
  BE: "Bélgica", LU: "Luxemburgo", MC: "Mónaco", CH: "Suiza", AT: "Austria",
  SE: "Suecia", DK: "Dinamarca", FI: "Finlandia", NO: "Noruega",
  IS: "Islandia", PL: "Polonia", CZ: "Chequia", SK: "Eslovaquia",
  SI: "Eslovenia", HR: "Croacia", HU: "Hungría", RO: "Rumania",
  BG: "Bulgaria", GR: "Grecia", RS: "Serbia", MT: "Malta",
  EE: "Estonia", LT: "Lituania", LV: "Letonia", TR: "Turquía",
  UA: "Ucrania", RU: "Rusia",
  // Asia / Pacific
  IN: "India", PH: "Filipinas", ID: "Indonesia", JP: "Japón",
  KR: "Corea", CN: "China", HK: "Hong Kong", TW: "Taiwán",
  TH: "Tailandia", VN: "Vietnam", MY: "Malasia", SG: "Singapur",
  AE: "Emiratos Árabes", BD: "Bangladesh", PK: "Pakistán",
  IL: "Israel", SA: "Arabia Saudita", AU: "Australia", NZ: "Nueva Zelanda",
  // Africa
  EG: "Egipto", KE: "Kenia", GH: "Ghana", NG: "Nigeria",
  MA: "Marruecos", ZA: "Sudáfrica", SN: "Senegal", CI: "Costa de Marfil",
  AO: "Angola", MZ: "Mozambique",
};

function countryLabel(code: string | null): string {
  if (!code || code === "(null)" || code === "?") return "Desconocido";
  return COUNTRY_NAMES[code] ?? code;
}

// ─── Page ──────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  const [
    kpis, pipeline, recent, senders, win, runs, breakdown, heart,
    agencyStats, lastAgencyRun, standupStats, lastStandupRun,
    mediaOrgStats, lastMediaOrgRun, bouncerStats,
  ] = await Promise.all([
    getKPIs(),
    getPipeline(),
    getRecentSends(15),
    getSenderPool(),
    Promise.resolve(getSendWindowState()),
    getDiscoveryRuns(5),
    getSendsBreakdown(),
    getCronHeartbeat(),
    getAgencyStats(),
    getLastAgencyRun(),
    getStandupStats(),
    getLastStandupRun(),
    getMediaOrgStats(),
    getLastMediaOrgRun(),
    getBouncerStats(),
  ]);

  const utilization = kpis.totalDailyCapacity > 0
    ? Math.round((kpis.sent24h / kpis.totalDailyCapacity) * 100)
    : 0;
  const runwayDays = kpis.queuedSendable / Math.max(1, kpis.totalDailyCapacity);

  // Get pipeline numbers we care about (rest into "other")
  const totalChannels = pipeline.reduce((a, p) => a + p.cnt, 0);
  const queued = pipeline.find((p) => p.status === "queued")?.cnt ?? 0;
  const sent = pipeline.find((p) => p.status === "sent")?.cnt ?? 0;
  const noEmail = pipeline.find((p) => p.status === "no_email")?.cnt ?? 0;

  // System health
  const lastSendTime = parseTs(heart.lastSendAt);
  const lastSendMinutesAgo = lastSendTime
    ? Math.floor((Date.now() - lastSendTime.getTime()) / 60000)
    : Infinity;
  const lastRun = runs[0];
  const discoveryHealthy = lastRun && !lastRun.error;
  const sendHealthy = lastSendMinutesAgo < 90; // last cron should fire every hour

  // Active language code → label for the breakdown
  const top7dByLang = breakdown.byLanguage.filter((x) => x.key !== "?");
  const legacyLangCount = breakdown.byLanguage.find((x) => x.key === "?")?.cnt ?? 0;

  return (
    <>
      <meta httpEquiv="refresh" content="30" />
      <main style={s.page}>
        {/* HEADER + STATUS */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <h1 style={s.h1}>Clipzi Outreach</h1>
          <div style={{ fontSize: 13, color: c.dim, display: "flex", gap: 12 }}>
            <a
              href="/dashboard/templates"
              style={{ color: c.dim, textDecoration: "underline" }}
            >
              plantillas
            </a>
            <a
              href="/api/logout"
              style={{ color: c.dim, textDecoration: "underline" }}
            >
              salir
            </a>
          </div>
        </div>
        <div style={{ marginTop: 4, fontSize: 13, color: c.dim }}>
          {sendHealthy && discoveryHealthy ? (
            <span>
              <span style={{ color: c.ok }}>● </span>
              Sistema funcionando · último envío {ago(heart.lastSendAt)}
            </span>
          ) : (
            <span>
              <span style={{ color: c.warn }}>⚠ </span>
              {!sendHealthy && (
                <>Sin envíos hace {fmtDuration(lastSendMinutesAgo)}. </>
              )}
              {!discoveryHealthy && lastRun?.error && (
                <>Discovery falló: {String(lastRun.error).slice(0, 80)}</>
              )}
            </span>
          )}
        </div>

        {/* SECTION 1: HOY */}
        <section style={s.section}>
          <h2 style={s.h2}>Hoy</h2>
          <p style={s.hint}>
            Lo que pasó en las últimas 24 horas. Mandamos 1 email por canal,
            jamás repetimos. Mix configurado:{" "}
            {(() => {
              const agency = Math.max(0, Math.min(100, Number(process.env.AGENCY_SEND_RATIO ?? "20")));
              const standup = Math.max(0, Math.min(100, Number(process.env.STANDUP_SEND_RATIO ?? "10")));
              const mediaOrg = Math.max(0, Math.min(100, Number(process.env.MEDIA_ORG_SEND_RATIO ?? "10")));
              const creator = Math.max(0, 100 - agency - standup - mediaOrg);
              return `${creator}% creadores · ${agency}% agencias · ${standup}% standup · ${mediaOrg}% media-org`;
            })()}.
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 12,
            }}
          >
            <div style={s.card}>
              <div style={s.num}>{kpis.sent24h}</div>
              <div style={s.numLbl}>
                Emails enviados
                <div style={{ color: c.muted, fontSize: 11, marginTop: 2 }}>
                  {utilization}% de la capacidad diaria ({kpis.totalDailyCapacity})
                </div>
              </div>
            </div>
            <div style={s.card}>
              <div style={{ ...s.num, color: kpis.failedAllTime > 0 ? c.warn : c.text }}>
                {kpis.failedAllTime}
              </div>
              <div style={s.numLbl}>
                Fallidos (todo el tiempo)
                <div style={{ color: c.muted, fontSize: 11, marginTop: 2 }}>
                  {kpis.failedAllTime === 0 ? "todo OK" : "revisar errores"}
                </div>
              </div>
            </div>
            <div style={s.card}>
              <div style={s.num}>{kpis.sent7d}</div>
              <div style={s.numLbl}>
                Esta semana
                <div style={{ color: c.muted, fontSize: 11, marginTop: 2 }}>
                  últimos 7 días
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 2: CARTERA */}
        <section style={s.section}>
          <h2 style={s.h2}>Cartera</h2>
          <p style={s.hint}>
            Canales que descubrimos. Algunos no tienen email público, otros sí
            pero ya los contactamos. Los <em>listos para enviar</em> son los
            que el cron va a procesar las próximas horas.
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: 12,
            }}
          >
            <div style={s.card}>
              <div style={{ ...s.num, color: c.accent }}>
                {kpis.queuedSendable.toLocaleString()}
              </div>
              <div style={s.numLbl}>
                Listos para enviar
                <div style={{ color: c.muted, fontSize: 11, marginTop: 2 }}>
                  alcanza para ~{runwayDays.toFixed(0)} días al ritmo actual
                </div>
              </div>
            </div>
            <div style={s.card}>
              <div style={s.num}>{kpis.totalSent.toLocaleString()}</div>
              <div style={s.numLbl}>
                Ya contactados
                <div style={{ color: c.muted, fontSize: 11, marginTop: 2 }}>
                  histórico (legacy + Vercel)
                </div>
              </div>
            </div>
            <div style={s.card}>
              <div style={s.num}>{totalChannels.toLocaleString()}</div>
              <div style={s.numLbl}>
                Canales descubiertos en total
                <div style={{ color: c.muted, fontSize: 11, marginTop: 2 }}>
                  {noEmail.toLocaleString()} sin email · resto en proceso
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 3: CASILLAS */}
        <section style={s.section}>
          <h2 style={s.h2}>Casillas de envío</h2>
          <p style={s.hint}>
            Cada email desde el que mandamos. Si una se acerca al límite diario,
            el sistema rota a las otras automáticamente.
          </p>
          <div style={s.card}>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>Email</th>
                  <th style={{ ...s.th, textAlign: "right" }}>Hoy</th>
                  <th style={{ ...s.th, textAlign: "right" }}>Histórico</th>
                  <th style={s.th}>Último envío</th>
                </tr>
              </thead>
              <tbody>
                {senders.map((sd) => {
                  const pct = sd.daily_limit > 0 ? (sd.sent_24h / sd.daily_limit) * 100 : 0;
                  return (
                    <tr key={sd.id}>
                      <td style={s.td}>{sd.email}</td>
                      <td
                        style={{
                          ...s.td,
                          textAlign: "right",
                          fontVariantNumeric: "tabular-nums",
                          color: pct > 90 ? c.warn : c.text,
                        }}
                      >
                        {sd.sent_24h} / {sd.daily_limit}
                      </td>
                      <td
                        style={{
                          ...s.td,
                          textAlign: "right",
                          fontVariantNumeric: "tabular-nums",
                          color: c.dim,
                        }}
                      >
                        {sd.sent_total.toLocaleString()}
                      </td>
                      <td style={{ ...s.td, color: c.dim }}>{ago(sd.last_used_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* SECTION 4: HORARIO */}
        <section style={s.section}>
          <h2 style={s.h2}>Horario de envío</h2>
          <p style={s.hint}>
            Solo mandamos cuando el reloj local del recipiente está entre las{" "}
            {win.window.start}h y las {win.window.end}h. Esto evita que llegue
            un email a las 3 AM y baja el riesgo de spam.
          </p>
          <div style={s.card}>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 13, color: c.ok, fontWeight: 600 }}>
                  ● {win.active.length} países activos ahora
                </div>
                <div style={{ fontSize: 11, color: c.dim, marginTop: 4, lineHeight: 1.5 }}>
                  {win.active.slice(0, 12).map((x) => countryLabel(x.country)).join(" · ")}
                  {win.active.length > 12 && ` · +${win.active.length - 12} más`}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 13, color: c.muted, fontWeight: 600 }}>
                  ○ {win.outside.length} países fuera de horario
                </div>
                <div style={{ fontSize: 11, color: c.muted, marginTop: 4, lineHeight: 1.5 }}>
                  esperan a que su reloj local entre en {win.window.start}h–{win.window.end}h
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 5: ÚLTIMOS ENVÍOS */}
        <section style={s.section}>
          <h2 style={s.h2}>Últimos envíos</h2>
          <p style={s.hint}>
            Los 15 más recientes. Cada fila es un email único a un canal único.
          </p>
          <div style={s.card}>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>Cuándo</th>
                  <th style={s.th}>Canal</th>
                  <th style={{ ...s.th, textAlign: "right" }}>Subs</th>
                  <th style={s.th}>País</th>
                  <th style={s.th}>Idioma</th>
                  <th style={s.th}>Email</th>
                  <th style={s.th}>Estado</th>
                </tr>
              </thead>
              <tbody>
                {recent.length === 0 && (
                  <tr>
                    <td style={s.td} colSpan={7}>
                      <em style={{ color: c.dim }}>(no hay envíos aún)</em>
                    </td>
                  </tr>
                )}
                {recent.map((r, i) => (
                  <tr key={r.channel_id + i}>
                    <td style={{ ...s.td, color: c.dim, whiteSpace: "nowrap" }}>
                      {ago(r.sent_at)}
                    </td>
                    <td style={s.td}>{r.clean_name || r.channel_title}</td>
                    <td style={{ ...s.td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {fmtSubs(r.subscribers)}
                    </td>
                    <td style={{ ...s.td, color: c.dim }}>
                      {countryLabel(r.country)}
                    </td>
                    <td style={{ ...s.td, color: c.dim }}>
                      {langLabel(r.language)}
                    </td>
                    <td style={{ ...s.td, fontSize: 11, color: c.dim }}>{r.email}</td>
                    <td style={s.td}>
                      <span
                        style={s.chip(
                          r.status === "sent" ? c.ok : r.status === "failed" ? c.err : c.warn,
                        )}
                      >
                        {r.status === "sent" ? "enviado" : r.status === "failed" ? "falló" : r.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* SECTION 6: BÚSQUEDA */}
        <DiscoverySection runs={runs} />

        <AgencySection stats={agencyStats} lastRun={lastAgencyRun} />

        <StandupSection stats={standupStats} lastRun={lastStandupRun} />

        <MediaOrgSection stats={mediaOrgStats} lastRun={lastMediaOrgRun} />

        <BouncerSection stats={bouncerStats} />



        {/* SECTION 7: MIX 7 DÍAS */}
        <section style={s.section}>
          <h2 style={s.h2}>Mix de los últimos 7 días</h2>
          <p style={s.hint}>
            Distribución de los emails enviados esta semana. Útil para ver si
            estamos llegando a los segmentos esperados.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <BreakdownCard
              title="Idiomas usados"
              rows={top7dByLang.map((r) => ({ ...r, label: langLabel(r.key) }))}
              footnote={
                legacyLangCount > 0
                  ? `+ ${legacyLangCount} envíos legacy sin idioma registrado`
                  : undefined
              }
            />
            <BreakdownCard
              title="Países alcanzados (top 10)"
              rows={breakdown.byCountry
                .slice(0, 10)
                .map((r) => ({ ...r, label: countryLabel(r.key) }))}
            />
          </div>
        </section>

        {/* FOOTER (dev info) */}
        <div
          style={{
            marginTop: "2.5rem",
            paddingTop: "1rem",
            borderTop: `1px solid ${c.border}`,
            color: c.muted,
            fontSize: 11,
            textAlign: "center" as const,
          }}
        >
          {totalChannels.toLocaleString()} canales en DB · auto-actualiza cada
          30s ·{" "}
          v.{process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev"} ·
          actualizado {new Date().toISOString().slice(11, 19)}Z
        </div>
      </main>
    </>
  );
}

// ─── Components ────────────────────────────────────────────────────────

function BreakdownCard({
  title,
  rows,
  footnote,
}: {
  title: string;
  rows: Array<{ key: string; cnt: number; label: string }>;
  footnote?: string;
}) {
  const total = rows.reduce((sum, r) => sum + r.cnt, 0);
  return (
    <div style={s.card}>
      <div style={{ fontSize: 12, color: c.dim, marginBottom: 8 }}>
        {title} · {total.toLocaleString()}
      </div>
      {rows.length === 0 && (
        <em style={{ color: c.dim, fontSize: 12 }}>(sin datos)</em>
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
              <span>{r.label}</span>
              <span style={{ color: c.dim, fontVariantNumeric: "tabular-nums" }}>
                {r.cnt}
                {" "}
                <span style={{ fontSize: 10, color: c.muted }}>
                  {pct.toFixed(0)}%
                </span>
              </span>
            </div>
            <div
              style={{
                background: c.bg,
                borderRadius: 2,
                height: 4,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${pct}%`,
                  height: "100%",
                  background: c.accent + "aa",
                }}
              />
            </div>
          </div>
        );
      })}
      {footnote && (
        <div style={{ fontSize: 10, color: c.muted, marginTop: 8, fontStyle: "italic" }}>
          {footnote}
        </div>
      )}
    </div>
  );
}

// ─── DiscoverySection ──────────────────────────────────────────────────

import type { DiscoveryRunRow, AgencyStats, StandupStats, MediaOrgStats, BouncerStats } from "@/lib/insights";

function shortError(error: string | null): string {
  if (!error) return "";
  // Map known errors to friendly Spanish.
  const e = error.toLowerCase();
  if (e.includes("value too large to transmit"))
    return "límite de batch excedido (corregido)";
  if (e.includes("quota")) return "quota de YouTube agotada";
  if (e.includes("timeout")) return "timeout";
  return error.length > 60 ? error.slice(0, 60) + "…" : error;
}

function nextDiscoveryRun(): { at: Date; inMinutes: number } {
  // Cron: 0 */6 * * * → next 0/6/12/18 UTC hour boundary
  const now = new Date();
  const next = new Date(now);
  const currentHour = now.getUTCHours();
  const nextHour = Math.ceil((currentHour + 1) / 6) * 6;
  if (nextHour >= 24) {
    next.setUTCDate(next.getUTCDate() + 1);
    next.setUTCHours(0, 0, 0, 0);
  } else {
    next.setUTCHours(nextHour, 0, 0, 0);
  }
  const inMinutes = Math.floor((next.getTime() - now.getTime()) / 60000);
  return { at: next, inMinutes };
}

function DiscoverySection({ runs }: { runs: DiscoveryRunRow[] }) {
  const lastRun = runs[0];
  const next = nextDiscoveryRun();
  const successfulRuns = runs.filter((r) => !r.error);
  const total7d = successfulRuns.reduce(
    (acc, r) => ({
      newCount: acc.newCount + r.channels_new,
      qualifiedCount: acc.qualifiedCount + r.qualified_new,
    }),
    { newCount: 0, qualifiedCount: 0 },
  );

  return (
    <section style={s.section}>
      <h2 style={s.h2}>Búsqueda de canales nuevos</h2>
      <p style={s.hint}>
        Cada 6 horas escaneamos YouTube buscando creadores nuevos en 70+ países
        y agregamos los que tienen email público y pasan filtro de calidad a
        la cartera.
      </p>

      {!lastRun ? (
        <div style={s.card}>
          <em style={{ color: c.dim }}>(no hay corridas registradas)</em>
        </div>
      ) : (
        <>
          {/* Status headline */}
          <div style={{ ...s.card, marginBottom: 12 }}>
            {lastRun.error ? (
              <div>
                <div style={{ marginBottom: 8 }}>
                  <span style={s.chip(c.err)}>✗ Última corrida falló</span>{" "}
                  <span style={{ fontSize: 13, color: c.dim }}>
                    {ago(lastRun.started_at)}
                  </span>
                </div>
                <div style={{ fontSize: 13, color: c.text }}>
                  Motivo: {shortError(lastRun.error)}
                </div>
              </div>
            ) : (
              <div>
                <div style={{ marginBottom: 8 }}>
                  <span style={s.chip(c.ok)}>● Funcionando</span>{" "}
                  <span style={{ fontSize: 13, color: c.dim }}>
                    última corrida {ago(lastRun.started_at)}
                  </span>
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.5 }}>
                  Encontró <strong>{lastRun.channels_new.toLocaleString()}</strong>{" "}
                  creadores nuevos. De ellos,{" "}
                  <strong style={{ color: c.accent }}>
                    {lastRun.qualified_new.toLocaleString()}
                  </strong>{" "}
                  tienen email y entraron a la cartera ({lastRun.qualified_pct}% de
                  los nuevos).
                </div>
              </div>
            )}
            <div
              style={{
                fontSize: 11,
                color: c.muted,
                marginTop: 12,
                paddingTop: 10,
                borderTop: `1px solid ${c.border}`,
              }}
            >
              Próxima corrida: {next.at.toISOString().slice(11, 16)} UTC ({" "}
              {fmtDuration(next.inMinutes)} ) ·{" "}
              <strong>{total7d.newCount.toLocaleString()}</strong> nuevos en
              últimas {runs.length} corridas, <strong>{total7d.qualifiedCount.toLocaleString()}</strong>{" "}
              entraron a cartera
            </div>
          </div>

          {/* Recent runs table */}
          <div style={s.card}>
            <div style={{ fontSize: 12, color: c.dim, marginBottom: 8 }}>
              Últimas {runs.length} corridas
            </div>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>Cuándo</th>
                  <th style={{ ...s.th, textAlign: "right" }}>Nuevos</th>
                  <th style={{ ...s.th, textAlign: "right" }}>A cartera</th>
                  <th style={{ ...s.th, textAlign: "right" }}>Tiempo</th>
                  <th style={s.th}>Estado</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td style={{ ...s.td, color: c.dim, whiteSpace: "nowrap" }}>
                      {ago(r.started_at)}
                    </td>
                    <td
                      style={{
                        ...s.td,
                        textAlign: "right",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {r.channels_new.toLocaleString()}
                    </td>
                    <td
                      style={{
                        ...s.td,
                        textAlign: "right",
                        fontVariantNumeric: "tabular-nums",
                        color: r.qualified_new > 0 ? c.accent : c.muted,
                      }}
                    >
                      {r.qualified_new.toLocaleString()}
                      {r.channels_new > 0 && (
                        <span style={{ fontSize: 10, color: c.muted, marginLeft: 6 }}>
                          {r.qualified_pct}%
                        </span>
                      )}
                    </td>
                    <td
                      style={{
                        ...s.td,
                        textAlign: "right",
                        color: c.dim,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {r.duration_s ? `${Math.round(r.duration_s)}s` : "—"}
                    </td>
                    <td style={s.td}>
                      {r.error ? (
                        <span style={s.chip(c.err)}>✗ {shortError(r.error)}</span>
                      ) : (
                        <span style={s.chip(c.ok)}>✓ ok</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

// ─── AgencySection ─────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  marketing: "Marketing y publicidad",
  communication: "Comunicación / PR",
  "creator-management": "Manejo de creadores",
  "community-management": "Community management",
};

function AgencySection({
  stats,
  lastRun,
}: {
  stats: AgencyStats;
  lastRun: DiscoveryRunRow | null;
}) {
  const next = nextSundayUtc();

  return (
    <section style={s.section}>
      <h2 style={s.h2}>Búsqueda de agencias</h2>
      <p style={s.hint}>
        Cada domingo a las 03:00 UTC consultamos Perplexity Sonar para encontrar
        agencias de marketing, comunicación, manejo de creadores y community
        management en 8 países, y agregamos las que tienen email público a la
        cartera con un template B2B distinto al de creators.
      </p>

      {/* Status headline */}
      <div style={{ ...s.card, marginBottom: 12 }}>
        {!lastRun ? (
          <div>
            <span style={s.chip(c.muted)}>○ Sin corridas todavía</span>{" "}
            <span style={{ fontSize: 13, color: c.dim }}>
              Próxima: domingo 03:00 UTC ({fmtDuration(next.inMinutes)} restantes)
            </span>
          </div>
        ) : lastRun.error ? (
          <div>
            <div style={{ marginBottom: 8 }}>
              <span style={s.chip(c.err)}>✗ Última corrida falló</span>{" "}
              <span style={{ fontSize: 13, color: c.dim }}>
                {ago(lastRun.started_at)}
              </span>
            </div>
            <div style={{ fontSize: 13, color: c.text }}>
              Motivo: {shortError(lastRun.error)}
            </div>
          </div>
        ) : (
          <div>
            <div style={{ marginBottom: 8 }}>
              <span style={s.chip(c.ok)}>● Funcionando</span>{" "}
              <span style={{ fontSize: 13, color: c.dim }}>
                última corrida {ago(lastRun.started_at)}
              </span>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.5 }}>
              Encontró <strong>{lastRun.channels_new.toLocaleString()}</strong>{" "}
              agencias nuevas, todas entraron a la cartera.
            </div>
          </div>
        )}
        <div
          style={{
            fontSize: 11,
            color: c.muted,
            marginTop: 12,
            paddingTop: 10,
            borderTop: `1px solid ${c.border}`,
          }}
        >
          Próxima corrida: domingo a las 03:00 UTC ({" "}
          {fmtDuration(next.inMinutes)} ) ·{" "}
          <strong>{stats.totalEverDiscovered.toLocaleString()}</strong>{" "}
          agencias en la base · <strong>{stats.newLast7d}</strong> nuevas en 7d
        </div>
      </div>

      {/* KPIs split */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <div style={s.card}>
          <div style={{ ...s.num, color: c.accent }}>
            {stats.totalQueued.toLocaleString()}
          </div>
          <div style={s.numLbl}>
            Agencias listas para enviar
            <div style={{ color: c.muted, fontSize: 11, marginTop: 2 }}>
              esperan turno en el cron horario
            </div>
          </div>
        </div>
        <div style={s.card}>
          <div style={s.num}>{stats.totalSent.toLocaleString()}</div>
          <div style={s.numLbl}>
            Agencias contactadas
            <div style={{ color: c.muted, fontSize: 11, marginTop: 2 }}>
              {stats.sentLast7d} en últimos 7 días
            </div>
          </div>
        </div>
      </div>

      {/* Breakdown by country and category */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div style={s.card}>
          <div style={{ fontSize: 12, color: c.dim, marginBottom: 8 }}>
            Por país (top 10) · cola / contactadas
          </div>
          {stats.byCountry.length === 0 ? (
            <em style={{ color: c.dim, fontSize: 12 }}>(sin datos aún)</em>
          ) : (
            <table style={{ ...s.table, fontSize: 12 }}>
              <tbody>
                {stats.byCountry.map((row) => (
                  <tr key={row.country}>
                    <td style={{ padding: "4px 8px" }}>
                      {countryLabel(row.country)}
                    </td>
                    <td
                      style={{
                        padding: "4px 8px",
                        textAlign: "right",
                        color: c.accent,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {row.queued}
                    </td>
                    <td
                      style={{
                        padding: "4px 8px",
                        textAlign: "right",
                        color: c.dim,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {row.sent}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div style={s.card}>
          <div style={{ fontSize: 12, color: c.dim, marginBottom: 8 }}>
            Por categoría · cola / contactadas
          </div>
          {stats.byCategory.length === 0 ? (
            <em style={{ color: c.dim, fontSize: 12 }}>(sin datos aún)</em>
          ) : (
            <table style={{ ...s.table, fontSize: 12 }}>
              <tbody>
                {stats.byCategory.map((row) => (
                  <tr key={row.category}>
                    <td style={{ padding: "4px 8px" }}>
                      {CATEGORY_LABELS[row.category] ?? row.category}
                    </td>
                    <td
                      style={{
                        padding: "4px 8px",
                        textAlign: "right",
                        color: c.accent,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {row.queued}
                    </td>
                    <td
                      style={{
                        padding: "4px 8px",
                        textAlign: "right",
                        color: c.dim,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {row.sent}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  );
}

function nextSundayUtc(): { at: Date; inMinutes: number } {
  // Next Sunday 03:00 UTC
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0 = Sunday
  const daysUntilSunday = dayOfWeek === 0 ? 7 : 7 - dayOfWeek;
  const next = new Date(now);
  next.setUTCDate(next.getUTCDate() + daysUntilSunday);
  next.setUTCHours(3, 0, 0, 0);
  // If already past 03:00 UTC today (and today is Sunday), it's next Sunday
  if (dayOfWeek === 0 && now.getUTCHours() < 3) {
    next.setUTCDate(now.getUTCDate());
  }
  const inMinutes = Math.floor((next.getTime() - now.getTime()) / 60000);
  return { at: next, inMinutes };
}

// ─── StandupSection ────────────────────────────────────────────────────

const STANDUP_CATEGORY_LABELS: Record<string, string> = {
  comedian: "Comediantes individuales",
  school: "Escuelas",
  club: "Clubs / venues",
  festival: "Festivales",
  "production-company": "Productoras",
};

function nextStandupRun(): { at: Date; inMinutes: number } {
  // Cron `15 */3 * * *` → next xx:15 UTC where xx is a multiple of 3
  const now = new Date();
  const next = new Date(now);
  const currentHour = now.getUTCHours();
  const currentMinute = now.getUTCMinutes();
  const onSlot = currentHour % 3 === 0 && currentMinute < 15;
  const nextHour = onSlot
    ? currentHour
    : Math.ceil((currentHour + 1) / 3) * 3;
  if (nextHour >= 24) {
    next.setUTCDate(next.getUTCDate() + 1);
    next.setUTCHours(0, 15, 0, 0);
  } else {
    next.setUTCHours(nextHour, 15, 0, 0);
  }
  const inMinutes = Math.floor((next.getTime() - now.getTime()) / 60000);
  return { at: next, inMinutes };
}

function StandupSection({
  stats,
  lastRun,
}: {
  stats: StandupStats;
  lastRun: DiscoveryRunRow | null;
}) {
  const next = nextStandupRun();

  return (
    <section style={s.section}>
      <h2 style={s.h2}>Búsqueda de standup</h2>
      <p style={s.hint}>
        Cada 3 horas (8 ticks/día) consultamos Perplexity Sonar para encontrar
        comediantes individuales y orgs de stand-up (escuelas, clubs, festivales,
        productoras) en 21 países. Cubrimos toda la grilla a lo largo del día y
        agregamos las que tienen email público con templates dedicados al nicho.
      </p>

      {/* Status headline */}
      <div style={{ ...s.card, marginBottom: 12 }}>
        {!lastRun ? (
          <div>
            <span style={s.chip(c.muted)}>○ Sin corridas todavía</span>{" "}
            <span style={{ fontSize: 13, color: c.dim }}>
              Próxima: {next.at.toISOString().slice(11, 16)} UTC ({fmtDuration(next.inMinutes)} restantes)
            </span>
          </div>
        ) : lastRun.error ? (
          <div>
            <div style={{ marginBottom: 8 }}>
              <span style={s.chip(c.err)}>✗ Última corrida falló</span>{" "}
              <span style={{ fontSize: 13, color: c.dim }}>
                {ago(lastRun.started_at)}
              </span>
            </div>
            <div style={{ fontSize: 13, color: c.text }}>
              Motivo: {shortError(lastRun.error)}
            </div>
          </div>
        ) : (
          <div>
            <div style={{ marginBottom: 8 }}>
              <span style={s.chip(c.ok)}>● Funcionando</span>{" "}
              <span style={{ fontSize: 13, color: c.dim }}>
                última corrida {ago(lastRun.started_at)}
              </span>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.5 }}>
              Encontró <strong>{lastRun.channels_new.toLocaleString()}</strong>{" "}
              entradas nuevas, todas entraron a la cartera.
            </div>
          </div>
        )}
        <div
          style={{
            fontSize: 11,
            color: c.muted,
            marginTop: 12,
            paddingTop: 10,
            borderTop: `1px solid ${c.border}`,
          }}
        >
          Próxima corrida: {next.at.toISOString().slice(11, 16)} UTC ({fmtDuration(next.inMinutes)}) ·{" "}
          <strong>{stats.totalEverDiscovered.toLocaleString()}</strong>{" "}
          en la base · <strong>{stats.newLast7d}</strong> nuevas en 7d
        </div>
      </div>

      {/* KPIs split — individuos vs orgs */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <div style={s.card}>
          <div style={{ ...s.num, color: c.accent }}>
            {stats.byKind.individual.queued.toLocaleString()}
          </div>
          <div style={s.numLbl}>
            Comediantes en cola
            <div style={{ color: c.muted, fontSize: 11, marginTop: 2 }}>
              {stats.byKind.individual.sent.toLocaleString()} contactados
            </div>
          </div>
        </div>
        <div style={s.card}>
          <div style={{ ...s.num, color: c.accent }}>
            {stats.byKind.org.queued.toLocaleString()}
          </div>
          <div style={s.numLbl}>
            Orgs en cola (clubs, escuelas, etc.)
            <div style={{ color: c.muted, fontSize: 11, marginTop: 2 }}>
              {stats.byKind.org.sent.toLocaleString()} contactadas
            </div>
          </div>
        </div>
        <div style={s.card}>
          <div style={s.num}>{stats.totalSent.toLocaleString()}</div>
          <div style={s.numLbl}>
            Total contactados
            <div style={{ color: c.muted, fontSize: 11, marginTop: 2 }}>
              {stats.sentLast7d} en últimos 7 días
            </div>
          </div>
        </div>
      </div>

      {/* Breakdown by country and category */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div style={s.card}>
          <div style={{ fontSize: 12, color: c.dim, marginBottom: 8 }}>
            Por país (top 10) · cola / contactadas
          </div>
          {stats.byCountry.length === 0 ? (
            <em style={{ color: c.dim, fontSize: 12 }}>(sin datos aún)</em>
          ) : (
            <table style={{ ...s.table, fontSize: 12 }}>
              <tbody>
                {stats.byCountry.map((row) => (
                  <tr key={row.country}>
                    <td style={{ padding: "4px 8px" }}>
                      {countryLabel(row.country)}
                    </td>
                    <td
                      style={{
                        padding: "4px 8px",
                        textAlign: "right",
                        color: c.accent,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {row.queued}
                    </td>
                    <td
                      style={{
                        padding: "4px 8px",
                        textAlign: "right",
                        color: c.dim,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {row.sent}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div style={s.card}>
          <div style={{ fontSize: 12, color: c.dim, marginBottom: 8 }}>
            Por categoría · cola / contactadas
          </div>
          {stats.byCategory.length === 0 ? (
            <em style={{ color: c.dim, fontSize: 12 }}>(sin datos aún)</em>
          ) : (
            <table style={{ ...s.table, fontSize: 12 }}>
              <tbody>
                {stats.byCategory.map((row) => (
                  <tr key={row.category}>
                    <td style={{ padding: "4px 8px" }}>
                      {STANDUP_CATEGORY_LABELS[row.category] ?? row.category}
                    </td>
                    <td
                      style={{
                        padding: "4px 8px",
                        textAlign: "right",
                        color: c.accent,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {row.queued}
                    </td>
                    <td
                      style={{
                        padding: "4px 8px",
                        textAlign: "right",
                        color: c.dim,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {row.sent}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  );
}

// ─── MediaOrgSection ───────────────────────────────────────────────────

const MEDIA_ORG_CATEGORY_LABELS: Record<string, string> = {
  "streaming-tv": "Streaming TV",
  "radio-station": "Radios",
  "podcast-network": "Networks de podcast",
  "internet-radio": "Radios online",
};

function nextMediaOrgRun(): { at: Date; inMinutes: number } {
  // Cron `45 */3 * * *` → next xx:45 UTC where xx is a multiple of 3
  const now = new Date();
  const next = new Date(now);
  const currentHour = now.getUTCHours();
  const currentMinute = now.getUTCMinutes();
  const onSlot = currentHour % 3 === 0 && currentMinute < 45;
  const nextHour = onSlot
    ? currentHour
    : Math.ceil((currentHour + 1) / 3) * 3;
  if (nextHour >= 24) {
    next.setUTCDate(next.getUTCDate() + 1);
    next.setUTCHours(0, 45, 0, 0);
  } else {
    next.setUTCHours(nextHour, 45, 0, 0);
  }
  const inMinutes = Math.floor((next.getTime() - now.getTime()) / 60000);
  return { at: next, inMinutes };
}

function MediaOrgSection({
  stats,
  lastRun,
}: {
  stats: MediaOrgStats;
  lastRun: DiscoveryRunRow | null;
}) {
  const next = nextMediaOrgRun();

  return (
    <section style={s.section}>
      <h2 style={s.h2}>Búsqueda de medios (radio/podcast/stream)</h2>
      <p style={s.hint}>
        Cada 3 horas (8 ticks/día) consultamos Perplexity Sonar para encontrar
        radios, networks de podcast y canales de streaming-TV (tipo Olga, Luzu,
        Vorterix) en 9 países LATAM-pesados. Pitch B2B unificado para
        organizaciones que ya producen contenido grabado y necesitan clipear.
      </p>

      <div style={{ ...s.card, marginBottom: 12 }}>
        {!lastRun ? (
          <div>
            <span style={s.chip(c.muted)}>○ Sin corridas todavía</span>{" "}
            <span style={{ fontSize: 13, color: c.dim }}>
              Próxima: {next.at.toISOString().slice(11, 16)} UTC ({fmtDuration(next.inMinutes)} restantes)
            </span>
          </div>
        ) : lastRun.error ? (
          <div>
            <div style={{ marginBottom: 8 }}>
              <span style={s.chip(c.err)}>✗ Última corrida falló</span>{" "}
              <span style={{ fontSize: 13, color: c.dim }}>
                {ago(lastRun.started_at)}
              </span>
            </div>
            <div style={{ fontSize: 13, color: c.text }}>
              Motivo: {shortError(lastRun.error)}
            </div>
          </div>
        ) : (
          <div>
            <div style={{ marginBottom: 8 }}>
              <span style={s.chip(c.ok)}>● Funcionando</span>{" "}
              <span style={{ fontSize: 13, color: c.dim }}>
                última corrida {ago(lastRun.started_at)}
              </span>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.5 }}>
              Encontró <strong>{lastRun.channels_new.toLocaleString()}</strong>{" "}
              entradas nuevas, todas entraron a la cartera.
            </div>
          </div>
        )}
        <div
          style={{
            fontSize: 11,
            color: c.muted,
            marginTop: 12,
            paddingTop: 10,
            borderTop: `1px solid ${c.border}`,
          }}
        >
          Próxima corrida: {next.at.toISOString().slice(11, 16)} UTC ({fmtDuration(next.inMinutes)}) ·{" "}
          <strong>{stats.totalEverDiscovered.toLocaleString()}</strong>{" "}
          en la base · <strong>{stats.newLast7d}</strong> nuevas en 7d
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <div style={s.card}>
          <div style={{ ...s.num, color: c.accent }}>
            {stats.totalQueued.toLocaleString()}
          </div>
          <div style={s.numLbl}>
            Medios en cola
            <div style={{ color: c.muted, fontSize: 11, marginTop: 2 }}>
              esperan turno en el cron horario
            </div>
          </div>
        </div>
        <div style={s.card}>
          <div style={s.num}>{stats.totalSent.toLocaleString()}</div>
          <div style={s.numLbl}>
            Medios contactados
            <div style={{ color: c.muted, fontSize: 11, marginTop: 2 }}>
              {stats.sentLast7d} en últimos 7 días
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div style={s.card}>
          <div style={{ fontSize: 12, color: c.dim, marginBottom: 8 }}>
            Por país (top 10) · cola / contactadas
          </div>
          {stats.byCountry.length === 0 ? (
            <em style={{ color: c.dim, fontSize: 12 }}>(sin datos aún)</em>
          ) : (
            <table style={{ ...s.table, fontSize: 12 }}>
              <tbody>
                {stats.byCountry.map((row) => (
                  <tr key={row.country}>
                    <td style={{ padding: "4px 8px" }}>
                      {countryLabel(row.country)}
                    </td>
                    <td
                      style={{
                        padding: "4px 8px",
                        textAlign: "right",
                        color: c.accent,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {row.queued}
                    </td>
                    <td
                      style={{
                        padding: "4px 8px",
                        textAlign: "right",
                        color: c.dim,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {row.sent}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div style={s.card}>
          <div style={{ fontSize: 12, color: c.dim, marginBottom: 8 }}>
            Por categoría · cola / contactadas
          </div>
          {stats.byCategory.length === 0 ? (
            <em style={{ color: c.dim, fontSize: 12 }}>(sin datos aún)</em>
          ) : (
            <table style={{ ...s.table, fontSize: 12 }}>
              <tbody>
                {stats.byCategory.map((row) => (
                  <tr key={row.category}>
                    <td style={{ padding: "4px 8px" }}>
                      {MEDIA_ORG_CATEGORY_LABELS[row.category] ?? row.category}
                    </td>
                    <td
                      style={{
                        padding: "4px 8px",
                        textAlign: "right",
                        color: c.accent,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {row.queued}
                    </td>
                    <td
                      style={{
                        padding: "4px 8px",
                        textAlign: "right",
                        color: c.dim,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {row.sent}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  );
}

// ─── BouncerSection ────────────────────────────────────────────────────

const BOUNCER_STATUS_LABELS: Record<string, string> = {
  deliverable: "Deliverable",
  risky: "Risky",
  undeliverable: "Undeliverable",
  unknown: "Unknown",
};

const BOUNCER_STATUS_COLORS: Record<string, string> = {
  deliverable: c.ok,
  risky: c.warn,
  undeliverable: c.err,
  unknown: c.muted,
};

function BouncerSection({ stats }: { stats: BouncerStats }) {
  const healthy = stats.validatedLast7d > 0;
  const filterPct =
    stats.totalCached > 0
      ? Math.round((stats.wouldSkip / stats.totalCached) * 100)
      : 0;

  return (
    <section style={s.section}>
      <h2 style={s.h2}>Validación de emails (Bouncer)</h2>
      <p style={s.hint}>
        Bouncer valida cada email antes de que entre a la cola. Filtra typos,
        dominios muertos, traps de spam y mailboxes llenos. Sin Bouncer cada
        bounce real daña la reputation de los senders. Cuando el servicio no
        responde (sin créditos, key faltante, timeout) el pipeline sigue
        funcionando como si Bouncer no existiera (fail-open).
      </p>

      <div style={{ ...s.card, marginBottom: 12 }}>
        {!healthy && stats.totalCached === 0 ? (
          <div>
            <span style={s.chip(c.muted)}>○ Sin actividad</span>{" "}
            <span style={{ fontSize: 13, color: c.dim }}>
              Todavía no se validó ningún email. Si la API key está seteada en
              Vercel, va a empezar a aparecer cuando corra la próxima discovery
              tick.
            </span>
          </div>
        ) : !healthy ? (
          <div>
            <div style={{ marginBottom: 8 }}>
              <span style={s.chip(c.warn)}>⚠ Sin validaciones recientes</span>
            </div>
            <div style={{ fontSize: 13, color: c.text }}>
              {stats.totalCached.toLocaleString()} emails en cache pero ninguno
              validado en los últimos 7 días. Posibles causas: sin créditos en
              Bouncer, key inválida, o discovery crons sin emails nuevos.
              Pipeline sigue funcionando vía fail-open.
            </div>
          </div>
        ) : (
          <div>
            <div style={{ marginBottom: 8 }}>
              <span style={s.chip(c.ok)}>● Activo</span>{" "}
              <span style={{ fontSize: 13, color: c.dim }}>
                {stats.validatedLast7d.toLocaleString()} validaciones en últimos
                7 días
              </span>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.5 }}>
              Cache total: <strong>{stats.totalCached.toLocaleString()}</strong>{" "}
              emails. Filter rate:{" "}
              <strong style={{ color: c.accent }}>{filterPct}%</strong>{" "}
              ({stats.wouldSkip.toLocaleString()} hubieran sido bloqueados al
              enviar).
            </div>
          </div>
        )}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 12,
          marginBottom: 12,
        }}
      >
        {(["deliverable", "risky", "undeliverable", "unknown"] as const).map(
          (status) => {
            const row = stats.byStatus.find((b) => b.status === status);
            const cnt = row?.cnt ?? 0;
            const pct =
              stats.totalCached > 0
                ? Math.round((cnt / stats.totalCached) * 100)
                : 0;
            return (
              <div key={status} style={s.card}>
                <div
                  style={{
                    ...s.num,
                    color: BOUNCER_STATUS_COLORS[status] ?? c.text,
                  }}
                >
                  {cnt.toLocaleString()}
                </div>
                <div style={s.numLbl}>
                  {BOUNCER_STATUS_LABELS[status] ?? status}
                  <div style={{ color: c.muted, fontSize: 11, marginTop: 2 }}>
                    {pct}% del cache
                  </div>
                </div>
              </div>
            );
          },
        )}
      </div>

      {/* Impact across channel pipeline stages */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 12,
        }}
      >
        <div style={s.card}>
          <div style={{ marginBottom: 6 }}>
            <span style={s.chip(c.ok)}>preventivo</span>
          </div>
          <div style={{ ...s.num, color: c.ok }}>
            {stats.channelsDemoted.toLocaleString()}
          </div>
          <div style={s.numLbl}>
            Bloqueados antes del envío
            <div style={{ color: c.muted, fontSize: 11, marginTop: 2 }}>
              status=low_quality por Bouncer al insertar. Sube cuando corre
              discovery con Bouncer activo.
            </div>
          </div>
        </div>

        <div style={s.card}>
          <div style={{ marginBottom: 6 }}>
            <span
              style={s.chip(stats.currentlyQueuedBad > 0 ? c.warn : c.muted)}
            >
              {stats.currentlyQueuedBad > 0 ? "alerta" : "ok"}
            </span>
          </div>
          <div
            style={{
              ...s.num,
              color: stats.currentlyQueuedBad > 0 ? c.warn : c.text,
            }}
          >
            {stats.currentlyQueuedBad.toLocaleString()}
          </div>
          <div style={s.numLbl}>
            En cola con email malo
            <div style={{ color: c.muted, fontSize: 11, marginTop: 2 }}>
              status=queued pero Bouncer ahora dice malo. Si &gt; 0, validá
              manualmente: el cache se llenó después del insert.
            </div>
          </div>
        </div>

        <div style={s.card}>
          <div style={{ marginBottom: 6 }}>
            <span style={s.chip(c.err)}>histórico</span>
          </div>
          <div style={{ ...s.num, color: c.err }}>
            {stats.retrospectiveBadSent.toLocaleString()}
          </div>
          <div style={s.numLbl}>
            Ya enviados a addresses malas
            <div style={{ color: c.muted, fontSize: 11, marginTop: 2 }}>
              status=sent + email validado como malo. Daño histórico que
              Bouncer hubiera evitado si hubiera estado activo desde el día 1.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
