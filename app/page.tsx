export default function HomePage() {
  return (
    <main style={{ padding: "3rem", maxWidth: 720, margin: "0 auto" }}>
      <h1 style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>
        Clipzi Outreach
      </h1>
      <p style={{ color: "#888", marginBottom: "2rem" }}>
        Discovery + sending platform — dashboard coming soon.
      </p>
      <div
        style={{
          padding: "1rem",
          border: "1px solid #2a2a2a",
          borderRadius: 8,
          fontFamily: "ui-monospace, monospace",
          fontSize: 13,
        }}
      >
        <div>v2 foundation up.</div>
        <div style={{ color: "#666", marginTop: 4 }}>
          Workers run on Vercel Cron + Workflows.
        </div>
      </div>
    </main>
  );
}
