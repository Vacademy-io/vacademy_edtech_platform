import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "@/lib/colour/contrast";
import { funBrandColours } from "./brand-colours";
import {
  type CourseColour,
  COURSE_PALETTE,
  courseColourClass,
  courseColourIndex,
  courseColourOf,
  fnv1a32,
} from "./course-palette";

const WHITE = "#FFFFFF"; // design-lint-ignore: test data
const INK = "#1F2333"; // design-lint-ignore: test data
const HIGHLIGHT = "#FDE047"; // design-lint-ignore: test data

describe("fnv1a32", () => {
  it("matches the published FNV-1a 32-bit vectors", () => {
    expect(fnv1a32("")).toBe(0x811c9dc5);
    expect(fnv1a32("a")).toBe(0xe40c292c);
    expect(fnv1a32("foobar")).toBe(0xbf9cf968);
  });
});

describe("courseColourIndex", () => {
  // Invented ids. These numbers must never change: a change repaints every
  // learner's courses.
  const FIXED: Array<[string, number]> = [
    ["3f2b6c1e-8a4d-4f7e-9b21-6d0c5a7e8f13", 3],
    ["a91d4e27-0c3b-4b8f-8e6a-2f5d7c9b1a04", 6],
    ["c4e8a2f0-5b7d-4e19-a3c6-8d2f0b4e6a71", 0],
    ["0b7f3d95-e21c-4a68-b4f2-9c1e7a3d5f80", 3],
    ["pkg-001", 7],
    ["pkg-002", 2],
    ["pkg-003", 5],
    ["pkg-004", 0],
    ["pkg-005", 3],
    ["pkg-006", 6],
    ["pkg-007", 1],
    ["pkg-008", 4],
    ["pkg-009", 7],
    ["पाठ्यक्रम-1", 5],
  ];
  it.each(FIXED)("%s -> %i", (id: string, index: number) => {
    expect(courseColourIndex(id)).toBe(index);
    expect(courseColourClass(id)).toBe(`fun-course-${index}`);
    expect(courseColourOf(id)).toBe(COURSE_PALETTE[index]);
  });
  it("is always a palette index, for any id", () => {
    for (let i = 0; i < 2000; i++) {
      const index = courseColourIndex(`course-${i}-${(i * 7919).toString(36)}`);
      expect(Number.isInteger(index) && index >= 0 && index < COURSE_PALETTE.length).toBe(true);
    }
  });
  it("uses every colour across many ids", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) seen.add(courseColourIndex(`id-${i}`));
    expect(seen.size).toBe(COURSE_PALETTE.length);
  });
});

describe("COURSE_PALETTE contrast (WCAG 2.x)", () => {
  it.each(COURSE_PALETTE.map((c) => [c.name, c] as const))("%s", (_name: string, colour: CourseColour) => {
    expect(contrastRatio(WHITE, colour.solid)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colour.onBand, colour.solid)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colour.text, WHITE)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(colour.text, colour.tint)).toBeGreaterThanOrEqual(6.2);
    // The highlight fill reads against the band as a graphic (3:1 is not required
    // for a bar fill, but ink text on it must read).
    expect(contrastRatio(INK, HIGHLIGHT)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("styles/fun/base.css", () => {
  const css = fs.readFileSync(fileURLToPath(new URL("../../../styles/fun/base.css", import.meta.url)), "utf8");
  it.each(COURSE_PALETTE.map((c, i) => [i, c] as const))("fun-course-%i holds the same colours", (index: number, colour: CourseColour) => {
    const block = new RegExp(`\\.fun-course-${index}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
    const value = (name: string) => new RegExp(`--fc-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block)?.[1]?.toUpperCase();
    expect(value("solid")).toBe(colour.solid);
    expect(value("on-band")).toBe(colour.onBand);
    expect(value("text")).toBe(colour.text);
    expect(value("tint")).toBe(colour.tint);
    expect(value("deco")).toBe(colour.deco);
    expect(value("lip")).toBe(colour.lip);
    expect(value("track")).toBe(colour.track);
  });
  it("falls back to the brand rule's own shades when no brand can be read", () => {
    const root = /html\.ui-fun\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    const value = (name: string) => new RegExp(`--fun-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(root)?.[1]?.toLowerCase();
    const expected = funBrandColours(value("brand"))!;
    expect(value("brand")).toBe(expected.solid);
    expect(value("brand-tint")).toBe(expected.tint);
    expect(value("brand-lip")).toBe(expected.lip);
  });
});
