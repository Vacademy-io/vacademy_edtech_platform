import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SidebarItemsType } from "../../../../types/layout-container-types";

const onboarding = { enabled: false };
vi.mock("@/services/onboarding-settings", () => ({
  isOnboardingEnabled: async () => onboarding.enabled,
}));

const { filterHamburgerMenuItemsWithPermissions } = await import("./utils");

const icon = (() => null) as unknown as SidebarItemsType["icon"];
const items: SidebarItemsType[] = [
  { icon, id: "view-profile", title: "View Profile Details", to: "/user-profile" },
  { icon, id: "onboarding", title: "Onboarding", to: "/profile/onboarding" },
  { icon, id: "change-password", title: "Change Password", to: "/change-password" },
];
const allowAll = {
  canViewProfile: true,
  canEditProfile: true,
  canDeleteProfile: true,
  canViewFiles: true,
  canViewReports: true,
};

// The sidebar and the website account sheet render this list; the top-navbar
// menu already hid Onboarding when the institute had not switched it on.
describe("hamburger Onboarding entry", () => {
  beforeEach(() => {
    onboarding.enabled = false;
  });

  it("is hidden when the institute has onboarding off", async () => {
    const ids = (await filterHamburgerMenuItemsWithPermissions(items, allowAll)).map((i) => i.id);
    expect(ids).toEqual(["view-profile", "change-password"]);
  });

  it("stays when the institute has onboarding on", async () => {
    onboarding.enabled = true;
    const ids = (await filterHamburgerMenuItemsWithPermissions(items, allowAll)).map((i) => i.id);
    expect(ids).toEqual(["view-profile", "onboarding", "change-password"]);
  });
});
