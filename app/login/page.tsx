// Login page. Plain server component, no JS, no React state — just an HTML
// form that POSTs to /api/login. Errors come back as ?error=... query params.

interface SearchParams {
  error?: string;
  next?: string;
}

const colors = {
  bg: "#0a0a0a",
  card: "#141414",
  border: "#262626",
  text: "#e5e5e5",
  textDim: "#888",
  accent: "#3b82f6",
  err: "#ef4444",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const errorMessage =
    params.error === "invalid"
      ? "Wrong password."
      : params.error === "no_password_set"
        ? "ADMIN_PASSWORD env var is not set on the server. Configure it in Vercel."
        : null;
  const next = params.next?.startsWith("/") ? params.next : "/dashboard";

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: colors.bg,
        color: colors.text,
        fontFamily: "system-ui, -apple-system, sans-serif",
        padding: "1rem",
      }}
    >
      <div
        style={{
          background: colors.card,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          padding: "2rem",
          width: "100%",
          maxWidth: 360,
        }}
      >
        <h1 style={{ fontSize: "1.25rem", margin: "0 0 0.25rem 0" }}>
          Clipzi Outreach
        </h1>
        <p style={{ color: colors.textDim, fontSize: 13, margin: "0 0 1.25rem 0" }}>
          Admin sign in
        </p>

        {errorMessage && (
          <div
            style={{
              background: colors.err + "1a",
              border: `1px solid ${colors.err}55`,
              color: colors.err,
              padding: "8px 12px",
              borderRadius: 6,
              fontSize: 13,
              marginBottom: "1rem",
            }}
          >
            {errorMessage}
          </div>
        )}

        <form action="/api/login" method="POST">
          <input type="hidden" name="next" value={next} />
          <label
            htmlFor="password"
            style={{ fontSize: 12, color: colors.textDim, display: "block", marginBottom: 6 }}
          >
            Password
          </label>
          <input
            id="password"
            type="password"
            name="password"
            autoFocus
            required
            autoComplete="current-password"
            style={{
              width: "100%",
              padding: "10px 12px",
              background: colors.bg,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              color: colors.text,
              fontSize: 14,
              boxSizing: "border-box",
            }}
          />
          <button
            type="submit"
            style={{
              width: "100%",
              marginTop: "1rem",
              padding: "10px",
              background: colors.accent,
              color: "#fff",
              border: "none",
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Enter
          </button>
        </form>
      </div>
    </main>
  );
}
