import { describe, expect, it } from "vitest";
import { FieldRenderType } from "@/components/common/enroll-by-invite/-utils/custom-field-helpers";
import {
  changedProfileValues,
  hasProfileValue,
  resolveProfileFieldControl,
  validateProfileValues,
  type LearnerProfileCustomField,
} from "./profile-custom-fields-utils";

const field = (
  overrides: Partial<LearnerProfileCustomField>
): LearnerProfileCustomField => ({
  custom_field_id: "f1",
  field_key: "school_name",
  field_name: "School Name",
  field_type: "text",
  config: null,
  value: null,
  editable: true,
  ...overrides,
});

const OPTIONS = JSON.stringify([
  { id: 1, value: "CSE", label: "CSE" },
  { id: 2, value: "ECE", label: "ECE" },
]);

describe("hasProfileValue", () => {
  it("treats blank and an empty multi-select as no answer", () => {
    expect(hasProfileValue(null)).toBe(false);
    expect(hasProfileValue("  ")).toBe(false);
    expect(hasProfileValue("[]")).toBe(false);
    expect(hasProfileValue("DPS")).toBe(true);
  });
});

describe("resolveProfileFieldControl", () => {
  it("uses the configured type when the stored value fits it", () => {
    expect(resolveProfileFieldControl(field({ field_type: "date", value: "2026-11-25" })).type).toBe(
      FieldRenderType.DATE
    );
    expect(resolveProfileFieldControl(field({ field_type: "number", value: "42" })).type).toBe(
      FieldRenderType.NUMBER
    );
    expect(resolveProfileFieldControl(field({ field_type: "date" })).type).toBe(FieldRenderType.DATE);
  });

  it("falls back to text when the typed control could not show the stored answer", () => {
    expect(resolveProfileFieldControl(field({ field_type: "date", value: "12th March" })).type).toBe(
      FieldRenderType.TEXT
    );
    expect(resolveProfileFieldControl(field({ field_type: "number", value: "R-12" })).type).toBe(
      FieldRenderType.TEXT
    );
    expect(resolveProfileFieldControl(field({ field_type: "checkbox", value: "Yes" })).type).toBe(
      FieldRenderType.TEXT
    );
    expect(
      resolveProfileFieldControl(field({ field_type: "multi_select", config: OPTIONS, value: "CSE,ECE" }))
        .type
    ).toBe(FieldRenderType.TEXT);
  });

  it("keeps a dropdown answer that is no longer an option selectable", () => {
    const control = resolveProfileFieldControl(
      field({ field_type: "dropdown", config: OPTIONS, value: "Mechanical" })
    );
    expect(control.type).toBe(FieldRenderType.DROPDOWN);
    expect(control.options?.map((o) => o.value)).toEqual(["CSE", "ECE", "Mechanical"]);
  });

  it("does not duplicate an answer that is already an option", () => {
    const control = resolveProfileFieldControl(
      field({ field_type: "dropdown", config: OPTIONS, value: "ECE" })
    );
    expect(control.options?.map((o) => o.value)).toEqual(["CSE", "ECE"]);
  });

  it("renders a dropdown with no options as text so it stays usable", () => {
    expect(resolveProfileFieldControl(field({ field_type: "dropdown", config: null })).type).toBe(
      FieldRenderType.TEXT
    );
  });

  it("detects a phone field from its key when typed as plain text", () => {
    expect(
      resolveProfileFieldControl(field({ field_key: "whatsapp_mobile", field_type: "text" })).type
    ).toBe(FieldRenderType.PHONE);
  });
});

describe("changedProfileValues", () => {
  const fields = [
    field({ custom_field_id: "school", value: "DPS" }),
    field({ custom_field_id: "roll", value: null }),
    field({ custom_field_id: "college", value: "IIT" }),
  ];

  it("sends only fields whose value changed, in field order", () => {
    expect(
      changedProfileValues(fields, { college: "", school: "DPS", roll: "R-12" })
    ).toEqual([
      { custom_field_id: "roll", value: "R-12" },
      { custom_field_id: "college", value: "" },
    ]);
  });

  it("sends nothing when the learner touched nothing", () => {
    expect(changedProfileValues(fields, {})).toEqual([]);
  });

  it("never sends a locked field, nor one the server did not mark editable", () => {
    const withLocked = [
      field({ custom_field_id: "branch", value: "North", editable: false }),
      field({ custom_field_id: "legacy", value: "x", editable: undefined }),
      field({ custom_field_id: "school", value: "DPS" }),
    ];
    expect(
      changedProfileValues(withLocked, { branch: "South", legacy: "y", school: "KV" })
    ).toEqual([{ custom_field_id: "school", value: "KV" }]);
  });
});

describe("validateProfileValues", () => {
  it("flags a bad email but allows clearing a field", () => {
    const fields = [
      field({ custom_field_id: "mail", field_key: "parent_email", field_type: "email" }),
      field({ custom_field_id: "dob", field_type: "date", value: "2010-01-01" }),
      field({ custom_field_id: "school" }),
    ];
    const errors = validateProfileValues(fields, [
      { custom_field_id: "mail", value: "not-an-email" },
      { custom_field_id: "dob", value: "" },
      { custom_field_id: "school", value: "anything" },
    ]);
    expect(Object.keys(errors)).toEqual(["mail"]);
  });
});
