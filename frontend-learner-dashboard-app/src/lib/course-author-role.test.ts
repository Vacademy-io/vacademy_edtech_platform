import { describe, expect, it } from "vitest";
import { authorRole, authorRoleTag, sharedAuthorRole } from "./course-author-role";

describe("course author role", () => {
    it("reads role_label trimmed, blank = none", () => {
        expect(authorRole({ role_label: "  Acharya " })).toBe("Acharya");
        expect(authorRole({ role_label: "   " })).toBeUndefined();
        expect(authorRole({})).toBeUndefined();
        expect(authorRole(null)).toBeUndefined();
    });

    it("heading is the shared role, else the institute term", () => {
        expect(sharedAuthorRole(["Acharya", "Acharya"], "Teachers")).toBe("Acharya");
        expect(sharedAuthorRole(["Acharya", "Instructor"], "Teachers")).toBe("Teachers");
        expect(sharedAuthorRole(["Acharya", undefined], "Teachers")).toBe("Teachers");
        expect(sharedAuthorRole([], "Teachers")).toBe("Teachers");
        expect(sharedAuthorRole([undefined], "Teachers")).toBe("Teachers");
    });

    it("tags an author only when the heading does not already name the role", () => {
        expect(authorRoleTag("Acharya", "Acharya")).toBeUndefined();
        expect(authorRoleTag("Acharya", "Teachers")).toBe("Acharya");
        expect(authorRoleTag(undefined, "Teachers")).toBeUndefined();
    });
});
