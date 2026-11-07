import { useMemo, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { ArrowSquareOut, Bell, Clock, Megaphone, User } from "@phosphor-icons/react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { openInBrowser } from "@/lib/open-in-browser";
import { formatNotificationDate } from "@/lib/notifications";
import { cn, sanitizeHtml } from "@/lib/utils";
import type { UserMessage } from "@/types/announcement";

/** Matches bare http(s) links so plain-text bodies get a real, tappable link.
 *  Built fresh per use: a shared /g regex carries `lastIndex` between calls,
 *  which makes alternating `test()`s silently skip matches. */
const urlPattern = () => /(https?:\/\/[^\s<>"'`)\]]+)/g;
const isUrl = (value: string): boolean => /^https?:\/\//.test(value);

/** Drop punctuation a sentence leaves glued to the end of a pasted URL. */
const trimTrailingPunctuation = (url: string): string =>
  url.replace(/[.,;:!?)\]}]+$/, "");

/** First link in the body, whatever the content type — powers the primary CTA. */
function findFirstUrl(message: UserMessage | null): string | null {
  if (!message?.content?.content) return null;
  const raw = message.content.content;

  if (message.content.type === "html") {
    const parsed = new DOMParser().parseFromString(raw, "text/html");
    const href = parsed.querySelector("a[href^='http']")?.getAttribute("href");
    if (href) return href;
  }

  const match = raw.match(urlPattern());
  return match?.[0] ? trimTrailingPunctuation(match[0]) : null;
}

interface LinkifiedTextProps {
  text: string;
}

/**
 * Plain-text body with its URLs turned into buttons. Announcements routinely
 * arrive as "Watch this…https://youtu.be/xyz" with the link glued to the
 * sentence, which was previously dead text the learner had to retype.
 */
function LinkifiedText({ text }: LinkifiedTextProps) {
  const parts = useMemo(() => text.split(urlPattern()), [text]);

  return (
    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground [.ui-play_&]:text-play-ink">
      {parts.map((part, index) => {
        if (!isUrl(part)) {
          return <span key={index}>{part}</span>;
        }

        const url = trimTrailingPunctuation(part);
        const trailing = part.slice(url.length);
        return (
          <span key={index}>
            <button
              type="button"
              onClick={() => void openInBrowser(url)}
              className="break-all font-medium text-foreground underline underline-offset-2 transition-colors hover:text-primary-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {url}
            </button>
            {trailing}
          </span>
        );
      })}
    </p>
  );
}

interface NotificationDetailDialogProps {
  notification: UserMessage | null;
  /** Occurrences collapsed into the row that was opened. */
  count?: number;
  isNew?: boolean;
  variant?: "general" | "announcement";
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Full notification body in a dialog. The list only ever had room for a
 * two-line preview and its "View details" affordance went nowhere, so the
 * whole message — long copy, rich text, links — now opens in place instead of
 * being truncated with no way to read the rest.
 */
export function NotificationDetailDialog({
  notification,
  count = 1,
  isNew = false,
  variant = "general",
  open,
  onOpenChange,
}: NotificationDetailDialogProps) {
  const { t } = useTranslation("dashboard");
  const primaryUrl = useMemo(() => findFirstUrl(notification), [notification]);
  const Icon = variant === "announcement" ? Megaphone : Bell;

  if (!notification) return null;

  const isHtml = notification.content?.type === "html";
  const body = notification.content?.content ?? "";

  /* Rich-text bodies carry real <a> tags. Inside the packaged app a plain
     anchor would navigate the WebView away from the learner shell, so every
     link is handed to the platform opener instead. */
  const handleRichTextClick = (event: MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as HTMLElement).closest("a");
    const href = anchor?.getAttribute("href");
    if (!href?.startsWith("http")) return;
    event.preventDefault();
    void openInBrowser(href);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          // `!p-0`: DialogContent's own `p-card-lg` is a custom spacing value
          // that tailwind-merge does not recognise as padding, so a plain
          // `p-0` is kept alongside it and loses on source order — the header
          // band would sit inset instead of running edge to edge.
          "max-w-lg gap-0 overflow-hidden !p-0 sm:max-w-xl",
          "[.ui-play_&]:rounded-play-card"
        )}
      >
        <DialogHeader className="space-y-0 border-b border-border bg-primary-50/50 p-card pe-12 text-start [.ui-play_&]:bg-play-info-soft">
          <div className="flex items-start gap-3">
            <span className="flex size-10 flex-shrink-0 items-center justify-center rounded-lg bg-primary-100 text-primary-500 [.ui-play_&]:bg-white [.ui-play_&]:text-play-info-soft-ink">
              <Icon size={20} weight="fill" />
            </span>

            <div className="min-w-0 flex-1 space-y-1.5">
              <DialogTitle className="text-base font-semibold leading-snug text-foreground [.ui-play_&]:font-bold [.ui-play_&]:text-play-ink sm:text-lg">
                {notification.title || t("notifications.defaultTitle")}
              </DialogTitle>

              <DialogDescription asChild>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground [.ui-play_&]:text-play-ink/75">
                  <span className="flex items-center gap-1.5">
                    <Clock size={13} />
                    {formatNotificationDate(notification.createdAt)}
                  </span>

                  {notification.createdByName && (
                    <span className="flex items-center gap-1.5">
                      <User size={13} />
                      {notification.createdByName}
                    </span>
                  )}

                  {isNew && (
                    <span className="flex items-center gap-1 rounded-full bg-background px-2 py-0.5 text-caption font-semibold text-foreground ring-1 ring-primary-200">
                      <span aria-hidden="true" className="size-1.5 rounded-full bg-primary-500" />
                      {t("notifications.newBadge")}
                    </span>
                  )}

                  {count > 1 && (
                    <span className="rounded-full bg-background px-2 py-0.5 text-caption font-semibold tabular-nums text-foreground/70">
                      {t("notifications.receivedTimes", { count })}
                    </span>
                  )}
                </div>
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="max-h-screen-50 overflow-y-auto p-card">
          {body ? (
            isHtml ? (
              <div
                onClick={handleRichTextClick}
                className="richtext-content text-sm text-foreground [.ui-play_&]:text-play-ink"
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(body) }}
              />
            ) : (
              <LinkifiedText text={body} />
            )
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("notifications.noContent")}
            </p>
          )}
        </div>

        <Separator />

        <div className="flex flex-col-reverse gap-2 p-card sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("notifications.close")}
          </Button>

          {primaryUrl && (
            <Button onClick={() => void openInBrowser(primaryUrl)}>
              <ArrowSquareOut size={16} />
              {t("notifications.openLink")}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
