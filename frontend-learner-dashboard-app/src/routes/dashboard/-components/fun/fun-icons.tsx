/**
 * The few drawn icons the Fun home uses, as on the boards. Decorative (the text
 * beside each one says the same thing). Colours come from CSS (currentColor or a
 * class), never from a value here.
 */

export function PlayIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 18" aria-hidden="true">
      <path d="M2 1.5 L14.5 9 L2 16.5 Z" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

export function FlameIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 18 20" aria-hidden="true">
      <path className="fun-flame__outer" d="M9 1 C11 5 15 7 15 12 A6 6 0 0 1 3 12 C3 9 5 8 6 5 C7 7 8 8 9 8 C9 6 8 3 9 1 Z" />
      <path className="fun-flame__core" d="M9 11 C10.5 12.5 11.5 13.5 11.5 15 A2.5 2.5 0 0 1 6.5 15 C6.5 13.5 8 12.5 9 11 Z" />
    </svg>
  );
}

export function VideoIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2" y="6" width="14" height="12" rx="3" fill="currentColor" />
      <path d="M16 10.5 L22 7 V17 L16 13.5 Z" fill="currentColor" />
    </svg>
  );
}

export function ClipboardIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M9 12 L11 14 L15 10" />
    </svg>
  );
}

export function CheckSquareIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <path d="M8 12 L11 15 L16 9" />
    </svg>
  );
}

export function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 5 L16 12 L9 19" />
    </svg>
  );
}

export function UserIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21 C5 16 8.5 14 12 14 C15.5 14 19 16 20 21" />
    </svg>
  );
}

/** Three stacked course cards, for the empty home (no course yet). */
export function EmptyCoursesArt({ className }: { className?: string }) {
  const cards = [
    { x: 36, y: 34, r: -8, n: 0 },
    { x: 108, y: 26, r: 5, n: 1 },
    { x: 180, y: 36, r: -4, n: 2 },
    { x: 250, y: 28, r: 8, n: 3 },
  ];
  return (
    <svg className={className} viewBox="0 0 346 150" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {cards.map((c) => (
        <g key={c.n} transform={`translate(${c.x} ${c.y}) rotate(${c.r} 36 44)`} className={`fun-course-${c.n}`}>
          <rect className="fun-empty-art__card" width="72" height="88" rx="14" />
          <rect className="fun-empty-art__band" width="72" height="44" rx="14" />
          <rect className="fun-empty-art__band" y="30" width="72" height="14" />
          <rect className="fun-empty-art__line" x="10" y="56" width="44" height="7" rx="3.5" />
          <rect className="fun-empty-art__line fun-empty-art__line--short" x="10" y="70" width="28" height="7" rx="3.5" />
        </g>
      ))}
    </svg>
  );
}

/** The finished card's three ticks. */
export function DoneTicksArt({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 110 44" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <g key={i} transform={`translate(${i * 36} 0)`}>
          <circle className="fun-done-art__disc" cx="20" cy="22" r="18" />
          <path className="fun-done-art__check" d="M12 22 L18 28 L28 16" />
        </g>
      ))}
    </svg>
  );
}
