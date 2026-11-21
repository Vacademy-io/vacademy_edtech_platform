import { useMemo } from "react";
import { announceSlideCompleted } from "@/services/slide-engagement";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, ChartBar } from "@phosphor-icons/react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getBackendErrorMessage } from "@/utils/error-message";
import type { Slide } from "@/hooks/study-library/use-slides";
import { useDiscussionContext } from "../discussion/use-discussion";
import { fetchPoll, votePoll, type PollView } from "./activity-api";
import { parsePollSlide, votePercent } from "./activity-utils";

/**
 * A poll: one question, a few choices, no right answer. Voting completes the slide
 * (on the server). Results show per the teacher's setting, for the learner's own batch.
 */
export function PollSlide({ slide }: { slide: Slide }) {
  const { t } = useTranslation("studyContent");
  const queryClient = useQueryClient();
  const poll = useMemo(
    () => parsePollSlide(slide.document_slide?.published_data),
    [slide.document_slide?.published_data]
  );
  const { ids, ready } = useDiscussionContext(slide.id);
  const key = ["slide-poll", slide.id, ids.packageSessionId ?? ""];
  const view = useQuery({
    queryKey: key,
    queryFn: () => fetchPoll(ids),
    enabled: ready && !!poll,
    staleTime: 15_000,
  });
  const vote = useMutation({
    mutationFn: (optionId: string) => votePoll(ids, optionId),
    onSuccess: (data: PollView) => {
      const first = !view.data?.myOptionId;
      queryClient.setQueryData(key, data);
      if (first && ids.chapterId) queryClient.invalidateQueries({ queryKey: ["slides", ids.chapterId] });
      if (first) announceSlideCompleted(slide.id);
    },
    onError: (error) => toast.error(getBackendErrorMessage(error, t("activity.poll.voteFailed"))),
  });

  if (!poll) {
    return (
      <div className="flex h-full w-full items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">{t("activity.unavailable")}</p>
      </div>
    );
  }

  const data = view.data;
  const mine = vote.isPending ? vote.variables : data?.myOptionId;
  const showResults = !!data?.resultsVisible;
  const canVote = data ? data.canVote : false;

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary-500">
          <ChartBar size={20} weight="duotone" aria-hidden />
        </span>
        <div className="min-w-0 space-y-1">
          <p className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
            {t("activity.poll.label")}
          </p>
          <h2 dir="auto" className="whitespace-pre-wrap text-h3 font-semibold text-foreground">
            {poll.question}
          </h2>
        </div>
      </div>

      <fieldset className="space-y-2" disabled={!canVote || vote.isPending || view.isPending}>
        <legend className="sr-only">{poll.question}</legend>
        {poll.options.map((o) => {
          const selected = mine === o.id;
          const n = data?.counts?.[o.id] ?? 0;
          const pct = votePercent(n, data?.totalVotes ?? 0);
          return (
            <button
              key={o.id}
              type="button"
              aria-pressed={selected}
              onClick={() => !selected && vote.mutate(o.id)}
              className={cn(
                "relative w-full overflow-hidden rounded-lg border p-3 text-start text-body transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300",
                selected ? "border-primary-400 bg-primary-50" : "border-border bg-card hover:border-primary-200",
                "disabled:cursor-default"
              )}
            >
              {showResults && (
                <span
                  aria-hidden
                  className={cn("absolute inset-y-0 start-0", selected ? "bg-primary-100" : "bg-muted")}
                  // Width is the live vote share.
                  style={{ width: `${pct}%` }} // design-lint-ignore: data-driven bar width
                />
              )}
              <span className="relative flex items-center justify-between gap-3">
                <span dir="auto" className="flex min-w-0 items-center gap-2 text-foreground">
                  {selected && <CheckCircle weight="fill" className="size-4 shrink-0 text-primary-500" aria-hidden />}
                  <span className="min-w-0 break-words">{o.text}</span>
                </span>
                {showResults && (
                  <span className="shrink-0 text-caption font-semibold tabular-nums text-muted-foreground">
                    {pct}%
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </fieldset>

      <p className="text-caption text-muted-foreground" role="status">
        {view.isPending
          ? t("activity.loading")
          : view.isError
            ? t("activity.loadFailed")
            : !data?.myOptionId
              ? t("activity.poll.pick")
              : showResults
                ? t("activity.poll.votes", { count: data.totalVotes })
                : t("activity.poll.thanksHidden")}
        {data?.myOptionId && canVote && ` ${t("activity.poll.canChange")}`}
      </p>
    </div>
  );
}
