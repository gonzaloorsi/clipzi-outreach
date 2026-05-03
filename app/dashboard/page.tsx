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
  const [kpis, pipeline, recent, senders, win, runs, breakdown, heart] =
    await Promise.all([
      getKPIs(),
      getPipeline(),
      getRecentSends(15),
      getSenderPool(),
      Promise.resolve(getSendWindowState()),
      getDiscoveryRuns(5),
      getSendsBreakdown(),
      getCronHeartbeat(),
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
          <div style={{ fontSize: 13, color: c.dim }}>
            <a href="/api/logout" style={{ color: c.dim, textDecoration: "underline" }}>
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
            Lo que pasó en las últimas 24 horas. Mandamos 1 email por canal —
            jamás repetimos.
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
        <section style={s.section}>
          <h2 style={s.h2}>Búsqueda de canales nuevos</h2>
          <p style={s.hint}>
            Cada 6 horas escaneamos YouTube por país y categoría buscando
            creadores nuevos para sumar a la cartera.
          </p>
          <div style={s.card}>
            {lastRun ? (
              lastRun.error ? (
                <div>
                  <span style={s.chip(c.err)}>⚠ falló</span>{" "}
                  <span style={{ fontSize: 13 }}>
                    Última corrida {ago(lastRun.started_at)}
                  </span>
                  <div style={{ fontSize: 12, color: c.err, marginTop: 6 }}>
                    {String(lastRun.error).slice(0, 200)}
                  </div>
                </div>
              ) : (
                <div>
                  <span style={s.chip(c.ok)}>● funcionando</span>{" "}
                  <span style={{ fontSize: 13 }}>
                    Última corrida {ago(lastRun.started_at)} ·{" "}
                    encontró <strong>{lastRun.channels_new.toLocaleString()}</strong>{" "}
                    canales nuevos, de los cuales{" "}
                    <strong>{lastRun.qualified_new}</strong> tienen email y
                    pasaron el filtro de calidad.
                  </span>
                  {runs.length > 1 && (
                    <div style={{ fontSize: 11, color: c.muted, marginTop: 8 }}>
                      Últimas 5 corridas:{" "}
                      {runs
                        .slice(0, 5)
                        .map(
                          (r) =>
                            `${r.channels_new}n→${r.qualified_new}q${r.error ? " ⚠" : ""}`,
                        )
                        .join(" · ")}
                    </div>
                  )}
                </div>
              )
            ) : (
              <em style={{ color: c.dim }}>(no hay corridas registradas)</em>
            )}
          </div>
        </section>

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
