import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { LockKeyOpen, X, CaretRight } from "@phosphor-icons/react";
import type { EngagementItem } from "@/services/engagement";
import { ecn, skinClasses, toneClasses } from "./engagement-tone";

/**
 * "Yesterday's answer is out · You got 1 of 2 · See answers" (D10).
 *
 * A one-time ribbon for reveals the learner has not seen yet. The full detail
 * (options, key, explanation, poll bars) lives on the `/engagement` Answers tab;
 * following the link or dismissing marks every listed reveal as seen. Seen ids
 * are kept in localStorage, and every access is guarded: with storage blocked
 * the ribbon still works for the session and simply shows again next time.
 */

const SEEN_KEY = "vacademy.engagement.seenReveals.v1";
/** Keep the stored list small; reveals only stay in the feed for about two days. */
const MAX_SEEN = 60;

/** Identity of one reveal: the same recurring task reveals again on another run. */
export function revealKey(item: Pick<EngagementItem, "id" | "runDate">): string {
  return `${item.id}:${item.runDate ?? ""}`;
}

function readSeen(): string[] {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function writeSeen(keys: string[]): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(keys.slice(-MAX_SEEN)));
  } catch {
    // Storage blocked: the ribbon is simply shown again next visit.
  }
}

export interface RevealSummary {
  unseen: EngagementItem[];
  /** Questions with a known right/wrong among the unseen. */
  graded: number;
  correct: number;
  /** Every unseen reveal ran before `todayKey` ("Yesterday's answer…"). */
  allFromBefore: boolean;
  /** Only polls: "Poll results are in". */
  onlyPolls: boolean;
}

/** What the ribbon says about the unseen reveals. Pure. */
export function summarizeReveals(
  revealed: EngagementItem[],
  seen: ReadonlySet<string>,
  todayKey: string | null
): RevealSummary {
  const unseen = revealed.filter((i) => !seen.has(revealKey(i)));
  let graded = 0;
  let correct = 0;
  for (const item of unseen) {
    if (item.itemType !== "QUESTION_OF_DAY") continue;
    if (item.isCorrect === true || item.isCorrect === false) {
      graded++;
      if (item.isCorrect) correct++;
    }
  }
  const allFromBefore =
    todayKey != null && unseen.length > 0 && unseen.every((i) => Boolean(i.runDate) && i.runDate! < todayKey);
  const onlyPolls = unseen.length > 0 && unseen.every((i) => i.itemType === "POLL");
  return { unseen, graded, correct, allFromBefore, onlyPolls };
}

export interface AnswerRibbonProps {
  revealed: EngagementItem[];
  /** The plan-local date of today's tasks (yyyy-MM-dd), for "Yesterday's". */
  todayKey: string | null;
  /** Opens `/engagement?tab=answers`. */
  onSeeAnswers: () => void;
  /** Rail: one short line (title + arrow); the score moves to the Answers tab. */
  compact?: boolean;
  className?: string;
}

export function AnswerRibbon({ revealed, todayKey, onSeeAnswers, compact = false, className }: AnswerRibbonProps) {
  const { t } = useTranslation("dashboardEngagement");
  const [seen, setSeen] = useState<Set<string>>(() => new Set(readSeen()));
  const summary = useMemo(() => summarizeReveals(revealed, seen, todayKey), [revealed, seen, todayKey]);

  const markSeen = useCallback(() => {
    const keys = summary.unseen.map(revealKey);
    const next = new Set(seen);
    for (const key of keys) next.add(key);
    setSeen(next);
    writeSeen([...readSeen().filter((k) => !keys.includes(k)), ...keys]);
  }, [seen, summary.unseen]);

  if (summary.unseen.length === 0) return null;
  const count = summary.unseen.length;

  let title: string;
  if (summary.onlyPolls) title = t("today.ribbon.polls", { count });
  else if (summary.allFromBefore) title = t("today.ribbon.yesterday", { count });
  else title = t("today.ribbon.out", { count });
  const score =
    summary.graded > 0 ? t("today.ribbon.score", { correct: summary.correct, total: summary.graded }) : null;

  return (
    <div
      className={ecn(
        "flex min-w-0 items-center gap-2 rounded-lg py-1 pe-1 ps-3",
        toneClasses("warn", "surface"),
        "[.ui-corporate_&]:border [.ui-corporate_&]:border-border",
        "motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200",
        className
      )}
    >
      <LockKeyOpen
        aria-hidden
        weight="duotone"
        className={ecn("size-5 shrink-0", toneClasses("warn", "icon"), compact && "hidden xl:block")}
      />
      <button
        type="button"
        onClick={() => {
          markSeen();
          onSeeAnswers();
        }}
        aria-label={[title, score, t("today.ribbon.see")].filter(Boolean).join(" · ")}
        className={ecn(
          "group flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-sm text-start",
          // Narrow columns (rail, phone) take the caption size so the title fits one line.
          compact ? "text-caption" : "text-caption sm:text-body",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
        )}
      >
        <span className={ecn("min-w-0 font-semibold", compact ? "line-clamp-2" : "truncate", skinClasses("ink"))}>
          {title}
        </span>
        {score && !compact && (
          <span className={ecn("hidden shrink-0 sm:inline", skinClasses("mutedInk"))}>{score}</span>
        )}
        <span className="ms-auto inline-flex shrink-0 items-center gap-0.5 font-medium text-primary-500 group-hover:underline [.ui-play_&]:text-play-info-deep [.ui-cleaner-play_&]:text-cp-ink">
          {!compact && <span className="hidden sm:inline">{t("today.ribbon.see")}</span>}
          <CaretRight
            aria-hidden
            weight="bold"
            className={ecn("size-4 rtl:-scale-x-100", compact && "hidden xl:block")}
          />
        </span>
      </button>
      <button
        type="button"
        onClick={markSeen}
        aria-label={t("today.ribbon.dismiss")}
        className={ecn(
          "flex size-9 shrink-0 items-center justify-center rounded-md hover:bg-muted",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400",
          skinClasses("mutedInk")
        )}
      >
        <X aria-hidden className="size-4" />
      </button>
    </div>
  );
}
