import { useState } from "react";
import type { Icon } from "@phosphor-icons/react";
import {
  ChartLineUp,
  CalendarCheck,
  Exam,
  VideoCamera,
  Receipt,
  Medal,
  Trophy,
  Certificate,
  FileText,
  Question,
  Bell,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

// Existing felted-clay 3D art (reused from the cleaner-play set — this is an image
// asset, not a play-* token, so it's allowed outside the Play experience).
import iconProgress from "@/assets/cleaner-play/icon-progress.webp";
import iconAttendance from "@/assets/cleaner-play/icon-attendance.webp";
import iconAssessments from "@/assets/cleaner-play/icon-assessments.webp";
import iconLiveSessions from "@/assets/cleaner-play/icon-live-sessions.webp";
import iconBadges from "@/assets/cleaner-play/icon-badges.webp";
import iconPoints from "@/assets/cleaner-play/icon-points.webp";
import iconHelp from "@/assets/cleaner-play/icon-help.webp";
import iconCertificate from "@/assets/cleaner-play/icon-certificate.webp";
import iconReports from "@/assets/cleaner-play/icon-reports.webp";

export type ParentIconKey =
  | "progress"
  | "attendance"
  | "assessments"
  | "liveSessions"
  | "payments"
  | "badges"
  | "rewards"
  | "certificates"
  | "reports"
  | "help"
  | "attention";

// Tier 1: generated art (dropped in later by scripts/generate-parent-icons.mjs).
// A glob with zero matches returns {} and compiles — which is exactly what lets
// the portal ship before the OpenRouter key arrives. Keyed by bare filename.
const generated = import.meta.glob<string>("@/assets/parent-icons/*.webp", {
  eager: true,
  query: "?url",
  import: "default",
});
const generatedByKey: Partial<Record<ParentIconKey, string>> = {};
for (const [path, url] of Object.entries(generated)) {
  const name = path.split("/").pop()?.replace(".webp", "");
  if (name) generatedByKey[name as ParentIconKey] = url as string;
}

// Tier 2: existing cleaner-play art. `certificates` and `reports` now resolve
// here too — scripts/generate-theme-icons.mjs added icon-certificate.webp and
// icon-reports.webp to the shared felted-clay set, so the parent portal reuses
// them rather than carrying a second copy under parent-icons/.
// `payments` and `attention` are NOT listed here on purpose: they were generated
// straight into src/assets/parent-icons/, so the Tier-1 glob above already picks
// them up by filename with no mapping needed.
const existingArt: Partial<Record<ParentIconKey, string>> = {
  progress: iconProgress,
  attendance: iconAttendance,
  assessments: iconAssessments,
  liveSessions: iconLiveSessions,
  badges: iconBadges,
  rewards: iconPoints,
  help: iconHelp,
  certificates: iconCertificate,
  reports: iconReports,
};

// Tier 3: Phosphor duotone — exhaustive, so a new key won't compile without a fallback.
const fallbackIcon: Record<ParentIconKey, Icon> = {
  progress: ChartLineUp,
  attendance: CalendarCheck,
  assessments: Exam,
  liveSessions: VideoCamera,
  payments: Receipt,
  badges: Medal,
  rewards: Trophy,
  certificates: Certificate,
  reports: FileText,
  help: Question,
  attention: Bell,
};

interface ParentModuleIconProps {
  name: ParentIconKey;
  className?: string;
  /** pixel size for the Phosphor fallback; the art fills its box */
  size?: number;
}

/**
 * Friendly module icon with a three-deep fallback: generated art → existing
 * cleaner-play art → Phosphor duotone. Fixed box so there's no layout shift
 * between tiers. The label is always adjacent, so the image is decorative
 * (aria-hidden) to avoid a double announcement.
 */
export function ParentModuleIcon({ name, className, size = 40 }: ParentModuleIconProps) {
  const [failed, setFailed] = useState(false);
  const src = generatedByKey[name] ?? existingArt[name];

  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        aria-hidden
        onError={() => setFailed(true)}
        className={cn("size-full object-contain", className)}
      />
    );
  }

  const FallbackIcon = fallbackIcon[name];
  return (
    <FallbackIcon
      weight="duotone"
      size={size}
      aria-hidden
      className={cn("text-primary-400", className)}
    />
  );
}
