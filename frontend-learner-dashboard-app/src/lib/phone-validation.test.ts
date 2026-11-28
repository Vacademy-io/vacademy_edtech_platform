import { describe, expect, it } from "vitest";
import {
  isValidPhoneValue,
  normalizeStoredPhone,
  repairedStoredPhone,
} from "./phone-validation";

describe("repairedStoredPhone", () => {
  it("repairs a bare national number", () => {
    expect(repairedStoredPhone("8712345678", "in")).toBe("+918712345678");
    expect(repairedStoredPhone("08712345678", "in")).toBe("+918712345678");
  });

  it("keeps the stored 91… format WhatsApp-OTP login matches on", () => {
    expect(repairedStoredPhone("918712345678", "in")).toBeNull();
  });

  it("keeps a foreign number stored without the plus", () => {
    expect(repairedStoredPhone("12025550123", "in")).toBeNull();
  });

  it("keeps an unreadable number so a profile save doesn't wipe it", () => {
    expect(repairedStoredPhone("712345678", "in")).toBeNull();
    expect(repairedStoredPhone("0912345678", "in")).toBeNull();
  });

  it("never touches the widget's own output or blanks", () => {
    expect(repairedStoredPhone("+918712345678", "in")).toBeNull();
    expect(repairedStoredPhone("+91871", "in")).toBeNull();
    expect(repairedStoredPhone("+", "in")).toBeNull();
    expect(repairedStoredPhone("", "in")).toBeNull();
    expect(repairedStoredPhone("91", "in")).toBeNull();
    expect(repairedStoredPhone(undefined, "in")).toBeNull();
  });

  it("only ever writes back a number the validator accepts", () => {
    for (const stored of ["8712345678", "08712345678", "7012345678"]) {
      expect(isValidPhoneValue(repairedStoredPhone(stored, "in"))).toBe(true);
    }
  });

  it("leaves short placeholders failing validation as they did", () => {
    expect(repairedStoredPhone("12345678", "in")).toBeNull();
    expect(normalizeStoredPhone("12345678", "in")).toBe("12345678");
  });

  it("does nothing without a country to read it against", () => {
    expect(repairedStoredPhone("8712345678")).toBeNull();
  });
});

describe("normalizeStoredPhone", () => {
  it("adds the country code to a bare national number", () => {
    // Shown as a locked "+87 12345-678" before this fix.
    expect(normalizeStoredPhone("8712345678", "in")).toBe("+918712345678");
    expect(normalizeStoredPhone("08712345678", "in")).toBe("+918712345678");
  });

  it("keeps a number that is already valid with its own dial code", () => {
    // US number stored without "+" — not an Indian 1-prefixed one.
    expect(normalizeStoredPhone("12025550123", "in")).toBe("12025550123");
  });

  it("passes through what the widget already handles", () => {
    expect(normalizeStoredPhone("918712345678", "in")).toBe("918712345678");
    expect(normalizeStoredPhone("+918712345678", "in")).toBe("+918712345678");
    expect(normalizeStoredPhone("+91871", "in")).toBe("+91871");
    expect(normalizeStoredPhone("+", "in")).toBe("+");
    // Unreadable, but the widget matches a country and stays editable.
    expect(normalizeStoredPhone("712345678", "in")).toBe("712345678");
    expect(normalizeStoredPhone("91234567", "in")).toBe("91234567");
    expect(normalizeStoredPhone("12345678", "in")).toBe("12345678");
  });

  it("leaves blank values alone", () => {
    expect(normalizeStoredPhone("", "in")).toBe("");
    expect(normalizeStoredPhone(undefined, "in")).toBe("");
    expect(normalizeStoredPhone(null, "in")).toBe("");
    expect(normalizeStoredPhone("91", "in")).toBe("91");
  });

  it("clears a value no dial code matches, which would lock the field", () => {
    expect(normalizeStoredPhone("0912345678", "in")).toBe("");
    expect(normalizeStoredPhone("8712345", "in")).toBe("");
    expect(normalizeStoredPhone("8712345678")).toBe("");
  });

  it("reads the national number for the form's country", () => {
    expect(normalizeStoredPhone("2025550123", "us")).toBe("+12025550123");
  });
});
