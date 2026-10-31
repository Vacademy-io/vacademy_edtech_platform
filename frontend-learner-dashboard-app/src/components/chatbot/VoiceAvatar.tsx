import React, { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

interface VoiceAvatarProps {
  avatarUrl?: string;
  assistantName: string;
  state: "idle" | "listening" | "speaking" | "processing";
  audioLevel: number; // 0-1
}

/**
 * The call's orb, in the institute's brand colours. It swells with the
 * learner's microphone level while listening, pulses outward while the tutor
 * speaks, and turns slowly while thinking. With reduced motion it holds still
 * and shows the state through its glow and the label instead.
 */
export const VoiceAvatar: React.FC<VoiceAvatarProps> = ({
  avatarUrl,
  assistantName,
  state,
  audioLevel,
}) => {
  const { t } = useTranslation("chatFeatureB");
  const reduceMotion = useReducedMotion();
  const STATE_LABELS: Record<VoiceAvatarProps["state"], string> = {
    idle: t("voiceAvatar.ready"),
    listening: t("voiceAvatar.listening"),
    processing: t("voiceAvatar.thinking"),
    speaking: t("voiceAvatar.speaking"),
  };

  const level = Math.min(1, Math.max(0, audioLevel || 0));
  // Deterministic offsets so the bars read as a waveform, not noise.
  const barOffsets = useMemo(
    () => Array.from({ length: 7 }, (_, i) => 0.6 + 0.4 * Math.sin(i * 1.2)),
    [],
  );

  const initials = assistantName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const active = state === "listening" || state === "speaking";
  const orbScale = reduceMotion
    ? 1
    : state === "listening"
      ? 1 + level * 0.22
      : state === "speaking"
        ? 1 + level * 0.12
        : 1;
  const glowOpacity = state === "idle" ? 0.25 : active ? 0.35 + level * 0.55 : 0.4;

  return (
    <div className="flex flex-col items-center gap-section">
      <div className="relative flex size-48 items-center justify-center">
        {/* Soft brand glow; brighter with the voice level. */}
        <motion.div
          aria-hidden
          className="absolute inset-4 rounded-full bg-primary blur-2xl"
          animate={{ opacity: glowOpacity }}
          transition={{ duration: 0.15, ease: "linear" }}
        />

        {/* Speaking: rings pulse outward from the orb. */}
        {state === "speaking" &&
          !reduceMotion &&
          [0, 0.8].map((delay) => (
            <motion.div
              key={delay}
              aria-hidden
              className="absolute size-32 rounded-full border-2 border-primary-300"
              initial={{ scale: 1, opacity: 0.6 }}
              animate={{ scale: 1.5, opacity: 0 }}
              transition={{ duration: 1.6, ease: "easeOut", repeat: Infinity, delay }}
            />
          ))}

        {/* Thinking / connecting: a dashed ring turning slowly. */}
        {state === "processing" && (
          <motion.div
            aria-hidden
            className="absolute size-40 rounded-full border-2 border-dashed border-primary-300/70"
            animate={reduceMotion ? undefined : { rotate: 360 }}
            transition={{ duration: 6, ease: "linear", repeat: Infinity }}
          />
        )}

        {/* The orb itself, carrying the tutor's avatar. */}
        <motion.div
          className={cn(
            "relative z-10 flex size-32 items-center justify-center rounded-full bg-gradient-to-br from-primary-300 to-primary-500 shadow-lg",
            state === "listening" && "ring-4 ring-primary-200/40",
          )}
          animate={
            reduceMotion
              ? { scale: 1 }
              : state === "idle" || state === "processing"
                ? { scale: [1, 1.03, 1] }
                : { scale: orbScale }
          }
          transition={
            !reduceMotion && (state === "idle" || state === "processing")
              ? { duration: 3, ease: "easeInOut", repeat: Infinity }
              : { duration: 0.1, ease: "linear" }
          }
        >
          {/* Highlight, for a little depth. */}
          <span
            aria-hidden
            className="absolute start-6 top-4 size-10 rounded-full bg-white/25 blur-md"
          />
          <Avatar className="relative size-20 ring-4 ring-white/20 sm:size-24">
            <AvatarImage src={avatarUrl} alt={assistantName} />
            <AvatarFallback className="bg-primary text-xl font-semibold text-primary-foreground">
              {initials}
            </AvatarFallback>
          </Avatar>
        </motion.div>
      </div>

      {/* Waveform bars; still under reduced motion. */}
      <div aria-hidden className="flex h-8 items-end gap-1">
        {barOffsets.map((offset, i) => {
          const barScale =
            reduceMotion || !active ? 0.15 + 0.05 * Math.sin(i * 0.9) : level * offset;
          const height = Math.max(4, barScale * 32);
          return (
            <div
              key={i}
              className={cn(
                "w-1 rounded-full transition-all duration-100 motion-reduce:transition-none",
                state === "listening"
                  ? "bg-primary-300"
                  : state === "speaking"
                    ? "bg-primary"
                    : state === "processing"
                      ? "bg-primary/60"
                      : "bg-white/30",
              )}
              style={{ height: `${height}px` }} // design-lint-ignore: live audio level
            />
          );
        })}
      </div>

      {/* State label */}
      <p className="text-sm font-medium text-white/70">{STATE_LABELS[state]}</p>
    </div>
  );
};
