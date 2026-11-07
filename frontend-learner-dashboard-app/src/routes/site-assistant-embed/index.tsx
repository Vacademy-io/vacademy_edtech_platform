import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { EmbeddedSiteAssistant } from "@/components/site-assistant/EmbeddedSiteAssistant";

/**
 * /site-assistant-embed — the Site Assistant inside the iframe that
 * public/site-assistant.js adds to an institute's own website. Chrome-less
 * and transparent; the session arrives from the loader by postMessage (never
 * in this URL — `sid` only binds the handshake to the session it was opened
 * for). Framing is allowed for this path in public/_headers.
 */
export const Route = createFileRoute("/site-assistant-embed/")({
  validateSearch: z.object({
    sid: z.string().max(64).optional(),
    pos: z.enum(["left", "right"]).optional().catch(undefined),
    lang: z.string().max(16).optional(),
    /** Reopen the chat (the visitor followed "Take me there" to this page). */
    open: z.coerce.number().optional().catch(undefined),
  }),
  component: SiteAssistantEmbedRoute,
});

function SiteAssistantEmbedRoute() {
  const { sid, pos, lang, open } = Route.useSearch();
  return (
    <div className="fixed inset-0">
      <EmbeddedSiteAssistant sid={sid ?? null} position={pos ?? null} lang={lang ?? null} startOpen={open === 1} />
    </div>
  );
}
