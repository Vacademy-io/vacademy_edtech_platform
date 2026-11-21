import { beforeEach, describe, expect, it, vi } from "vitest";

// The user-messages endpoints require the learner's token, so every call must go through the
// authenticated axios instance (which adds Authorization + clientId).
const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock("@/constants/urls", () => ({ BASE_URL: "https://api.test" }));
vi.mock("@/lib/auth/axiosInstance", () => ({ default: { get, post } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: key === "accessToken" ? "token" : null }),
  },
}));
vi.mock("@/lib/auth/sessionUtility", () => ({ getTokenDecodedData: () => ({ user: "learner-1" }) }));

const api = await import("./announcementApi");

const BASE = "https://api.test/notification-service/v1";

describe("announcementApi sends the learner's token", () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
  });

  it("reads dashboard pins and overlays through the authenticated instance", async () => {
    get.mockResolvedValue({ data: [] });

    await api.getDashboardPins();
    await api.getAppOverlays();

    expect(get).toHaveBeenCalledWith(
      `${BASE}/user-messages/user/learner-1/dashboard-pins`,
      expect.objectContaining({ timeout: 10000 }),
    );
    expect(get).toHaveBeenCalledWith(
      `${BASE}/user-messages/user/learner-1/app-overlays`,
      expect.anything(),
    );
  });

  it("posts interactions through the authenticated instance", async () => {
    post.mockResolvedValue({ data: {} });

    await api.dismissOverlay("rm-1");

    expect(post).toHaveBeenCalledWith(
      `${BASE}/user-messages/interactions/dismiss`,
      { recipientMessageId: "rm-1", userId: "learner-1", interactionType: "DISMISSED" },
      expect.objectContaining({ timeout: 10000 }),
    );
  });
});
