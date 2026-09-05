// Which of these emails already have a Clipzi account. Used by the follow-up
// cron so nobody who signed up after the cold email gets "did you get to try
// it?" four days later. Asks the clipzi app (it owns Supabase auth); outreach
// never holds Supabase credentials.
//
// Fails open on purpose: if clipzi is unreachable the follow-up still goes out
// (a slightly redundant bump beats silently stalling the whole sequence).
//
// Env: CLIPZI_INTERNAL_URL (default https://clipzi.app), OUTREACH_INTERNAL_SECRET
// (same value as in the clipzi project).

export async function filterOutSignedUp(emails: string[]): Promise<{ keep: string[]; signedUp: string[]; checked: boolean }> {
  const secret = process.env.OUTREACH_INTERNAL_SECRET;
  if (!secret || emails.length === 0) return { keep: emails, signedUp: [], checked: false };
  const base = (process.env.CLIPZI_INTERNAL_URL || "https://clipzi.app").replace(/\/$/, "");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45_000);
  try {
    const res = await fetch(`${base}/api/internal/accounts`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ emails }),
    });
    if (!res.ok) return { keep: emails, signedUp: [], checked: false };
    const json = (await res.json()) as { exists?: string[] };
    const exists = new Set((json.exists ?? []).map((e) => e.toLowerCase()));
    return {
      keep: emails.filter((e) => !exists.has(e.toLowerCase())),
      signedUp: emails.filter((e) => exists.has(e.toLowerCase())),
      checked: true,
    };
  } catch {
    return { keep: emails, signedUp: [], checked: false };
  } finally {
    clearTimeout(timer);
  }
}
