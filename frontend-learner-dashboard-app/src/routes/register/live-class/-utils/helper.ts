import { CustomField, RegistrationFormValues } from "../-types/type";
import { isBlankPhone } from "@/lib/phone-validation";
import {
  getFieldRenderType,
  FieldRenderType,
} from "@/components/common/enroll-by-invite/-utils/custom-field-helpers";

export interface GuestRegistrationRequestDTO {
  session_id: string;
  email: string;
  // Second identity for phone-identity institutes; either email or
  // mobile_number must be non-empty.
  mobile_number: string;
  custom_fields: {
    customFieldId: string;
    value: string;
  }[];
}
export interface PublicUser {
  username?: string;
  email: string;
  full_name: string;
  address_line?: string;
  city?: string;
  region?: string;
  pin_code?: string;
  mobile_number?: string;
  date_of_birth?: string;
  gender?: string;
  password?: string;
  profile_pic_file_id?: string;
}

export interface CollectPublicUserDataDTO {
  user_dto: PublicUser;
  package_session_id: string | null;
  type: string;
  type_id: string;
  source: string | null;
  custom_field_values: {
    custom_field_id: string;
    type: string | null;
    type_id: string | null;
    source_type: string | null;
    source_id: string | null;
    value: string;
  }[];
}

/**
 * A value that is nothing but a country dial code — "+91", "91", "+1" — which is what
 * react-phone-input-2 leaves in the box when a learner opens an optional phone field and enters
 * nothing. Deliberately narrower than {@link isBlankPhone}: this only ever matches a bare
 * (optionally +-prefixed) run of at most 3 digits, so no answer a person actually typed can be
 * mistaken for it and blanked.
 */
const isDialCodeOnly = (value: string): boolean => /^\+?\d{0,3}$/.test(value.trim());

/**
 * The value to send for one answered field.
 *
 * A registration form is free to make its phone field optional, and the phone widget keeps the
 * selected country's dial code in the box — so a phone field the learner skipped reads back as
 * "+91" rather than "". Stored as-is it is a junk phone number on the CRM lead, and sent as the
 * identity it is shared by everyone who skipped the field. Blank is blank.
 */
const answerValue = (field: CustomField, raw: unknown): string => {
  const value = String(raw);
  if (
    getFieldRenderType(field.fieldKey, field.fieldType) === FieldRenderType.PHONE &&
    isDialCodeOnly(value)
  ) {
    return "";
  }
  return value;
};
export const transformToGuestRegistrationDTO = (
  formValues: RegistrationFormValues,
  sessionId: string,
  customFields: CustomField[]
): GuestRegistrationRequestDTO => {
  // Extract email: try top-level formValues.email first, then look in custom fields
  let email = formValues.email as string | undefined;
  if (!email || email === "undefined") {
    // Find the email from custom fields (fieldKey contains "email" or fieldType is email-like)
    const emailField = customFields.find(
      (f) =>
        f.fieldKey === "email" ||
        f.fieldKey === "email_address" ||
        f.fieldName.toLowerCase() === "email"
    );
    if (emailField) {
      const emailValue = formValues[emailField.fieldKey];
      if (emailValue) {
        email = String(emailValue);
      }
    }
  }

  const rawMobileNumber =
    extractFieldValue(
      formValues,
      customFields,
      "mobile_number",
      "phone_number",
      "phone",
      "mobile",
      "contact_number"
    ) || "";
  // A dial-code-only value means the learner skipped an optional phone field, not that they
  // can be identified or reached by that country code.
  const mobileNumber = isBlankPhone(rawMobileNumber) ? "" : rawMobileNumber;

  const dto: GuestRegistrationRequestDTO = {
    session_id: sessionId,
    email: email || "",
    mobile_number: mobileNumber,
    custom_fields: [],
  };

  for (const field of customFields) {
    const value = formValues[field.fieldKey];

    // Only include value if present (especially if not mandatory)
    if (value !== undefined && value !== null) {
      dto.custom_fields.push({
        customFieldId: field.id,
        value: answerValue(field, value),
      });
    }
  }

  return dto;
};

// Paid live sessions: superset of the guest registration DTO carrying the
// payer's display name (the backend creates the auth user invoices bill to).
export interface PaidRegistrationRequestDTO extends GuestRegistrationRequestDTO {
  full_name: string;
}

export const transformToPaidRegistrationDTO = (
  formValues: RegistrationFormValues,
  sessionId: string,
  customFields: CustomField[]
): PaidRegistrationRequestDTO => {
  const base = transformToGuestRegistrationDTO(formValues, sessionId, customFields);
  const fullName =
    extractFieldValue(formValues, customFields, "full_name", "name") || "";
  return { ...base, full_name: fullName };
};

// Normalize a label/key for loose comparison: lowercase, trim, and collapse
// runs of spaces/hyphens into single underscores (so "Full Name" -> "full_name").
const normalizeKey = (s: string): string =>
  s.toLowerCase().trim().replace(/[\s-]+/g, "_");

const extractFieldValue = (
  formValues: RegistrationFormValues,
  customFields: CustomField[],
  ...keys: string[]
): string | undefined => {
  // Try direct form value first
  for (const key of keys) {
    const val = formValues[key];
    if (val && String(val) !== "undefined") return String(val);
  }
  // Fallback: match a custom field by key or (normalized) name, then read its value.
  // The backend generates fieldKey as e.g. "full_name_inst_<instituteId>", and
  // fieldName may be a human label like "Full Name", so match loosely rather than
  // requiring an exact "full_name"/"name" equality.
  for (const key of keys) {
    const field = customFields.find((f) => {
      const fieldKey = f.fieldKey ?? "";
      const fieldName = normalizeKey(f.fieldName ?? "");
      return (
        fieldKey === key ||
        fieldKey.startsWith(`${key}_`) ||
        fieldName === key
      );
    });
    if (field) {
      const val = formValues[field.fieldKey];
      if (val && String(val) !== "undefined") return String(val);
    }
  }
  return undefined;
};

export const transformToCollectPublicUserDataDTO = (
  formValues: RegistrationFormValues,
  sessionId: string,
  customFields: CustomField[]
): CollectPublicUserDataDTO => {
  const email =
    extractFieldValue(formValues, customFields, "email", "email_address") || "";
  const fullName =
    extractFieldValue(formValues, customFields, "full_name", "name") || "";

  const dto: CollectPublicUserDataDTO = {
    user_dto: {
      full_name: fullName,
      email: email,
      username: formValues.username as string,
      mobile_number: formValues.mobile_number as string | undefined,
      address_line: formValues.address_line as string | undefined,
      city: formValues.city as string | undefined,
      region: formValues.state as string | undefined,
      pin_code: formValues.pin_code as string | undefined,
      date_of_birth: formValues.date_of_birth as string | undefined,
    },
    package_session_id: null,
    type: "PUBLIC_LIVE_SESSION",
    type_id: sessionId,
    source: "LEAD",
    custom_field_values: [],
  };
  for (const field of customFields) {
    const value = formValues[field.fieldKey];

    // Only include value if present
    if (value !== undefined && value !== null) {
      dto.custom_field_values.push({
        custom_field_id: field.id,
        type: "SESSION",
        type_id: sessionId,
        source_type: null,
        source_id: null,
        value: answerValue(field, value),
      });
    }
  }
  return dto;
};
