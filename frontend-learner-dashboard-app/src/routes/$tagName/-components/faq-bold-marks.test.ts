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
import { renderBoldMarks } from "./JsonRenderer";

const html = (t: unknown) => renderToString(React.createElement("div", null, renderBoldMarks(t)));

describe("FAQ answer bold marks (faqSection boldMarks: true)", () => {
  it("bolds **runs** and keeps the rest as text", () => {
    const out = html("**Dispatch begins 20 Nov.** Use the button.");
    expect(out).toContain("<strong");
    expect(out).toContain("Dispatch begins 20 Nov.</strong>");
    expect(out).toContain(" Use the button.");
    expect(out).not.toContain("**");
  });

  it("leaves plain answers and HTML-looking text untouched", () => {
    expect(html("No marks here")).toBe("<div>No marks here</div>");
    expect(html("<b>x</b>")).toContain("&lt;b&gt;");
    expect(html("a ** b")).toContain("a ** b");
  });
});
