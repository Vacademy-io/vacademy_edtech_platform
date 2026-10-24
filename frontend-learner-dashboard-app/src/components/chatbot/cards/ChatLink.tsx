import React from "react";
import { useTranslation } from "react-i18next";
import { classifyHref } from "./href";
import { useChatLinkNavigation } from "./useChatLinkNavigation";

interface ChatLinkProps {
  href?: string;
  /** Accept http:// and mailto: too (markdown replies). Cards stay strict. */
  lenient?: boolean;
  className?: string;
  /** Class for the non-clickable fallback when the href is not allowed. */
  inertClassName?: string;
  children: React.ReactNode;
}

/**
 * A link from assistant output. In-app paths go through the router (and get
 * the chat out of the way on mobile), https opens a new tab, anything else is
 * plain text.
 */
export const ChatLink: React.FC<ChatLinkProps> = ({
  href,
  lenient = false,
  className,
  inertClassName,
  children,
}) => {
  const { t } = useTranslation("chatFeatureB");
  const navigate = useChatLinkNavigation();
  const target = classifyHref(href, { lenient });

  if (target.kind === "internal") {
    return (
      <a
        href={target.href}
        className={className}
        onClick={(e) => {
          // Let modified clicks (new tab / window) do what the browser does.
          if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          navigate(target.href);
        }}
      >
        {children}
      </a>
    );
  }

  if (target.kind === "external") {
    return (
      <a href={target.href} target="_blank" rel="noopener noreferrer" className={className}>
        {children}
        <span className="sr-only"> {t("cards.opensInNewTab")}</span>
      </a>
    );
  }

  return <span className={inertClassName}>{children}</span>;
};
