import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Clock } from "@phosphor-icons/react";
import { Preferences } from "@capacitor/preferences";

interface Props {
  slideId: string;
  totalMinutes: number;
  onExpire: () => void;
}

const MS_PER_MIN = 60_000;

function fmt(ms: number): string {
  if (ms <= 0) return "00:00";
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Countdown timer that:
 *  - persists `startedAt` per-slide in Capacitor Preferences so refresh continues
 *    the same session
 *  - calls onExpire exactly once when the time runs out
 *  - shows amber under 5 min, red under 1 min
 */
export function SessionTimer({ slideId, totalMinutes, onExpire }: Props) {
  const { t } = useTranslation("libraryCommonA");
  const [now, setNow] = useState(() => Date.now());
  const [startedAt, setStartedAt] = useState<number | null>(null);
  // Snapshot the duration at session start. If the admin edits the question's
  // sessionTimeMinutes while a learner is mid-attempt, we keep the deadline
  // the learner originally agreed to — prevents the timer jumping forward or
  // backward unexpectedly.
  const [snapshotMinutes, setSnapshotMinutes] = useState<number | null>(null);
  const expiredRef = useRef(false);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  // Hydrate / initialize from Preferences. Value is JSON
  // {startedAt, totalMinutes}; a bare numeric string is also accepted for
  // back-compat with sessions started before this upgrade.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const k = `coding_session_started_${slideId}`;
      try {
        const { value } = await Preferences.get({ key: k });
        if (cancelled) return;
        if (value) {
          let parsedStart: number | null = null;
          let parsedMins: number | null = null;
          try {
            const obj = JSON.parse(value);
            if (obj && typeof obj === "object") {
              if (Number.isFinite(obj.startedAt)) parsedStart = Number(obj.startedAt);
              if (Number.isFinite(obj.totalMinutes)) parsedMins = Number(obj.totalMinutes);
            }
          } catch {
            const n = Number(value);
            if (Number.isFinite(n)) parsedStart = n;
          }
          if (parsedStart != null) {
            setStartedAt(parsedStart);
            setSnapshotMinutes(parsedMins ?? totalMinutes);
            return;
          }
        }
        const ts = Date.now();
        await Preferences.set({
          key: k,
          value: JSON.stringify({ startedAt: ts, totalMinutes }),
        });
        if (!cancelled) {
          setStartedAt(ts);
          setSnapshotMinutes(totalMinutes);
        }
      } catch (e) {
        // Preferences may not be available in pure web; fall back to in-memory.
        console.warn("[SessionTimer] Preferences unavailable", e);
        if (!cancelled) {
          setStartedAt(Date.now());
          setSnapshotMinutes(totalMinutes);
        }
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [slideId, totalMinutes]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const effectiveMinutes = snapshotMinutes ?? totalMinutes;
  const totalMs = effectiveMinutes * MS_PER_MIN;
  const elapsed = startedAt ? now - startedAt : 0;
  const remaining = Math.max(0, totalMs - elapsed);

  useEffect(() => {
    if (!startedAt) return;
    if (remaining <= 0 && !expiredRef.current) {
      expiredRef.current = true;
      onExpireRef.current();
    }
  }, [remaining, startedAt]);

  if (!startedAt) return null;

  const colorClass =
    remaining <= 60_000
      ? "bg-red-50 text-red-700 border-red-200"
      : remaining <= 5 * MS_PER_MIN
      ? "bg-amber-50 text-amber-700 border-amber-200"
      : "bg-gray-50 text-gray-700 border-gray-200";

  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-mono font-semibold ${colorClass}`}
      title={t("codingQuestion.sessionTimer.tooltip")}
    >
      <Clock className="size-3" />
      {fmt(remaining)}
    </div>
  );
}

