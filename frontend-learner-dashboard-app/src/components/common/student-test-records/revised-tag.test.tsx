// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Echo the key and its options so the test sees which string and which date were asked for.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key,
  }),
}));

const { RevisedTag } = await import("./revised-tag");
const { formatDate } = await import("@/lib/format-date");

const hosts: HTMLElement[] = [];
async function mount(at: string | number | null | undefined) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  hosts.push(host);
  const root = createRoot(host);
  await act(async () => root.render(<RevisedTag at={at} />));
  return host;
}

afterEach(() => {
  hosts.splice(0).forEach((h) => h.remove());
});

describe("RevisedTag", () => {
  it("renders nothing when the result was never revised", async () => {
    expect((await mount(null)).innerHTML).toBe("");
    expect((await mount(undefined)).innerHTML).toBe("");
    expect((await mount("")).innerHTML).toBe("");
  });

  it("shows 'Revised <date>' with the app's date format and an explanation on hover", async () => {
    const iso = "2026-11-18T10:30:00.000+00:00";
    const host = await mount(iso);
    const tag = host.querySelector('[data-testid="revised-tag"]');
    expect(tag).not.toBeNull();
    expect(tag?.textContent).toBe(`revisedTag:${JSON.stringify({ date: formatDate(iso) })}`);
    expect(tag?.getAttribute("title")).toBe("revisedTagHint");
    // Tokens only: the info scale, no raw palette hue or hex.
    expect(tag?.className).toContain("bg-info-50");
    expect(tag?.className).not.toMatch(/#|amber|sky/);
  });

  it("accepts an epoch-millis timestamp too (Jackson's other Date form)", async () => {
    const ms = Date.UTC(2026, 10, 18, 10, 30);
    const tag = (await mount(ms)).querySelector('[data-testid="revised-tag"]');
    expect(tag?.textContent).toBe(`revisedTag:${JSON.stringify({ date: formatDate(ms) })}`);
  });

  it("falls back to a plain 'Revised' when the date cannot be read", async () => {
    const tag = (await mount("not-a-date")).querySelector('[data-testid="revised-tag"]');
    expect(tag?.textContent).toBe("revisedTagShort");
  });
});
