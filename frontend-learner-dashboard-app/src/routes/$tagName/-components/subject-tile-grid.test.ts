import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SubjectTileGrid,
  ContentDrillCrumb,
  type ContentTile,
} from "./SubjectTileGrid";

/**
 * The tile grid is the whole visible difference of the "tiles" course-content
 * variant on the public course page, and nothing between the editor and
 * production renders it — this app's build never runs tsc. So render it for
 * real (SSR, the only option here: no @testing-library, environment "node")
 * and check the artwork, the fallback, and the open state actually come out.
 */

const SUBJECTS: ContentTile[] = [
  { id: "s1", name: "Level 2: English", description: "Reading & phonics" },
  { id: "s2", name: "Level 2: Math Explorer" },
];

const html = (props: Partial<Parameters<typeof SubjectTileGrid>[0]> = {}) =>
  renderToStaticMarkup(
    React.createElement(SubjectTileGrid, {
      items: SUBJECTS,
      thumbs: {},
      onOpen: vi.fn(),
      ...props,
    }),
  );

describe("SubjectTileGrid", () => {
  it("renders a card per subject", () => {
    const out = html();
    expect(out).toContain("Level 2: English");
    expect(out).toContain("Level 2: Math Explorer");
    expect((out.match(/<button/g) || []).length).toBe(2);
  });

  it("lays the cards out as a grid, not a list", () => {
    expect(html()).toContain("grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3");
  });

  it("shows the subject artwork when one resolved", () => {
    const out = html({ thumbs: { s1: "https://cdn.example/eng.png" } });
    expect(out).toContain('src="https://cdn.example/eng.png"');
    // Decorative: the subject name is right beside it, so an alt would be
    // read out twice.
    expect(out).toContain('alt=""');
  });

  it("falls back to a glyph rather than a broken image when artwork is missing", () => {
    const out = html({ thumbs: {} });
    expect(out).not.toContain("<img");
    expect(out).toContain("svg");
  });

  it("omits the description line for a subject that has none", () => {
    const out = html();
    expect(out).toContain("Reading &amp; phonics");
    // Two cards, one description — the subject without one must not leave a
    // blank line where its text would go. Match the description div itself,
    // not the muted colour, which the artwork-fallback glyph also uses.
    const descriptions = out.match(/line-clamp-1 text-sm text-catalogue-text-muted/g) || [];
    expect(descriptions.length).toBe(1);
  });

  it("renders nothing for an empty subject list", () => {
    expect(html({ items: [] })).not.toContain("<button");
  });
});

/**
 * The trail back up. Expanding in place gave no way to say which card a
 * panel belonged to, so the grid now swaps for the level below and this is
 * the only way back — if it stops rendering, a visitor is stranded one level
 * down with no route out.
 */
describe("ContentDrillCrumb", () => {
  const crumb = (
    trail: Array<{ id: string; name: string }>,
    onNavigate = vi.fn(),
  ) =>
    renderToStaticMarkup(
      React.createElement(ContentDrillCrumb, {
        trail,
        rootLabel: "Subjects",
        onNavigate,
      }),
    );

  it("shows the way back to the top from one level down", () => {
    const out = crumb([{ id: "s1", name: "Level 1: English" }]);
    expect(out).toContain("Subjects");
    expect(out).toContain("Level 1: English");
  });

  it("heads the current level and keeps its ancestors as links", () => {
    const out = crumb([
      { id: "s1", name: "Level 1: English" },
      { id: "m1", name: "Know Your Content" },
    ]);
    // The current level is the heading; everything above it is a button.
    expect(out).toContain("<h4");
    expect(out.indexOf("Level 1: English")).toBeLessThan(
      out.indexOf("Know Your Content"),
    );
    expect((out.match(/<button/g) || []).length).toBe(2);
  });

  it("offers exactly one way out at the shallowest level", () => {
    const out = crumb([{ id: "s1", name: "Level 1: English" }]);
    expect((out.match(/<button/g) || []).length).toBe(1);
  });
});
