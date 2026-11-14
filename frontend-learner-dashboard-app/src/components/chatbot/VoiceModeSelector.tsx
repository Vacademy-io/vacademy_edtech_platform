import React, { useEffect, useState } from "react";
import { Briefcase, ChatCircle, FileDashed } from "@phosphor-icons/react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type VoiceMode = "voice_interview" | "voice_doubt" | "voice_oral_test";

interface VoiceModeSelectorProps {
  open: boolean;
  onClose: () => void;
  onSelect: (mode: VoiceMode, language: string, topic?: string) => void;
  enabledModes?: string[];
  /** Topic taken from the student's current chapter/course; editable here. */
  defaultTopic?: string;
  defaultLanguage?: string;
}

export const VoiceModeSelector: React.FC<VoiceModeSelectorProps> = ({
  open,
  onClose,
  onSelect,
  enabledModes,
  defaultTopic = "",
  defaultLanguage = "en-IN",
}) => {
  const { t } = useTranslation("chatFeatureB");
  const [selectedMode, setSelectedMode] = useState<VoiceMode | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState(defaultLanguage);
  const [topic, setTopic] = useState(defaultTopic);

  const MODES: {
    key: VoiceMode;
    label: string;
    description: string;
    icon: React.ElementType;
  }[] = [
    {
      key: "voice_interview",
      label: t("voiceModeSelector.modeInterviewLabel"),
      description: t("voiceModeSelector.modeInterviewDescription"),
      icon: Briefcase,
    },
    {
      key: "voice_doubt",
      label: t("voiceModeSelector.modeDoubtLabel"),
      description: t("voiceModeSelector.modeDoubtDescription"),
      icon: ChatCircle,
    },
    {
      key: "voice_oral_test",
      label: t("voiceModeSelector.modeOralTestLabel"),
      description: t("voiceModeSelector.modeOralTestDescription"),
      icon: FileDashed,
    },
  ];

  const LANGUAGES = [
    { code: "en-IN", label: t("voiceModeSelector.languageEn") },
    { code: "hi-IN", label: t("voiceModeSelector.languageHi") },
    { code: "bn-IN", label: t("voiceModeSelector.languageBn") },
    { code: "ta-IN", label: t("voiceModeSelector.languageTa") },
    { code: "te-IN", label: t("voiceModeSelector.languageTe") },
    { code: "kn-IN", label: t("voiceModeSelector.languageKn") },
    { code: "ml-IN", label: t("voiceModeSelector.languageMl") },
    { code: "mr-IN", label: t("voiceModeSelector.languageMr") },
    { code: "gu-IN", label: t("voiceModeSelector.languageGu") },
    { code: "pa-IN", label: t("voiceModeSelector.languagePa") },
    { code: "od-IN", label: t("voiceModeSelector.languageOr") },
  ];

  const visibleModes = enabledModes
    ? MODES.filter((m) => enabledModes.includes(m.key))
    : MODES;

  // Re-seed each time the dialog opens: the student may have moved to another
  // chapter since it was last shown.
  useEffect(() => {
    if (!open) return;
    setTopic(defaultTopic);
    setSelectedLanguage(defaultLanguage);
    setSelectedMode(visibleModes.length === 1 ? visibleModes[0]!.key : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultTopic, defaultLanguage]);

  const handleStart = () => {
    if (selectedMode) {
      onSelect(selectedMode, selectedLanguage, topic.trim() || undefined);
    }
  };

  const topicPlaceholder = selectedMode === "voice_interview"
    ? t("voiceModeSelector.topicPlaceholderInterview")
    : selectedMode === "voice_oral_test"
    ? t("voiceModeSelector.topicPlaceholderOralTest")
    : t("voiceModeSelector.topicPlaceholderDoubt");

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="w-full max-w-md mx-4 rounded-2xl bg-slate-900 border border-white/10 p-6 shadow-2xl"
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            transition={{ duration: 0.2 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-white mb-1">{t("voiceModeSelector.title")}</h2>
            <p className="text-sm text-white/50 mb-5">
              {t("voiceModeSelector.subtitle")}
            </p>

            {/* Mode cards */}
            <div className="space-y-2 mb-5">
              {visibleModes.map((m) => {
                const Icon = m.icon;
                const isSelected = selectedMode === m.key;
                return (
                  <button
                    key={m.key}
                    className={cn(
                      "w-full flex items-start gap-3 p-3 rounded-xl text-start transition-all",
                      isSelected
                        ? "bg-primary/20 border border-primary/50 ring-1 ring-primary/30"
                        : "bg-white/5 border border-white/10 hover:bg-white/10",
                    )}
                    onClick={() => setSelectedMode(m.key)}
                  >
                    <div
                      className={cn(
                        "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                        isSelected ? "bg-primary/30 text-primary" : "bg-white/10 text-white/60",
                      )}
                    >
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <p
                        className={cn(
                          "text-sm font-medium",
                          isSelected ? "text-white" : "text-white/80",
                        )}
                      >
                        {m.label}
                      </p>
                      <p className="text-xs text-white/40 mt-0.5">{m.description}</p>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Topic — prefilled from the student's current chapter/course */}
            {selectedMode && (
              <div className="mb-4">
                <label className="text-xs text-white/50 font-medium mb-1.5 block">
                  {selectedMode === "voice_interview"
                    ? t("voiceModeSelector.topicLabelInterview")
                    : selectedMode === "voice_oral_test"
                      ? t("voiceModeSelector.topicLabelOralTest")
                      : t("voiceModeSelector.topicLabelDoubt")}
                </label>
                <input
                  type="text"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder={topicPlaceholder}
                  className="w-full rounded-lg bg-white/5 border border-white/10 text-white text-sm px-3 py-2 outline-none focus:border-primary/50 placeholder:text-white/25"
                />
                <p className="text-caption text-white/30 mt-1">
                  {topic.trim()
                    ? t("voiceModeSelector.topicHelperEditable")
                    : t("voiceModeSelector.topicHelperOptional")}
                </p>
              </div>
            )}

            {/* Language picker */}
            <div className="mb-5 space-y-1.5">
              <label className="text-xs text-white/50 font-medium block">
                {t("voiceModeSelector.languageLabel")}
              </label>
              <select
                value={selectedLanguage}
                onChange={(e) => setSelectedLanguage(e.target.value)}
                className="w-full rounded-lg bg-white/5 border border-white/10 text-white text-sm px-3 py-2 outline-none focus:border-primary/50 appearance-none cursor-pointer"
              >
                {LANGUAGES.map((lang) => (
                  <option
                    key={lang.code}
                    value={lang.code}
                    className="bg-slate-900 text-white"
                  >
                    {lang.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Buttons */}
            <div className="flex gap-3">
              <Button
                variant="ghost"
                className="flex-1 border border-white/20 bg-white/5 text-white/80 hover:bg-white/15 hover:text-white"
                onClick={onClose}
              >
                {t("voiceModeSelector.cancel")}
              </Button>
              <Button
                className="flex-1"
                disabled={!selectedMode}
                onClick={handleStart}
              >
                {t("voiceModeSelector.start")}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
