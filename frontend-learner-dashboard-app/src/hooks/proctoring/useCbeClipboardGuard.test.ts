// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { useCbeClipboardGuard } from "./useCbeClipboardGuard";
import { useCopyDisable } from "./useCopyDisable";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** jsdom has no ClipboardEvent/DataTransfer; a plain Event with clipboardData is enough. */
const clipboardEvent = (type: string, data: Record<string, string>) => {
  const event = new Event(type, { bubbles: true, cancelable: true }) as Event & {
    clipboardData: { getData: (k: string) => string; setData: (k: string, v: string) => void; files: unknown[] };
  };
  const store = { ...data };
  event.clipboardData = {
    getData: (k) => store[k] ?? "",
    setData: (k, v) => {
      store[k] = v;
    },
    files: [],
  };
  return event;
};

let root: Root;
let host: HTMLDivElement;
const onBlocked = vi.fn();

function Harness() {
  useCopyDisable({ disabled: false });
  useCbeClipboardGuard({ enabled: true, onBlockedPaste: onBlocked });
  return createElement(
    "div",
    null,
    createElement("p", { id: "question" }, "Scenario text"),
    createElement(
      "div",
      { "data-cbe-workspace": "" },
      createElement("div", { id: "cell", tabIndex: 0 }, "3,200"),
    ),
  );
}

beforeEach(async () => {
  onBlocked.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(Harness)));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("CBE proctoring clipboard", () => {
  it("lets copy through inside the workspace but still blocks it outside", () => {
    const cell = document.getElementById("cell")!;
    const inside = clipboardEvent("copy", { "text/plain": "3,200" });
    cell.dispatchEvent(inside);
    expect(inside.defaultPrevented).toBe(false);

    const outside = clipboardEvent("copy", { "text/plain": "Scenario text" });
    document.getElementById("question")!.dispatchEvent(outside);
    expect(outside.defaultPrevented).toBe(true);
  });

  it("allows pasting what was copied inside the workspace", () => {
    const cell = document.getElementById("cell")!;
    cell.dispatchEvent(clipboardEvent("copy", { "text/plain": "3,200\t4,100" }));
    const paste = clipboardEvent("paste", { "text/plain": "3,200 4,100\n" });
    cell.dispatchEvent(paste);
    expect(paste.defaultPrevented).toBe(false);
    expect(onBlocked).not.toHaveBeenCalled();
  });

  it("blocks and counts a paste of outside text", () => {
    const cell = document.getElementById("cell")!;
    cell.dispatchEvent(clipboardEvent("copy", { "text/plain": "3,200" }));
    const paste = clipboardEvent("paste", { "text/plain": "answer from ChatGPT" });
    const downstream = vi.fn();
    document.addEventListener("paste", downstream);
    cell.dispatchEvent(paste);
    document.removeEventListener("paste", downstream);
    expect(paste.defaultPrevented).toBe(true);
    expect(downstream).not.toHaveBeenCalled(); // the grid's own handler never sees it
    expect(onBlocked).toHaveBeenCalledTimes(1);
  });

  it("ignores pastes outside the workspace (other inputs police their own)", () => {
    const paste = clipboardEvent("paste", { "text/plain": "anything" });
    document.getElementById("question")!.dispatchEvent(paste);
    expect(paste.defaultPrevented).toBe(false);
    expect(onBlocked).not.toHaveBeenCalled();
  });
});
