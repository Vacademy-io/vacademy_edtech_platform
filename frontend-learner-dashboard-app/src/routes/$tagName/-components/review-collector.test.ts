// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const submit = vi.fn();
const listApproved = vi.fn();
vi.mock("../-services/review-service", () => ({
  ReviewService: {
    submit: (...args: unknown[]) => submit(...args),
    listApproved: (...args: unknown[]) => listApproved(...args),
  },
}));
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts && "count" in opts ? `${key}:${opts.count}` : key),
  }),
}));
vi.mock("@/hooks/use-media-query", () => ({ useMediaQuery: () => true }));
vi.mock("@/services/upload_file", () => ({ getPublicUrlWithoutLogin: async () => "" }));
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ReviewCollector } from "./components/review/ReviewCollector";
import { TestimonialSectionComponent } from "./components/TestimonialSectionComponent";
import {
  DEFAULT_REVIEW_FIELDS,
  EMPTY_REVIEW,
  mergeTestimonials,
  normalizeDisplay,
  normalizeFields,
  reviewPayload,
  reviewToTestimonial,
  validateReview,
} from "../-utils/review-collector";

/**
 * Reviews & feedback: what the form insists on, what it sends, how each
 * display asks (button, self-opening popup, inline), that a visitor who has
 * reviewed is not asked again, and that a testimonials section only reads
 * approved reviews when its reviewSource says so.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// This jsdom setup has no usable localStorage / sessionStorage; Map-backed ones are enough.
const makeStore = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  };
};
Object.defineProperty(window, "localStorage", { configurable: true, value: makeStore() });
Object.defineProperty(window, "sessionStorage", { configurable: true, value: makeStore() });

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  submit.mockReset().mockResolvedValue(undefined);
  listApproved.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

const render = async (el: React.ReactElement) => {
  await act(async () => root.render(el));
};
const q = <T extends Element>(sel: string) => document.querySelector(sel) as T | null;
const typeInto = (input: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};
const base = { componentId: "c1", instituteId: "inst-1", tagName: "school", pageRoute: "home" };

describe("review form rules", () => {
  it("needs stars and a name; other fields only when required", () => {
    expect(validateReview(EMPTY_REVIEW, DEFAULT_REVIEW_FIELDS)).toEqual({ rating: "required", reviewerName: "required" });
    const ok = { ...EMPTY_REVIEW, rating: 5, reviewerName: "Asha" };
    expect(validateReview(ok, DEFAULT_REVIEW_FIELDS)).toEqual({});
    const strict = normalizeFields({ reviewText: "required", city: "required", course: "off" });
    expect(validateReview(ok, strict)).toEqual({ reviewText: "required", city: "required" });
  });

  it("sends only the fields the block asks for", () => {
    const v = { ...EMPTY_REVIEW, rating: 4, reviewerName: " Asha ", city: "Ajmer", courseName: "SSC", designation: "Clerk", reviewText: " Great " };
    expect(reviewPayload(v, normalizeFields({ course: "off" }))).toEqual({
      rating: 4,
      reviewerName: "Asha",
      reviewText: "Great",
      city: "Ajmer",
      courseName: undefined,
      designation: "Clerk",
    });
  });

  it("reads unknown settings as the defaults", () => {
    expect(normalizeDisplay("bogus")).toBe("floatingPopup");
    expect(normalizeFields({ city: "nope" }).city).toBe("optional");
  });
});

describe("testimonials from reviews", () => {
  it("builds a card from an approved review and merges by source", () => {
    const card = reviewToTestimonial({ id: "r", rating: 5, reviewer_name: "Asha", review_text: "Good", designation: "Clerk", course_name: "SSC", city: "Ajmer" });
    expect(card).toEqual({ name: "Asha", role: "Clerk · SSC · Ajmer", feedback: "Good", avatar: "", rating: 5 });
    const manual = [{ name: "M" }];
    expect(mergeTestimonials(manual, [card], "manual")).toBe(manual);
    expect(mergeTestimonials(manual, [card], "reviews")).toEqual([card]);
    expect(mergeTestimonials(manual, [card], "both")).toEqual([manual[0], card]);
  });

  it("a section left on manual never asks the server", async () => {
    await render(
      React.createElement(TestimonialSectionComponent, {
        headerText: "Students",
        description: "",
        layout: "grid",
        testimonials: [{ name: "Ravi", role: "", feedback: "Nice", avatar: "" }],
        instituteId: "inst-1",
      })
    );
    expect(listApproved).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Ravi");
  });

  it("a section on both shows its quotes, then approved reviews", async () => {
    listApproved.mockResolvedValue({
      content: [{ id: "r1", rating: 5, reviewer_name: "Asha", review_text: "Loved it", city: "Ajmer" }],
      page: 0, size: 9, total_elements: 1, total_pages: 1, average_rating: 4.8, approved_count: 12,
    });
    await render(
      React.createElement(TestimonialSectionComponent, {
        headerText: "Students",
        description: "",
        layout: "grid",
        testimonials: [{ name: "Ravi", role: "", feedback: "Nice", avatar: "" }],
        instituteId: "inst-1",
        reviewSource: "both",
        showAverageRating: true,
      })
    );
    expect(listApproved).toHaveBeenCalledWith("inst-1", { size: 9, minRating: 4 });
    const text = container.textContent || "";
    expect(text.indexOf("Ravi")).toBeLessThan(text.indexOf("Asha"));
    expect(text).toContain("Loved it");
    expect(text).toContain("reviewCollector.averageRating:12");
  });
});

describe("ReviewCollector", () => {
  it("floating: the button opens the form, a review is sent once and the button goes away", async () => {
    await render(React.createElement(ReviewCollector, { ...base, display: "floating" }));
    const launcher = q<HTMLButtonElement>("[data-review-launcher] button")!;
    expect(launcher).toBeTruthy();
    expect(q("[role=dialog]")).toBeNull();

    await act(async () => launcher.click());
    expect(q("[role=dialog]")).toBeTruthy();

    // Name without stars is refused.
    typeInto(q<HTMLInputElement>('input[autocomplete="name"]')!, "Asha");
    await act(async () => q<HTMLFormElement>("form")!.requestSubmit());
    expect(submit).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("reviewCollector.ratingRequired");

    await act(async () => q<HTMLInputElement>('input[type=radio][value="5"]')!.click());
    typeInto(q<HTMLTextAreaElement>("textarea")!, "Clear teaching");
    await act(async () => q<HTMLFormElement>("form")!.requestSubmit());
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0][0]).toMatchObject({
      instituteId: "inst-1",
      catalogueTag: "school",
      pageRoute: "home",
      rating: 5,
      reviewerName: "Asha",
      reviewText: "Clear teaching",
      website: "",
    });
    expect(document.body.textContent).toContain("reviewCollector.successHeading");

    // Closing after sending: hideAfterSubmit (default) removes the button.
    await act(async () => q<HTMLButtonElement>('[aria-label="reviewCollector.close"]')!.click());
    expect(q("[data-review-launcher]")).toBeNull();
    expect(window.localStorage.getItem("catalogue-review-submitted:inst-1")).toBe("1");
  });

  it("popup: opens by itself after the delay, and not again once dismissed", async () => {
    vi.useFakeTimers();
    await render(React.createElement(ReviewCollector, { ...base, display: "popup", delaySeconds: 5, frequency: "once" }));
    expect(q("[role=dialog]")).toBeNull();
    expect(q("[data-review-launcher]")).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(q("[role=dialog]")).toBeTruthy();

    await act(async () => q<HTMLButtonElement>('[aria-label="reviewCollector.close"]')!.click());
    expect(q("[role=dialog]")).toBeNull();

    act(() => root.unmount());
    root = createRoot(container);
    await render(React.createElement(ReviewCollector, { ...base, display: "popup", delaySeconds: 5, frequency: "once" }));
    await act(async () => {
      vi.advanceTimersByTime(10000);
    });
    expect(q("[role=dialog]")).toBeNull();
  });

  it("never opens by itself for a visitor who already sent a review", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem("catalogue-review-submitted:inst-1", "1");
    await render(React.createElement(ReviewCollector, { ...base, display: "floatingPopup", delaySeconds: 0 }));
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(q("[role=dialog]")).toBeNull();
    expect(q("[data-review-launcher]")).toBeNull();
  });

  it("inline: the form sits in the page and shows only the asked fields", async () => {
    await render(
      React.createElement(ReviewCollector, {
        ...base,
        display: "inline",
        fields: { reviewText: "off", city: "off", course: "required", designation: "off" },
        courseOptions: ["SSC CGL", "Railway NTPC", "SSC CGL"],
      })
    );
    expect(container.querySelector("[data-review-collector=inline] form")).toBeTruthy();
    expect(container.querySelector("textarea")).toBeNull();
    const options = Array.from(container.querySelectorAll("select option")).map((o) => o.textContent);
    expect(options).toEqual(["reviewCollector.coursePlaceholder", "SSC CGL", "Railway NTPC"]);
  });

  it("editor preview shows success without sending anything", async () => {
    await render(React.createElement(ReviewCollector, { ...base, display: "inline", isPreviewMode: true }));
    await act(async () => container.querySelector<HTMLInputElement>('input[type=radio][value="4"]')!.click());
    typeInto(container.querySelector<HTMLInputElement>('input[autocomplete="name"]')!, "Asha");
    await act(async () => container.querySelector<HTMLFormElement>("form")!.requestSubmit());
    expect(submit).not.toHaveBeenCalled();
    expect(container.textContent).toContain("reviewCollector.previewNoSave");
  });
});
