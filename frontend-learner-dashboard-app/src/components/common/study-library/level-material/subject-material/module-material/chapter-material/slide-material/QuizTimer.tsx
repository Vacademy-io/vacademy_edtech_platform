import React, { useEffect, useRef, useState } from "react";
import { quizSecondsLeft } from "./quiz-session";

interface QuizTimerProps {
  /** When the learner pressed Start. Time is read from this on every tick, so a
   * throttled or suspended page cannot stretch the clock. */
  startedAt: number;
  totalSeconds: number;
  onExpire: () => void;
  onWarn: () => void;
  /** Draws the clock instead of the standard pill (the Fun skin); the timing is the same. */
  render?: (secondsLeft: number, warning: boolean) => React.ReactNode;
}

const WARN_AT_SECONDS = 30;

const formatTime = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

const QuizTimer: React.FC<QuizTimerProps> = ({ startedAt, totalSeconds, onExpire, onWarn, render }) => {
  const [remaining, setRemaining] = useState(() =>
    quizSecondsLeft(startedAt, totalSeconds, Date.now())
  );
  const warnFiredRef = useRef(false);
  const expiredRef = useRef(false);
  const onExpireRef = useRef(onExpire);
  const onWarnRef = useRef(onWarn);
  onExpireRef.current = onExpire;
  onWarnRef.current = onWarn;

  useEffect(() => {
    if (totalSeconds <= 0) return;
    warnFiredRef.current = false;
    expiredRef.current = false;

    const interval = setInterval(() => {
      const next = quizSecondsLeft(startedAt, totalSeconds, Date.now());
      setRemaining(next);

      if (next <= WARN_AT_SECONDS && next > 0 && totalSeconds > WARN_AT_SECONDS && !warnFiredRef.current) {
        warnFiredRef.current = true;
        onWarnRef.current();
      }

      if (next <= 0 && !expiredRef.current) {
        expiredRef.current = true;
        clearInterval(interval);
        onExpireRef.current();
      }
    }, 250);

    return () => clearInterval(interval);
  }, [startedAt, totalSeconds]);
  const isWarning = remaining <= 120; // orange when ≤ 2 min
  if (render) return <>{render(remaining, isWarning)}</>;

  return (
    <div
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-sm font-semibold ${
        isWarning
          ? "border-orange-300 bg-orange-50 text-orange-700"
          : "border-gray-200 bg-white text-slate-700"
      }`}
    >
      <svg
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      {formatTime(remaining)}
    </div>
  );
};

export default QuizTimer;
