import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarBlank, Broadcast } from "@phosphor-icons/react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Cta, EventConfig } from "@/types/learner-home";
import { useHomeBuilder } from "../home-context";
import { altOf, srcSetOf } from "../image-sources";
import { countdown, eventPhase, eventTimes, nextTickDelay, type Countdown } from "../event-timing";

function formatWhen(ms: number, locale: string | undefined): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleString(locale);
  }
}

/**
 * A dated event (spec 7.4.5): a webinar, a live class, an exam date. Shows the
 * learner's local time with its zone, a countdown, and Register until the join
 * window opens, then Join. Hides itself when the event ends, with no refetch.
 */
export function EventBlock({ blockKey, config }: { blockKey: string; config: EventConfig }) {
  const { t, i18n } = useTranslation("learnerHome");
  const { openLink } = useHomeBuilder();
  const headingId = useId();
  const times = eventTimes(config);
  const [now, setNow] = useState(() => Date.now());

  // Re-render exactly when the text or the button changes: each second in the
  // last minute, each minute otherwise, and on the join / start / end instants.
  useEffect(() => {
    if (!times) return;
    if (eventPhase(times, now) === "ENDED") return;
    const timer = window.setTimeout(() => setNow(Date.now()), nextTickDelay(times, now));
    return () => window.clearTimeout(timer);
  }, [times?.startsMs, times?.endsMs, times?.joinOpensMs, now]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!times) return null;
  const phase = eventPhase(times, now);
  if (phase === "ENDED") return null;

  const when = formatWhen(times.startsMs, i18n.language);
  const cd = countdown(times, now);
  const cta: { cta: Cta; itemKey: string; primary: boolean; label: string } | null =
    phase === "BEFORE"
      ? config.register_cta
        ? {
            cta: config.register_cta,
            itemKey: "register",
            primary: false,
            label: config.register_cta.label?.trim() || t("event.register"),
          }
        : null
      : config.join_cta
        ? {
            cta: config.join_cta,
            itemKey: "join",
            primary: true,
            label: config.join_cta.label?.trim() || t("event.join"),
          }
        : null;

  return (
    <Card
      role="region"
      aria-labelledby={headingId}
      className={cn(
        "overflow-hidden",
        "[.ui-vibrant_&]:border-primary/20 [.ui-vibrant_&]:bg-gradient-to-br [.ui-vibrant_&]:from-card [.ui-vibrant_&]:to-primary/5",
        "[.ui-play_&]:rounded-play-card-sm [.ui-play_&]:shadow-play-soft-card",
        "cp-card fun-block-event"
      )}
    >
      {config.image?.url && (
        <img
          src={config.image.url}
          srcSet={srcSetOf(config.image) || undefined}
          sizes="(max-width: 1023px) 100vw, 66vw"
          alt={altOf(config.image)}
          loading="lazy"
          decoding="async"
          className="block aspect-video w-full object-cover"
        />
      )}
      <CardContent className="space-y-3 p-card">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-500 [.ui-corporate_&]:bg-transparent"
          >
            {phase === "LIVE" ? <Broadcast size={22} weight="duotone" /> : <CalendarBlank size={22} weight="duotone" />}
          </span>
          <div className="min-w-0 flex-1">
            <h3 id={headingId} className="text-title font-semibold text-foreground [.ui-play_&]:font-black cp-heading fun-block-title">
              <bdi>{config.title}</bdi>
            </h3>
            {config.subtitle ? (
              <p className="mt-0.5 text-sm text-muted-foreground">
                <bdi>{config.subtitle}</bdi>
              </p>
            ) : null}
            <p className="mt-1 text-sm font-medium text-foreground">
              <time dateTime={new Date(times.startsMs).toISOString()}>{when}</time>
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          {phase === "LIVE" ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-danger-50 px-2.5 py-1 text-xs font-bold text-danger-700">
              <span aria-hidden className="size-2 animate-pulse rounded-full bg-danger-500 motion-reduce:animate-none" />
              {t("event.liveNow")}
            </span>
          ) : config.show_countdown !== false ? (
            <>
              {/* Visual countdown only: a ticking aria-live region would flood screen readers. */}
              <span aria-hidden className="text-sm font-semibold tabular-nums text-primary-500 fun-block-event__countdown">
                {countdownText(cd, t)}
              </span>
              <span className="sr-only">{t("event.startsOn", { when })}</span>
            </>
          ) : (
            <span />
          )}
          {cta && (
            <Button
              size="sm"
              variant={cta.primary ? "default" : "outline"}
              onClick={() => openLink(cta.cta.link, blockKey, cta.itemKey)}
              className={cn(cta.primary && "bg-primary-500 text-white hover:bg-primary-500/90")}
            >
              {cta.label}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function countdownText(cd: Countdown, t: (key: string, opts?: Record<string, unknown>) => string): string {
  switch (cd.kind) {
    case "days":
      return t("event.startsInDays", { days: cd.days, hours: cd.hours });
    case "hours":
      return t("event.startsInHours", { hours: cd.hours, minutes: cd.minutes });
    case "minutes":
      return t("event.startsInMinutes", { minutes: cd.minutes });
    case "seconds":
      return t("event.startsInSeconds", { seconds: cd.seconds });
    case "live":
      return t("event.liveNow");
    default:
      return "";
  }
}
