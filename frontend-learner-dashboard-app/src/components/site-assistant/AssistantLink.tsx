import React from "react";
import { useAssistantLinks } from "./link-context";

/**
 * Every link inside the assistant goes through here: the hosted widget
 * navigates its own site with the router (so the chat stays open across
 * "Take me there"), the embed asks the loader to move the parent page, and
 * anything else opens in a new tab. A href that fails the safety check
 * renders as plain text.
 */

interface Props {
  href: string | null | undefined;
  className?: string;
  children: React.ReactNode;
  "aria-label"?: string;
}

export const AssistantLink: React.FC<Props> = ({ href, className, children, ...rest }) => {
  const handler = useAssistantLinks();
  const target = href ? handler.resolve(href) : null;
  if (!target) return <span className={className}>{children}</span>;
  if (target.kind === "external") {
    return (
      <a href={target.url} target="_blank" rel="noopener noreferrer" className={className} aria-label={rest["aria-label"]}>
        {children}
      </a>
    );
  }
  const url = target.kind === "internal" ? target.path : target.url;
  return (
    <a
      href={url}
      className={className}
      aria-label={rest["aria-label"]}
      onClick={(e) => {
        // Let the browser open a new tab/window when asked to.
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        handler.navigate(target);
      }}
    >
      {children}
    </a>
  );
};
