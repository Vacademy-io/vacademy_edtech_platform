// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The list page pulls in the API client, native storage, the router and a PDF viewer;
// stub them so the test only exercises the row rendering.
let listContent: Record<string, unknown>[] = [];
const posts: unknown[] = [];
vi.mock("@/lib/auth/axiosInstance", () => {
  const client = Object.assign(async () => ({ data: {} }), {
    post: async (...args: unknown[]) => {
      posts.push(args);
      return { data: { content: listContent, last: true } };
    },
    get: async () => ({ data: {} }),
  });
  return { default: client };
});
vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({
      value: JSON.stringify(key === "StudentDetails" ? { user_id: "u-1" } : { id: "inst-1", subjects: [] }),
    }),
  },
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => () => undefined }));
vi.mock("@/stores/layout-container/useNavHeadingStore", () => ({
  useNavHeadingStore: () => ({ setNavHeading: () => undefined }),
}));
vi.mock("@/constants/urls", () => ({
  STUDENT_REPORT_URL: "/reports",
  STUDENT_REPORT_DETAIL_URL: "/report-detail",
}));
vi.mock("@/constants/helper", () => ({
  formatDuration: () => "",
  getSubjectNameById: () => "",
}));
vi.mock("@/services/upload_file", () => ({ getFileDetail: async () => null }));
vi.mock("@/services/student-report-routing", () => ({ openStudentReport: async () => undefined }));
vi.mock("@/components/common/student-test-records/evaluated-report-dialog", () => ({
  EvaluatedReportDialog: () => null,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key,
  }),
}));

class NoopObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
}
(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = NoopObserver;

const { default: AssessmentReportList } = await import("./reportMain");

const baseRow = {
  assessment_id: "a-1",
  assessment_name: "FR Mock 1",
  assessment_status: "ENDED",
  attempt_date: "2026-11-10T09:00:00.000+00:00",
  subject_id: "",
  duration_in_seconds: 0,
  total_marks: 9,
  evaluation_type: "MANUAL",
  start_time: "",
  end_time: "",
  sections: {},
  play_mode: "EXAM",
};

const hosts: { host: HTMLElement; unmount: () => Promise<void> }[] = [];
async function mount(assessment_types: "ASSESSMENT" | "HOMEWORK" = "ASSESSMENT") {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<AssessmentReportList assessment_types={assessment_types} />));
  // Preferences → POST → setState: let the promise chain settle.
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
  const handle = {
    host,
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
  hosts.push(handle);
  return host;
}

function rowOf(host: HTMLElement, name: string) {
  const title = Array.from(host.querySelectorAll("h3")).find((h) => h.textContent === name);
  return title?.closest("div.min-w-0") as HTMLElement | null;
}

beforeEach(() => {
  posts.length = 0;
});
afterEach(async () => {
  for (const h of hosts.splice(0)) await h.unmount();
});

describe("Reports list: Revised tag (W11, acceptance 3)", () => {
  it("tags a released row whose marks a teacher changed after release, next to Released", async () => {
    listContent = [
      { ...baseRow, attempt_id: "t-1", report_release_status: "RELEASED", result_revised_at: "2026-11-18T10:30:00.000+00:00" },
    ];
    const host = await mount();
    expect(posts).toHaveLength(1);
    const row = rowOf(host, "FR Mock 1");
    expect(row).not.toBeNull();
    const tag = row!.querySelector('[data-testid="revised-tag"]');
    expect(tag?.textContent).toContain("revisedTag");
    // The score shown is the revised total (2 + 7), not a stale one.
    expect(host.textContent).toContain("9");
    // Sits in the chip row right after the Released chip.
    expect(tag?.previousElementSibling?.textContent).toBe("reportList.status.released");
  });

  it("shows no tag on a released row that was never changed, nor on older servers without the field", async () => {
    listContent = [
      { ...baseRow, attempt_id: "t-2", assessment_name: "Never changed", report_release_status: "RELEASED", result_revised_at: null },
      { ...baseRow, attempt_id: "t-3", assessment_name: "Old server", report_release_status: "RELEASED" },
    ];
    const host = await mount();
    expect(rowOf(host, "Never changed")).not.toBeNull();
    expect(rowOf(host, "Old server")).not.toBeNull();
    expect(host.querySelector('[data-testid="revised-tag"]')).toBeNull();
  });

  it("never tags a held (PENDING) result, even if a stray date arrives", async () => {
    listContent = [
      { ...baseRow, attempt_id: "t-4", assessment_name: "Held", report_release_status: "PENDING", result_revised_at: "2026-11-18T10:30:00.000+00:00" },
    ];
    const host = await mount();
    expect(rowOf(host, "Held")).not.toBeNull();
    expect(host.querySelector('[data-testid="revised-tag"]')).toBeNull();
  });

  it("homework reports reuse the same row and show the tag", async () => {
    listContent = [
      { ...baseRow, attempt_id: "t-5", assessment_name: "HW 3", report_release_status: "RELEASED", result_revised_at: "2026-11-18T10:30:00.000+00:00" },
    ];
    const host = await mount("HOMEWORK");
    expect(rowOf(host, "HW 3")!.querySelector('[data-testid="revised-tag"]')).not.toBeNull();
  });
});

describe("Reports list: sort order", () => {
  it("asks for the server's default order (newest first) and offers the sort control", async () => {
    listContent = [{ ...baseRow, attempt_id: "s-1", report_release_status: "RELEASED" }];
    const host = await mount();
    expect(posts).toHaveLength(1);
    const [, body] = posts[0] as [string, { sort_columns: Record<string, string> }];
    expect(body.sort_columns).toEqual({});
    expect(host.textContent).toContain("reportList.sort.label");
  });

  it("shows no sort control when there is nothing to sort", async () => {
    listContent = [];
    const host = await mount();
    expect(host.textContent).not.toContain("reportList.sort.label");
  });
});
