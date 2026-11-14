import { describe, expect, it, vi, beforeEach } from "vitest";

const { axiosMock } = vi.hoisted(() => ({ axiosMock: vi.fn() }));
vi.mock("@/lib/auth/axiosInstance", () => ({ default: axiosMock }));
vi.mock("@/constants/urls", () => ({ LIVE_SESSION_GET_PAST: "/past" }));
vi.mock("@/lib/auth/sessionUtility", () => ({
  getTokenDecodedData: vi.fn(),
  getTokenFromStorage: vi.fn(),
}));

import { fetchPastSessionsForMultipleBatches } from "./usePastSessions";

const flags = {
  show_past_sessions: true,
  show_recordings: false,
  show_attendance: false,
  show_activity_stats: false,
  show_class_materials: false,
};

const session = (scheduleId: string, date: string) => ({
  session_id: `s-${scheduleId}`,
  schedule_id: scheduleId,
  meeting_date: date,
  start_time: "10:00:00",
});

describe("fetchPastSessionsForMultipleBatches", () => {
  beforeEach(() => axiosMock.mockReset());

  it("lists an unassigned public class once and does not count it per batch", async () => {
    // Both batches return the institute's unassigned public class "pub".
    axiosMock.mockImplementation((config?: { params?: { batchId?: string } }) =>
      Promise.resolve({
        data: {
          display_flags: flags,
          content:
            config?.params?.batchId === "b1"
              ? [session("pub", "2026-10-01"), session("own-1", "2026-09-30")]
              : [session("pub", "2026-10-01"), session("own-2", "2026-09-29")],
          page: 0,
          size: 20,
          total_pages: 1,
          total_elements: 2,
          last: true,
        },
      })
    );

    const result = await fetchPastSessionsForMultipleBatches(["b1", "b2"], "u1", { page: 0 });

    expect(result.sessions.map((s) => s.schedule_id)).toEqual(["pub", "own-1", "own-2"]);
    expect(result.totalElements).toBe(3);
  });

  it("never reports fewer elements than it returned", async () => {
    axiosMock.mockResolvedValue({
      data: {
        display_flags: flags,
        content: [session("pub", "2026-10-01")],
        page: 0,
        size: 20,
        total_pages: 1,
        total_elements: 0,
        last: true,
      },
    });

    const result = await fetchPastSessionsForMultipleBatches(["b1", "b2"], "u1", { page: 0 });

    expect(result.sessions).toHaveLength(1);
    expect(result.totalElements).toBe(1);
  });
});
