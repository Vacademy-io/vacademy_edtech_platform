// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: string | { defaultValue?: string }) =>
      typeof opts === "string" ? opts : (opts?.defaultValue ?? key),
  }),
}));

import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CourseLanguagePicker } from "./CourseLanguagePicker";
import { CourseCartActions, CourseCartPending } from "./CourseCartActions";
import type { LanguageVersionOption } from "../-utils/course-version-selection";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

const render = (element: React.ReactElement) => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(element));
  return host;
};

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const options: LanguageVersionOption[] = [
  { code: "en", label: "English", chip: "EN", packageSessionId: "ps-en", disabled: false },
  { code: "hi", label: "Hindi", chip: "हिं", packageSessionId: "ps-hi", disabled: false },
  { code: "mr", label: "Marathi", packageSessionId: "ps-mr", disabled: true },
];

describe("CourseLanguagePicker", () => {
  it("renders one segment per language, the selected one checked", () => {
    const el = render(
      React.createElement(CourseLanguagePicker, {
        options,
        selectedPackageSessionId: "ps-hi",
        onSelect: () => {},
      }),
    );
    const radios = Array.from(el.querySelectorAll('[role="radio"]'));
    expect(radios.map((r) => r.textContent)).toEqual(["ENEnglish", "हिंHindi", "Marathi, Not open for enrolment yet"]);
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
    expect(el.querySelector('[role="group"]')?.getAttribute("aria-labelledby")).toBeTruthy();
    expect(el.textContent).toContain("Language");
  });

  it("selects another version, ignores the active and the disabled segment", () => {
    const onSelect = vi.fn();
    const el = render(
      React.createElement(CourseLanguagePicker, { options, selectedPackageSessionId: "ps-hi", onSelect }),
    );
    const [en, hi, mr] = Array.from(el.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
    act(() => hi.click());
    act(() => mr.click());
    expect(onSelect).not.toHaveBeenCalled();
    expect(mr.disabled).toBe(true);
    expect(mr.getAttribute("title")).toBe("Not open for enrolment yet");
    act(() => en.click());
    expect(onSelect).toHaveBeenCalledWith("ps-en");
  });

  it("renders nothing for a single-language course", () => {
    const el = render(
      React.createElement(CourseLanguagePicker, {
        options: options.slice(0, 1),
        selectedPackageSessionId: "ps-en",
        onSelect: () => {},
      }),
    );
    expect(el.innerHTML).toBe("");
  });
});

describe("CourseCartActions", () => {
  const handlers = () => ({ onAdd: vi.fn(), onBuyNow: vi.fn(), onViewCart: vi.fn() });

  it("offers Add to cart + Buy now, disabled until the cart is ready", () => {
    const h = handlers();
    const el = render(React.createElement(CourseCartActions, { inCart: false, ready: false, ...h }));
    const buttons = Array.from(el.querySelectorAll("button"));
    expect(buttons.map((b) => b.textContent)).toEqual(["Add to cart", "Buy now"]);
    expect(buttons.every((b) => b.disabled)).toBe(true);
  });

  it("adds, then shows In cart (opens the cart) with Buy now emphasised", () => {
    const h = handlers();
    const el = render(React.createElement(CourseCartActions, { inCart: false, ready: true, ...h }));
    act(() => el.querySelectorAll("button")[0].click());
    expect(h.onAdd).toHaveBeenCalledTimes(1);

    act(() => root!.render(React.createElement(CourseCartActions, { inCart: true, ready: true, note: null, ...h })));
    const [inCart, buyNow] = Array.from(el.querySelectorAll("button"));
    expect(inCart.textContent).toBe("In cart");
    expect(inCart.getAttribute("aria-label")).toBe("In cart, view cart");
    expect(buyNow.className).toContain("catalogue-btn-primary");
    act(() => inCart.click());
    act(() => buyNow.click());
    expect(h.onViewCart).toHaveBeenCalledTimes(1);
    expect(h.onBuyNow).toHaveBeenCalledTimes(1);
  });

  it("waits with nothing to press while the store is being checked (CourseCartPending)", () => {
    const el = render(React.createElement(CourseCartPending));
    const buttons = Array.from(el.querySelectorAll("button"));
    expect(buttons).toHaveLength(1);
    expect(buttons[0].disabled).toBe(true);
    expect(buttons[0].getAttribute("aria-busy")).toBe("true");
    expect(buttons[0].getAttribute("aria-label")).toBe("Checking availability…");
    expect(buttons[0].textContent).toBe("");
  });

  it("shows a note when another version of the course is in the cart", () => {
    const el = render(
      React.createElement(CourseCartActions, {
        inCart: false,
        ready: true,
        note: "Your cart has the English version. Adding this one replaces it.",
        layout: "row",
        ...handlers(),
      }),
    );
    expect(el.querySelector("p")?.textContent).toContain("English version");
  });
});
