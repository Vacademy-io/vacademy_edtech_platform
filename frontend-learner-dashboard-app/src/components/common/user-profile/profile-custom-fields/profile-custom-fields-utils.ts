import {
  FieldRenderType,
  getFieldRenderType,
  parseDropdownOptions,
  validateFieldValue,
} from "@/components/common/enroll-by-invite/-utils/custom-field-helpers";

/** One custom field on the learner's own profile (GET /learner/info/v1/custom-fields). */
export interface LearnerProfileCustomField {
  custom_field_id: string;
  field_key?: string | null;
  field_name: string;
  field_type?: string | null;
  config?: string | null;
  /** The learner's current value; null when they have none yet. */
  value?: string | null;
  /**
   * False when the institute's own rules read this field (it picks an invoice / receipt
   * series, or it is synced into a system field): shown read-only, never sent.
   */
  editable?: boolean;
}

/** Only an explicit `true` from the server makes a field editable. */
export const isProfileFieldEditable = (field: LearnerProfileCustomField): boolean =>
  field.editable === true;

export interface ProfileCustomFieldValue {
  custom_field_id: string;
  value: string;
}

type EditorOption = { _id?: number; value: string; label: string };

export interface ProfileFieldControl {
  type: FieldRenderType;
  /** Only for option types: the field's options, plus the stored answer if it is no longer one of them. */
  options?: EditorOption[];
}

/** A real answer: not empty and not an empty multi-select ("[]"). */
export const hasProfileValue = (value?: string | null): value is string =>
  typeof value === "string" && value.trim() !== "" && value.trim() !== "[]";

const OPTION_TYPES = [
  FieldRenderType.DROPDOWN,
  FieldRenderType.RADIO,
  FieldRenderType.MULTI_SELECT,
];

const isJsonArray = (value: string): boolean => {
  try {
    return Array.isArray(JSON.parse(value));
  } catch {
    return false;
  }
};

/**
 * The control a profile field is edited with. A stored answer that the typed control cannot show
 * (an old free-text date, "Yes" in a checkbox, a comma list in a multi-select) falls back to a text
 * box, so the learner sees what they have instead of an empty control. A dropdown/radio answer
 * that is no longer one of the options is kept as an extra option for the same reason.
 */
export const resolveProfileFieldControl = (
  field: LearnerProfileCustomField
): ProfileFieldControl => {
  const type = getFieldRenderType(field.field_key ?? "", field.field_type ?? "");
  const stored = hasProfileValue(field.value) ? field.value.trim() : "";

  if (stored) {
    if (type === FieldRenderType.DATE && !/^\d{4}-\d{2}-\d{2}/.test(stored)) {
      return { type: FieldRenderType.TEXT };
    }
    if (type === FieldRenderType.NUMBER && Number.isNaN(Number(stored))) {
      return { type: FieldRenderType.TEXT };
    }
    if (type === FieldRenderType.CHECKBOX && stored !== "true" && stored !== "false") {
      return { type: FieldRenderType.TEXT };
    }
    if (type === FieldRenderType.MULTI_SELECT && !isJsonArray(stored)) {
      return { type: FieldRenderType.TEXT };
    }
  }

  if (!OPTION_TYPES.includes(type)) {
    return { type };
  }

  const options: EditorOption[] = field.config ? [...parseDropdownOptions(field.config)] : [];
  if (
    stored &&
    type !== FieldRenderType.MULTI_SELECT &&
    !options.some((option) => option.value === stored)
  ) {
    options.push({ value: stored, label: stored });
  }
  // No options at all would render an empty select the learner can't use.
  if (options.length === 0) {
    return { type: FieldRenderType.TEXT };
  }
  return { type, options };
};

/** The values the learner actually changed, in field order. Untouched fields are never re-sent. */
export const changedProfileValues = (
  fields: LearnerProfileCustomField[],
  edits: Record<string, string>
): ProfileCustomFieldValue[] =>
  fields
    .filter(isProfileFieldEditable)
    .filter((field) => field.custom_field_id in edits)
    .filter((field) => (edits[field.custom_field_id] ?? "") !== (field.value ?? ""))
    .map((field) => ({
      custom_field_id: field.custom_field_id,
      value: edits[field.custom_field_id] ?? "",
    }));

const VALIDATED_TYPES = [
  FieldRenderType.EMAIL,
  FieldRenderType.PHONE,
  FieldRenderType.URL,
  FieldRenderType.NUMBER,
  FieldRenderType.DATE,
];

/**
 * Format errors per field id for the changed values. Empty is allowed: profile fields are optional
 * and a learner may clear one.
 */
export const validateProfileValues = (
  fields: LearnerProfileCustomField[],
  changes: ProfileCustomFieldValue[]
): Record<string, string> => {
  const errors: Record<string, string> = {};
  for (const change of changes) {
    if (!hasProfileValue(change.value)) continue;
    const field = fields.find((f) => f.custom_field_id === change.custom_field_id);
    if (!field) continue;
    const { type } = resolveProfileFieldControl(field);
    if (!VALIDATED_TYPES.includes(type)) continue;
    const result = validateFieldValue(change.value, type);
    if (!result.isValid && result.error) {
      errors[change.custom_field_id] = result.error;
    }
  }
  return errors;
};
