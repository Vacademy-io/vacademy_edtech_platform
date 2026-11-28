import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

interface QuizTimeWarningProps {
  onDismiss: () => void;
}

const QuizTimeWarning: React.FC<QuizTimeWarningProps> = ({ onDismiss }) => {
  const { t } = useTranslation("libraryCommonA");
  const [countdown, setCountdown] = useState(5);

  useEffect(() => {
    if (countdown <= 0) {
      onDismiss();
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown, onDismiss]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="mx-4 max-w-sm rounded-xl border border-orange-300 bg-orange-50 p-6 text-center shadow-xl">
        <div className="mb-3 text-4xl">⏰</div>
        <h2 className="mb-2 text-lg font-bold text-orange-800">{t("quizTimeWarning.title")}</h2>
        <p className="mb-4 text-sm text-orange-700">
          {t("quizTimeWarning.message")}
        </p>
        <button
          type="button"
          className="rounded-lg bg-orange-500 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-orange-600"
          onClick={onDismiss}
        >
          {t("quizTimeWarning.gotIt", { countdown })}
        </button>
      </div>
    </div>
  );
};

export default QuizTimeWarning;
