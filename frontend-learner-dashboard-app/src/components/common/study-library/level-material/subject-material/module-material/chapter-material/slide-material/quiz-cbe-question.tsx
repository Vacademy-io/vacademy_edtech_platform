/**
 * A Spreadsheet & Written Response (CBE_RESPONSE) question while a quiz is being
 * answered: the scenario beside the requirements and the answer workspace (one tab
 * per part), as on a CBE question slide. There is no check here: the answer goes
 * with the quiz submit and is marked by AI after it (see quiz-cbe.ts).
 */
import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { DesktopTower } from "@phosphor-icons/react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { CbeWorkspace, type CbeWorkspaceHandle } from "@/components/cbe/CbeWorkspace";
import { CbeStringsProvider } from "@/components/cbe/cbe-strings";
import { cbeTotalMarks, htmlToPlainText, parseCbeConfig } from "@/components/cbe/types";
import { useLearnerCbeStrings } from "@/lib/cbe/learner-cbe-strings";
import { cn } from "@/lib/utils";
import { parseCbeQuizAnswer, serializeCbeQuizAnswer } from "./quiz-cbe";

export type QuizCbeQuestionHandle = {
  /**
   * Saves the cell still being typed in and returns the answer as the answers map keeps
   * it (JSON text, or undefined when nothing is written). Null when there is no workspace.
   */
  commit: () => string | undefined | null;
};

type Props = {
  scenarioHtml: string;
  requirementHtml: string;
  autoEvaluationJson?: string;
  /** The answers-map value for this question. */
  value: unknown;
  onChange: (value: string | undefined) => void;
  /** Renders maths in the scenario and requirements, as the rest of the quiz does. */
  renderHtml: (html: string) => string;
};

const hasVisibleHtml = (html: string | null | undefined): boolean =>
  !!html && (htmlToPlainText(html) !== "" || /<(img|table|svg)\b/i.test(html));

export const QuizCbeQuestion = forwardRef<QuizCbeQuestionHandle, Props>(function QuizCbeQuestion(
  { scenarioHtml, requirementHtml, autoEvaluationJson, value, onChange, renderHtml },
  ref,
) {
  const { t } = useTranslation("libraryCommonB");
  const cbeStrings = useLearnerCbeStrings();
  const workspaceRef = useRef<CbeWorkspaceHandle>(null);
  const config = useMemo(() => parseCbeConfig(autoEvaluationJson), [autoEvaluationJson]);
  const answer = useMemo(() => parseCbeQuizAnswer(value), [value]);
  const totalMarks = cbeTotalMarks(config);

  useImperativeHandle(
    ref,
    () => ({
      commit: () => {
        const handle = workspaceRef.current;
        if (!handle) return null;
        return serializeCbeQuizAnswer(handle.commit(), config);
      },
    }),
    [config],
  );

  if (!config) {
    return <p className="text-body text-neutral-500">{t("cbeSlide.missingConfig")}</p>;
  }

  const hasScenario = hasVisibleHtml(scenarioHtml);

  return (
    <CbeStringsProvider value={cbeStrings}>
      <div className="flex w-full flex-col gap-4" data-cbe-quiz-question="">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="text-caption font-medium text-neutral-600">
            {t("cbeSlide.typeLabel")}
          </Badge>
          {totalMarks > 0 && (
            <span className="text-caption text-neutral-500">{t("cbeSlide.totalMarks", { count: totalMarks })}</span>
          )}
        </div>

        <Alert className="border-info-200 bg-info-50 md:hidden">
          <DesktopTower size={16} />
          <AlertDescription className="text-caption text-neutral-700">{t("cbeSlide.desktopNotice")}</AlertDescription>
        </Alert>

        <div className={cn("grid min-w-0 gap-5", hasScenario && "lg:grid-cols-5")}>
          {hasScenario && (
            <section
              aria-label={t("cbeSlide.scenario")}
              className="min-w-0 rounded-xl border border-neutral-200 bg-neutral-50 p-4 lg:col-span-2 lg:max-h-reg-600 lg:overflow-auto"
            >
              <h3 className="mb-2 text-3xs font-bold uppercase tracking-wide text-neutral-500">
                {t("cbeSlide.scenario")}
              </h3>
              <div
                className="rich-text-content text-body leading-relaxed text-neutral-800"
                dangerouslySetInnerHTML={{ __html: renderHtml(scenarioHtml) }}
              />
            </section>
          )}

          <section className={cn("flex min-w-0 flex-col gap-4", hasScenario && "lg:col-span-3")}>
            {hasVisibleHtml(requirementHtml) && (
              <div className="flex flex-col gap-1.5">
                {hasScenario && (
                  <h3 className="text-3xs font-bold uppercase tracking-wide text-neutral-500">
                    {t("cbeSlide.requirements")}
                  </h3>
                )}
                <div
                  className="rich-text-content text-body text-neutral-800"
                  dangerouslySetInnerHTML={{ __html: renderHtml(requirementHtml) }}
                />
              </div>
            )}
            <CbeWorkspace
              ref={workspaceRef}
              config={config}
              value={answer}
              onChange={(next) => onChange(serializeCbeQuizAnswer(next, config))}
              height={440}
            />
          </section>
        </div>
      </div>
    </CbeStringsProvider>
  );
});
