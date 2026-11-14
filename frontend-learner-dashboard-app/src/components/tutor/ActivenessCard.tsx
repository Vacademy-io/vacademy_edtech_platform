import { useState } from "react";
import { Camera, CameraSlash, Info } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import type { ActivenessParts } from "@/lib/tutor/activeness";
import type { ActivenessStatus } from "@/hooks/useActiveness";

interface ActivenessCardProps {
  status: ActivenessStatus;
  score: number | null;
  parts: ActivenessParts;
  away: boolean;
  attachVideo: (el: HTMLVideoElement | null) => void;
  onEnable: () => void;
  onDisable: () => void;
}

const band = (score: number | null) =>
  score === null ? "text-neutral-500" : score >= 70 ? "text-success-700" : score >= 40 ? "text-warning-700" : "text-danger-600";

const PART_LABEL: Array<{ key: keyof ActivenessParts; label: string }> = [
  { key: "onScreen", label: "On screen" },
  { key: "listening", label: "Listening" },
  { key: "answering", label: "Answering" },
];

/**
 * The activeness score beside the teacher: a one-time consent ask, then a
 * small mirrored camera preview with the live score. Laptops / desktops only
 * (hidden below lg); nothing renders when there is no camera or the learner
 * said no, apart from a quiet way to turn it on.
 */
export const ActivenessCard: React.FC<ActivenessCardProps> = ({ status, score, parts, away, attachVideo, onEnable, onDisable }) => {
  const [showWhy, setShowWhy] = useState(false);
  if (status === "unavailable") return null;

  if (status === "off") {
    return (
      <div className="mt-2 hidden justify-end lg:flex">
        <button type="button" onClick={onEnable} className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-primary-500">
          <Camera className="size-3.5" /> Turn on activeness score
        </button>
      </div>
    );
  }

  if (status === "ask") {
    return (
      <div className="mt-2 hidden rounded-xl border border-primary-100 bg-primary-50 p-3 lg:block" role="region" aria-label="Activeness score">
        <div className="flex items-start gap-2">
          <Camera className="mt-0.5 size-4 shrink-0 text-primary-500" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-neutral-900">See your activeness score?</p>
            <p className="mt-0.5 text-xs text-neutral-600">
              Your camera checks that you are here and listening, and the teacher waits if you step away. The video stays on
              this device; only the score is saved.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" onClick={onEnable} className="rounded-full bg-primary-500 px-3 py-1 text-xs font-semibold text-white hover:bg-primary-400">
                Turn on camera
              </button>
              <button type="button" onClick={onDisable} className="rounded-full px-3 py-1 text-xs font-medium text-neutral-600 hover:bg-white">
                Not now
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2 hidden items-center gap-3 rounded-xl border border-neutral-200 bg-white p-2 lg:flex" role="region" aria-label="Activeness score">
      <div className="relative h-14 w-20 shrink-0 overflow-hidden rounded-lg bg-neutral-900">
        {/* Mirrored like a selfie view; muted and inline so autoplay is allowed. */}
        <video ref={attachVideo} muted playsInline autoPlay className="size-full -scale-x-100 object-cover" aria-label="Your camera" />
        {status === "starting" && (
          <span className="absolute inset-0 flex items-center justify-center text-xs text-white/80">Starting…</span>
        )}
        {away && status === "on" && (
          <span className="absolute inset-0 flex items-center justify-center bg-neutral-900/60 text-xs font-medium text-white">Paused</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className={cn("text-xl font-semibold tabular-nums", band(score))}>{score ?? "–"}</span>
          <span className="text-xs text-neutral-500">activeness</span>
          <button
            type="button"
            onClick={() => setShowWhy((v) => !v)}
            aria-expanded={showWhy}
            className="ms-auto rounded-full p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
            title="How this is worked out"
          >
            <Info className="size-3.5" />
          </button>
          <button type="button" onClick={onDisable} className="rounded-full p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600" title="Turn camera off">
            <CameraSlash className="size-3.5" />
          </button>
        </div>
        {showWhy ? (
          <ul className="mt-0.5 space-y-px text-xs text-neutral-600">
            {PART_LABEL.map(({ key, label }) => (
              <li key={key} className="flex justify-between gap-2">
                <span>{label}</span>
                <span className="tabular-nums">{parts[key] ?? "–"}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="truncate text-xs text-neutral-500">
            {status === "starting" ? "Loading the on-device model…" : away ? "The teacher is waiting for you" : "Stay on screen and answer when asked"}
          </p>
        )}
      </div>
    </div>
  );
};
