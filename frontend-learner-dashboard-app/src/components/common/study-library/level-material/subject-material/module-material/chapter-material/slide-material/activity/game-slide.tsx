import { useEffect, useMemo, useRef, useState } from "react";
import { announceSlideCompleted } from "@/services/slide-engagement";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GameController, Trophy } from "@phosphor-icons/react";
import type { Slide } from "@/hooks/study-library/use-slides";
import { getSlideCompletionThreshold } from "@/constants/study-library";
import { markSlideCompletion } from "@/services/study-library/tracking-api/mark-slide-completion";
import { HtmlSlideIframe, type SlideResult } from "../html-slide-iframe";
import { useDiscussionContext } from "../discussion/use-discussion";
import { fetchGame, sendGameScore, type GameView } from "./activity-api";
import { gameReportsResult, parseGameSlide } from "./activity-utils";

/** How long a game that never reports a result must be on screen to count as played. */
const UNSCORED_GAME_DONE_AFTER_MS = 30_000;
const VISIBLE_TICK_MS = 1_000;

/**
 * A game: the teacher's HTML page in the sandboxed slide frame. When the page posts
 * `vacademy:complete`, the score is saved (the server caps it and keeps the best) and the
 * first result completes the slide.
 *
 * A page that never posts it can't be scored. It completes once the learner has had it
 * on screen for {@link UNSCORED_GAME_DONE_AFTER_MS}. Without this the slide stayed at 0%
 * for good, holding the chapter below 100% and every unlock rule that waits on it.
 */
export function GameSlide({ slide }: { slide: Slide }) {
  const { t, i18n } = useTranslation("studyContent");
  const queryClient = useQueryClient();
  const game = useMemo(
    () => parseGameSlide(slide.document_slide?.published_data),
    [slide.document_slide?.published_data]
  );
  const { ids, ready } = useDiscussionContext(slide.id);
  const key = ["slide-game", slide.id, ids.packageSessionId ?? ""];
  const view = useQuery({ queryKey: key, queryFn: () => fetchGame(ids), enabled: ready && !!game, staleTime: 30_000 });
  const [last, setLast] = useState<number | null>(null);
  const save = useMutation({
    mutationFn: (r: SlideResult) => sendGameScore(ids, r.score, r.maxScore),
    onSuccess: (data: GameView) => {
      const first = (view.data?.attempts ?? 0) === 0;
      queryClient.setQueryData(key, data);
      if (first && ids.chapterId) queryClient.invalidateQueries({ queryKey: ["slides", ids.chapterId] });
      if (first) announceSlideCompleted(slide.id);
    },
  });

  // Unscored game: count visible time, then mark the slide complete once.
  const reportsResult = !!game && gameReportsResult(game.html);
  const alreadyComplete = (slide.percentage_completed || 0) >= getSlideCompletionThreshold();
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const markedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!game || reportsResult || alreadyComplete || !ready || markedRef.current === slide.id) return;
    let visibleMs = 0;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      visibleMs += VISIBLE_TICK_MS;
      if (visibleMs < UNSCORED_GAME_DONE_AFTER_MS) return;
      window.clearInterval(timer);
      markedRef.current = slide.id;
      const { chapterId, moduleId, subjectId, packageSessionId } = idsRef.current;
      markSlideCompletion({
        slideId: slide.id,
        slideType: "DOCUMENT",
        completed: true,
        chapterId,
        moduleId,
        subjectId,
        packageSessionId,
      })
        .then(() => {
          if (chapterId) queryClient.invalidateQueries({ queryKey: ["slides", chapterId] });
          announceSlideCompleted(slide.id);
        })
        .catch(() => {
          // Not fatal: the next time the learner opens the game it tries again.
          markedRef.current = null;
        });
    }, VISIBLE_TICK_MS);
    return () => window.clearInterval(timer);
  }, [game, reportsResult, alreadyComplete, ready, slide.id, queryClient]);

  if (!game) {
    return (
      <div className="flex h-full w-full items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">{t("activity.unavailable")}</p>
      </div>
    );
  }

  const data = view.data;
  const fmt = (n: number | null | undefined) =>
    n == null ? "—" : n.toLocaleString(i18n.language, { maximumFractionDigits: 1 });
  const max = data?.maxScore ?? game.maxScore;

  return (
    <div className="flex w-full flex-col gap-3 p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <GameController size={20} weight="duotone" className="shrink-0 text-primary-500" aria-hidden />
          {game.instructions ? (
            <p dir="auto" className="min-w-0 text-body text-foreground">{game.instructions}</p>
          ) : (
            <p className="text-body text-muted-foreground">{t("activity.game.label")}</p>
          )}
        </div>
        {data && data.attempts > 0 && (
          <p className="flex items-center gap-1.5 text-caption font-semibold tabular-nums text-foreground" role="status">
            <Trophy weight="fill" className="size-4 text-warning-500" aria-hidden />
            {max
              ? t("activity.game.bestOf", { best: fmt(data.bestScore), max: fmt(max) })
              : t("activity.game.best", { best: fmt(data.bestScore) })}
          </p>
        )}
      </div>
      {last != null && (
        <p className="text-caption text-muted-foreground" role="status">
          {save.isError
            ? t("activity.game.saveFailed")
            : save.isPending
              ? t("activity.game.saving")
              : t("activity.game.scored", { score: fmt(last) })}
        </p>
      )}
      <HtmlSlideIframe
        html={game.html}
        measure="content"
        minHeight={420}
        title={slide.title}
        lang={i18n.language}
        className="block rounded-lg border border-border bg-card"
        onComplete={(r) => {
          setLast(typeof r.score === "number" ? r.score : 0);
          save.mutate(r);
        }}
      />
    </div>
  );
}
