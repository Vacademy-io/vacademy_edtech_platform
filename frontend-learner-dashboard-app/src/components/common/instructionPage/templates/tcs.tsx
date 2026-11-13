import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import SimplePDFViewer from "@/components/common/simple-pdf-viewer";
import { isUntimedPlayMode } from "@/lib/untimed-play-mode";
import { useLiveTestStore } from "@/stores/live-test-store";
import type { Assessment } from "@/types/assessment";
import type { ExamExperienceSettings } from "@/types/assessment-experience";
import type { ResolvedExamTheme } from "@/types/exam-theme";
import { bottomSafeAreaInset, topSafeAreaInset } from "@/utils/safe-area";
import { consoleChromeFor } from "@/components/common/questionLiveTest/layouts/console-chrome";
import { QuestionHtmlContent } from "@/components/common/questionLiveTest/question-html-content";
import { effectiveAnswerCommit } from "@/components/common/questionLiveTest/themes/layouts";
import { useExamSkinIsolation } from "@/components/common/questionLiveTest/themes/use-exam-skin-isolation";
import { BannerStrip } from "@/components/common/questionLiveTest/widgets/Banner";
import { CandidateBox } from "@/components/common/questionLiveTest/widgets/CandidateBox";
import { TcsGeneralInstructions } from "@/components/common/questionLiveTest/widgets/TcsGeneralInstructions";
import AssessmentStartModal from "../StartAssessment";
import { useLeaveBrief } from "../AssessmentNavbar";
import { parseInstructions } from "../instruction-attachments";

export interface TcsInstructionTemplateProps {
  theme: ResolvedExamTheme;
  assessmentInfo: Assessment;
  /** The institute's instruction rich text ("" when there is none). */
  instructionsHtml: string;
  examExperience: ExamExperienceSettings;
  agreed: boolean;
  onAgreedChange: (agreed: boolean) => void;
  /** Proctoring check-in, when the assessment is proctored. */
  proctorCheckIn?: ReactNode;
  /** Everything the page requires is done (declaration, check-in). */
  canStart: boolean;
}

const B = "examThemes.tcs.brief";

/**
 * Instruction page of the console themes. Page 1: general instructions in
 * our own words (the same text as the in-test Instructions dialog). Page 2:
 * this test's facts, the institute's instructions, the proctoring check-in,
 * a declaration and "I am ready to begin". The page that hosts it keeps the
 * loading, proctoring and start state; the start itself is the shared
 * AssessmentStartModal flow, here without its extra confirmation because the
 * declaration already confirms the start.
 */
export function TcsInstructionTemplate({
  theme,
  assessmentInfo,
  instructionsHtml,
  examExperience,
  agreed,
  onAgreedChange,
  proctorCheckIn,
  canStart,
}: TcsInstructionTemplateProps) {
  useExamSkinIsolation(theme.id);
  const { t, ready } = useTranslation("questionTest");
  const [page, setPage] = useState<1 | 2>(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const leave = useLeaveBrief();
  const immersiveActive = useLiveTestStore((s) => s.immersiveActive);
  const chrome = consoleChromeFor(theme);

  const untimed = isUntimedPlayMode(assessmentInfo.play_mode);
  const durationMinutes = untimed ? 0 : assessmentInfo.duration;
  const showAttempts =
    assessmentInfo.play_mode !== "PRACTICE" && assessmentInfo.play_mode !== "MOCK";

  const { cleanHtml, attachments } = useMemo(
    () => parseInstructions(instructionsHtml, t(`${B}.attachment`)),
    [instructionsHtml, t],
  );
  const hasInstructionText = cleanHtml.replace(/<[^>]+>/g, "").trim() !== "";

  // Each page opens at its top.
  useEffect(() => {
    scrollRef.current?.scrollTo?.({ top: 0 });
  }, [page]);

  return (
    <div
      data-exam-theme={theme.id}
      data-exam-theme-family={theme.family}
      className="tcs-root tcs-brief"
      style={{ // design-lint-ignore: dynamic safe-area inset padding
        paddingTop: topSafeAreaInset(immersiveActive),
      }}
    >
      {/* The text namespace loads on demand; draw nothing until it has. */}
      {ready && (
        <>
          <BannerStrip bannerStyle={chrome.bannerStyle} />
          <div className="tcs-brief__body">
            <main className="tcs-brief__main">
              <h1 className="tcs-brief__title">
                {page === 1 ? t(`${B}.title`) : t(`${B}.aboutTitle`)}
              </h1>
              <div ref={scrollRef} className="tcs-brief__scroll">
                <div className="tcs-brief__candidate-compact">
                  <CandidateBox compact />
                </div>
                {page === 1 ? (
                  <div className="tcs-brief__text">
                    <p className="tcs-brief__lead">{t(`${B}.readCarefully`)}</p>
                    <h2 className="tcs-brief__heading">{t(`${B}.generalTitle`)}</h2>
                    <TcsGeneralInstructions
                      theme={theme}
                      answerCommit={effectiveAnswerCommit(theme)}
                      submitLocked={theme.policy.earlySubmit === "disabled-until-end" && !untimed}
                      durationMinutes={durationMinutes}
                      calculator={chrome.calculatorSlot && examExperience.calculator.enabled}
                    />
                  </div>
                ) : (
                  <div className="tcs-brief__text">
                    <h2 className="tcs-brief__heading">{assessmentInfo.name}</h2>
                    <ul className="tcs-brief__facts">
                      <li>
                        {durationMinutes > 0
                          ? t(`${B}.duration`, { count: durationMinutes })
                          : t(`${B}.untimed`)}
                      </li>
                      <li>
                        {assessmentInfo.can_switch_section
                          ? t(`${B}.sectionSwitchYes`)
                          : t(`${B}.sectionSwitchNo`)}
                      </li>
                      {assessmentInfo.preview_time > 0 && <li>{t(`${B}.preview`)}</li>}
                      {showAttempts && (
                        <li>
                          {t(`${B}.attempt`, {
                            used: (assessmentInfo.created_attempts ?? 0) + 1,
                            max: assessmentInfo.assessment_attempts ?? 1,
                          })}
                        </li>
                      )}
                    </ul>

                    <h3 className="tcs-brief__subheading">
                      {t("examThemes.tcs.instructions.testTitle")}
                    </h3>
                    {hasInstructionText ? (
                      <QuestionHtmlContent
                        html={cleanHtml}
                        className="tcs-brief__institute richtext-content"
                      />
                    ) : (
                      attachments.length === 0 && (
                        <p className="tcs-brief__muted">{t(`${B}.noTestInstructions`)}</p>
                      )
                    )}
                    {attachments.length > 0 && (
                      <ul className="tcs-brief__attachments">
                        {attachments.map((attachment) => (
                          <li key={attachment.url}>
                            <a href={attachment.url} target="_blank" rel="noopener noreferrer">
                              {attachment.fileName}
                            </a>
                            {attachment.isPdf && (
                              <div className="tcs-brief__pdf">
                                <SimplePDFViewer pdfUrl={attachment.url} />
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                {/* Stays mounted on both pages, so a finished camera check
                    is not lost when the learner goes back to page 1. */}
                {proctorCheckIn && (
                  <div className="tcs-brief__proctor" hidden={page !== 2}>
                    {proctorCheckIn}
                  </div>
                )}
                {page === 2 && (
                  <label className="tcs-brief__declaration">
                    <input
                      type="checkbox"
                      checked={agreed}
                      onChange={(event) => onAgreedChange(event.target.checked)}
                    />
                    <span>{t(`${B}.declaration`)}</span>
                  </label>
                )}
              </div>
              <div className="tcs-brief__nav">
                {page === 1 ? (
                  <>
                    <button type="button" className="tcs-btn tcs-btn--secondary" onClick={leave}>
                      {t(`${B}.leave`)}
                    </button>
                    <button
                      type="button"
                      className="tcs-btn tcs-btn--secondary"
                      onClick={() => setPage(2)}
                    >
                      {t(`${B}.next`)}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="tcs-btn tcs-btn--secondary"
                      onClick={() => setPage(1)}
                    >
                      {t(`${B}.previous`)}
                    </button>
                    <div className="tcs-brief__start">
                      <AssessmentStartModal
                        disabled={!canStart}
                        confirm={false}
                        renderTrigger={({ onClick, disabled, isLoading }) => (
                          <button
                            type="button"
                            className="tcs-btn tcs-btn--ready"
                            data-testid="tcs-ready"
                            disabled={disabled}
                            onClick={onClick}
                          >
                            {isLoading ? t(`${B}.starting`) : t(`${B}.ready`)}
                          </button>
                        )}
                      />
                      {!agreed && <p className="tcs-brief__hint">{t(`${B}.tickToBegin`)}</p>}
                    </div>
                    <span className="tcs-brief__nav-spacer" aria-hidden="true" />
                  </>
                )}
              </div>
            </main>
            <aside className="tcs-brief__side">
              <CandidateBox />
            </aside>
          </div>
          <footer
            className="tcs-footer tcs-brief__footer"
            style={{ // design-lint-ignore: dynamic safe-area inset padding
              paddingBottom: bottomSafeAreaInset(immersiveActive),
            }}
          />
        </>
      )}
    </div>
  );
}
