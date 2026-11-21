import { describe, expect, it } from "vitest";
import { transformToGuestRegistrationDTO } from "./helper";
import type { CustomField } from "../-types/type";

const field = (
  overrides: Partial<CustomField> & Pick<CustomField, "id" | "fieldKey" | "fieldName">
): CustomField =>
  ({
    fieldType: "text",
    formOrder: 0,
    mandatory: false,
    config: "",
    ...overrides,
  }) as CustomField;

const NAME = field({ id: "cf-1", fieldKey: "full_name_inst_a1", fieldName: "Full Name" });
const EMAIL = field({
  id: "cf-2",
  fieldKey: "email_inst_a1",
  fieldName: "Email",
  fieldType: "email",
});
const PHONE = field({
  id: "cf-3",
  fieldKey: "phone_number_inst_a1",
  fieldName: "Phone Number",
  fieldType: "phone",
});

const valueOf = (
  dto: ReturnType<typeof transformToGuestRegistrationDTO>,
  customFieldId: string
) => dto.custom_fields.find((entry) => entry.customFieldId === customFieldId)?.value;

describe("registering with an optional phone number left blank", () => {
  it("sends no mobile number when the field holds only the country dial code", () => {
    const dto = transformToGuestRegistrationDTO(
      {
        [NAME.fieldKey]: "Asha",
        [EMAIL.fieldKey]: "asha@example.com",
        // What react-phone-input-2 leaves behind on a field the learner opened and cleared.
        [PHONE.fieldKey]: "+91",
      },
      "session-1",
      [NAME, EMAIL, PHONE]
    );

    expect(dto.mobile_number).toBe("");
    expect(dto.email).toBe("asha@example.com");
    // "+91" is shared by everyone who skipped the field — storing it would make them one guest.
    expect(valueOf(dto, PHONE.id)).toBe("");
  });

  it("still sends a real number", () => {
    const dto = transformToGuestRegistrationDTO(
      {
        [NAME.fieldKey]: "Asha",
        [EMAIL.fieldKey]: "asha@example.com",
        [PHONE.fieldKey]: "+919876543210",
      },
      "session-1",
      [NAME, EMAIL, PHONE]
    );

    expect(dto.mobile_number).toBe("+919876543210");
    expect(valueOf(dto, PHONE.id)).toBe("+919876543210");
  });

  it("never blanks a value the learner actually typed", () => {
    // A field whose key merely contains "contact" is detected as a phone field. Whatever ends up
    // in it, only a bare dial code may be treated as "left blank".
    const CONTACT = field({
      id: "cf-4",
      fieldKey: "emergency_contact_inst_a1",
      fieldName: "Emergency Contact",
    });
    const dto = transformToGuestRegistrationDTO(
      {
        [NAME.fieldKey]: "Asha",
        [EMAIL.fieldKey]: "asha@example.com",
        [CONTACT.fieldKey]: "Ravi (uncle)",
        [PHONE.fieldKey]: "+9198",
      },
      "session-1",
      [NAME, EMAIL, PHONE, CONTACT]
    );

    expect(valueOf(dto, CONTACT.id)).toBe("Ravi (uncle)");
    // 4 digits is past a dial code, so it is kept as the (invalid) answer it is, not dropped.
    expect(valueOf(dto, PHONE.id)).toBe("+9198");
  });

  it("keeps a phone-identity registration working when email is the optional one", () => {
    const dto = transformToGuestRegistrationDTO(
      {
        [NAME.fieldKey]: "Asha",
        [EMAIL.fieldKey]: "",
        [PHONE.fieldKey]: "+919876543210",
      },
      "session-1",
      [NAME, EMAIL, PHONE]
    );

    expect(dto.email).toBe("");
    expect(dto.mobile_number).toBe("+919876543210");
  });
});
