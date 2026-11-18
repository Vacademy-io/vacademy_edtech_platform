import { cn } from '@/lib/utils';

/**
 * Two small pictures for the guided scan: putting the pile in the feeder, and
 * turning it over like a book page. Colours come from the design tokens.
 */

const SHEET_LINES = [0, 1, 2, 3];

/** Sheets in the feeder, writing up, top edge going in first. */
export const PutPileIllustration = ({ className }: { className?: string }) => (
    <svg
        viewBox="0 0 120 90"
        aria-hidden="true"
        className={cn('h-20 w-28 shrink-0', className)}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
    >
        {/* scanner body with the feed slot */}
        <rect
            x="8"
            y="58"
            width="104"
            height="24"
            rx="4"
            className="fill-neutral-100 stroke-neutral-400"
            strokeWidth="2"
        />
        <line x1="30" y1="64" x2="90" y2="64" className="stroke-neutral-500" strokeWidth="3" />
        {/* the pile, top edge at the slot */}
        <rect
            x="34"
            y="16"
            width="52"
            height="42"
            rx="2"
            className="fill-neutral-50 stroke-neutral-300"
            strokeWidth="1.5"
        />
        <rect
            x="31"
            y="12"
            width="52"
            height="42"
            rx="2"
            className="fill-neutral-50 stroke-neutral-400"
            strokeWidth="1.5"
        />
        {SHEET_LINES.map((i) => (
            <line
                key={i}
                x1="37"
                y1={22 + i * 8}
                x2={i === 3 ? 62 : 76}
                y2={22 + i * 8}
                className="stroke-primary-400"
                strokeWidth="2"
            />
        ))}
        {/* arrow: this edge goes in first */}
        <path
            d="M100 14 L100 46 M94 40 L100 47 L106 40"
            className="stroke-primary-500"
            strokeWidth="2.5"
        />
    </svg>
);

/** The pile turned over like a page of a book: the back now faces up. */
export const TurnOverIllustration = ({ className }: { className?: string }) => (
    <svg
        viewBox="0 0 120 90"
        aria-hidden="true"
        className={cn('h-20 w-28 shrink-0', className)}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
    >
        {/* front, writing up */}
        <rect
            x="6"
            y="28"
            width="40"
            height="52"
            rx="2"
            className="fill-neutral-50 stroke-neutral-400"
            strokeWidth="1.5"
        />
        {SHEET_LINES.map((i) => (
            <line
                key={i}
                x1="12"
                y1={38 + i * 9}
                x2={i === 3 ? 30 : 40}
                y2={38 + i * 9}
                className="stroke-primary-400"
                strokeWidth="2"
            />
        ))}
        {/* turning over to the right, like a book page */}
        <path d="M30 24 C40 4 80 4 90 24" className="stroke-primary-500" strokeWidth="2.5" />
        <path d="M83 20 L90 25 L93 17" className="stroke-primary-500" strokeWidth="2.5" />
        {/* back, now facing up */}
        <rect
            x="74"
            y="28"
            width="40"
            height="52"
            rx="2"
            className="fill-primary-50 stroke-neutral-400"
            strokeWidth="1.5"
        />
        {SHEET_LINES.map((i) => (
            <line
                key={i}
                x1="80"
                y1={38 + i * 9}
                x2={i === 0 ? 96 : 108}
                y2={38 + i * 9}
                className="stroke-neutral-300"
                strokeWidth="2"
            />
        ))}
    </svg>
);
