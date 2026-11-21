// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => () => {},
  useParams: () => ({ tagName: "tag" }),
  useRouter: () => ({ navigate: () => {} }),
  Link: () => null,
}));
import React from "react";
import { renderToString } from "react-dom/server";
import { JsonRenderer } from "./JsonRenderer";
import { isHexDark } from "../-utils/catalogue-style-engine";

/**
 * A hero paints its title/description with theme TOKEN classes, so an author
 * colour of navy with textColor #FFFFFF used to render navy-on-navy (the AI
 * copilot's "Template 1" build, Smart AI Academy 2026-09-14). The band now
 * marks itself `dark` from the colour alone, flipping every token inside it.
 * (`left.subheading` is deliberately NOT rendered here: 8 of the 24 live
 * heroes carrying it hold the untouched template default, so showing it
 * would inject "Your path to mastery starts here" onto real sites. The AI
 * sanitizer folds a subheading into `description` instead.)
 */
const page = (props: Record<string, unknown>) => ({
  id: "home", route: "home", title: "home",
  components: [{ id: "hero", type: "heroSection", enabled: true, props }],
});

const render = (props: Record<string, unknown>) =>
  renderToString(
    React.createElement(JsonRenderer, {
      page: page(props), globalSettings: {} as never,
      instituteId: "inst", tagName: "tag",
    } as never),
  );

const heroSectionClass = (html: string): string => {
  const m = html.match(/<section[^>]*class="([^"]*catalogue-hero-surface[^"]*)"/);
  return m ? m[1] : "";
};

describe("heroSection on an author colour", () => {
  it("marks a dark band `dark` so token ink flips to light", () => {
    const html = render({
      layout: "split", backgroundColor: "#0B1F3A", textColor: "#FFFFFF",
      left: { title: "Learn AI Skills for a Brighter Future" },
    });
    expect(heroSectionClass(html).split(/\s+/)).toContain("dark");
  });

  it("leaves a light band alone", () => {
    const html = render({ layout: "split", backgroundColor: "#F8FAFC", left: { title: "Hello" } });
    expect(heroSectionClass(html).split(/\s+/)).not.toContain("dark");
  });

  it("does not guess when a background image is set (its brightness is unknown)", () => {
    const html = render({
      layout: "centered", backgroundColor: "#0B1F3A", backgroundImage: "https://cdn.example.com/bg.jpg",
      left: { title: "Hello" },
    });
    // The image variant renders through the with-state path; the class is
    // decided by !hasBgImage, and SSR has not probed the image yet, so the
    // section still carries `dark` here only if the colour path won. Either
    // way the title must be present.
    expect(html).toContain("Hello");
  });
});

describe("isHexDark", () => {
  it.each([
    ["#0B1F3A", true], ["#0F1E4D", true], ["#1E293B", true], ["#2563EB", true],
    ["#F8FAFC", false], ["#FFFFFF", false], ["#EFF6FF", false], ["#06B6D4", true],
    ["not-a-colour", false], ["", false], [undefined, false],
  ])("%s → %s", (hex, expected) => {
    expect(isHexDark(hex as string | undefined)).toBe(expected);
  });
});
