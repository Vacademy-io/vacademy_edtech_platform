import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "@/lib/colour/contrast";
import { COURSE_PALETTE } from "@/components/design-system/fun/course-palette";

const css = fs.readFileSync(fileURLToPath(new URL("../../../../../../styles/fun/course.css", import.meta.url)), "utf8");
const WHITE = "#FFFFFF"; // design-lint-ignore: test data

describe("the course page's active tab", () => {
  const block = /html\.ui-fun \.fun-structure \.fun-tab\[data-state="active"\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";

  it("is filled with the course colour, not the institute brand, with white text", () => {
    expect(block).toMatch(/background:\s*var\(--fc-solid/);
    expect(block).toMatch(/border-color:\s*var\(--fc-solid/);
    expect(block).toMatch(/box-shadow:[^;]*var\(--fc-lip/);
    expect(block).toMatch(/color:\s*var\(--fun-ground\)/);
  });

  it.each(COURSE_PALETTE.map((c) => [c.name, c.solid] as const))("reads at 4.5:1 or better on %s", (_name: string, solid: string) => {
    expect(contrastRatio(WHITE, solid)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("the course's own media under the band", () => {
  it("is capped at 320px tall, a video keeping its 16:9 width for that height", () => {
    expect(css).toMatch(/\.fun-course-media img \{[^}]*max-height:\s*320px/);
    expect(css).toMatch(/\.fun-course-media--video \{[^}]*width:\s*min\(100%,\s*569px\)/);
    expect(css).toMatch(/\.fun-course-media--video \[style\*="aspect-ratio"\] \{\s*max-height:\s*320px !important/);
  });
});
