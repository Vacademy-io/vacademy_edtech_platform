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

/**
 * A featureGrid card's own image (a line icon, an illustration) follows
 * iconSize like a library icon does. Before, every image was 160px, so small
 * line icons read as clip art and nothing — editor or MCP — could shrink them.
 */
const IMG = "https://cdn.example.com/icons/comic.png";
const render = (iconSize?: string) =>
  renderToString(
    React.createElement(JsonRenderer, {
      page: {
        id: "p", route: "p", title: "p",
        components: [{ id: "fg", type: "featureGrid", enabled: true,
          props: { style: "minimal", ...(iconSize ? { iconSize } : {}), features: [{ title: "Comic", description: "d", image: IMG }] } }],
      },
      globalSettings: {} as never, instituteId: "inst", tagName: "tag",
    } as never),
  );

describe("featureGrid image size", () => {
  it("keeps 160px by default and follows iconSize small / medium", () => {
    expect(render()).toContain("max-w-40");
    expect(render("small")).toContain("max-w-16");
    expect(render("medium")).toContain("max-w-24");
  });
});
