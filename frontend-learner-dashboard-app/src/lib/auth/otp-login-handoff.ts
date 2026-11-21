import { isValidPhoneValue } from "@/lib/phone-validation";

/**
 * Hand-off from a screen that knows who the learner is (e.g. the product page
 * success screen, for a buyer whose account existed before the checkout) to the
 * login page's OTP forms: /login?method=otp&email=…&phone=…
 *
 * The link never names a login method. The login page picks the OTP form the
 * portal allows (domain routing: allowEmailOtpAuth / allowPhoneAuth) and fills
 * in the matching identifier, so moving a portal from email OTP to phone OTP is
 * a settings change, not a code change. Prefilling is only a convenience: the
 * OTP still has to arrive in that inbox or on that phone.
 */

export const OTP_LOGIN_METHOD_PARAM = "method";
export const OTP_LOGIN_METHOD_VALUE = "otp";
export const OTP_LOGIN_EMAIL_PARAM = "email";
export const OTP_LOGIN_PHONE_PARAM = "phone";

export interface OtpLoginHandoff {
  email?: string;
  /** Digits with the country dial code, as the phone widget holds them ("919876543210"). */
  phone?: string;
}

export type OtpLoginMethod = "EMAIL" | "PHONE";

const cleanEmail = (email?: string | null): string | undefined => {
  const value = email?.trim();
  return value && value.includes("@") ? value : undefined;
};

/** Only a number that carries its dial code; a bare national number would land under the wrong country. */
const cleanPhone = (phone?: string | null): string | undefined => {
  const value = phone?.trim();
  if (!value || !isValidPhoneValue(value)) return undefined;
  return value.replace(/\D/g, "");
};

/** The login link for this learner, or null when there is nothing to prefill. */
export const buildOtpLoginHref = (identity: {
  email?: string | null;
  phone?: string | null;
}): string | null => {
  const email = cleanEmail(identity.email);
  const phone = cleanPhone(identity.phone);
  if (!email && !phone) return null;
  const params = new URLSearchParams({ [OTP_LOGIN_METHOD_PARAM]: OTP_LOGIN_METHOD_VALUE });
  if (email) params.set(OTP_LOGIN_EMAIL_PARAM, email);
  if (phone) params.set(OTP_LOGIN_PHONE_PARAM, phone);
  return `/login?${params.toString()}`;
};

/** Reads the hand-off from a /login query string; null when the link is not one. */
export const readOtpLoginHandoff = (search: string): OtpLoginHandoff | null => {
  const params = new URLSearchParams(search);
  if (params.get(OTP_LOGIN_METHOD_PARAM) !== OTP_LOGIN_METHOD_VALUE) return null;
  const email = cleanEmail(params.get(OTP_LOGIN_EMAIL_PARAM));
  const phone = cleanPhone(params.get(OTP_LOGIN_PHONE_PARAM));
  return email || phone ? { email, phone } : null;
};

/** The same query string without the hand-off, so the email/phone don't stay in history or analytics. */
export const stripOtpLoginHandoff = (search: string): string => {
  const params = new URLSearchParams(search);
  [OTP_LOGIN_METHOD_PARAM, OTP_LOGIN_EMAIL_PARAM, OTP_LOGIN_PHONE_PARAM].forEach((k) =>
    params.delete(k),
  );
  const rest = params.toString();
  return rest ? `?${rest}` : "";
};

/**
 * The OTP form to open: the first one the portal allows for which the hand-off
 * has an identifier, email before phone. Null leaves the login page as it was.
 */
export const pickOtpLoginMethod = (
  handoff: OtpLoginHandoff | null,
  allowed: { allowEmailOtpAuth: boolean; allowPhoneAuth: boolean },
): OtpLoginMethod | null => {
  if (!handoff) return null;
  if (handoff.email && allowed.allowEmailOtpAuth) return "EMAIL";
  if (handoff.phone && allowed.allowPhoneAuth) return "PHONE";
  return null;
};
