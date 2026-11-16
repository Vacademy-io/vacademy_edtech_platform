import { useTranslation } from "react-i18next";
import { User } from "@phosphor-icons/react";
import { useAssessmentStore } from "@/stores/assessment-store";
import { shouldShowEntireTimer } from "../engine/clock-logic";
import { useLiveTestEngine } from "../engine/live-test-engine-context";
import { ConsoleClock } from "./ConsoleClock";
import { useCandidate, useInstituteBrand } from "./use-console-data";

/**
 * White header of the NTA mock layout. The left slot, where the exam body
 * puts its own logo, carries the institute's logo and name; no exam body's
 * mark is ever drawn. On the right: the candidate photo, then Candidate
 * Name, Subject Name (the test's name) and Remaining Time as a pill.
 */
export function NtaHeader() {
  const { t } = useTranslation("questionTest");
  const { name: instituteName, logoUrl } = useInstituteBrand();
  const { name, photoUrl } = useCandidate();
  const { assessmentName, playMode } = useLiveTestEngine();
  const timeLeft = useAssessmentStore((s) => s.entireTestTimer);
  const showClock = shouldShowEntireTimer(playMode, timeLeft);

  return (
    <header className="nta-header">
      <span className="nta-header__brand">
        {logoUrl && <img className="nta-header__logo" src={logoUrl} alt="" />}
        {instituteName && <span className="nta-header__name">{instituteName}</span>}
      </span>
      <div className="nta-candidate">
        <span className="nta-candidate__photo">
          {photoUrl ? (
            <img src={photoUrl} alt="" />
          ) : (
            <User size={44} weight="fill" aria-hidden="true" />
          )}
        </span>
        <dl className="nta-candidate__rows">
          <div className="nta-candidate__row">
            <dt>{t("examThemes.tcs.candidateName")}</dt>
            <dd className="nta-candidate__value">{name || t("examThemes.tcs.candidate")}</dd>
          </div>
          <div className="nta-candidate__row">
            <dt>{t("examThemes.tcs.subjectName")}</dt>
            <dd className="nta-candidate__value">{assessmentName}</dd>
          </div>
          {showClock && (
            <div className="nta-candidate__row">
              <dt>{t("examThemes.tcs.remainingTime")}</dt>
              <dd>
                <ConsoleClock withLabel={false} />
              </dd>
            </div>
          )}
        </dl>
      </div>
    </header>
  );
}
