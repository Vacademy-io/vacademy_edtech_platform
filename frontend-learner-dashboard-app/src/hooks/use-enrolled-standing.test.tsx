// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/services/points", () => ({ useCurrentInstituteId: () => "inst-standing" }));
vi.mock("@/lib/auth/axiosInstance", () => ({ default: { post: vi.fn() } }));
vi.mock("@/constants/urls", () => ({ urlPublicCourseDetails: "/search" }));

const { useEnrolledStanding, useEnrolledFurthestPercent } = await import("./use-enrolled-standing");
const { noteEnrolmentList } = await import("@/services/enrolled-courses");

describe("useEnrolledStanding", () => {
  it("is unknown until an answer lands, then follows each new answer without asking", async () => {
    const seen: Array<[string, number | null | undefined]> = [];
    function Probe() {
      seen.push([useEnrolledStanding(), useEnrolledFurthestPercent()]);
      return null;
    }
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(<Probe />));
    expect(seen.at(-1)).toEqual(["unknown", undefined]);

    await act(async () => noteEnrolmentList("inst-standing", []));
    expect(seen.at(-1)).toEqual(["noCourses", null]);

    await act(async () =>
      noteEnrolmentList("inst-standing", [{ percentage_completed: 100 }, { percentage_completed: 40 }]),
    );
    expect(seen.at(-1)).toEqual(["unknown", 40]);

    await act(async () => noteEnrolmentList("inst-standing", [{ percentage_completed: 100 }]));
    expect(seen.at(-1)).toEqual(["finished", null]);

    await act(async () => root.unmount());
    host.remove();
  });
});
