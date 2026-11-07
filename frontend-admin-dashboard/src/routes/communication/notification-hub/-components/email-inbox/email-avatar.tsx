import { cn } from '@/lib/utils';

/**
 * A letter avatar with a colour fixed per address, so one person keeps one colour across the
 * list and the thread (Gmail's coloured initials). Our own messages use the brand colour.
 */
const TONES = [
    'bg-info-100 text-info-700',
    'bg-success-100 text-success-700',
    'bg-warning-100 text-warning-700',
    'bg-danger-100 text-danger-700',
    'bg-neutral-200 text-neutral-700',
];

function toneFor(seed: string): string {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
    return TONES[Math.abs(hash) % TONES.length] ?? TONES[0]!;
}

export function getInitials(s: string): string {
    if (!s) return '?';
    const parts = s.split(/[\s@.]+/).filter(Boolean);
    if (parts.length === 0) return s.charAt(0).toUpperCase();
    if (parts.length === 1) return (parts[0] ?? '').slice(0, 2).toUpperCase();
    return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
}

export function EmailAvatar({
    seed,
    label,
    outgoing = false,
    size = 'md',
}: {
    /** Stable identity for the colour — the email address. */
    seed: string;
    /** What the initials are taken from — the display name, else the address. */
    label: string;
    outgoing?: boolean;
    size?: 'sm' | 'md';
}) {
    return (
        <span
            aria-hidden
            className={cn(
                'flex shrink-0 select-none items-center justify-center rounded-full font-medium',
                size === 'sm' ? 'size-8 text-xs' : 'size-10 text-sm',
                outgoing ? 'bg-primary-100 text-primary-600' : toneFor(seed.toLowerCase())
            )}
        >
            {getInitials(label)}
        </span>
    );
}
