import { describe, expect, it } from "vitest";
import { createPageChangeDetector } from "./page-change";

describe("createPageChangeDetector", () => {
    it("ignores the first run", () => {
        expect(createPageChangeDetector(0)(0)).toBe(false);
    });

    it("ignores the first page of results arriving, which only changes the totals", () => {
        const changed = createPageChangeDetector(0);
        expect(changed(0)).toBe(false);
        expect(changed(0)).toBe(false);
    });

    it("reports a move to another page once", () => {
        const changed = createPageChangeDetector(0);
        expect(changed(1)).toBe(true);
        expect(changed(1)).toBe(false);
    });

    it("reports a move back to the first page", () => {
        const changed = createPageChangeDetector(0);
        changed(2);
        expect(changed(0)).toBe(true);
    });

    it("starts from the page the screen opened on", () => {
        const changed = createPageChangeDetector(3);
        expect(changed(3)).toBe(false);
        expect(changed(4)).toBe(true);
    });
});
