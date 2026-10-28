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
  buildReviewSubmission,
  mergeTestimonials,
  normalizeDisplay,
  normalizeFormFields,
  reviewToTestimonial,
  validateReviewForm,
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

describe("review form fields", () => {
  it("a block saved before the builder keeps its old fields, order and labels", () => {
    const fields = normalizeFormFields({
      fields: { reviewText: "required", course: "optional", city: "optional", designation: "off" },
      courseLabel: "eBook",
      courseOptions: ["SSC", "SSC", " "],
    });
    expect(fields.map((f) => f.kind)).toEqual(["rating", "reviewText", "reviewerName", "courseName", "city"]);
    expect(fields.find((f) => f.kind === "reviewText")!.required).toBe(true);
    const course = fields.find((f) => f.kind === "courseName")!;
    expect(course).toMatchObject({ label: "eBook", options: ["SSC"], width: "half" });
  });

  it("formFields: admin order kept, stars and name forced in and required, built-ins once, unknown kinds dropped", () => {
    const fields = normalizeFormFields({
      formFields: [
        { id: "f_exam", kind: "select", label: "Exam", options: ["SSC", "Railway"], required: true, width: "half" },
        { id: "reviewerName", kind: "reviewerName", required: false },
        { id: "city", kind: "city" },
        { id: "city", kind: "city" },
        { id: "x", kind: "bogus" },
        { id: "f_exam", kind: "email", label: "Email" },
      ],
    });
    expect(fields.map((f) => f.id)).toEqual(["rating", "f_exam", "reviewerName", "city", "f_exam_"]);
    expect(fields.find((f) => f.kind === "reviewerName")!.required).toBe(true);
    expect(fields[1]).toMatchObject({ kind: "select", width: "half", options: ["SSC", "Railway"], required: true });
  });

  it("validates required, stars, email, number and phone", () => {
    const fields = normalizeFormFields({
      formFields: [
        { id: "rating", kind: "rating" },
        { id: "reviewerName", kind: "reviewerName" },
        { id: "f_mail", kind: "email" },
        { id: "f_age", kind: "number", required: true },
        { id: "f_ph", kind: "phone" },
      ],
    });
    expect(validateReviewForm(fields, {})).toEqual({ rating: "required", reviewerName: "required", f_age: "required" });
    expect(validateReviewForm(fields, { rating: 5, reviewerName: "Asha", f_mail: "nope", f_age: "abc", f_ph: "12" })).toEqual({
      f_mail: "invalidEmail",
      f_age: "invalidNumber",
      f_ph: "invalidPhone",
    });
    expect(validateReviewForm(fields, { rating: 5, reviewerName: "Asha", f_mail: "a@b.co", f_age: "21", f_ph: "+91 98765 43210" })).toEqual({});
  });

  it("sends built-ins to their columns and custom answers with the label shown, blanks left out", () => {
    const fields = normalizeFormFields({
      formFields: [
        { id: "rating", kind: "rating" },
        { id: "f_exam", kind: "select", label: "Exam", options: ["SSC"] },
        { id: "reviewerName", kind: "reviewerName" },
        { id: "city", kind: "city" },
        { id: "f_note", kind: "textarea" },
      ],
    });
    const out = buildReviewSubmission(fields, { rating: 4, reviewerName: " Asha ", city: "Ajmer", f_exam: "SSC", f_note: "  " }, (f) =>
      f.label || "default"
    );
    expect(out).toEqual({ rating: 4, reviewerName: "Asha", city: "Ajmer", answers: [{ key: "f_exam", label: "Exam", value: "SSC" }] });
  });

  it("reads unknown display settings as the default", () => {
    expect(normalizeDisplay("bogus")).toBe("floatingPopup");
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
    expect(options).toEqual(["reviewCollector.selectPlaceholder", "SSC CGL", "Railway NTPC"]);
  });

  it("custom fields render in the admin's order and their answers are sent", async () => {
    await render(
      React.createElement(ReviewCollector, {
        ...base,
        display: "inline",
        formFields: [
          { id: "reviewerName", kind: "reviewerName", label: "Full name" },
          { id: "f_exam", kind: "select", label: "Exam", options: ["SSC", "Railway"], required: true },
          { id: "rating", kind: "rating" },
        ],
      })
    );
    const kinds = Array.from(container.querySelectorAll("[data-review-field]")).map((n) => n.getAttribute("data-review-field"));
    expect(kinds).toEqual(["reviewerName", "select", "rating"]);
    expect(container.textContent).toContain("Full name");

    typeInto(container.querySelector<HTMLInputElement>('input[autocomplete="name"]')!, "Asha");
    await act(async () => container.querySelector<HTMLInputElement>('input[type=radio][value="5"]')!.click());
    await act(async () => container.querySelector<HTMLFormElement>("form")!.requestSubmit());
    expect(submit).not.toHaveBeenCalled(); // the required dropdown is empty
    expect(container.textContent).toContain("reviewCollector.fieldRequired");

    const select = container.querySelector<HTMLSelectElement>("select")!;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, "Railway");
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await act(async () => container.querySelector<HTMLFormElement>("form")!.requestSubmit());
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0][0]).toMatchObject({
      rating: 5,
      reviewerName: "Asha",
      answers: [{ key: "f_exam", label: "Exam", value: "Railway" }],
    });
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
