import React, { useEffect, useRef, useState } from "react";
import {
  Buildings,
  BookOpen,
  ChalkboardTeacher,
  GlobeHemisphereWest,
  GraduationCap,
  Star,
  TrendUp,
  type IconProps,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

interface Stat {
  label: string;
  value?: string;
}

interface StatGroup {
  description: string;
  stats: Stat[];
}

interface StatsHighlightsProps {
  headerText: string;
  description?: string;
  stats?: Stat[];
  groups?: StatGroup[];
  style?: "circle" | "card" | "minimal";
  styles?: {
    backgroundColor?: string;
    textColor?: string;
    hoverEffect?: "scale" | "shadow" | "none";
  };
  /** The untranslated props (JsonRenderer): icons are picked from the
   *  authored labels, so a translated page shows the same icons. */
  baseProps?: { stats?: Stat[]; groups?: StatGroup[] };
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Staggered entrance delays (standard Tailwind transition-delay utilities).
const REVEAL_DELAYS = [
  "delay-0",
  "delay-100",
  "delay-200",
  "delay-300",
  "delay-500",
  "delay-700",
];

// Pick a sensible brand icon from the stat's label.
const getStatIcon = (label: string): React.ComponentType<IconProps> => {
  const l = (label || "").toLowerCase();
  if (/student|learner|user|member|enroll/.test(l)) return GraduationCap;
  if (/school|institute|campus|college|cent(er|re)|branch/.test(l))
    return Buildings;
  if (/countr|nation|global|world|region/.test(l)) return GlobeHemisphereWest;
  if (/course|program|class|subject|chapter|lesson/.test(l)) return BookOpen;
  if (/teacher|faculty|mentor|educator|instructor|tutor/.test(l))
    return ChalkboardTeacher;
  if (/rating|review|star|satisf|success/.test(l)) return Star;
  return TrendUp;
};

/** The big number and the label of a stat: "1,200+ Learners" with no value splits into both. */
const splitStat = (stat: Stat): { bigValue: string; labelText: string } => {
  const bigValue = stat.value || "";
  const labelText = stat.label || "";
  if (!bigValue && labelText) {
    const match = labelText.match(/^([\d,.]+[+%]?)\s+(.+)$/);
    if (match) return { bigValue: match[1]!, labelText: match[2]! };
  }
  return { bigValue, labelText };
};

/** The authored list a shown (translated) list was made from: same length, same order. */
const authoredList = <T,>(base: T[] | undefined, shown: T[] | undefined): T[] | undefined =>
  Array.isArray(base) && Array.isArray(shown) && base.length === shown.length ? base : undefined;

/**
 * Animated number that counts up 0 → target when `active` becomes true.
 * Keeps a non-numeric suffix ("+", "%", "k") and falls back to the raw
 * string for non-numeric values. Respects reduced-motion.
 */
const CountUp: React.FC<{ value: string; active: boolean }> = ({
  value,
  active,
}) => {
  const match = value.trim().match(/^([\d,]+(?:\.\d+)?)\s*(.*)$/);
  const target = match ? parseFloat(match[1].replace(/,/g, "")) : NaN;
  const suffix = match ? match[2] : "";
  const isInt = Number.isInteger(target);
  const [n, setN] = useState(0);

  useEffect(() => {
    if (!active || !match || !Number.isFinite(target)) return;
    if (prefersReducedMotion()) {
      setN(target);
      return;
    }
    let raf = 0;
    let start: number | null = null;
    const duration = 1600;
    const tick = (ts: number) => {
      if (start === null) start = ts;
      const p = Math.min((ts - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      setN(target * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else setN(target);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // Depend on the stable `value` string only. Depending on `match` (a fresh
    // array from .match() each render) would re-run this on every parent
    // re-render — e.g. the catalogue's scroll re-renders — restarting the
    // count-up so it never settles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, value]);

  if (!match || !Number.isFinite(target)) return <>{value}</>;
  const display = isInt ? Math.round(n).toLocaleString() : n.toFixed(1);
  return (
    <>
      {display}
      {suffix}
    </>
  );
};

export const StatsHighlightsComponent: React.FC<StatsHighlightsProps> = ({
  headerText,
  description,
  stats,
  groups,
  style: displayStyle = "card",
  styles = {},
  baseProps,
}) => {
  const { backgroundColor } = styles;

  // On a dark custom section background the fixed gray heading/description go
  // low-contrast — switch them to light text. (Stat CARDS stay white, so
  // their inner label/number keep their own contrast.)
  const onDark = (() => {
    const raw = (backgroundColor || "").trim().replace(/^#/, "");
    if (!/^[0-9a-fA-F]{6}$/.test(raw)) return false;
    const r = parseInt(raw.slice(0, 2), 16);
    const g = parseInt(raw.slice(2, 4), 16);
    const b = parseInt(raw.slice(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.55;
  })();

  const sectionRef = useRef<HTMLElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    if (prefersReducedMotion()) {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const renderStat = (stat: Stat, index: number, authored?: Stat) => {
    const { bigValue, labelText } = splitStat(stat);
    // Picked from the authored label: the icons never change with the language.
    const Icon = getStatIcon(authored ? splitStat(authored).labelText : labelText);
    const delayClass = REVEAL_DELAYS[Math.min(index, REVEAL_DELAYS.length - 1)];
    const revealClass = inView
      ? "opacity-100 translate-y-0"
      : "opacity-0 translate-y-8";
    const minimal = displayStyle === "minimal";

    return (
      // Outer: scroll-reveal only (slow). Keeping the reveal transition off the
      // hovered element so hover stays snappy instead of inheriting duration-700.
      <div
        key={index}
        className={cn(
          "transition-all duration-700 ease-out",
          delayClass,
          revealClass,
        )}
      >
        {/* Inner: the card + a fast, separate hover transition. */}
        <div
          className={cn(
            "group relative flex h-full flex-col items-center text-center",
            minimal
              ? "px-4 py-6"
              : "rounded-catalogue-lg border border-catalogue-border-subtle bg-catalogue-bg-elevated p-7 sm:p-8 shadow-sm transition-transform duration-300 ease-out will-change-transform hover:-translate-y-1",
          )}
        >
          {/* Soft brand-green glow — animates via OPACITY only (GPU-smooth),
              instead of transitioning box-shadow size/color which stutters. */}
          {!minimal && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-catalogue-lg opacity-0 shadow-xl shadow-primary-500/30 transition-opacity duration-300 ease-out group-hover:opacity-100"
            />
          )}

          {/* Brand icon chip */}
          <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-catalogue-lg bg-gradient-to-br from-primary-50 to-primary-100 ring-1 ring-primary-100 transition-all duration-300 ease-out group-hover:scale-105 group-hover:ring-primary-200">
            <Icon className="h-7 w-7 text-primary-500" weight="duotone" />
          </div>

          {/* Number — brand gradient, counts up */}
          <span className="bg-gradient-to-br from-primary-500 to-primary-400 bg-clip-text text-4xl font-extrabold leading-none tracking-tight text-transparent sm:text-5xl">
            {bigValue ? <CountUp value={bigValue} active={inView} /> : labelText}
          </span>

          {/* Label */}
          {bigValue && (
            <span className="mt-3 text-xs font-semibold uppercase tracking-wider text-catalogue-text-secondary sm:text-sm">
              {labelText}
            </span>
          )}
        </div>
      </div>
    );
  };

  const useGroupsFormat = groups && groups.length > 0;
  const authoredStats = authoredList(baseProps?.stats, stats);
  const authoredGroups = authoredList(baseProps?.groups, groups);

  const gridClass = (count: number) =>
    cn(
      "grid gap-5 sm:gap-6",
      count <= 3
        ? "grid-cols-1 sm:grid-cols-3 max-w-4xl mx-auto"
        : count <= 4
          ? "grid-cols-2 sm:grid-cols-4 max-w-5xl mx-auto"
          : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5",
    );

  return (
    <section
      ref={sectionRef}
      className="w-full catalogue-section"
      style={{ backgroundColor: backgroundColor || "#f8fafc" }} // design-lint-ignore: page-builder default color
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div
          className={cn(
            "text-center mb-12 transition-all duration-700 ease-out",
            inView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4",
          )}
        >
          <h2 className={cn("text-3xl sm:text-4xl font-bold tracking-tight", onDark ? "text-white" : "text-gray-900")}>
            {headerText}
          </h2>
          {!useGroupsFormat && description && (
            <p className={cn("mt-3 text-base sm:text-lg max-w-2xl mx-auto", onDark ? "text-white/70" : "text-gray-500")}>
              {description}
            </p>
          )}
          <div className="mx-auto mt-5 h-1 w-16 rounded-full bg-gradient-to-r from-primary-500 to-primary-400" />
        </div>

        {/* Groups or single stats */}
        {useGroupsFormat ? (
          <div className="space-y-8">
            {groups!.map((group, groupIndex) => (
              <div
                key={groupIndex}
                className="rounded-catalogue-lg border border-catalogue-border-subtle bg-catalogue-bg-elevated p-5 shadow-sm sm:p-8"
              >
                <div className="text-center mb-6">
                  <h3 className="text-base sm:text-lg font-semibold text-primary-500">
                    {group.description}
                  </h3>
                </div>
                <div className={gridClass(group.stats.length)}>
                  {group.stats.map((stat, index) =>
                    renderStat(stat, index, authoredList(authoredGroups?.[groupIndex]?.stats, group.stats)?.[index]),
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className={gridClass((stats || []).length)}>
            {(stats || []).map((stat, index) => renderStat(stat, index, authoredStats?.[index]))}
          </div>
        )}
      </div>
    </section>
  );
};
