import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle, GameController } from "@phosphor-icons/react";
import {
  HtmlSlideIframe,
  type SlideResult,
} from "@/components/common/study-library/level-material/subject-material/module-material/chapter-material/slide-material/html-slide-iframe";
import { Progress } from "@/components/ui/progress";
import type { EngagementItem } from "@/services/engagement";
import { ecn, outcomeClasses, skinClasses } from "../engagement-tone";
import { hostReadingVars } from "./ReadingBody";

/**
 * A game, on a full-bleed stage (D38): no box inside a box, the frame sized to
 * the game's own content, the host's font and colours offered as `--vac-*`.
 *
 * `vacademy:complete` is the only honest "played it" signal (D1); the runner
 * keeps its button disabled until it arrives. A progress bar shows only when
 * the game itself posts `vacademy:progress` (generated games don't yet).
 */

export interface GameScore {
  score: number;
  maxScore: number | null;
}

/** "3 / 4" from a game's self-reported result; null when it reported no score. */
export function gameScoreOf(result: SlideResult, itemMax?: number | null): GameScore | null {
  if (typeof result.score !== "number" || !Number.isFinite(result.score)) return null;
  const max =
    typeof result.maxScore === "number" && result.maxScore > 0
      ? result.maxScore
      : typeof itemMax === "number" && itemMax > 0
        ? itemMax
        : null;
  return { score: Math.max(0, result.score), maxScore: max };
}

export interface GameBodyProps {
  item: EngagementItem;
  /** The game posted `vacademy:complete`. */
  finished: boolean;
  score: GameScore | null;
  onComplete: (result: SlideResult) => void;
}

export function GameBody({ item, finished, score, onComplete }: GameBodyProps) {
  const { t, i18n } = useTranslation("dashboardEngagement");
  const [progress, setProgress] = useState<number | null>(null);
  const vars = useMemo(() => hostReadingVars(), []);

  if (!item.contentHtml) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
        <GameController aria-hidden className={ecn("size-8", skinClasses("mutedInk"))} />
        <p className={ecn("text-body", skinClasses("mutedInk"))}>{t("runner.game.empty")}</p>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col">
      {finished ? (
        <div
          role="status"
          className={ecn(
            "flex items-center gap-2 border-b px-4 py-2 sm:px-6",
            skinClasses("divider"),
            outcomeClasses("correct", "option")
          )}
        >
          <CheckCircle aria-hidden weight="fill" className={ecn("size-5 shrink-0", outcomeClasses("correct", "ink"))} />
          <p className={ecn("text-body font-medium", skinClasses("ink"))}>
            {score?.maxScore != null
              ? t("runner.game.finishedScore", { score: score.score, max: score.maxScore })
              : t("runner.game.finished")}
          </p>
        </div>
      ) : (
        progress != null && (
          <div className="flex items-center gap-3 px-4 py-2 sm:px-6">
            <Progress
              value={progress}
              aria-label={t("runner.game.progress")}
              className="h-1.5 flex-1 bg-muted rtl:-scale-x-100 [.ui-cleaner-play_&]:bg-cp-bg-deep"
            />
            <span className={ecn("text-caption tabular-nums", skinClasses("mutedInk"))}>
              {t("runner.game.percent", { percent: progress })}
            </span>
          </div>
        )
      )}
      <HtmlSlideIframe
        html={item.contentHtml}
        injectVars={vars}
        measure="content"
        minHeight={360}
        title={item.title}
        lang={i18n.language}
        className="block"
        onProgress={(percent) => setProgress(Math.max(0, Math.min(100, Math.round(percent))))}
        onComplete={onComplete}
      />
    </div>
  );
}
