import { createContext, useContext } from "react";
import type { LinkTarget } from "./links";

/** How the assistant resolves and follows links (hosted router / embed parent / new tab). See AssistantLink. */
export interface AssistantLinkHandler {
  resolve: (href: string) => LinkTarget | null;
  navigate: (target: LinkTarget) => void;
}

const fallbackHandler: AssistantLinkHandler = {
  resolve: (href) => (href.startsWith("https://") ? { kind: "external", url: href } : null),
  navigate: () => {},
};

export const AssistantLinkContext = createContext<AssistantLinkHandler>(fallbackHandler);

export const useAssistantLinks = () => useContext(AssistantLinkContext);
