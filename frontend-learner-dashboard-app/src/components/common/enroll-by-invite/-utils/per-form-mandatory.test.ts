import { describe, expect, it } from "vitest";
import { transformCustomFieldsToFormValues } from "./custom-field-helpers";
import type { InstituteCustomFieldResponse } from "./custom-field-helpers";

/**
 * Required-ness is a property of the field ON THIS FORM. The API returns both: `is_mandatory` on
 * the mapping row (what this form's Required switch writes) and `custom_field.isMandatory` on the
 * master row shared with every other form that reuses the field. Reading only the master is what
 * made the switch flip in the builder and change nothing here.
 */
const field = (
  overrides: Partial<InstituteCustomFieldResponse> & {
    isMandatory?: boolean | null;
  } = {}
): InstituteCustomFieldResponse => {
  const { isMandatory = true, ...rest } = overrides;
  return {
    id: "map-1",
    field_id: "cf-1",
    institute_id: "inst-1",
    type: "ENROLL_INVITE",
    type_id: "invite-1",
    group_name: null,
    individual_order: 0,
    group_internal_order: null,
    status: "ACTIVE",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    custom_field: {
      id: "cf-1",
      fieldKey: "phone_number_inst_a1",
      fieldName: "Phone Number",
      fieldType: "text",
      config: "",
      isMandatory,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    ...rest,
  };
};

const mandatoryOf = (f: InstituteCustomFieldResponse) =>
  transformCustomFieldsToFormValues([f])[f.custom_field.fieldKey]?.is_mandatory;

describe("a form asks for what THIS form requires", () => {
  it("honours an optional field even while the shared master says required", () => {
    expect(mandatoryOf(field({ is_mandatory: false, isMandatory: true }))).toBe(
      false
    );
  });

  it("honours a required field while the shared master says optional", () => {
    expect(mandatoryOf(field({ is_mandatory: true, isMandatory: false }))).toBe(
      true
    );
  });

  it("falls back to the master when this form never answered", () => {
    expect(mandatoryOf(field({ is_mandatory: null, isMandatory: true }))).toBe(
      true
    );
    expect(mandatoryOf(field({ isMandatory: true }))).toBe(true);
  });

  it("treats a field neither of them answered as optional", () => {
    expect(mandatoryOf(field({ is_mandatory: null, isMandatory: null }))).toBe(
      false
    );
  });
});
