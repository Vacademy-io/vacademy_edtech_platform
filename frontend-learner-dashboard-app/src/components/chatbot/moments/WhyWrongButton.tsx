import { useTranslation } from "react-i18next";
import { Sparkle } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { useAvailableTutor, whyWrongPrompt, type WrongAnswerDetails } from "./tutor-moments";

export interface WhyWrongButtonProps {
  /**
   * What the learner can see, read when tapped. Return null to do nothing.
   * The button is passed in so callers can read text the card already shows
   * (see `readWhyWrongPart`).
   */
  getDetails: (button: HTMLButtonElement) => WrongAnswerDetails | null;
  /** Run before the chat opens, e.g. close a modal sheet that would cover it. */
  onBeforeAsk?: () => void;
  className?: string;
}

/**
 * "Why was I wrong?" beside a wrong answer whose correct answer is ALREADY
 * shown. Sends the question, both answers and any explanation, asking the
 * tutor to explain the mistake and set a similar practice question. Callers
 * must only render it once the answer key is visible — never on an open or
 * unrevealed graded item.
 */
export function WhyWrongButton({ getDetails, onBeforeAsk, className }: WhyWrongButtonProps) {
  const { t } = useTranslation("chatFeatureB");
  const tutor = useAvailableTutor();
  if (!tutor) return null;
  return (
    <button
      type="button"
      onClick={(e) => {
        const details = getDetails(e.currentTarget);
        if (!details) return;
        const prompt = whyWrongPrompt(t, details);
        if (onBeforeAsk) {
          onBeforeAsk();
          // Let a closing sheet release focus and pointer events first.
          window.setTimeout(() => tutor.openAndSend(prompt), 200);
        } else {
          tutor.openAndSend(prompt);
        }
      }}
      className={cn(
        "inline-flex min-h-9 items-center gap-1.5 rounded-full border border-primary-200 bg-primary-50 px-3 text-caption font-medium text-primary-500 transition-colors hover:bg-primary-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <Sparkle aria-hidden weight="fill" className="size-3.5 shrink-0" />
      {t("moments.whyWrong.button")}
    </button>
  );
}
