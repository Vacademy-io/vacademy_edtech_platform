/**
 * Utility functions for handling custom fields in registration forms
 */
import i18n from "@/i18n";

export interface CustomField {
  guestId: string | null;
  id: string;
  fieldKey: string;
  fieldName: string;
  fieldType: string;
  defaultValue: string | null;
  config: string;
  formOrder: number | null;
  isMandatory: boolean | null;
  isFilter: boolean;
  isSortable: boolean;
  isHidden: boolean | null;
  createdAt: string;
  updatedAt: string;
  sessionId: string;
  liveSessionId: string | null;
  customFieldValue: string | null;
  groupName: string | null;
  groupInternalOrder: number | null;
  individualOrder: number | null;
  settingRequest: string | null;
}

export interface InstituteCustomFieldResponse {
  id: string;
  field_id: string | null;
  institute_id: string;
  type: string;
  type_id: string;
  group_name: string | null;
  custom_field: CustomField;
  /** Per-form required-ness. Takes precedence over the shared `custom_field.isMandatory`. */
  is_mandatory?: boolean | null;
  individual_order: number | null;
  group_internal_order: number | null;
  status: string;
}

export enum FieldRenderType {
  PHONE = "PHONE",
  EMAIL = "EMAIL",
  TEXT = "TEXT",
  DROPDOWN = "DROPDOWN",
  NUMBER = "NUMBER",
  URL = "URL",
  DATE = "DATE",
  TEXTAREA = "TEXTAREA",
  CHECKBOX = "CHECKBOX",
  RADIO = "RADIO",
  FILE = "FILE",
  MULTI_SELECT = "MULTI_SELECT",
}

/**
 * Determines the render type for a custom field based on its key and type.
 *
 * Prioritises the explicit `fieldType` coming from the API (settings) — if
 * the admin picked "date" in Settings we must render a date picker even if
 * the field name happens to contain "phone". Only when the field type is a
 * generic "text" do we fall back to keyword-based auto-detection (phone/
 * email) for backward compatibility with older fields.
 */
export const getFieldRenderType = (
  fieldKey: string,
  fieldType: string
): FieldRenderType => {
  const normalized = (fieldType || "").toLowerCase().trim();

  // Direct mapping from API field type to render type (takes priority)
  switch (normalized) {
    case "dropdown":
    case "select":
      return FieldRenderType.DROPDOWN;
    case "radio":
      return FieldRenderType.RADIO;
    case "number":
      return FieldRenderType.NUMBER;
    case "email":
      return FieldRenderType.EMAIL;
    case "url":
      return FieldRenderType.URL;
    case "phone":
    case "tel":
      return FieldRenderType.PHONE;
    case "date":
      return FieldRenderType.DATE;
    case "textarea":
      return FieldRenderType.TEXTAREA;
    case "checkbox":
      return FieldRenderType.CHECKBOX;
    case "file":
      return FieldRenderType.FILE;
    case "multi_select":
      return FieldRenderType.MULTI_SELECT;
  }

  // Fallback: auto-detect phone/email from field key for legacy generic-text fields
  const lowerKey = (fieldKey || "").toLowerCase();
  const phoneKeywords = ["phone", "mobile", "contact", "telephone", "cell"];
  if (phoneKeywords.some((keyword) => lowerKey.includes(keyword))) {
    return FieldRenderType.PHONE;
  }
  const emailKeywords = ["email", "e-mail", "mail"];
  if (emailKeywords.some((keyword) => lowerKey.includes(keyword))) {
    return FieldRenderType.EMAIL;
  }

  return FieldRenderType.TEXT;
};

/**
 * Full config shape stored in the custom_fields.config column as JSON.
 * - Legacy dropdown-only format: bare array [{id,value,label}]
 * - New object format: { options?, defaultValue?, allowedFileTypes?, maxSizeMB?, min?, max?, minDate?, maxDate? }
 */
export interface CustomFieldFullConfig {
  options?: Array<{ id: number; value: string; label: string; parent?: string }>;
  // Dependent dropdown: the field_key of the dropdown this one follows. Each
  // option's `parent` names the parent value it belongs to; an option with no
  // `parent` shows for every parent value.
  parentFieldKey?: string;
  defaultValue?: string;
  allowedFileTypes?: string[];
  maxSizeMB?: number;
  min?: number;
  max?: number;
  minDate?: string;
  maxDate?: string;
  maxLength?: number;
  // Optional bold section heading rendered above the description block
  // (e.g. a "Terms & Conditions" title). Pairs with `description`.
  heading?: string;
  // Long descriptive body shown above the input (e.g. a Terms & Conditions
  // block above a "Yes, I agree" checkbox). Stored here instead of fieldName
  // because fieldName is varchar(255); config is unbounded text.
  description?: string;
  // Short hint rendered under the input, set by the admin in the custom-field
  // dialog. Distinct from `description`, which is the checkbox consent body.
  helpText?: string;
  // Overrides the auto-generated "Enter <field name>" prompt inside the input.
  // Authored per field so one institute can reword the hint (e.g. spelling out
  // "Enter First Name and Last Name" on a Full Name field) without renaming the
  // field — the label above the input keeps coming from `field_name`.
  placeholder?: string;
  // Proof-of-ownership gate: the visitor must receive a one-time code on the
  // value they typed and enter it back before the form can be submitted.
  // Authored per field in the admin, so any field can be made verifiable —
  // nothing here is specific to phone numbers or to one institute.
  verification?: FieldVerificationConfig;
}

/** Channels a one-time code can be delivered over. */
export type VerificationChannel = "WHATSAPP";

export interface FieldVerificationConfig {
  /** Off unless explicitly enabled — an unverifiable field must never block a form. */
  required?: boolean;
  channel?: VerificationChannel;
  /**
   * WhatsApp template to send. Naming one here skips the institute's
   * OTP_REQUEST notification config entirely, so an institute with an approved
   * template but no config wired up can still verify. Blank falls back to that
   * config.
   */
  templateName?: string;
  /**
   * Language the named template is approved in. Meta registers a template per
   * language, so one approved only as "en_US" must say so or the send is
   * rejected. Ignored unless templateName is set; blank means English.
   */
  languageCode?: string;
}

/**
 * The verification a field asks for, or null when it asks for none.
 *
 * Deliberately strict: a config that names a channel this build cannot deliver
 * returns null rather than a gate nobody can pass. A form that cannot be
 * submitted is a worse failure than one that skips a check.
 */
export const getFieldVerification = (
  config?: string | null
): Required<Pick<FieldVerificationConfig, "channel">> & FieldVerificationConfig | null => {
  const parsed = parseFieldConfig(config)?.verification;
  if (!parsed?.required) return null;
  const channel = parsed.channel ?? "WHATSAPP";
  if (channel !== "WHATSAPP") return null;
  return { ...parsed, channel };
};

// Sentinel value for the admin's "All Files" option — equivalent to no
// restriction at all, including formats outside the fixed category list
// (e.g. .sb3 PictoBlox/Scratch projects).
export const ALL_FILES_VALUE = "all";

export const isUnrestrictedFileTypes = (allowed?: string[] | null): boolean =>
  !allowed || allowed.length === 0 || allowed.includes(ALL_FILES_VALUE);

/**
 * Parse the full config JSON (handles both legacy array and new object format)
 */
export const parseFieldConfig = (config?: string | null): CustomFieldFullConfig | undefined => {
  if (!config) return undefined;
  try {
    const parsed = JSON.parse(config);
    if (Array.isArray(parsed)) {
      return { options: parsed };
    }
    if (parsed && typeof parsed === "object") {
      return parsed as CustomFieldFullConfig;
    }
  } catch {
    // ignore - may be a comma-separated fallback handled elsewhere
  }
  return undefined;
};

/**
 * Extract the default value from a field's config JSON (or top-level defaultValue)
 */
export const getFieldDefaultValue = (
  config?: string | null,
  topLevelDefault?: string | null
): string => {
  if (topLevelDefault) return topLevelDefault;
  const parsed = parseFieldConfig(config);
  return parsed?.defaultValue ?? "";
};

type DropdownOption = { _id: number; value: string; label: string; parent?: string };

/**
 * Admin writes two variants of the same option config: {id,value,label} and
 * {label,name}. Both mean the same thing, so collapse them to one shape here.
 * An option with no resolvable value is dropped — it would otherwise render as
 * a SelectItem that cannot be selected.
 */
const normaliseOptions = (
  raw: Array<string | { id?: number; value?: string; name?: string; label?: string; parent?: unknown }>
): DropdownOption[] =>
  raw
    // Some writers (e.g. the MCP form editor) store {"options":["A","B"]} —
    // plain strings, which used to resolve to no value and render an empty list.
    .map((entry) => (typeof entry === "string" ? { value: entry.trim() } : entry))
    .map((option, index) => {
      const value = option.value ?? option.name;
      const parent = typeof option.parent === "string" ? option.parent.trim() : "";
      return {
        _id: option.id ?? index + 1,
        value: value as string,
        label: option.label ?? (value as string),
        ...(parent ? { parent } : {}),
      };
    })
    .filter((option) => option.value !== undefined && option.value !== "");

/**
 * Parses dropdown options from config JSON string or comma-separated string
 * Expected formats:
 * - JSON array: "[{\"id\":1,\"value\":\"Option 1\",\"label\":\"Option 1\"},{\"id\":2,\"value\":\"Option 2\",\"label\":\"Option 2\"}]"
 * - JSON array: "[{\"label\":\"Option 1\",\"name\":\"Option 1\"}]"
 * - Comma-separated: "MALE,FEMALE,OTHER"
 */
export const parseDropdownOptions = (
  config: string
): DropdownOption[] => {
  try {
    // Return empty array for empty config
    if (!config || config === "{}") {
      console.warn("parseDropdownOptions: Empty or invalid config provided");
      return [];
    }

    const trimmedConfig = config.trim();

    // Check if config is a simple comma-separated string (not JSON)
    // If it doesn't start with '[' or '{', treat it as comma-separated
    if (!trimmedConfig.startsWith('[') && !trimmedConfig.startsWith('{')) {
      // It's a comma-separated string like "MALE,FEMALE,OTHER"
      return trimmedConfig.split(",").map((option, index) => ({
        _id: index + 1,
        value: option.trim(),
        label: option.trim(),
      }));
    }

    // Parse JSON string
    const parsed = JSON.parse(config);

    // Handle object case wrapping options
    if (!Array.isArray(parsed) && typeof parsed === "object" && parsed !== null) {
      // New object-format config: {options: [{id,value,label}], defaultValue, ...}
      if (Array.isArray(parsed.options)) {
        return normaliseOptions(parsed.options);
      }

      // Check for comma-separated wrapping (legacy) including the typo version seen in logs
      const optionsString = parsed.coommaSepartedOptions || parsed.commaSeparatedOptions;
      if (typeof optionsString === "string") {
        return optionsString.split(",").map((option: string, index: number) => ({
          _id: index + 1,
          value: option.trim(),
          label: option.trim(),
        }));
      }
    }

    // Ensure it's an array
    if (!Array.isArray(parsed)) {
      console.warn("parseDropdownOptions: Config is not an array", parsed);
      if (typeof parsed === "string") {
        return parsed.split(",").map((option, index) => ({
          _id: index + 1,
          value: option.trim(),
          label: option.trim(),
        }));
      }
      return [];
    }

    // Transform to match SelectField Options interface
    return normaliseOptions(parsed);
  } catch (error) {
    console.error("parseDropdownOptions: Error parsing config", {
      config,
      error,
    });
    // If JSON parsing fails, try treating it as comma-separated string
    try {
      const trimmedConfig = config.trim();
      if (trimmedConfig.includes(',')) {
        return trimmedConfig.split(",").map((option, index) => ({
          _id: index + 1,
          value: option.trim(),
          label: option.trim(),
        }));
      }
    } catch (fallbackError) {
      console.error("parseDropdownOptions: Fallback parsing also failed", fallbackError);
    }
    return [];
  }
};

export interface FormFieldValue {
  id: string;
  name: string;
  value: string;
  is_mandatory: boolean;
  type: string;
  render_type: FieldRenderType;
  config: string;
  comma_separated_options?: Array<{
    _id: number;
    value: string;
    label: string;
  }>;
}

/**
 * Transforms institute custom fields response to form values structure
 */
export const transformCustomFieldsToFormValues = (
  customFields: InstituteCustomFieldResponse[]
): Record<string, FormFieldValue> => {
  const formValues: Record<string, FormFieldValue> = {};

  customFields.forEach((field) => {
    const { custom_field } = field;
    const fieldKey = custom_field.fieldKey;

    const fieldType = (custom_field.fieldType || "text").toLowerCase();
    const initialValue =
      custom_field.customFieldValue ||
      getFieldDefaultValue(custom_field.config, custom_field.defaultValue);

    formValues[fieldKey] = {
      id: custom_field.id,
      name: custom_field.fieldName,
      value: initialValue,
      // The form builder's Required switch writes the per-form mapping row, so read that
      // first and fall back to the master only when this form never answered.
      is_mandatory: field.is_mandatory ?? custom_field.isMandatory ?? false,
      type: fieldType,
      render_type: getFieldRenderType(fieldKey, fieldType),
      config: custom_field.config,
      comma_separated_options:
        fieldType === "dropdown" || fieldType === "radio" || fieldType === "multi_select"
          ? parseDropdownOptions(custom_field.config)
          : undefined,
    };
  });

  return formValues;
};

/**
 * Validates if a field value is valid based on its render type
 */
export const validateFieldValue = (
  value: string,
  renderType: FieldRenderType
): { isValid: boolean; error?: string } => {
  if (!value || !value.trim()) {
    return { isValid: false, error: i18n.t("enrollmentB:fieldValidation.required") };
  }

  switch (renderType) {
    case FieldRenderType.EMAIL: {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(value)) {
        return { isValid: false, error: i18n.t("enrollmentB:fieldValidation.invalidEmail") };
      }
      break;
    }
    case FieldRenderType.PHONE: {
      const phoneRegex = /^[+]?[\d\s()-]{10,}$/;
      if (!phoneRegex.test(value)) {
        return {
          isValid: false,
          error: i18n.t("enrollmentB:fieldValidation.invalidPhone"),
        };
      }
      break;
    }
    case FieldRenderType.URL: {
      try {
        new URL(value);
      } catch {
        return { isValid: false, error: i18n.t("enrollmentB:fieldValidation.invalidUrl") };
      }
      break;
    }
    case FieldRenderType.NUMBER: {
      if (Number.isNaN(Number(value))) {
        return { isValid: false, error: i18n.t("enrollmentB:fieldValidation.invalidNumber") };
      }
      break;
    }
    case FieldRenderType.DATE: {
      if (Number.isNaN(new Date(value).getTime())) {
        return { isValid: false, error: i18n.t("enrollmentB:fieldValidation.invalidDate") };
      }
      break;
    }
  }

  return { isValid: true };
};

/**
 * Sorts custom fields by their order (if available)
 */
export const sortCustomFields = (
  fields: InstituteCustomFieldResponse[]
): InstituteCustomFieldResponse[] => {
  return [...fields].sort((a, b) => {
    const orderA = a.individual_order ?? a.group_internal_order ?? 999;
    const orderB = b.individual_order ?? b.group_internal_order ?? 999;
    return orderA - orderB;
  });
};

/**
 * Gets the input type for HTML input element
 */
export const getInputType = (
  fieldType: string,
  renderType: FieldRenderType
): string => {
  if (renderType === FieldRenderType.EMAIL) return "email";
  if (renderType === FieldRenderType.URL) return "url";
  if (renderType === FieldRenderType.NUMBER || fieldType === "number") return "number";
  if (renderType === FieldRenderType.PHONE) return "tel";
  if (renderType === FieldRenderType.DATE) return "date";
  return "text";
};

/**
 * Dependent (cascading) dropdowns, e.g. Course → Query: where a field stands
 * given the values the visitor has picked so far.
 * - independent: not a dependent field — render as before.
 * - waiting: the parent has no value yet — show the field disabled.
 * - empty: the parent's value has no options here — hide it and skip "required".
 * - ready: render with exactly these options.
 */
export type DependentFieldState =
  | { kind: "independent" }
  | { kind: "waiting"; parentFieldKey: string }
  | { kind: "empty"; parentFieldKey: string }
  | { kind: "ready"; parentFieldKey: string; options: DropdownOption[] };

export const getParentFieldKey = (config?: string | null): string | null => {
  const key = parseFieldConfig(config)?.parentFieldKey;
  return typeof key === "string" && key.trim() ? key.trim() : null;
};

export const resolveDependentField = (
  config: string | null | undefined,
  parentValueOf: (fieldKey: string) => string | undefined
): DependentFieldState => {
  const parentFieldKey = getParentFieldKey(config);
  if (!parentFieldKey) return { kind: "independent" };
  const parentValue = (parentValueOf(parentFieldKey) ?? "").trim();
  if (!parentValue) return { kind: "waiting", parentFieldKey };
  const options = parseDropdownOptions(config || "").filter(
    (option) => !option.parent || option.parent === parentValue
  );
  return options.length
    ? { kind: "ready", parentFieldKey, options }
    : { kind: "empty", parentFieldKey };
};

/**
 * Keys of every field that follows `changedKey`, directly or through another
 * dependent field — their values are stale once the parent changes.
 */
export const dependentFieldKeys = (
  changedKey: string,
  fields: Array<{ key: string; config?: string | null }>
): string[] => {
  const out: string[] = [];
  const queue = [changedKey];
  while (queue.length) {
    const parent = queue.shift()!;
    for (const field of fields) {
      if (field.key !== changedKey && !out.includes(field.key) && getParentFieldKey(field.config) === parent) {
        out.push(field.key);
        queue.push(field.key);
      }
    }
  }
  return out;
};
