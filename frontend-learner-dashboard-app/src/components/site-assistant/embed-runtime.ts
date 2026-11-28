import { createSiteAssistantApi } from "./api";
import { createSiteAssistantController, type SiteAssistantController } from "./controller";
import type { EmbedBridge, ParentMessage } from "./embed-protocol";
import type { SiteAssistantPageContext, SiteAssistantSession } from "./types";

export interface EmbedRuntime {
  controller: SiteAssistantController;
  /** The live bridge (attached by the embed page's effect; null while unmounted). */
  bridge: EmbedBridge | null;
  onMessage: (m: ParentMessage) => void;
  listeners: Set<(m: ParentMessage) => void>;
}

/**
 * Controller + parent-message handling for one embed frame. The loader owns
 * the session: the first `init` is adopted, a later `init` after the frame
 * reported `expired` answers that refresh, any other `init` re-issues it.
 * No side effects here: the bridge is attached by the component's effect.
 */
export const createEmbedRuntime = (): EmbedRuntime => {
  let page: SiteAssistantPageContext = { url: "", route: "", title: "" };
  let firstSession: (s: SiteAssistantSession) => void = () => {};
  const first = new Promise<SiteAssistantSession>((resolve) => {
    firstSession = resolve;
  });
  let refreshWaiter: ((s: SiteAssistantSession) => void) | null = null;
  let adopted = false;

  const rt: EmbedRuntime = {
    bridge: null,
    listeners: new Set(),
    controller: createSiteAssistantController({
      api: createSiteAssistantApi(),
      source: {
        get: () => first,
        // The token was refused: ask the loader for a new session and wait for its init.
        refresh: () =>
          new Promise<SiteAssistantSession>((resolve, reject) => {
            refreshWaiter = resolve;
            rt.bridge?.post({ type: "expired" });
            window.setTimeout(() => reject(new Error("refresh timeout")), 15000);
          }),
      },
      getPage: () => page,
    }),
    onMessage: (message) => {
      if (message.type === "init") {
        if (message.page) page = message.page;
        if (refreshWaiter) {
          const resolve = refreshWaiter;
          refreshWaiter = null;
          resolve(message.session);
        } else {
          rt.controller.adoptSession(message.session);
          if (!adopted) {
            adopted = true;
            firstSession(message.session);
          }
        }
      } else if (message.type === "page") {
        page = message.page;
      }
      rt.listeners.forEach((l) => l(message));
    },
  };
  return rt;
};
