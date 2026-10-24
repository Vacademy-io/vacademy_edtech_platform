import {
  AsYouType,
  getCountries,
  getCountryCallingCode,
  isValidPhoneNumber,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";
import { z } from "zod";

/**
 * Country-aware phone validation, shared by every phone input in the app.
 *
 * The phone widget (react-phone-input-2) stores the number in E.164 style with
 * the selected country's dial code embedded as a prefix (e.g. "+919876543210").
 * Because the dial code is part of the value, `isValidPhoneNumber` enforces the
 * correct national length/format for that country automatically — India = exactly
 * 10 digits, US = 10, UK = 10/11, etc. — with no per-country hardcoding.
 *
 * Three entry points cover the three ways phone inputs are wired here:
 *  - {@link phoneSchema}        for react-hook-form + zodResolver forms (schema is the source of truth)
 *  - {@link phoneValidateRule}  for Controller `rules` on non-resolver forms (used by the wrappers)
 *  - {@link validatePhoneField} for plain-useState / manual-validation forms
 */

const DEFAULT_LABEL = "Phone number";

interface PhoneValidationOptions {
  required?: boolean;
  label?: string;
}

const invalidMessage = (label: string): string =>
  `Enter a valid ${label.toLowerCase()} for the selected country`;

/**
 * True when the value carries no national number beyond the country dial code
 * (e.g. "", undefined, or a dial-code-only "+91"). The dial code is parsed from
 * the value itself, so "+91" is blank but "+919" (one national digit) is not —
 * a global digit-count threshold can't tell those apart because dial codes are
 * 1–3 digits long.
 */
export const isBlankPhone = (value: string | undefined | null): boolean => {
  if (!value) return true;
  const raw = String(value).trim();
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 0) return true;
  try {
    const asYouType = new AsYouType();
    asYouType.input(raw.startsWith("+") ? raw : `+${raw}`);
    if ((asYouType.getNumber()?.nationalNumber ?? "").length > 0) return false;
  } catch {
    // fall through to the digit-count heuristic
  }
  // Unparseable calling code: the longest dial code is 3 digits, so anything
  // with <= 3 digits total is treated as blank.
  return digits.length <= 3;
};

/**
 * True when `value` is a valid phone number for the country implied by its dial
 * code. The phone widget always embeds the dial code (e.g. "+919876543210" /
 * "919876543210"), so an incomplete number like "+9179998738" (dial code + only
 * 8 national digits) is correctly rejected.
 */
export const isValidPhoneValue = (value: string | undefined | null): boolean => {
  if (!value) return false;
  const raw = String(value).trim();
  try {
    return isValidPhoneNumber(raw.startsWith("+") ? raw : `+${raw}`);
  } catch {
    return false;
  }
};

const DIAL_CODES = new Set(getCountries().map((c) => getCountryCallingCode(c)));

/** True when the digits open with some country's dial code (1–3 digits). */
const startsWithDialCode = (digits: string): boolean =>
  [1, 2, 3].some((n) => DIAL_CODES.has(digits.slice(0, n)));

/**
 * A stored number without a "+" read as a national number of `countryIso2`
 * ("8712345678" in India → "+918712345678"), or null when it isn't one.
 * A value that is already valid with its own dial code is never read this way:
 * "12025550123" is a US number, not an Indian 1-prefixed one. Only full-length
 * (10+ digit) national numbers count.
 */
const storedNationalPhone = (
  raw: string,
  countryIso2?: string
): string | null => {
  if (!countryIso2 || raw.startsWith("+") || isBlankPhone(raw)) return null;
  const digits = raw.replace(/\D/g, "");
  if (isValidPhoneValue(digits)) return null;
  const national = parsePhoneNumberFromString(
    digits,
    countryIso2.toUpperCase() as CountryCode
  );
  if (!national?.isValid()) return null;
  // libphonenumber also accepts "918712345678" here by stripping the country
  // code; that one already has its dial code, so it isn't a national number.
  const nationalDigits = String(national.nationalNumber);
  if (digits !== nationalDigits && digits !== `0${nationalDigits}`) return null;
  // Shorter values pass as landlines but in our data are placeholders
  // ("12345678"); left alone they still fail validation, as they should.
  return nationalDigits.length >= 10 ? national.number : null;
};

/**
 * Makes a stored number safe to hand to the phone widget.
 *
 * Numbers saved outside the widget (bulk imports, older forms) are often a bare
 * national number like "8712345678". The widget reads its leading digits as the
 * dial code and shows "+87 12345-678", and with `countryCodeEditable={false}` it
 * drops every edit that doesn't start with the selected country's code, so the
 * field locks: Delete and Backspace do nothing.
 *
 * A national number for `countryIso2` becomes E.164. A value whose leading
 * digits the widget can match to a country is returned as is, readable or not,
 * since the widget handles it as it always has. Only a value it can't match —
 * the one that locks — becomes "", so the learner can type the number again.
 */
export const normalizeStoredPhone = (
  value: string | undefined | null,
  countryIso2?: string
): string => {
  if (!value) return "";
  const raw = String(value).trim();
  if (raw.startsWith("+") || isBlankPhone(raw)) return raw;
  const national = storedNationalPhone(raw, countryIso2);
  if (national) return national;
  return startsWithDialCode(raw.replace(/\D/g, "")) ? raw : "";
};

/**
 * The value a form should hold instead of `value`, or null to keep it as is.
 *
 * Only a bare national number ("8712345678") is replaced — with the E.164 the
 * widget shows — because left in the form it fails validation on a field that
 * looks valid. Everything else stays exactly as stored: a "918712345678" is what
 * WhatsApp-OTP login matches on, and an unreadable number must survive a save
 * (e.g. a profile edit that only changed the city) rather than be wiped.
 */
export const repairedStoredPhone = (
  value: string | undefined | null,
  countryIso2?: string
): string | null =>
  value ? storedNationalPhone(String(value).trim(), countryIso2) : null;

/**
 * Imperative validator for plain-state / manual-validation forms.
 * Returns an error message string, or `undefined` when the value is acceptable.
 */
export const validatePhoneField = (
  value: string | undefined | null,
  { required = false, label = DEFAULT_LABEL }: PhoneValidationOptions = {}
): string | undefined => {
  if (isBlankPhone(value)) {
    return required ? `${label} is required` : undefined;
  }
  return isValidPhoneValue(value) ? undefined : invalidMessage(label);
};

/**
 * react-hook-form `rules.validate` function for Controller-based fields on forms
 * that do NOT use a zodResolver. (When a resolver is set, RHF ignores these
 * rules and the resolver's schema governs instead.)
 */
export const phoneValidateRule =
  (options: PhoneValidationOptions = {}) =>
  (value: string | undefined | null): true | string =>
    validatePhoneField(value, options) ?? true;

/** Reusable zod schema for react-hook-form + zodResolver forms. */
export const phoneSchema = ({
  required = false,
  label = DEFAULT_LABEL,
}: PhoneValidationOptions = {}) => {
  if (required) {
    return z
      .string({ required_error: `${label} is required` })
      .nonempty(`${label} is required`)
      .refine((value) => isValidPhoneValue(value), {
        message: invalidMessage(label),
      });
  }
  return z
    .string()
    .refine((value) => isBlankPhone(value) || isValidPhoneValue(value), {
      message: invalidMessage(label),
    })
    .optional();
};
