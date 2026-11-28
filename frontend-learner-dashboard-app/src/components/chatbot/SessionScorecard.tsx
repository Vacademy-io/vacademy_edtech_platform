import React from "react";
import { Check, ArrowUpRight, X } from "@phosphor-icons/react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

interface SessionScorecardProps {
  summary: {
    /** 0-100 percentage; null for doubt calls, which get a recap, not a grade. */
    score?: number | null;
    total_questions?: number;
    strengths?: string[];
    areas_to_improve?: string[];
    feedback?: string;
  };
  mode: string;
  onClose: () => void;
  onStartNew: () => void;
}

export const SessionScorecard: React.FC<SessionScorecardProps> = ({
  summary,
  mode,
  onClose,
  onStartNew,
}) => {
  const { t } = useTranslation("chatFeatureB");
  const MODE_DISPLAY: Record<string, string> = {
    voice_interview: t("voiceModeLabels.interview"),
    voice_doubt: t("voiceModeLabels.doubt"),
    voice_oral_test: t("voiceModeLabels.oralTest"),
  };
  const { score, strengths, areas_to_improve, feedback } = summary;
  const hasScore = typeof score === "number";

  // The server sends a 0-100 percentage. It used to be divided by the question
  // count, so 80 with 5 questions showed "80/5" and filled the ring 1600%.
  const scorePercent = hasScore ? Math.max(0, Math.min(100, Math.round(score))) : 0;
  const circumference = 2 * Math.PI * 44; // r=44
  const strokeDashoffset = circumference - (circumference * scorePercent) / 100;

  return (
    <motion.div
      className="absolute inset-0 z-10 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        className="w-full max-w-md rounded-2xl bg-slate-900 border border-white/10 p-6 shadow-2xl max-h-screen-85 overflow-y-auto"
        initial={{ scale: 0.85, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.85, opacity: 0 }}
        transition={{ type: "spring", duration: 0.4 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-semibold text-white">
            {t("sessionScorecard.summaryTitle", {
              mode: MODE_DISPLAY[mode] ?? t("voiceModeLabels.sessionFallback"),
            })}
          </h3>
          <button
            className="text-white/40 hover:text-white/70 transition-colors"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Score circle */}
        {hasScore && (
          <div className="flex justify-center mb-6">
            <div className="relative w-28 h-28">
              <svg className="w-28 h-28 -rotate-90" viewBox="0 0 100 100">
                <circle
                  cx="50"
                  cy="50"
                  r="44"
                  fill="none"
                  stroke="rgba(255,255,255,0.1)"
                  strokeWidth="6"
                />
                <motion.circle
                  cx="50"
                  cy="50"
                  r="44"
                  fill="none"
                  stroke={scorePercent >= 70 ? "hsl(var(--success-500))" : scorePercent >= 40 ? "hsl(var(--warning-500))" : "hsl(var(--danger-500))"}
                  strokeWidth="6"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  initial={{ strokeDashoffset: circumference }}
                  animate={{ strokeDashoffset }}
                  transition={{ duration: 1, ease: "easeOut", delay: 0.2 }}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-bold text-white">
                  {`${scorePercent}%`}
                </span>
                <span className="text-caption text-white/40 uppercase tracking-wider">{t("sessionScorecard.score")}</span>
              </div>
            </div>
          </div>
        )}

        {/* Strengths */}
        {strengths && strengths.length > 0 && (
          <div className="mb-4 space-y-2">
            <h4 className="text-xs font-semibold text-green-400 uppercase tracking-wider">
              {t("sessionScorecard.strengths")}
            </h4>
            <ul className="space-y-1.5">
              {strengths.map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-white/80">
                  <Check className="h-4 w-4 text-green-400 shrink-0 mt-0.5" />
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Areas to improve */}
        {areas_to_improve && areas_to_improve.length > 0 && (
          <div className="mb-4 space-y-2">
            <h4 className="text-xs font-semibold text-amber-400 uppercase tracking-wider">
              {t("sessionScorecard.areasToImprove")}
            </h4>
            <ul className="space-y-1.5">
              {areas_to_improve.map((a, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-white/80">
                  <ArrowUpRight className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                  <span>{a}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Feedback */}
        {feedback && (
          <div className="mb-5 space-y-2">
            <h4 className="text-xs font-semibold text-white/50 uppercase tracking-wider">
              {t("sessionScorecard.feedback")}
            </h4>
            <p className="text-sm text-white/70 leading-relaxed">{feedback}</p>
          </div>
        )}

        {/* Buttons */}
        <div className="flex gap-3 pt-2">
          <Button
            variant="outline"
            className="flex-1 border-white/10 bg-transparent text-white/70 hover:bg-white/10 hover:text-white"
            onClick={onClose}
          >
            {t("sessionScorecard.close")}
          </Button>
          <Button className="flex-1" onClick={onStartNew}>
            {t("sessionScorecard.startNewSession")}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
};
