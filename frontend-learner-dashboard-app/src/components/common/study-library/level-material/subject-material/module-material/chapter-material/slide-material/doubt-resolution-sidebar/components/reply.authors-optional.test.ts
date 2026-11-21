import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Reply } from "./reply";
import type { Doubt } from "../types/get-doubts-type";

// The avatar placeholder is an SVG imported as a React component by vite-plugin-svgr, which the
// test runner does not load — stub the barrel so the real Reply/DoubtAvatar tree still renders.
vi.mock("@/assets/svgs", () => ({ SmallDummyProfile: () => null }));

/**
 * The "My Queries" list renders <Reply> without an author map. Before this was allowed, the
 * component did `authors[reply.user_id]` on an undefined prop and took the whole page down with
 * "Cannot read properties of undefined (reading '<user id>')".
 */
const reply = {
    id: "r1",
    user_id: "fc96e17e-4917-4634-926f-76602101fc99",
    name: "Deepti",
    html_text: "<p>Thanks!</p>",
    raised_time: "2026-08-31T10:00:00Z",
    status: "ACTIVE",
    replies: [],
} as unknown as Doubt;

describe("Reply without an authors map", () => {
    it("renders instead of throwing", () => {
        const html = renderToStaticMarkup(createElement(Reply, { reply }));
        expect(html).toContain("Deepti");
    });

    it("still uses the map when one is passed", () => {
        const html = renderToStaticMarkup(
            createElement(Reply, {
                reply,
                authors: { [reply.user_id]: { name: "Mr. Sharma" } },
            })
        );
        expect(html).toContain("Mr. Sharma");
    });
});
