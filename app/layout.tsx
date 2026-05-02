export const metadata = {
  title: "Clipzi Outreach",
  description: "YouTube creator outreach platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, -apple-system, sans-serif",
          margin: 0,
          padding: 0,
          background: "#0a0a0a",
          color: "#e5e5e5",
        }}
      >
        {children}
      </body>
    </html>
  );
}
