// /dashboard/templates/[key] — editor for one template.
// Server component, form posts to a server action that writes to email_templates.
// Preview renders the template with sample channelName + fromName.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  loadTemplateRow,
  saveTemplateRow,
  ALL_TEMPLATE_KEYS,
} from "@/lib/templates/db-loader";
import { rowToBuilder } from "@/lib/templates/db-loader";
import { htmlToPlainText } from "@/lib/email";

export const dynamic = "force-dynamic";

const c = {
  bg: "#0a0a0a",
  card: "#141414",
  border: "#262626",
  text: "#e8e8e8",
  dim: "#888",
  muted: "#5a5a5a",
  accent: "#3b82f6",
  ok: "#22c55e",
  err: "#ef4444",
};

const SAMPLE_CHANNEL_NAME = "Marca Demo";
const SAMPLE_FROM_NAME = "Gonzalo Orsi";

async function saveAction(formData: FormData) {
  "use server";
  const key = String(formData.get("key") ?? "");
  const subject = String(formData.get("subject") ?? "").trim();
  const html = String(formData.get("html") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  if (!ALL_TEMPLATE_KEYS.includes(key)) {
    throw new Error(`Unknown template key: ${key}`);
  }
  if (!subject || !html) {
    throw new Error("Subject and HTML are required");
  }
  // Cheap style guard — refuse em/en dashes per project memory rule
  if (/[—–]/.test(subject) || /[—–]/.test(html)) {
    throw new Error(
      "Em-dashes (—) and en-dashes (–) aren't allowed in email copy. Use hyphens, periods, or commas instead.",
    );
  }
  await saveTemplateRow(key, subject, html, notes || null);
  revalidatePath("/dashboard/templates");
  revalidatePath(`/dashboard/templates/${key}`);
  redirect(`/dashboard/templates/${key}?saved=1`);
}

export default async function TemplateEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { key } = await params;
  const { saved } = await searchParams;

  if (!ALL_TEMPLATE_KEYS.includes(key)) notFound();
  const row = await loadTemplateRow(key);
  if (!row) notFound();

  // Preview using current row contents
  const preview = rowToBuilder(row)({
    channelName: SAMPLE_CHANNEL_NAME,
    fromName: SAMPLE_FROM_NAME,
  });

  return (
    <main
      style={{
        fontFamily: "system-ui, -apple-system, sans-serif",
        background: c.bg,
        color: c.text,
        padding: "1.5rem",
        maxWidth: 1100,
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
          Editar plantilla{" "}
          <code
            style={{
              fontSize: "0.95rem",
              background: c.card,
              padding: "2px 8px",
              borderRadius: 4,
              border: `1px solid ${c.border}`,
              color: c.dim,
            }}
          >
            {key}
          </code>
        </h1>
        <Link
          href="/dashboard/templates"
          style={{ color: c.dim, fontSize: 13, textDecoration: "underline" }}
        >
          ← volver a la lista
        </Link>
      </div>
      <p style={{ color: c.dim, fontSize: 12, margin: "8px 0 1rem 0" }}>
        Source actual:{" "}
        <strong style={{ color: row.source === "db" ? c.accent : c.muted }}>
          {row.source === "db" ? "DB override" : "código (default)"}
        </strong>
        {" · "}
        Variables disponibles: <code>{"{channelName}"}</code>,{" "}
        <code>{"{fromName}"}</code>
      </p>

      {saved === "1" && (
        <div
          style={{
            background: c.ok + "1a",
            border: `1px solid ${c.ok}55`,
            color: c.ok,
            padding: "8px 12px",
            borderRadius: 6,
            fontSize: 13,
            marginBottom: "1rem",
          }}
        >
          ✓ Plantilla guardada. El próximo envío usa esta versión.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Edit column */}
        <form action={saveAction}>
          <input type="hidden" name="key" value={key} />

          <label style={labelStyle}>Subject</label>
          <input
            name="subject"
            defaultValue={row.subject}
            required
            style={inputStyle}
          />

          <label style={labelStyle}>HTML del cuerpo</label>
          <textarea
            name="html"
            defaultValue={row.html}
            required
            rows={20}
            style={{
              ...inputStyle,
              fontFamily: "ui-monospace, 'Cascadia Code', monospace",
              fontSize: 12,
              lineHeight: 1.5,
            }}
          />

          <label style={labelStyle}>Notas (opcional, no se manda en el email)</label>
          <textarea
            name="notes"
            defaultValue={row.notes ?? ""}
            rows={2}
            style={inputStyle}
          />

          <div
            style={{
              display: "flex",
              gap: 8,
              marginTop: 16,
              alignItems: "center",
            }}
          >
            <button
              type="submit"
              style={{
                background: c.accent,
                color: "#fff",
                border: "none",
                borderRadius: 6,
                padding: "10px 16px",
                fontSize: 14,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Guardar
            </button>
            <span style={{ fontSize: 11, color: c.muted }}>
              Reglas: sin em-dashes (—) ni en-dashes (–) en el copy.
            </span>
          </div>
        </form>

        {/* Preview column */}
        <div>
          <div style={{ fontSize: 12, color: c.dim, marginBottom: 8 }}>
            Sample: <strong>{SAMPLE_CHANNEL_NAME}</strong> +{" "}
            <strong>{SAMPLE_FROM_NAME}</strong>
          </div>

          {/* What actually goes out — plain text + lowercase subject */}
          <div style={{ fontSize: 11, color: c.dim, marginBottom: 6, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>
            ✓ Como llega al recipient (versión enviada)
          </div>
          <div
            style={{
              background: c.card,
              border: `1px solid ${c.ok}66`,
              borderRadius: 8,
              overflow: "hidden",
              marginBottom: 16,
            }}
          >
            <div
              style={{
                padding: "12px 16px",
                borderBottom: `1px solid ${c.border}`,
                fontSize: 13,
              }}
            >
              <div style={{ color: c.muted, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
                Subject (lowercase)
              </div>
              {preview.subject.toLowerCase()}
            </div>
            <div
              style={{
                padding: "16px",
                fontSize: 14,
                lineHeight: 1.5,
                background: "#fff",
                color: "#222",
                whiteSpace: "pre-wrap",
                fontFamily: "ui-monospace, 'Cascadia Code', monospace",
              }}
            >
              {htmlToPlainText(preview.html)}
            </div>
          </div>

          {/* Raw HTML preview — for editing reference */}
          <div style={{ fontSize: 11, color: c.dim, marginBottom: 6, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>
            ⓘ Vista raw (template HTML, NO es lo que se manda)
          </div>
          <div
            style={{
              background: c.card,
              border: `1px solid ${c.border}`,
              borderRadius: 8,
              overflow: "hidden",
              opacity: 0.7,
            }}
          >
            <div
              style={{
                padding: "12px 16px",
                borderBottom: `1px solid ${c.border}`,
                fontSize: 13,
              }}
            >
              <div style={{ color: c.muted, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
                Subject (raw)
              </div>
              {preview.subject}
            </div>
            <div
              style={{
                padding: "16px",
                fontSize: 14,
                lineHeight: 1.5,
                background: "#fff",
                color: "#222",
              }}
              dangerouslySetInnerHTML={{ __html: preview.html }}
            />
          </div>

          <div
            style={{
              fontSize: 11,
              color: c.muted,
              marginTop: 8,
              lineHeight: 1.5,
            }}
          >
            La versión enviada es lo que reciben los destinatarios (plain text +
            subject en minúscula, definido en{" "}
            <code>app/api/cron/send/route.ts:368-369</code>). La vista raw es
            solo para referencia mientras editás.
          </div>
        </div>
      </div>
    </main>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  color: c.dim,
  marginBottom: 6,
  marginTop: 16,
  textTransform: "uppercase",
  letterSpacing: 0.5,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  background: c.bg,
  border: `1px solid ${c.border}`,
  borderRadius: 6,
  color: c.text,
  fontSize: 13,
  fontFamily: "system-ui, -apple-system, sans-serif",
  boxSizing: "border-box",
  resize: "vertical",
};
