import { useTranslation } from "react-i18next";
import { useCandidate } from "./use-console-data";

/** Photo (or initial) and the learner's name, top of the right panel. */
export function CandidateBox({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation("questionTest");
  const { name, photoUrl } = useCandidate();
  const shownName = name || t("examThemes.tcs.candidate");
  const initial = shownName.trim().charAt(0).toUpperCase();
  return (
    <div className={compact ? "tcs-candidate tcs-candidate--compact" : "tcs-candidate"}>
      <span className="tcs-candidate__photo">
        {photoUrl ? <img src={photoUrl} alt="" /> : <span aria-hidden="true">{initial}</span>}
      </span>
      <span className="tcs-candidate__name">{shownName}</span>
    </div>
  );
}
