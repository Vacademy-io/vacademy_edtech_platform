import { describe, expect, it } from "vitest";
import {
  buildOtpLoginHref,
  pickOtpLoginMethod,
  readOtpLoginHandoff,
  stripOtpLoginHandoff,
} from "./otp-login-handoff";

const both = { allowEmailOtpAuth: true, allowPhoneAuth: true };

describe("the OTP login link", () => {
  it("round-trips email and phone", () => {
    const href = buildOtpLoginHref({ email: " a+b@x.com ", phone: "+91 98765-43210" });
    expect(href).toBe("/login?method=otp&email=a%2Bb%40x.com&phone=919876543210");
    expect(readOtpLoginHandoff(href!.slice("/login".length))).toEqual({
      email: "a+b@x.com",
      phone: "919876543210",
    });
  });

  it("is null when there is nothing usable to prefill", () => {
    expect(buildOtpLoginHref({ email: "", phone: "" })).toBeNull();
    expect(buildOtpLoginHref({ email: "not-an-email", phone: "9876543210" })).toBeNull();
  });

  it("ignores links that are not an OTP hand-off", () => {
    expect(readOtpLoginHandoff("?username=a@x.com&redirect=%2Fchange-password")).toBeNull();
    expect(readOtpLoginHandoff("?method=email&email=a@x.com")).toBeNull();
    expect(readOtpLoginHandoff("?method=otp")).toBeNull();
  });

  it("strips only its own params", () => {
    expect(stripOtpLoginHandoff("?method=otp&email=a%40x.com&phone=919876543210&redirect=%2Fx")).toBe(
      "?redirect=%2Fx",
    );
    expect(stripOtpLoginHandoff("?method=otp&email=a%40x.com")).toBe("");
  });
});

describe("which OTP form opens", () => {
  const handoff = { email: "a@x.com", phone: "919876543210" };

  it("follows the portal: email OTP when it is on", () => {
    expect(pickOtpLoginMethod(handoff, both)).toBe("EMAIL");
  });

  it("phone OTP when the portal has email OTP off and phone on", () => {
    expect(pickOtpLoginMethod(handoff, { allowEmailOtpAuth: false, allowPhoneAuth: true })).toBe("PHONE");
  });

  it("phone OTP when only the phone is known", () => {
    expect(pickOtpLoginMethod({ phone: "919876543210" }, both)).toBe("PHONE");
  });

  it("nothing when the portal allows no OTP the hand-off can fill", () => {
    expect(pickOtpLoginMethod(handoff, { allowEmailOtpAuth: false, allowPhoneAuth: false })).toBeNull();
    expect(pickOtpLoginMethod({ email: "a@x.com" }, { allowEmailOtpAuth: false, allowPhoneAuth: true })).toBeNull();
    expect(pickOtpLoginMethod(null, both)).toBeNull();
  });
});
