import { describe, expect, it } from "vitest";
import { applyEarlierAnswers } from "./earlier-answers";
import type { DynamicSchemaData } from "@/types/assessment-open-registration";

const field = (value: string, type = "text", options?: string[]) => ({
  name: "Field",
  value,
  is_mandatory: true,
  type,
  ...(options && { comma_separated_options: options }),
});

describe("applyEarlierAnswers", () => {
  const form: DynamicSchemaData = {
    email: field("new@x.com"),
    full_name: field("Profile Name"),
    phone_number: field(""),
    student_roll_number: field(""),
    branch_of_engineering: field("CSE", "dropdown", ["CSE", "ECE", "EEE"]),
  };

  it("fills empty fields and keeps filled ones", () => {
    const out = applyEarlierAnswers(form, {
      email: "old@x.com",
      full_name: "Old Name",
      phone_number: "+919000000001",
      student_roll_number: "R-101",
      branch_of_engineering: "ECE",
    });
    expect(out.email.value).toBe("new@x.com");
    expect(out.full_name.value).toBe("Profile Name");
    expect(out.phone_number.value).toBe("+919000000001");
    expect(out.student_roll_number.value).toBe("R-101");
    expect(out.branch_of_engineering.value).toBe("ECE");
  });

  it("skips a dropdown answer that is no longer an option", () => {
    const out = applyEarlierAnswers(form, { branch_of_engineering: "MECH" });
    expect(out.branch_of_engineering.value).toBe("CSE");
  });

  it("ignores keys the form does not have and bad payloads", () => {
    expect(applyEarlierAnswers(form, { other_field: "x" })).toEqual(form);
    expect(applyEarlierAnswers(form, null)).toBe(form);
    expect(applyEarlierAnswers(form, { phone_number: "   " })).toEqual(form);
  });

  it("leaves a half-formed field untouched", () => {
    const broken = { phone_number: { value: "" } } as unknown as DynamicSchemaData;
    expect(applyEarlierAnswers(broken, { phone_number: "123" })).toEqual(broken);
  });
});
