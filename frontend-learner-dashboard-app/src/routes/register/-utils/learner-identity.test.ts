import { describe, expect, it } from "vitest";
import {
  learnerNameFrom,
  learnerPhoneFrom,
  mergeDataToGetUserId,
} from "./helper";
import type {
  DynamicSchemaData,
  OpenRegistrationUserDetails,
} from "@/types/assessment-open-registration";

const answers = (values: Record<string, string>): DynamicSchemaData =>
  Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      { name: key, value, is_mandatory: true, type: "textfield" },
    ]),
  ) as unknown as DynamicSchemaData;

const blankUser = (): OpenRegistrationUserDetails => ({
  id: "",
  username: "",
  email: "",
  full_name: "",
  address_line: "",
  city: "",
  region: "",
  pin_code: "",
  mobile_number: "",
  date_of_birth: "",
  gender: "",
  password: "",
  profile_pic_file_id: "",
  roles: [],
  root_user: true,
});

describe("learnerNameFrom", () => {
  it("reads a 'Student Name' field", () => {
    expect(learnerNameFrom(answers({ student_name: " Riya Sharma " }))).toBe(
      "Riya Sharma",
    );
  });

  it("prefers the built-in full_name", () => {
    expect(
      learnerNameFrom(answers({ student_name: "B", full_name: "A" })),
    ).toBe("A");
  });

  it("does not take a parent's or school's name", () => {
    expect(
      learnerNameFrom(answers({ father_name: "X", school_name: "Y" })),
    ).toBe("");
  });
});

describe("learnerPhoneFrom", () => {
  it("reads the built-in phone_number field", () => {
    expect(learnerPhoneFrom(answers({ phone_number: "+919876543210" }))).toBe(
      "+919876543210",
    );
  });

  it("reads a 'WhatApp Number' field (typo key)", () => {
    expect(learnerPhoneFrom(answers({ whatapp_number: "9876543210" }))).toBe(
      "9876543210",
    );
  });

  it("falls back to any phone-like key that is the learner's", () => {
    expect(
      learnerPhoneFrom(answers({ "student_mobile_(whatsapp)": "9000000001" })),
    ).toBe("9000000001");
  });

  it("never takes a parent's number", () => {
    expect(
      learnerPhoneFrom(
        answers({ parent_mobile_number: "9111111111", guardian_phone: "9222222222" }),
      ),
    ).toBe("");
  });

  it("skips a value that is not a phone number", () => {
    expect(
      learnerPhoneFrom(
        answers({ phone_number: "call after 6pm", whatsapp_number: "9876543210" }),
      ),
    ).toBe("9876543210");
    expect(learnerPhoneFrom(answers({ mobile_brand: "Samsung" }))).toBe("");
    expect(learnerPhoneFrom(answers({ phone: "12345" }))).toBe("");
  });

  it("skips a blank known key and uses the next one", () => {
    expect(
      learnerPhoneFrom(answers({ phone_number: "  ", whatsapp_number: "9300000000" })),
    ).toBe("9300000000");
  });
});

describe("mergeDataToGetUserId", () => {
  it("never puts an aliased phone into the account lookup", () => {
    // An institute that signs learners in by phone resolves the account by the
    // phone when one is sent; this page verifies by email, so it must not.
    const user = mergeDataToGetUserId(
      blankUser(),
      answers({
        full_name: "Asha",
        email: "a@example.com",
        phone_number: "+919876543210",
      }),
    );
    expect(user.full_name).toBe("Asha");
    expect(user.email).toBe("a@example.com");
    expect(user.mobile_number).toBe("");
  });

  it("fills the name from a Student Name form, phone untouched", () => {
    const user = mergeDataToGetUserId(
      blankUser(),
      answers({
        student_name: "Kabir",
        email: "k@example.com",
        whatapp_number: "9876543210",
        city: "Delhi",
      }),
    );
    expect(user.full_name).toBe("Kabir");
    expect(user.mobile_number).toBe("");
    expect(user.city).toBe("Delhi");
  });

  it("still copies an exact mobile_number key, as before", () => {
    const user = mergeDataToGetUserId(
      blankUser(),
      answers({ mobile_number: "+911111111111" }),
    );
    expect(user.mobile_number).toBe("+911111111111");
  });

  it("leaves the name blank when the form has none", () => {
    const user = mergeDataToGetUserId(
      blankUser(),
      answers({ email: "x@example.com", branch: "CSE" }),
    );
    expect(user.full_name).toBe("");
    expect(user.mobile_number).toBe("");
  });
});
