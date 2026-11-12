// FR-BOT-2: server-side verification of the Turnstile token before any database write.
// https://developers.cloudflare.com/turnstile/get-started/server-side-validation/

export interface TurnstileOutcome {
  success: boolean;
  errorCodes: string[];
}

export async function verifyTurnstile(
  secret: string | undefined,
  token: string | null,
  remoteIp: string | null,
  fetcher: typeof fetch = fetch,
): Promise<TurnstileOutcome> {
  // A secret pasted into `wrangler secret put` can carry a stray space or line break (common on Windows): trim it.
  const cleanSecret = secret?.trim();
  const cleanToken = token?.trim();
  if (!cleanSecret) return { success: false, errorCodes: ["missing-secret"] };
  if (!cleanToken) return { success: false, errorCodes: ["missing-input-response"] };

  const body = new FormData();
  body.append("secret", cleanSecret);
  body.append("response", cleanToken);
  if (remoteIp) body.append("remoteip", remoteIp);
  body.append("idempotency_key", crypto.randomUUID());

  try {
    const res = await fetcher("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
    });
    const data = (await res.json()) as { success?: boolean; "error-codes"?: string[] };
    return { success: data.success === true, errorCodes: data["error-codes"] ?? [] };
  } catch (err) {
    return { success: false, errorCodes: ["network-error"] };
  }
}
