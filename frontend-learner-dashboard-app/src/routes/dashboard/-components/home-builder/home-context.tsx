import { createContext, useContext } from "react";
import type { ResolvedLink } from "@/types/learner-home";
import type { LinkContext } from "./link-target";
import type { HomeAnalytics } from "./use-home-analytics";

/** What every block needs from the page, provided once by LearnerHomeRenderer. */
export interface HomeBuilderContextValue {
  linkContext: LinkContext;
  /** Tracks the click (before navigating), then follows the link. */
  openLink: (link: ResolvedLink, blockKey: string, itemKey?: string) => void;
  analytics: HomeAnalytics;
  /** Shared clock, refreshed by the renderer's tick. */
  nowMs: number;
  /** Admin preview: no network writes (dismiss, acknowledge, analytics). */
  preview: boolean;
  skin: { fun: boolean; play: boolean; cleanerPlay: boolean };
  onDismiss: (blockKey: string) => void;
  /** Resolves false when the server refused it (the button comes back). */
  onAcknowledge: (blockKey: string) => Promise<boolean>;
}

const noop = () => {};

export const HomeBuilderContext = createContext<HomeBuilderContextValue>({
  linkContext: { readerMode: false, playSkin: false },
  openLink: noop,
  analytics: { view: noop, click: noop, flush: noop },
  nowMs: 0,
  preview: false,
  skin: { fun: false, play: false, cleanerPlay: false },
  onDismiss: noop,
  onAcknowledge: async () => true,
});

export const useHomeBuilder = () => useContext(HomeBuilderContext);
