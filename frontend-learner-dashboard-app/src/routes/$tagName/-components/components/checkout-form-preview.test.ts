// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The cart's checkout in the page editor's preview (Browse mode makes the
 * site clickable): the WhatsApp OTP and the checkout are buttons, not form
 * submits, so the preview's submit guard never sees them. They must send
 * nothing from the preview — no paid OTP, no enrolment or payment — and work
 * as always on the live site.
 */

const h = vi.hoisted(() => ({ post: vi.fn(), info: vi.fn() }));

vi.mock("axios", () => ({ default: { post: h.post, get: vi.fn(async () => ({ data: {} })) } }));
vi.mock("sonner", () => ({ toast: { info: h.info, error: vi.fn(), success: vi.fn() } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: undefined }),
}));
vi.mock("react-phone-input-2", async () => {
  const { createElement } = await import("react");
  return {
    default: (props: { value: string; onChange: (value: string) => void }) =>
      createElement("input", {
        "data-testid": "phone",
        value: props.value,
        onChange: (e: { target: { value: string } }) => props.onChange(e.target.value),
      }),
  };
});
vi.mock("react-phone-input-2/lib/bootstrap.css", () => ({}));
vi.mock("@/lib/phone-validation", () => ({ isValidPhoneValue: () => true }));
vi.mock("@/hooks/use-preferred-phone-countries", () => ({
  phoneFieldHasInput: () => false,
  usePreferredPhoneCountries: () => ({ defaultCountry: "in", preferredCountries: [] }),
}));
vi.mock("@/lib/auth/sessionUtility", () => ({
  getAccessToken: async () => null,
  isTokenExpired: () => true,
}));
vi.mock("@capacitor/preferences", () => ({
  Preferences: { get: async () => ({ value: null }), set: async () => {} },
}));
vi.mock("@/components/common/layout-container/sidebar/utils", () => ({
  getTerminology: (_term: string, fallback: string) => fallback,
}));
vi.mock("../../-services/custom-fields-service", () => ({ getBooksPreferenceFieldId: async () => null }));
vi.mock("@/services/auth-cycle-service", () => ({ performFullAuthCycle: vi.fn() }));
vi.mock("@/services/signup-api", () => ({ loginEnrolledUser: vi.fn() }));
vi.mock("./AddressForm", () => ({ AddressForm: () => null }));

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CheckoutForm } from "./CheckoutForm";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const mount = async (isPreviewMode: boolean) => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      React.createElement(CheckoutForm, {
        open: true,
        onOpenChange: () => {},
        instituteId: "inst-1",
        totalAmount: 100,
        items: [{ enrollInviteId: "inv-1" }],
        isPreviewMode,
      }),
    );
  });
};
const sendOtp = async () => {
  const phone = document.querySelector('[data-testid="phone"]') as HTMLInputElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(phone, "919876543210");
    phone.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const verify = Array.from(document.querySelectorAll("button")).find(
    (b) => b.textContent === "checkoutForm.buttons.verify",
  )!;
  await act(async () => {
    verify.click();
  });
};

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  h.post.mockReset();
  h.info.mockReset();
});

describe("checkout in the editor's preview", () => {
  it("never requests a WhatsApp OTP, and says forms do not send", async () => {
    await mount(true);
    await sendOtp();
    expect(h.post).not.toHaveBeenCalled();
    expect(h.info).toHaveBeenCalledWith("courseCataloguePage.previewFormNotSent");
  });

  it("on the live site requests the OTP as always", async () => {
    h.post.mockResolvedValue({ data: {} });
    await mount(false);
    await sendOtp();
    expect(h.post).toHaveBeenCalledTimes(1);
    expect(h.info).not.toHaveBeenCalled();
  });
});
