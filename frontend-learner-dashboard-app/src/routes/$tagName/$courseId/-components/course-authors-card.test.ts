// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => () => {},
  useParams: () => ({ tagName: "store" }),
  useSearch: () => ({}),
  useRouter: () => ({ navigate: () => {} }),
  Link: () => null,
}));
vi.mock("@/services/upload_file", () => ({
  getPublicUrlWithoutLogin: vi.fn(async (id: string) => `https://cdn.test/${id}.jpg`),
}));

import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CourseHighlightsAccordion } from "./CourseDetailsPage";
import { mapCourseAuthors } from "../../-utils/course-authors";

// React 18/19 both look at this flag before deciding whether `act` is legal.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// The naming-settings util reads `localStorage`, which jsdom leaves undefined
// on an opaque origin; without a stand-in it logs a (caught) TypeError on
// every getTerminology call.
const memoryStorage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => memoryStorage.get(k) ?? null,
    setItem: (k: string, v: string) => void memoryStorage.set(k, String(v)),
    removeItem: (k: string) => void memoryStorage.delete(k),
    clear: () => memoryStorage.clear(),
  },
});

/** The real course-init faculty for Brahm Varchas "testing" (2026-09-19). */
const authors = mapCourseAuthors(
  [
    {
      id: "c1c683fb-63c3-43cc-a2f2-ea31b2a78006",
      full_name: "Admin Brahmvarchas",
      profile_pic_file_id: "159276d4-b3cc-4ebb-b9c8-294ff0df6104",
      author_subtitle: "लेखक परिचय",
      author_description:
        "<p>जन्म: 20 मार्च, 1969, (झाँसी)</p><p>प्रकाशित उपन्यास: रूही - एक पहेली (2017)</p>",
    },
    { id: "cb703101", full_name: "Abhishek", author_subtitle: "Filmmaker" },
  ],
  "Unknown Teacher",
);

let root: Root | null = null;
let host: HTMLDivElement | null = null;

const mount = async (showInstructors: boolean) => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      React.createElement(CourseHighlightsAccordion, {
        whyLearn: "",
        aboutCourse: null,
        whoShouldLearn: "",
        instructors: authors,
        showInstructors,
        primaryInstructor: "Admin Brahmvarchas",
      }),
    );
  });
  // let the mocked photo URL resolve and re-render
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  document.body.innerHTML = "";
});

describe("Course page authors card", () => {
  it("OFF (default): first author with photo, name and subtitle inline; bio in the dialog; no email anywhere", async () => {
    await mount(false);
    const html = host!.innerHTML;
    expect(html).toContain("Admin Brahmvarchas");
    expect(html).toContain("लेखक परिचय");
    expect(html).not.toContain("Abhishek"); // roster hidden when OFF
    expect(host!.querySelector('img[src="https://cdn.test/159276d4-b3cc-4ebb-b9c8-294ff0df6104.jpg"]')).not.toBeNull();

    // open "View more" -> bio rendered as HTML (a <p>, not literal tags)
    const trigger = Array.from(host!.querySelectorAll("button")).find((b) =>
      /view ?more/i.test(b.textContent ?? ""),
    );
    expect(trigger).toBeDefined();
    await act(async () => {
      trigger!.click();
    });
    const everything = document.body.innerHTML;
    expect(everything).toContain("जन्म: 20 मार्च, 1969");
    expect(everything).not.toContain("&lt;p&gt;");
    expect(everything).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/);
    expect(everything).not.toMatch(/no email/i);
  });

  it("ON: every author is listed", async () => {
    await mount(true);
    const html = host!.innerHTML;
    expect(html).toContain("Admin Brahmvarchas");
    expect(html).toContain("Abhishek");
    expect(html).toContain("Filmmaker");
    expect(html).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/);
  });
});
