import { describe, expect, it } from "vitest";
import { createOpenGroups } from "./open-groups";

describe("sidebar open groups", () => {
    it("starts closed unless the group holds the active route", () => {
        const groups = createOpenGroups();
        expect(groups.resolve("Learning", false)).toBe(false);
        expect(groups.resolve("Learning", true)).toBe(true);
    });

    it("keeps a group the learner opened across a remount", () => {
        const groups = createOpenGroups();
        groups.set("Learning", true);
        expect(groups.resolve("Learning", false)).toBe(true);
    });

    it("keeps a group that opened for its active route after leaving that route", () => {
        const groups = createOpenGroups();
        groups.resolve("Learning", true);
        expect(groups.resolve("Learning", false)).toBe(true);
    });

    it("keeps a group the learner closed closed on the next route", () => {
        const groups = createOpenGroups();
        groups.set("Learning", true);
        groups.set("Learning", false);
        expect(groups.resolve("Learning", false)).toBe(false);
    });

    it("reopens a closed group when navigation lands inside it", () => {
        const groups = createOpenGroups();
        groups.set("Learning", false);
        expect(groups.resolve("Learning", true)).toBe(true);
    });

    it("tracks groups independently", () => {
        const groups = createOpenGroups();
        groups.set("Learning", true);
        expect(groups.resolve("Reports", false)).toBe(false);
    });
});
