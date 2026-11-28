import { useTranslation } from "react-i18next";
import { X } from "@phosphor-icons/react";

/** The 44px close control at the start of the quiz and result headers: back to the course page. */
export function FunQuizClose({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation("funQuiz");
  return (
    <button type="button" className="fun-quiz__close" aria-label={t("closeQuiz")} onClick={onClose}>
      <X aria-hidden="true" weight="bold" />
    </button>
  );
}
