import { toast } from "sonner";
import i18n from "@/i18n";
import { buildOtpLoginHref } from "@/lib/auth/otp-login-handoff";

/**
 * /auth-service/learner/v1/register answers `account_exists: true` with no tokens when the
 * e-mail or phone already belongs to an account that has to sign in itself. The enrollment
 * in that call has already gone through; only the automatic sign-in is withheld.
 */
export const isExistingAccountWithoutSession = (response: unknown): boolean => {
  if (!response || typeof response !== "object") return false;
  const body = response as Record<string, unknown>;
  return body.account_exists === true && !body.accessToken && !body.access_token;
};

/**
 * The normal sign-in page for that account: the OTP form prefilled when an e-mail or phone is
 * known (same hand-off as the product page success screen), and `redirect` so the learner
 * lands where a signed-in enrollment would have taken them.
 */
export const existingAccountSignInHref = (opts: {
  email?: string | null;
  phone?: string | null;
  redirect?: string | null;
}): string => {
  const base = buildOtpLoginHref({ email: opts.email, phone: opts.phone }) ?? "/login";
  const redirect = opts.redirect?.trim();
  if (!redirect) return base;
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}redirect=${encodeURIComponent(redirect)}`;
};

/** Long enough to read the message before the sign-in page replaces this one. */
const SIGN_IN_REDIRECT_DELAY_MS = 1500;

/**
 * Tells the learner to sign in and then opens the sign-in page. The returned promise never
 * settles: the page is being replaced, so callers waiting on it must not go on to a success or
 * error screen in the meantime.
 */
export const sendExistingAccountToSignIn = (opts: {
  email?: string | null;
  phone?: string | null;
  redirect?: string | null;
}): Promise<never> => {
  toast.info(
    i18n.t("auth:enrollment.existingAccountSignIn", {
      defaultValue: "You already have an account. Please sign in to continue.",
    }),
  );
  const href = existingAccountSignInHref(opts);
  window.setTimeout(() => window.location.assign(href), SIGN_IN_REDIRECT_DELAY_MS);
  return new Promise<never>(() => {});
};
