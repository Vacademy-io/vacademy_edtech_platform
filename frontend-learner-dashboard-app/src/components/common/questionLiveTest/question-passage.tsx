import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CaretDown, CaretUp } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { QuestionHtmlContent } from "./question-html-content";

interface QuestionPassageProps {
  /** `parent_rich_text.content` of the current question — the comprehension passage. */
  html?: string | null;
  className?: string;
}

/**
 * Comprehension passage shown above the question.
 *
 * Collapsible as a whole rather than height-capped with a "read more": sibling
 * sub-questions each carry their own copy of the same passage, so after the
 * first question the learner mostly wants it out of the way — one tap should
 * put the question back at the top of the screen, which matters most on a phone.
 * It opens by default on every new passage.
 */
export function QuestionPassage({ html, className }: QuestionPassageProps) {
  const { t } = useTranslation("questionTest");
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    setExpanded(true);
  }, [html]);

  if (!html || !html.trim()) return null;

  return (
    <div
      className={cn(
        "mb-4 overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50 md:mb-5",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 px-4 py-3 text-start transition-colors hover:bg-neutral-100"
      >
        <span className="text-3xs font-bold uppercase tracking-wide text-neutral-500">
          {t("questionPassage.label")}
        </span>
        <span className="flex-1 text-caption text-neutral-400">
          {expanded ? "" : t("questionPassage.tapToRead")}
        </span>
        {expanded ? (
          <CaretUp size={16} className="flex-none text-neutral-400" />
        ) : (
          <CaretDown size={16} className="flex-none text-neutral-400" />
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-4">
          {/* text-neutral-700 matches the question body below; a lighter support
              tone was unreadable on the tinted surface. */}
          {/* Tailwind's reset strips <p> margins, which ran a multi-paragraph
              passage together into one wall of text. */}
          <QuestionHtmlContent
            html={html}
            className="text-body leading-relaxed text-neutral-700 [&_img]:mx-auto [&_img]:h-auto [&_img]:max-w-full [&_p:last-child]:mb-0 [&_p]:mb-3"
          />
        </div>
      )}
    </div>
  );
}
