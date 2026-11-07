import { useTranslation } from "react-i18next";
import { useAssessmentStore } from "@/stores/assessment-store";
import { cn } from "@/lib/utils";

export function LongAnswerInput() {
  const { t } = useTranslation("questionTest");
  const { currentQuestion, answers, setAnswer, setQuestionState } =
    useAssessmentStore();
  if (!currentQuestion) {
    return null;
  }

  const currentAnswer = answers[currentQuestion.question_id]?.[0] || "";
  const wordCount = currentAnswer.trim()
    ? currentAnswer.trim().split(/\s+/).length
    : 0;

  const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setAnswer(currentQuestion.question_id, [event.target.value]);
    setQuestionState(currentQuestion.question_id, { isVisited: true });
  };

  return (
    <div>
      <div className="mb-2 flex items-baseline gap-2">
        <p className="text-3xs font-bold uppercase tracking-wide text-neutral-400">
          {t("common.yourAnswer")}
        </p>
        <span className="flex-1" />
        <span className="font-mono text-2xs tabular-nums text-neutral-400">
          {t("longAnswer.wordCount", { count: wordCount })}
        </span>
      </div>
      <textarea
        value={currentAnswer}
        onChange={handleChange}
        placeholder={t("longAnswer.placeholder")}
        aria-label={t("common.yourAnswer")}
        rows={7}
        // Copy/cut/paste stay blocked here for the same reason as the rest of
        // the live test — pasted answers defeat the proctoring rules.
        onCopy={(event) => event.preventDefault()}
        onCut={(event) => event.preventDefault()}
        onPaste={(event) => event.preventDefault()}
        className={cn(
          "w-full resize-y rounded-xl border-2 p-4 text-body leading-relaxed text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 md:text-subtitle",
          currentAnswer ? "border-primary-500" : "border-neutral-200",
        )}
      />
    </div>
  );
}
