import { ChalkboardTeacher } from "@phosphor-icons/react";
import type { SessionInstructor } from "../-types/types";

interface InstructorLineProps {
  instructors?: SessionInstructor[] | null;
  /** Matches the surrounding card's icon size (16 on cards, 14 in the day modal). */
  iconSize?: number;
  className?: string;
}

/**
 * "Taught by …" on a live-class card.
 *
 * Renders nothing at all when there are no instructors, or when none of them
 * has a resolvable name: an unnamed instructor is worse than no line, and the
 * backend deliberately returns an instructor carrying only a user id rather
 * than dropping them, so it's this component's job not to print a raw UUID at
 * a learner.
 */
export function InstructorLine({
  instructors,
  iconSize = 16,
  className = "",
}: InstructorLineProps) {
  const names = (instructors ?? [])
    .map((i) => i?.full_name?.trim())
    .filter((name): name is string => !!name);

  if (names.length === 0) return null;

  return (
    <div
      className={`flex items-center gap-1 text-sm text-neutral-600 dark:text-neutral-300 ${className}`}
    >
      <ChalkboardTeacher
        size={iconSize}
        className="text-neutral-500 dark:text-neutral-400 shrink-0"
      />
      <span className="truncate">{names.join(", ")}</span>
    </div>
  );
}
