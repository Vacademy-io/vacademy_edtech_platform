// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18next from "i18next";
import { I18nextProvider } from "react-i18next";
import { SiteAssistantWidget } from "./SiteAssistantWidget";
import { SiteAssistantUiContext } from "./context";
import { createSiteAssistantController } from "./controller";
import type { SiteAssistantApi } from "./api";

const e = React.createElement;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let host: HTMLElement;

beforeAll(async () => {
  const catalog = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../locales/en/siteAssistant.json"), "utf8"));
  await i18next.init({
    lng: "en",
    fallbackLng: "en",
    defaultNS: "common",
    ns: ["common", "siteAssistant"],
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
    resources: { en: { common: {}, siteAssistant: catalog } },
  });
  window.matchMedia = ((q: string) => ({ matches: false, media: q })) as unknown as typeof window.matchMedia;
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host?.remove();
});

const tick = () => act(async () => new Promise((r) => setTimeout(r, 40)));

describe("SiteAssistantWidget (hosted)", () => {
  it("opens with a greeting and chips, sends a chip, streams the answer, closes on Esc back to the launcher", async () => {
    const createSession = vi.fn();
    const api = {
      createSession,
      streamMessage: vi.fn(async (_s: string, _t: string, _b: unknown, onEvent: (ev: unknown) => void) => {
        onEvent({ type: "token", text: "Yes — **every Sunday**." });
        onEvent({ type: "done", message_id: "m1", answered: true, billed: true });
      }),
    } as unknown as SiteAssistantApi;
    const getSession = vi.fn(async () => ({
      session_id: "s1",
      token: "t",
      expires_at: null,
      assistant: { name: "Ask BV", avatar_url: null, greeting: null, suggestions: [], accent_color: null, position: null, persona: null },
      history: [],
    }));
    const controller = createSiteAssistantController({
      api,
      source: { get: getSession, refresh: getSession },
      getPage: () => ({ url: "https://s/", route: "/", title: "Home" }),
    });

    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(
        e(
          I18nextProvider,
          { i18n: i18next },
          e(
            SiteAssistantUiContext.Provider,
            { value: { controller, consentText: null } },
            e(SiteAssistantWidget, {
              display: { name: "Ask BV", avatarUrl: null, greeting: "Namaste!", suggestions: ["Any free class?"] },
              side: "end",
              variant: "hosted",
              launcherOffsetClassName: "bottom-32 md:bottom-6",
            }),
          ),
        ),
      );
    });

    const launcher = host.querySelector("button") as HTMLButtonElement;
    expect(launcher.getAttribute("aria-label")).toBe("Chat with Ask BV");
    expect(launcher.className).toContain("bottom-32");
    expect(getSession).not.toHaveBeenCalled(); // no session until the visitor opens the chat

    await act(async () => launcher.click());
    await tick();
    const dialog = host.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog).toBeTruthy();
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(document.activeElement?.tagName).toBe("TEXTAREA");
    expect(host.querySelector('[role="log"]')?.getAttribute("aria-live")).toBe("polite");
    expect(host.textContent).toContain("Namaste!");

    const chip = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Any free class?")!;
    await act(async () => chip.click());
    await tick();
    expect(host.querySelector('[data-role="user"]')?.textContent).toContain("Any free class?");
    expect(host.querySelector('[data-role="assistant"] strong')?.textContent).toBe("every Sunday");
    expect(host.querySelectorAll('[aria-pressed]')).toHaveLength(2); // thumbs

    await act(async () => {
      dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Chat with Ask BV");
  });
});
