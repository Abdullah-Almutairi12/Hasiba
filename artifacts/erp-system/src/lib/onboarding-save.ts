// Onboarding persists ONLY the business activity (PATCH /api/companies/me
// accepts businessType). Branches, currency, invoice type and tax are NOT
// saved here; they live in their own settings screens.
export type OnboardingSaveResult = { ok: true } | { ok: false; message: string };

export const ONBOARDING_SAVE_ERROR = "تعذّر تأكيد حفظ نوع النشاط. راجع الإعداد الحالي قبل إعادة المحاولة.";
export const ONBOARDING_NETWORK_ERROR = "تعذّر الاتصال بالخادم؛ قد يكون نوع النشاط حُفظ. تحقق من الاتصال وراجع الإعداد الحالي قبل إعادة المحاولة.";

export async function saveOnboardingBusinessType(
  baseUrl: string,
  businessType: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OnboardingSaveResult> {
  let res: Response;
  try {
    res = await fetchImpl(`${baseUrl}api/companies/me`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ businessType }),
    });
  } catch {
    return { ok: false, message: ONBOARDING_NETWORK_ERROR };
  }
  if (!res.ok) {
    let serverMsg = "";
    try {
      const body = (await res.json()) as { error?: unknown; message?: unknown };
      const m = body?.error ?? body?.message;
      if (typeof m === "string" && /[\u0600-\u06FF]/.test(m)) serverMsg = m;
    } catch {
      /* non-JSON body */
    }
    return { ok: false, message: serverMsg || ONBOARDING_SAVE_ERROR };
  }
  return { ok: true };
}
