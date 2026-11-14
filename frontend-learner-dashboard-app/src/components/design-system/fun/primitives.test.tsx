// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => `funCommon:${key}` }) }));

const { FunButton } = await import("./FunButton");
const { CourseArt, firstGrapheme } = await import("./CourseArt");
const { FunProgress } = await import("./FunProgress");
const { LiveChip, CalendarChip, NewChip } = await import("./chips");
const { FinishedTick, ReviewLabel } = await import("./FinishedTick");
const { courseColourIndex } = await import("./course-palette");

let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function render(node: ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(node));
  return host;
}

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe("FunButton", () => {
  it("carries the lip classes for each variant and never submits a form by itself", async () => {
    const el = await render(
      <>
        <FunButton>Go</FunButton>
        <FunButton variant="onColour" compact>
          On colour
        </FunButton>
        <FunButton variant="outline" block disabled>
          Try again
        </FunButton>
      </>,
    );
    const [primary, onColour, outline] = Array.from(el.querySelectorAll("button"));
    expect(primary!.className).toBe("fun-btn fun-btn--primary");
    expect(primary!.type).toBe("button");
    expect(onColour!.className).toContain("fun-btn--on-colour");
    expect(onColour!.className).toContain("fun-btn--compact");
    expect(outline!.className).toContain("fun-btn--outline");
    expect(outline!.className).toContain("fun-btn--block");
    expect(outline!.disabled).toBe(true);
  });
  it("lends its look to a link", async () => {
    const el = await render(
      <FunButton asChild>
        <a href="/x">See all</a>
      </FunButton>,
    );
    const link = el.querySelector("a")!;
    expect(link.className).toBe("fun-btn fun-btn--primary");
    expect(link.hasAttribute("type")).toBe(false);
  });
});

describe("CourseArt", () => {
  const id = "pkg-003";
  it("shows the plain shape and first letter on the course colour with no image", async () => {
    const el = await render(<CourseArt courseId={id} name="  physics for class 12" />);
    const art = el.firstElementChild!;
    expect(art.className).toContain(`fun-course-${courseColourIndex(id)}`);
    expect(art.getAttribute("data-fun-art")).toBe("shape");
    expect(art.querySelector(".fun-course-art__mark")!.textContent).toBe("P");
    expect(art.querySelector("img")).toBeNull();
  });
  it("shows the course image on the tint, and the shape again if it fails to load", async () => {
    const el = await render(<CourseArt courseId={id} name="Physics" imageUrl="https://example.invalid/a.png" />);
    const art = el.firstElementChild!;
    expect(art.getAttribute("data-fun-art")).toBe("image");
    expect(art.className).toContain("fun-course-art--image");
    const img = art.querySelector("img")!;
    expect(img.getAttribute("alt")).toBe("");
    await act(async () => {
      img.dispatchEvent(new Event("error"));
    });
    expect(art.getAttribute("data-fun-art")).toBe("shape");
  });
  it("adds the finished tick and keeps the course's own colour", async () => {
    const el = await render(<CourseArt courseId={id} name="Physics" finished />);
    const art = el.firstElementChild!;
    expect(art.className).toContain(`fun-course-${courseColourIndex(id)}`);
    expect(art.querySelector(".fun-tick")!.getAttribute("aria-label")).toBe("funCommon:done");
  });
  it("keeps a Devanagari first syllable whole", () => {
    expect(firstGrapheme("क्षेत्रमिति")).toBe("क्षे");
    expect(firstGrapheme("")).toBe("");
    expect(firstGrapheme(null)).toBe("");
  });
});

describe("FunProgress", () => {
  it("draws nothing for an unknown percent, never 0%", async () => {
    const el = await render(
      <>
        <FunProgress percent={null} />
        <FunProgress percent={undefined} />
        <FunProgress percent={Number.NaN} />
      </>,
    );
    expect(el.innerHTML).toBe("");
  });
  it("clamps and labels a known percent", async () => {
    const el = await render(<FunProgress percent={140} tone="band" />);
    const bar = el.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute("aria-valuenow")).toBe("100");
    expect(bar.getAttribute("aria-label")).toBe("funCommon:progress");
    expect(bar.className).toContain("fun-progress--band");
  });
});

describe("chips and labels", () => {
  it("names the live state only on the live chip, and a later class by its time", async () => {
    const el = await render(
      <>
        <LiveChip />
        <LiveChip tone="solid" />
        <CalendarChip>TODAY 5:00 PM</CalendarChip>
        <NewChip />
        <FinishedTick decorative />
        <ReviewLabel />
      </>,
    );
    const chips = Array.from(el.querySelectorAll(".fun-chip"));
    expect(chips.map((c) => c.className)).toEqual([
      "fun-chip fun-chip--live",
      "fun-chip fun-chip--live-solid",
      "fun-chip fun-chip--calendar",
      "fun-chip fun-chip--new",
    ]);
    expect(chips[2]!.textContent).toBe("TODAY 5:00 PM");
    expect(chips[2]!.textContent).not.toContain("live");
    expect(el.querySelector(".fun-tick")!.getAttribute("aria-hidden")).toBe("true");
    expect(el.querySelector(".fun-review")!.textContent).toBe("funCommon:review");
  });
});
