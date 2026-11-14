import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Brain, CheckCircle } from "@phosphor-icons/react";
import { MyButton } from "@/components/design-system/button";
import { EmptyState, LoadErrorState, LoadingState } from "@/components/design-system/states";
import { fetchDueNotes, recordReview } from "@/lib/notes/api";
import { notePosition, recallHint } from "@/lib/notes/format";

/**
 * Recall, not rereading: the learner sees where a mark came from, tries to bring
 * it back, and only then sees it. Each mark returns later the better it is
 * remembered.
 */
export function NotebookReview({ instituteId, onDone }: { instituteId: string; onDone: () => void }) {
  const { t } = useTranslation("notebook");
  const queryClient = useQueryClient();
  const [revealed, setRevealed] = useState(false);
  const [doneCount, setDoneCount] = useState(0);
  const [index, setIndex] = useState(0);

  const due = useQuery({
    queryKey: ["notebook-due", instituteId],
    queryFn: () => fetchDueNotes(instituteId, 20),
    // One fixed list for this sitting, and a new one next time.
    staleTime: Infinity,
    gcTime: 0,
  });
  const answer = useMutation({
    mutationFn: ({ id, remembered }: { id: string; remembered: boolean }) => recordReview(id, remembered),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["notebook-due-count", instituteId] }),
  });

  if (due.isLoading) return <LoadingState variant="list" count={1} />;
  if (due.isError) return <LoadErrorState onRetry={() => due.refetch()} />;

  const notes = due.data ?? [];
  const note = notes[index];
  if (!note) {
    return (
      <div className="space-y-3">
        <EmptyState
          icon={CheckCircle}
          title={t("review.doneTitle")}
          description={t("review.doneBody", { count: doneCount })}
        />
        <div className="flex justify-center">
          <MyButton buttonType="secondary" scale="medium" onClick={onDone}>
            {t("review.back")}
          </MyButton>
        </div>
      </div>
    );
  }

  const position = notePosition(note, { page: (page) => t("pageNumber", { page }) });
  const prompt = note.quote_text?.trim() || note.note_text?.trim() || "";
  const hint = recallHint(prompt);
  const next = (remembered: boolean) => {
    answer.mutate({ id: note.id, remembered });
    setDoneCount((count) => count + 1);
    setRevealed(false);
    setIndex((i) => i + 1);
  };

  return (
    <section aria-label={t("review.title")} className="mx-auto max-w-xl space-y-4" data-notebook-review>
      <p className="text-caption text-neutral-500 tabular-nums">
        {t("review.progress", { current: index + 1, total: notes.length })}
      </p>
      <div className="space-y-3 rounded-xl border border-neutral-200 bg-white p-5">
        <div className="flex items-center gap-2 text-primary-500">
          <Brain size={20} weight="duotone" />
          <span className="text-caption font-medium text-neutral-500">
            {note.slide_title}
            {position ? ` · ${position}` : ""}
          </span>
        </div>
        {revealed ? (
          <div className="space-y-2">
            {note.quote_text && <blockquote className="border-s-2 border-warning-400 ps-3 text-body text-neutral-800">{note.quote_text}</blockquote>}
            {note.note_text && <p className="whitespace-pre-wrap text-body text-neutral-800">{note.note_text}</p>}
          </div>
        ) : (
          <div className="space-y-1">
            <p className="text-subtitle font-semibold text-neutral-900">{t("review.prompt")}</p>
            {hint && <p className="text-caption text-neutral-500">{t("review.hint", { hint })}</p>}
          </div>
        )}
      </div>
      {revealed ? (
        <div className="flex flex-wrap justify-end gap-2">
          <MyButton buttonType="secondary" scale="medium" onClick={() => next(false)}>
            {t("review.again")}
          </MyButton>
          <MyButton buttonType="primary" scale="medium" onClick={() => next(true)}>
            {t("review.remembered")}
          </MyButton>
        </div>
      ) : (
        <div className="flex justify-end">
          <MyButton buttonType="primary" scale="medium" onClick={() => setRevealed(true)}>
            {t("review.show")}
          </MyButton>
        </div>
      )}
    </section>
  );
}
