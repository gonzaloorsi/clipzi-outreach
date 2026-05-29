// Mint Stripe promotion codes for Clipzi lead trial codes.
//
// Called by the LLM via Stripe's REST API (fetch, no SDK dependency — matches
// the repo's fetch-based style for Gmail and the AI Gateway). Each positive
// lead gets a unique promotion code pointing to one reusable coupon:
//   TO3YNzMc = "100% off / first month free" (LIVE).
// The lead picks their plan at checkout; the code makes the first month $0.
//
// Env: STRIPE_SECRET_KEY (restricted key, write on promotion codes).

const STRIPE_API = "https://api.stripe.com/v1";

// Base coupon: 100% off first month. See memory/stripe-trial-code-coupon.md.
export const TRIAL_COUPON_ID = process.env.STRIPE_TRIAL_COUPON_ID || "TO3YNzMc";

/**
 * Turn a lead name into a stable, readable, uppercase code stem.
 * "Flávio Santos" -> "FLAVIO". Falls back to the email local-part.
 */
export function codeStem(name: string | null, email: string): string {
  const fromName = (name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .replace(/[^a-zA-Z]/g, "")
    .toUpperCase();
  if (fromName.length >= 3) return fromName.slice(0, 10);
  const local = email.split("@")[0].replace(/[^a-zA-Z]/g, "").toUpperCase();
  return (local || "LEAD").slice(0, 10);
}

/**
 * Build the customer-facing code. `suffix` should be unique per call (the
 * orchestrator passes a short token derived from the thread id) so reruns
 * never collide on Stripe's unique-code constraint.
 */
export function buildCode(name: string | null, email: string, suffix: string): string {
  return `${codeStem(name, email)}${suffix}`.replace(/[^A-Z0-9]/g, "").slice(0, 20);
}

export interface PromotionCodeResult {
  ok: boolean;
  code?: string;
  id?: string;
  error?: string;
}

/**
 * Create a single-use promotion code on the trial coupon.
 * Returns the human-readable code to drop into the email.
 */
export async function createTrialPromotionCode(
  code: string,
): Promise<PromotionCodeResult> {
  if (!process.env.STRIPE_SECRET_KEY) {
    return { ok: false, error: "STRIPE_SECRET_KEY not set" };
  }
  const body = new URLSearchParams({
    coupon: TRIAL_COUPON_ID,
    code,
    max_redemptions: "1",
  });
  try {
    const res = await fetch(`${STRIPE_API}/promotion_codes`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
        // Pin a known-good API version. The account's default version rejects the
        // `coupon` param on /promotion_codes ("unknown parameter: coupon").
        "Stripe-Version": "2024-06-20",
      },
      body,
    });
    const json = (await res.json()) as {
      id?: string;
      code?: string;
      error?: { message?: string };
    };
    if (!res.ok || !json.code) {
      return { ok: false, error: json.error?.message ?? `Stripe ${res.status}` };
    }
    return { ok: true, code: json.code, id: json.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
