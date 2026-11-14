import { AssessmentCustomFieldOpenRegistration } from "@/types/assessment-open-registration";
import type { InstituteCustomField } from "@/routes/audience-response/-services/audience-campaign-services";

// Field keys already captured by the booking form's fixed inputs.
const RESERVED_FIELD_KEYS = new Set(["full_name", "email", "phone"]);

/**
 * Convert the booking page's campaign custom fields (InstituteCustomFieldDTO,
 * same shape the audience-response form consumes) into the renderer format —
 * adapted from audience-response-form's convertAudienceCustomFields, plus
 * filtering out non-ACTIVE fields and the keys covered by fixed inputs.
 */
export const convertBookingCustomFields = (
  customFields: InstituteCustomField[]
): AssessmentCustomFieldOpenRegistration[] => {
  return (customFields ?? [])
    .filter((field) => (field.status || "ACTIVE") === "ACTIVE")
    .filter(
      (field) =>
        !RESERVED_FIELD_KEYS.has(
          (field.custom_field?.fieldKey || "").toLowerCase()
        )
    )
    .map((field) => {
      const customField = field.custom_field;
      return {
        id: customField.id,
        field_name: customField.fieldName,
        field_key: customField.fieldKey,
        field_order: customField.individualOrder || customField.formOrder || 0,
        comma_separated_options: customField.config || "",
        config: customField.config || "{}",
        status: field.status || "ACTIVE",
        // Per-form answer first, master row second — the builder's Required switch writes the
        // mapping. `??` so an explicit false is respected.
        is_mandatory: field.is_mandatory ?? customField.isMandatory ?? false,
        field_type: customField.fieldType || "text",
        created_at: customField.createdAt,
        updated_at: customField.updatedAt,
      };
    })
    .sort((a, b) => a.field_order - b.field_order);
};

export interface BookingCustomFieldFormValue {
  id?: string;
  name: string;
  value: string;
  is_mandatory: boolean;
  type: string;
}

/** Default RHF values for the `custom` group, matching getDynamicSchema's shape. */
export const buildBookingCustomFieldDefaults = (
  formFields: AssessmentCustomFieldOpenRegistration[]
): Record<string, BookingCustomFieldFormValue> =>
  formFields.reduce<Record<string, BookingCustomFieldFormValue>>(
    (defaults, field) => {
      defaults[field.field_key] = {
        id: field.id,
        name: field.field_name,
        value: "",
        is_mandatory: field.is_mandatory || false,
        type: field.field_type,
      };
      return defaults;
    },
    {}
  );

/** Build the { field_key: value } map sent to the book endpoint. */
export const buildCustomFieldValues = (
  formFields: AssessmentCustomFieldOpenRegistration[],
  customValues: Record<string, BookingCustomFieldFormValue | undefined>
): Record<string, string> => {
  const result: Record<string, string> = {};
  formFields.forEach((field) => {
    const value = customValues[field.field_key]?.value;
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      result[field.field_key] = String(value);
    }
  });
  return result;
};
