// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi, beforeEach } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// A plain responder rather than vi.fn(): a spy re-throws a rejected promise it returns even
// when the component catches it, which would fail the fallback test for the wrong reason.
const calls: unknown[] = [];
let respond: () => Promise<unknown> = async () => ({ data: {} });
vi.mock("@/lib/auth/axiosInstance", () => ({
  default: (config: unknown) => {
    calls.push(config);
    return respond();
  },
}));
vi.mock("@capacitor/preferences", () => ({
  Preferences: { get: async () => ({ value: JSON.stringify({ id: "inst-1" }) }) },
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/constants/urls", () => ({ AI_REPORT_WEB_HTML: "/ai-html", EXPORT_AI_REPORT: "/ai-pdf" }));
vi.mock("@/components/core/dashboard-loader", () => ({ DashboardLoader: () => <div data-testid="loader" /> }));

const { AiReportWebView } = await import("./ai-report-web-view");

async function mount(props: { assessmentId: string; attemptId?: string }) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <AiReportWebView
        assessmentId={props.assessmentId}
        attemptId={props.attemptId}
        assessmentName="Unit Test"
        fallback={<div data-testid="fallback">old view</div>}
      />,
    ),
  );
  // Let the request promise and the state update settle.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return {
    host,
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

describe("AiReportWebView", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("shows the server's report in a sandboxed iframe with scripts disabled", async () => {
    respond = async () => ({ data: { html: "<html><body><p>Report</p></body></html>" } });
    const view = await mount({ assessmentId: "a1", attemptId: "t1" });

    const frame = view.host.querySelector("iframe");
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute("sandbox")).toBe("allow-same-origin");
    expect(frame?.getAttribute("srcdoc")).toContain("<p>Report</p>");
    expect(view.host.querySelector("[data-testid=fallback]")).toBeNull();
    expect(calls).toEqual([
      expect.objectContaining({
        url: "/ai-html",
        params: { assessmentId: "a1", attemptId: "t1", instituteId: "inst-1" },
      }),
    ]);
    await view.unmount();
  });

  it("falls back to the previous view when the server cannot render the report", async () => {
    respond = () => Promise.reject(new Error("404"));
    const view = await mount({ assessmentId: "a2", attemptId: "t2" });
    expect(view.host.querySelector("[data-testid=fallback]")).not.toBeNull();
    expect(view.host.querySelector("iframe")).toBeNull();
    await view.unmount();
  });

  it("falls back when the response has no html", async () => {
    respond = async () => ({ data: {} });
    const view = await mount({ assessmentId: "a3" });
    expect(view.host.querySelector("[data-testid=fallback]")).not.toBeNull();
    await view.unmount();
  });

  it("builds the report once when the page swaps layouts while it is still loading", async () => {
    let release: (value: unknown) => void = () => undefined;
    respond = () => new Promise((resolve) => (release = resolve));
    const first = await mount({ assessmentId: "a5", attemptId: "t5" });
    await first.unmount(); // the page moved to its tab layout before the answer came back
    const second = await mount({ assessmentId: "a5", attemptId: "t5" });
    await act(async () => release({ data: { html: "<p>Once</p>" } }));
    expect(second.host.querySelector("iframe")?.getAttribute("srcdoc")).toContain("Once");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(expect.objectContaining({ timeout: 30_000 }));
    await second.unmount();
  });

  it("does not ask the server again when the same report is opened again in the session", async () => {
    respond = async () => ({ data: { html: "<p>Cached</p>" } });
    const first = await mount({ assessmentId: "a4", attemptId: "t4" });
    await first.unmount();
    const second = await mount({ assessmentId: "a4", attemptId: "t4" });
    expect(second.host.querySelector("iframe")?.getAttribute("srcdoc")).toContain("Cached");
    expect(calls).toHaveLength(1);
    await second.unmount();
  });
});
