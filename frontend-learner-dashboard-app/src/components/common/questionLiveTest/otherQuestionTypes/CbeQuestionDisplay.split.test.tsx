// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("@capacitor/storage", () => ({
  Storage: {
    get: async () => ({ value: null }),
    set: async () => undefined,
    remove: async () => undefined,
    keys: async () => ({ keys: [] }),
  },
}));
vi.mock("@sentry/react", () => ({ addBreadcrumb: () => undefined }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
  initReactI18next: { type: "3rdParty", init: () => undefined },
}));
// The spreadsheet itself is not under test here.
vi.mock("@/components/cbe/CbeWorkspace", () => ({ CbeWorkspace: () => <div data-testid="workspace" /> }));

const { CBE_QUESTION_TYPE } = await import("@/components/cbe/types");
const { CbeQuestionDisplay } = await import("./CbeQuestionDisplay");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const question = {
  question_id: "q-cbe",
  question_type: "CBE_RESPONSE",
  parent_rich_text: { id: "p", type: "HTML", content: "<p>Scenario: the ledger.</p>" },
  question: { id: "s", type: "HTML", content: "<p>Prepare the trial balance.</p>" },
  evaluation_json: JSON.stringify({ type: CBE_QUESTION_TYPE, data: { parts: [] } }),
  options: [],
} as never;

/** The shared split hook keeps the CBE view exactly as before the extraction. */
describe("CbeQuestionDisplay split (after moving the split into split/)", () => {
  it("draws scenario | divider | answer with the CBE labels and default 40%", () => {
    try {
      window.localStorage?.removeItem("cbe-live-split-pct");
    } catch {
      /* no storage in this environment */
    }
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<CbeQuestionDisplay question={question} header={null} />));

    const scenario = host.querySelector('section[aria-label="cbe.scenarioLabel"]') as HTMLElement;
    expect(scenario.textContent).toContain("Scenario: the ledger.");
    expect(scenario.style.flexBasis).toBe("40%");

    const divider = host.querySelector('[role="separator"]') as HTMLElement;
    expect(divider.getAttribute("aria-label")).toBe("cbe.resizeLabel");
    expect(divider.getAttribute("aria-valuenow")).toBe("40");
    expect(divider.nextElementSibling?.textContent).toContain("Prepare the trial balance.");
    expect(host.querySelector('[data-testid="workspace"]')).not.toBeNull();

    // Keyboard: ArrowRight +2, Shift+ArrowLeft -10, Home = min (22).
    act(() => {
      divider.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(divider.getAttribute("aria-valuenow")).toBe("42");
    act(() => {
      divider.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowLeft", shiftKey: true, bubbles: true }),
      );
    });
    expect(divider.getAttribute("aria-valuenow")).toBe("32");
    act(() => {
      divider.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    });
    expect(divider.getAttribute("aria-valuenow")).toBe("22");
    // Double-click puts it back at the CBE default.
    act(() => {
      divider.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(divider.getAttribute("aria-valuenow")).toBe("40");

    act(() => root.unmount());
    host.remove();
  });
});
