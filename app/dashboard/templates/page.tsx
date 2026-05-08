// /dashboard/templates — list of all email templates with current source
// (DB override vs hardcoded code default). Click any to edit.

import Link from "next/link";
import { listAllTemplates } from "@/lib/templates/db-loader";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const c = {
  bg: "#0a0a0a",
  card: "#141414",
  border: "#262626",
  text: "#e8e8e8",
  dim: "#888",
  muted: "#5a5a5a",
  accent: "#3b82f6",
  ok: "#22c55e",
  warn: "#eab308",
};

const KIND_LABEL: Record<string, string> = {
  creator: "Creador (B2C)",
  agency: "Agencia (B2B)",
  "standup-individual": "Standup individual (B2C)",
  "standup-org": "Standup org (B2B)",
  "media-org": "Medios (radio/podcast/stream) (B2B)",
};

const KIND_ORDER = [
  "creator",
  "agency",
  "standup-individual",
  "standup-org",
  "media-org",
] as const;
type Kind = (typeof KIND_ORDER)[number];

function kindOf(key: string): Kind {
  if (key.startsWith("standup-individual-")) return "standup-individual";
  if (key.startsWith("standup-org-")) return "standup-org";
  if (key.startsWith("media-org-")) return "media-org";
  if (key.startsWith("agency-")) return "agency";
  return "creator";
}

function langFromKey(key: string): string {
  // Last segment after the final "-" is the lang code.
  return key.split("-").pop() ?? "?";
}

const LANG_LABEL: Record<string, string> = {
  en: "Inglés",
  es: "Español",
  pt: "Portugués",
  de: "Alemán",
  fr: "Francés",
};

function fmtTs(ts: Date | string | null | undefined): string {
  if (!ts) return "—";
  const date = typeof ts === "string" ? new Date(String(ts).replace(" ", "T")) : ts;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toISOString().slice(0, 10);
}

export default async function TemplatesListPage() {
  const all = await listAllTemplates();

  // Group by kind
  const grouped: Record<Kind, typeof all> = {
    creator: [],
    agency: [],
    "standup-individual": [],
    "standup-org": [],
    "media-org": [],
  };
  for (const t of all) {
    grouped[kindOf(t.key)].push(t);
  }

  return (
    <main
      style={{
        fontFamily: "system-ui, -apple-system, sans-serif",
        background: c.bg,
        color: c.text,
        padding: "1.5rem",
        maxWidth: 900,
        margin: "0 auto",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 4,
        }}
      >
        <h1 style={{ fontSize: "1.4rem", margin: 0, fontWeight: 600 }}>
          Plantillas de email
        </h1>
        <Link
          href="/dashboard"
          style={{ color: c.dim, fontSize: 13, textDecoration: "underline" }}
        >
          ← volver al dashboard
        </Link>
      </div>
      <p
        style={{
          color: c.dim,
          fontSize: 12,
          fontStyle: "italic",
          margin: "0 0 0.75rem 0",
        }}
      >
        Las plantillas que tienen una versión guardada en DB sobrescriben el
        default del código. Si una plantilla no tiene override, se usa el código
        directamente. Variables disponibles: <code>{"{channelName}"}</code> y{" "}
        <code>{"{fromName}"}</code>.
      </p>
      <div
        style={{
          background: c.warn + "11",
          border: `1px solid ${c.warn}44`,
          color: c.text,
          fontSize: 12,
          padding: "10px 12px",
          borderRadius: 6,
          margin: "0 0 1.5rem 0",
          lineHeight: 1.5,
        }}
      >
        <strong>Nota:</strong> los templates están en HTML para edición. Pero la
        versión que llega al recipient sale en <strong>plain text + subject en
        minúscula</strong> (decisión de deliverability tras tests en GMass +
        GlockApps). Al editar cada template vas a ver ambas vistas: la enviada y
        la raw.
      </div>

      {KIND_ORDER.map((kind) => (
        <section key={kind} style={{ marginBottom: "2rem" }}>
          <h2
            style={{
              fontSize: "0.95rem",
              margin: "0 0 0.5rem 0",
              fontWeight: 600,
            }}
          >
            {KIND_LABEL[kind]}
          </h2>
          <div
            style={{
              background: c.card,
              border: `1px solid ${c.border}`,
              borderRadius: 8,
              overflow: "hidden",
            }}
          >
            {grouped[kind].map((t, idx) => {
              const lang = langFromKey(t.key);
              return (
                <Link
                  key={t.key}
                  href={`/dashboard/templates/${t.key}`}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "12px 16px",
                    borderTop: idx === 0 ? "none" : `1px solid ${c.border}`,
                    color: c.text,
                    textDecoration: "none",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 500 }}>
                      {KIND_LABEL[kind]} · {LANG_LABEL[lang] ?? lang}
                    </div>
                    <div
                      style={{
                        color: c.dim,
                        fontSize: 11,
                        marginTop: 4,
                        fontFamily: "ui-monospace, monospace",
                      }}
                    >
                      {t.key}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div
                      style={{
                        fontSize: 11,
                        padding: "2px 8px",
                        borderRadius: 4,
                        background:
                          t.source === "db" ? c.accent + "22" : c.muted + "22",
                        color: t.source === "db" ? c.accent : c.muted,
                        border: `1px solid ${
                          t.source === "db" ? c.accent + "44" : c.muted + "44"
                        }`,
                        display: "inline-block",
                      }}
                    >
                      {t.source === "db" ? "DB override" : "código (default)"}
                    </div>
                    <div style={{ fontSize: 11, color: c.muted, marginTop: 4 }}>
                      {t.source === "db" ? `editado ${fmtTs(t.updatedAt)}` : "→ editar"}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </main>
  );
}
