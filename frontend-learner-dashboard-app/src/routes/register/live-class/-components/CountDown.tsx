import React, { useEffect, useState } from "react";
import dayjs from "dayjs";
import { useTranslation } from "react-i18next";

interface TimerProps {
  startTime: string;
}

const TimeUnit: React.FC<{ value: string; label: string }> = ({
  value,
  label,
}) => (
  <div className="flex flex-col items-center gap-1.5">
    <div className="relative bg-primary-500 text-primary-foreground rounded-xl w-14 h-14 sm:w-16 sm:h-16 flex items-center justify-center text-2xl sm:text-3xl font-bold shadow-md overflow-hidden">
      {/* Subtle top highlight */}
      <div className="absolute inset-x-0 top-0 h-1/2 bg-white/10 rounded-t-xl" />
      <span className="relative z-10">{value}</span>
    </div>
    <span className="text-caption sm:text-xs text-gray-400 uppercase tracking-widest font-medium">
      {label}
    </span>
  </div>
);

const TimeSeparator: React.FC = () => (
  <div className="flex flex-col items-center gap-1.5 pb-6">
    <div className="flex flex-col gap-1.5">
      <div className="w-1.5 h-1.5 rounded-full bg-primary-300" />
      <div className="w-1.5 h-1.5 rounded-full bg-primary-300" />
    </div>
  </div>
);

const CountdownTimer: React.FC<TimerProps> = ({ startTime }) => {
  const { t } = useTranslation("registrationA");
  const calculateTimeLeft = () => {
    if (!startTime) return null;
    const now = dayjs();
    const start = dayjs(startTime);
    if (!start.isValid() || now.isAfter(start)) return null;
    const diff = start.diff(now);
    return {
      days: Math.floor(diff / (1000 * 60 * 60 * 24)),
      hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
      minutes: Math.floor((diff / (1000 * 60)) % 60),
      seconds: Math.floor((diff / 1000) % 60),
    };
  };

  const [timeLeft, setTimeLeft] = useState(calculateTimeLeft());

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft(calculateTimeLeft());
    }, 1000);
    return () => clearInterval(timer);
  }, [startTime]);

  if (!timeLeft) {
    return (
      <div className="inline-flex items-center gap-2 bg-green-50 text-green-700 px-5 py-2.5 rounded-full text-sm font-semibold border border-green-200 shadow-sm">
        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
        {t("common.liveNow")}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <p className="text-sm text-gray-500 font-medium tracking-wide">
        {t("liveClass.countdown.startsIn")}
      </p>
      <div className="flex items-center gap-2 sm:gap-3">
        {timeLeft.days > 0 && (
          <>
            <TimeUnit value={String(timeLeft.days)} label={t("liveClass.countdown.days")} />
            <TimeSeparator />
          </>
        )}
        <TimeUnit
          value={String(timeLeft.hours).padStart(2, "0")}
          label={t("liveClass.countdown.hours")}
        />
        <TimeSeparator />
        <TimeUnit
          value={String(timeLeft.minutes).padStart(2, "0")}
          label={t("liveClass.countdown.mins")}
        />
        <TimeSeparator />
        <TimeUnit
          value={String(timeLeft.seconds).padStart(2, "0")}
          label={t("liveClass.countdown.secs")}
        />
      </div>
    </div>
  );
};

export default CountdownTimer;
