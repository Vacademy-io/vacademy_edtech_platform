import { useCallback } from "react";
import { useRouter } from "@tanstack/react-router";
import { useChatbotContext } from "../useChatbotContext";
import { useChatbotPanelStore } from "@/stores/chatbot/useChatbotPanelStore";

/** Below this the chat covers the page (ChatbotPanel), so it gets out of the way. */
const MOBILE_MAX_WIDTH = 768;

/**
 * Navigates to an in-app path ("/study-library/...?x=1") from inside the chat
 * and makes the destination visible: on mobile the chat closes, and the
 * desktop popup docks so the page is no longer hidden behind it.
 */
export const useChatLinkNavigation = () => {
  const router = useRouter();
  const { setIsOpen } = useChatbotContext();
  const viewMode = useChatbotPanelStore((s) => s.viewMode);
  const setViewMode = useChatbotPanelStore((s) => s.setViewMode);

  return useCallback(
    (href: string) => {
      // "?x=1": stay on the current page, add the params.
      router.history.push(href.startsWith("?") ? `${window.location.pathname}${href}` : href);
      if (window.innerWidth < MOBILE_MAX_WIDTH) {
        setIsOpen(false);
      } else if (viewMode === "popup") {
        setViewMode("docked");
      }
    },
    [router, setIsOpen, viewMode, setViewMode],
  );
};
