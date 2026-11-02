import { useId } from 'react';
import { REPORT_COLORS, tint } from './palette';

/**
 * Decorative report illustrations drawn in the brand colour. Inline SVG so they need no asset
 * hosting, scale cleanly and survive the PDF export. All are aria-hidden.
 */

interface IllustrationProps {
    brand: string;
    className?: string;
}

/** A rising bar chart on a board with a trend arrow and a star: the learner report hero. */
export const GrowthIllustration = ({ brand, className }: IllustrationProps) => {
    const id = useId().replace(/:/g, '');
    return (
        <svg viewBox="0 0 160 120" className={className} aria-hidden>
            <defs>
                <linearGradient id={`g-bar-${id}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={brand} />
                    <stop offset="100%" stopColor={tint(brand, 0.35)} />
                </linearGradient>
            </defs>
            <circle cx="92" cy="62" r="52" fill={tint(brand, 0.88)} />
            <rect
                x="30"
                y="22"
                width="112"
                height="80"
                rx="10"
                fill="#fff"
                stroke={tint(brand, 0.7)}
            />
            <line x1="42" y1="88" x2="130" y2="88" stroke={REPORT_COLORS.line} strokeWidth="2" />
            {[
                [48, 68, 20],
                [68, 58, 30],
                [88, 46, 42],
                [108, 34, 54],
            ].map(([x, y, h]) => (
                <rect
                    key={x}
                    x={x}
                    y={y}
                    width="14"
                    height={h}
                    rx="3"
                    fill={`url(#g-bar-${id})`}
                />
            ))}
            <polyline
                points="46,70 70,58 92,50 120,30"
                fill="none"
                stroke={REPORT_COLORS.good}
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <polygon points="120,22 128,32 116,34" fill={REPORT_COLORS.good} />
            <path
                d="M24 30 l3.5 7 7.7 1.1 -5.6 5.4 1.3 7.6 -6.9 -3.6 -6.9 3.6 1.3 -7.6 -5.6 -5.4 7.7 -1.1z"
                fill={REPORT_COLORS.warn}
            />
            <circle cx="146" cy="16" r="4" fill={tint(brand, 0.5)} />
            <circle cx="18" cy="96" r="6" fill={tint(brand, 0.6)} />
        </svg>
    );
};

/** Three learners in front of a pie chart: the batch report hero. */
export const ClassIllustration = ({ brand, className }: IllustrationProps) => (
    <svg viewBox="0 0 160 120" className={className} aria-hidden>
        <circle cx="84" cy="58" r="52" fill={tint(brand, 0.88)} />
        <g transform="translate(104 38)">
            <circle r="26" fill="#fff" stroke={tint(brand, 0.7)} />
            <path d="M0 0 L0 -22 A22 22 0 1 1 -19 11 Z" fill={brand} />
            <path d="M0 0 L-19 11 A22 22 0 0 1 -12 -18.4 Z" fill={REPORT_COLORS.warn} />
            <path d="M0 0 L-12 -18.4 A22 22 0 0 1 0 -22 Z" fill={REPORT_COLORS.neutral} />
        </g>
        {[
            { x: 40, c: tint(brand, 0.25), y: 74 },
            { x: 66, c: brand, y: 70 },
            { x: 92, c: tint(brand, 0.45), y: 76 },
        ].map((p) => (
            <g key={p.x}>
                <circle cx={p.x} cy={p.y} r="10" fill="#fbd5b5" />
                <path
                    d={`M${p.x - 10} ${p.y - 3} a10 10 0 0 1 20 0 q-10 -6 -20 0z`}
                    fill={REPORT_COLORS.ink}
                />
                <rect x={p.x - 15} y={p.y + 12} width="30" height="26" rx="12" fill={p.c} />
            </g>
        ))}
        <rect x="22" y="104" width="100" height="4" rx="2" fill={REPORT_COLORS.line} />
        <path
            d="M138 84 l2.6 5.2 5.7 .8 -4.1 4 1 5.6 -5.2 -2.7 -5.1 2.7 1 -5.6 -4.2 -4 5.8 -.8z"
            fill={REPORT_COLORS.warn}
        />
        <circle cx="20" cy="26" r="5" fill={tint(brand, 0.55)} />
    </svg>
);

/** An open book with a magnifier over a flat chart: empty states. */
export const EmptyReportIllustration = ({ brand, className }: IllustrationProps) => (
    <svg viewBox="0 0 160 110" className={className} aria-hidden>
        <ellipse cx="80" cy="96" rx="58" ry="7" fill={REPORT_COLORS.line} />
        <path d="M30 30 q25 -10 50 0 v58 q-25 -10 -50 0z" fill="#fff" stroke={tint(brand, 0.6)} />
        <path
            d="M80 30 q25 -10 50 0 v58 q-25 -10 -50 0z"
            fill={tint(brand, 0.92)}
            stroke={tint(brand, 0.6)}
        />
        {[44, 54, 64].map((y) => (
            <line
                key={y}
                x1="40"
                y1={y}
                x2="70"
                y2={y - 3}
                stroke={REPORT_COLORS.line}
                strokeWidth="3"
                strokeLinecap="round"
            />
        ))}
        <polyline
            points="90,70 102,62 112,66 122,52"
            fill="none"
            stroke={tint(brand, 0.3)}
            strokeWidth="3"
            strokeLinecap="round"
        />
        <circle cx="118" cy="40" r="13" fill="none" stroke={brand} strokeWidth="4" />
        <line
            x1="127"
            y1="49"
            x2="138"
            y2="60"
            stroke={brand}
            strokeWidth="5"
            strokeLinecap="round"
        />
    </svg>
);
