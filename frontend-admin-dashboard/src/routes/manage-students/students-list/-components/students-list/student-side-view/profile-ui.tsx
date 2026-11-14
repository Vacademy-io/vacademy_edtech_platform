/**
 * profile-ui — shared presentational primitives for the Student Profile side view.
 *
 * Every tab body (Overview, Progress, Programs, Tests, …) renders from these so
 * the drawer reads as one consistent surface: neutral cards, uniform label/value
 * rows, and matching loading / empty / error states. Purely presentational — no
 * data fetching, no business logic.
 */
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import {
    Warning,
    ArrowClockwise,
    Copy,
    Check,
    Envelope,
    Phone,
    WhatsappLogo,
    Circle,
    CaretUp,
    CaretDown,
    Minus,
    type Icon as PhosphorIcon,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';

export type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

// ── Section card ──────────────────────────────────────────────────────────────

export const ProfileSectionCard = ({
    icon: Icon,
    heading,
    action,
    className,
    bodyClassName,
    children,
}: {
    icon?: PhosphorIcon;
    heading?: string;
    action?: React.ReactNode;
    className?: string;
    bodyClassName?: string;
    children: React.ReactNode;
}) => (
    <section
        className={cn(
            'rounded-lg border border-border bg-card p-2.5 shadow-sm',
            className
        )}
    >
        {(heading || action) && (
            <div className="mb-1 flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5">
                    {Icon && (
                        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary-50 text-primary-600">
                            <Icon className="size-3.5" weight="duotone" />
                        </span>
                    )}
                    {heading && (
                        <h3 className="truncate text-caption font-semibold text-card-foreground">
                            {heading}
                        </h3>
                    )}
                </div>
                {action && <div className="shrink-0">{action}</div>}
            </div>
        )}
        <div className={bodyClassName}>{children}</div>
    </section>
);

// ── Label / value row ─────────────────────────────────────────────────────────

export const ProfileFieldRow = ({
    label,
    value,
    copied,
    onCopy,
    action,
}: {
    label: string;
    value: React.ReactNode;
    copied?: boolean;
    onCopy?: () => void;
    /** Optional control rendered after the copy button — e.g. the click-to-call
     *  button on the mobile row. Shown only when the row has a real value, so a
     *  blank field never offers an action that cannot work. */
    action?: React.ReactNode;
}) => {
    const { t } = useTranslation('manageStudentsProfileUi');
    // A value counts as "empty" — rendered as an em-dash with NO copy icon — when
    // it's nullish or a blank/placeholder string (whitespace, N/A, null, a dash).
    // Non-string nodes (badges, links) are always treated as present.
    const isEmpty =
        value === null ||
        value === undefined ||
        (typeof value === 'string' &&
            ['', 'n/a', 'null', 'undefined', '-', '—'].includes(value.trim().toLowerCase()));
    return (
        <div className="group flex items-center justify-between gap-3 rounded-md py-1 transition-colors hover:bg-muted/40">
            <dt className="shrink-0 text-2xs text-muted-foreground">{label}</dt>
            <dd
                className={cn(
                    'flex min-w-0 items-center justify-end gap-1.5 text-right text-2xs font-medium',
                    isEmpty ? 'text-muted-foreground' : 'text-card-foreground'
                )}
            >
                <span
                    className="truncate"
                    title={typeof value === 'string' && !isEmpty ? value : undefined}
                >
                    {isEmpty ? '—' : value}
                </span>
                {onCopy && !isEmpty && (
                    <button
                        type="button"
                        onClick={onCopy}
                        aria-label={t('fieldRow.copyAriaLabel', { label })}
                        className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                    >
                        {copied ? (
                            <Check className="size-3.5 text-success-600" />
                        ) : (
                            <Copy className="size-3.5" />
                        )}
                    </button>
                )}
                {action && !isEmpty && <span className="shrink-0">{action}</span>}
            </dd>
        </div>
    );
};

// ── Loading skeleton ──────────────────────────────────────────────────────────

export const ProfileSkeleton = ({ blocks = 3 }: { blocks?: number }) => (
    <div className="flex flex-col gap-3">
        <Skeleton className="h-9 w-full rounded-md" />
        {Array.from({ length: blocks }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-lg" />
        ))}
    </div>
);

// ── Empty state ───────────────────────────────────────────────────────────────

export const ProfileEmpty = ({
    icon: Icon,
    title,
    hint,
    action,
}: {
    icon: PhosphorIcon;
    title: string;
    hint?: string;
    action?: React.ReactNode;
}) => (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-4 py-10 text-center">
        <Icon className="size-8 text-muted-foreground" />
        <div>
            <p className="text-body font-semibold text-card-foreground">{title}</p>
            {hint && <p className="mt-0.5 text-caption text-muted-foreground">{hint}</p>}
        </div>
        {action}
    </div>
);

// ── Error state ───────────────────────────────────────────────────────────────

export const ProfileError = ({
    title,
    hint,
    onRetry,
}: {
    title?: string;
    hint?: string;
    onRetry?: () => void;
}) => {
    const { t } = useTranslation('manageStudentsProfileUi');
    const resolvedTitle = title ?? t('error.defaultTitle');
    const resolvedHint = hint ?? t('error.defaultHint');
    return (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-danger-200 bg-danger-50 px-4 py-8 text-center">
            <Warning className="size-8 text-danger-500" weight="fill" />
            <div>
                <p className="text-sm font-semibold text-neutral-800">{resolvedTitle}</p>
                <p className="mt-0.5 text-xs text-neutral-500">{resolvedHint}</p>
            </div>
            {onRetry && (
                <MyButton buttonType="secondary" scale="small" onClick={onRetry}>
                    <ArrowClockwise className="size-4" />
                    {t('error.retry')}
                </MyButton>
            )}
        </div>
    );
};

// ── Circular progress ring ────────────────────────────────────────────────────

export const ProfileRing = ({ value }: { value: number }) => {
    const size = 64;
    const stroke = 6;
    const r = (size - stroke) / 2;
    const circumference = 2 * Math.PI * r;
    const clamped = Math.min(100, Math.max(0, value));
    const offset = circumference - (clamped / 100) * circumference;
    const tone =
        clamped >= 75
            ? 'text-success-500'
            : clamped >= 40
              ? 'text-primary-500'
              : 'text-warning-500';
    return (
        <div className="relative size-16 shrink-0">
            <svg viewBox="0 0 64 64" className="size-full -rotate-90">
                <circle
                    cx="32"
                    cy="32"
                    r={r}
                    fill="none"
                    strokeWidth={stroke}
                    className="stroke-neutral-100"
                />
                <circle
                    cx="32"
                    cy="32"
                    r={r}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={stroke}
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={offset}
                    className={cn('transition-all duration-500', tone)}
                />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center text-sm font-bold text-neutral-800">
                {Math.round(clamped)}%
            </div>
        </div>
    );
};

// ── Stat tile (compact metric) ────────────────────────────────────────────────

export const ProfileStat = ({
    label,
    value,
    tone = 'neutral',
}: {
    label: string;
    value: React.ReactNode;
    tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'primary';
}) => {
    const toneText =
        tone === 'success'
            ? 'text-success-600'
            : tone === 'warning'
              ? 'text-warning-600'
              : tone === 'danger'
                ? 'text-danger-600'
                : tone === 'primary'
                  ? 'text-primary-600'
                  : 'text-neutral-800';
    return (
        <div className="flex flex-1 flex-col gap-1 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
            <span className={cn('text-xl font-bold leading-none', toneText)}>{value}</span>
            <span className="text-xs font-medium uppercase tracking-wide text-neutral-400">
                {label}
            </span>
        </div>
    );
};

// ── Tone helpers ──────────────────────────────────────────────────────────────

const TONE_TEXT: Record<Tone, string> = {
    neutral: 'text-neutral-700',
    primary: 'text-primary-600',
    success: 'text-success-600',
    warning: 'text-warning-600',
    danger: 'text-danger-600',
    info: 'text-info-600',
};
const TONE_BG: Record<Tone, string> = {
    neutral: 'bg-neutral-100',
    primary: 'bg-primary-50',
    success: 'bg-success-50',
    warning: 'bg-warning-50',
    danger: 'bg-danger-50',
    info: 'bg-info-50',
};
const TONE_ACCENT: Record<Tone, string> = {
    neutral: 'bg-neutral-400',
    primary: 'bg-primary-500',
    success: 'bg-success-500',
    warning: 'bg-warning-500',
    danger: 'bg-danger-500',
    info: 'bg-info-500',
};
const TONE_RING: Record<Tone, string> = {
    neutral: 'ring-neutral-200',
    primary: 'ring-primary-200',
    success: 'ring-success-200',
    warning: 'ring-warning-200',
    danger: 'ring-danger-200',
    info: 'ring-info-200',
};

// ── Hero zone (per-tab headline metric / status) ──────────────────────────────
//
// One per tab, at the top. Visually distinct from regular ProfileSectionCards via
// a left tone accent + tinted icon chip + larger title. The right slot holds the
// tab's primary action (e.g. "Create Invoice", "Open Portal").

export const ProfileHero = ({
    eyebrow,
    title,
    subtitle,
    icon: Icon,
    tone = 'primary',
    action,
    children,
    className,
}: {
    eyebrow?: string;
    title: React.ReactNode;
    subtitle?: React.ReactNode;
    icon?: PhosphorIcon;
    tone?: Tone;
    action?: React.ReactNode;
    children?: React.ReactNode;
    className?: string;
}) => (
    <section
        className={cn(
            'overflow-hidden rounded-lg border border-border bg-card p-3 shadow-sm',
            className
        )}
    >
        <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-start gap-2">
                {Icon && (
                    <span
                        className={cn(
                            'flex size-6 shrink-0 items-center justify-center rounded-md',
                            TONE_BG[tone],
                            TONE_TEXT[tone]
                        )}
                    >
                        <Icon className="size-3.5" weight="duotone" />
                    </span>
                )}
                <div className="min-w-0 flex-1">
                    {eyebrow && (
                        <span
                            className={cn(
                                'text-2xs font-semibold',
                                TONE_TEXT[tone]
                            )}
                        >
                            {eyebrow}
                        </span>
                    )}
                    <div className="text-body font-semibold leading-tight text-card-foreground">
                        {title}
                    </div>
                    {subtitle && (
                        <div className="mt-0.5 text-2xs text-muted-foreground">
                            {subtitle}
                        </div>
                    )}
                </div>
            </div>
            {action && <div className="shrink-0">{action}</div>}
        </div>
        {children && <div className="mt-3">{children}</div>}
    </section>
);

// ── Hero stat tile (large number with caption, optional trend, optional click) ──

export const ProfileHeroStat = ({
    label,
    value,
    tone = 'neutral',
    icon: Icon,
    trend,
    onClick,
    selected,
}: {
    label: string;
    value: React.ReactNode;
    tone?: Tone;
    icon?: PhosphorIcon;
    trend?: { direction: 'up' | 'down' | 'flat'; label?: string };
    onClick?: () => void;
    selected?: boolean;
}) => {
    const isInteractive = !!onClick;
    const content = (
        <>
            <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    {label}
                </span>
                {Icon && (
                    <span
                        className={cn(
                            'flex size-8 shrink-0 items-center justify-center rounded-md',
                            TONE_BG[tone],
                            TONE_TEXT[tone]
                        )}
                    >
                        <Icon className="size-4" weight="duotone" />
                    </span>
                )}
            </div>
            <div className={cn('text-xl font-semibold leading-none', TONE_TEXT[tone])}>{value}</div>
            {trend && (
                <span
                    className={cn(
                        'mt-0.5 inline-flex items-center gap-0.5 text-xs font-medium',
                        trend.direction === 'up'
                            ? 'text-success-600'
                            : trend.direction === 'down'
                              ? 'text-danger-600'
                              : 'text-neutral-500'
                    )}
                >
                    {trend.direction === 'up' ? (
                        <CaretUp className="size-3" weight="fill" />
                    ) : trend.direction === 'down' ? (
                        <CaretDown className="size-3" weight="fill" />
                    ) : (
                        <Minus className="size-3" />
                    )}
                    {trend.label}
                </span>
            )}
        </>
    );
    const baseClasses = cn(
        'flex flex-1 flex-col gap-1.5 rounded-lg border bg-white p-4 text-left shadow-sm transition',
        selected ? 'border-primary-400 ring-2 ring-primary-100' : 'border-neutral-200'
    );
    if (isInteractive) {
        return (
            <button
                type="button"
                onClick={onClick}
                aria-pressed={selected}
                className={cn(
                    baseClasses,
                    'hover:border-primary-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400'
                )}
            >
                {content}
            </button>
        );
    }
    return <div className={baseClasses}>{content}</div>;
};

// ── Action bar (row of primary/secondary buttons under a hero) ────────────────

export const ProfileActionBar = ({
    children,
    className,
}: {
    children: React.ReactNode;
    className?: string;
}) => <div className={cn('flex flex-wrap items-center gap-2', className)}>{children}</div>;

// ── Quick contact (mailto / tel / wa.me chips) ────────────────────────────────
//
// Pure <a href> chips — zero backend. Renders only the channels for which a
// value exists. Skips chips silently when the value is empty / 'N/A'.

const isUsableValue = (v: string | null | undefined): v is string =>
    !!v && v.trim() !== '' && v.trim() !== 'N/A';

export const ProfileQuickContact = ({
    email,
    phone,
    whatsapp,
    className,
}: {
    email?: string | null;
    phone?: string | null;
    /** If omitted, falls back to phone. Both are normalized to digits-only. */
    whatsapp?: string | null;
    className?: string;
}) => {
    const { t } = useTranslation('manageStudentsProfileUi');
    const items: Array<{
        key: 'email' | 'call' | 'whatsapp';
        href: string;
        label: string;
        title: string;
        Icon: PhosphorIcon;
        external?: boolean;
    }> = [];
    if (isUsableValue(email)) {
        items.push({
            key: 'email',
            href: `mailto:${email.trim()}`,
            label: t('quickContact.email'),
            title: email.trim(),
            Icon: Envelope,
        });
    }
    if (isUsableValue(phone)) {
        items.push({
            key: 'call',
            href: `tel:${phone.trim()}`,
            label: t('quickContact.call'),
            title: phone.trim(),
            Icon: Phone,
        });
    }
    const waSource = isUsableValue(whatsapp) ? whatsapp : isUsableValue(phone) ? phone : null;
    if (waSource) {
        const digits = waSource.replace(/\D/g, '');
        if (digits.length >= 6) {
            items.push({
                key: 'whatsapp',
                href: `https://wa.me/${digits}`,
                label: t('quickContact.whatsapp'),
                title: waSource.trim(),
                Icon: WhatsappLogo,
                external: true,
            });
        }
    }
    if (!items.length) return null;
    return (
        <div className={cn('flex items-center gap-1.5', className)}>
            {items.map((it) => (
                <a
                    key={it.key}
                    href={it.href}
                    target={it.external ? '_blank' : undefined}
                    rel={it.external ? 'noreferrer' : undefined}
                    title={`${it.label}: ${it.title}`}
                    aria-label={`${it.label} ${it.title}`}
                    className="flex size-9 items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-600 transition hover:border-primary-300 hover:bg-primary-50 hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                >
                    <it.Icon className="size-4" weight="duotone" />
                </a>
            ))}
        </div>
    );
};

// ── Context strip (sticky-under-header chips visible on every tab) ────────────

export interface ContextStripItem {
    label: string;
    value: React.ReactNode;
    tone?: Tone;
}
export const ProfileContextStrip = ({
    items,
    className,
}: {
    items: Array<ContextStripItem | null | false | undefined>;
    className?: string;
}) => {
    const visible = items.filter(Boolean) as ContextStripItem[];
    if (!visible.length) return null;
    return (
        // Surface-3 strip per the handoff hero meta row: warm grey bg with no
        // border (the bg-card+border-border above provides the seam), 26px
        // column gaps, and slightly larger value typography so the strip reads
        // as an at-a-glance ID/Joined/Email/Phone row instead of fading out.
        <div
            className={cn(
                'flex flex-wrap items-center gap-x-6 gap-y-1.5 rounded-md bg-neutral-100 px-4 py-2.5',
                className
            )}
        >
            {visible.map((it, i) => (
                <div key={i} className="flex min-w-0 items-baseline gap-2">
                    <span className="shrink-0 text-caption font-semibold uppercase tracking-wide text-muted-foreground">
                        {it.label}
                    </span>
                    <span
                        className={cn(
                            'truncate text-body font-semibold',
                            it.tone ? TONE_TEXT[it.tone] : 'text-card-foreground'
                        )}
                        title={typeof it.value === 'string' ? it.value : undefined}
                    >
                        {it.value}
                    </span>
                </div>
            ))}
        </div>
    );
};

// ── Vertical timeline (event icon · title · time · optional body) ─────────────

export interface ProfileTimelineItem {
    id: string | number;
    icon?: PhosphorIcon;
    tone?: Tone;
    title: React.ReactNode;
    meta?: React.ReactNode;
    body?: React.ReactNode;
}
export const ProfileTimeline = ({
    items,
    className,
}: {
    items: ProfileTimelineItem[];
    className?: string;
}) => {
    if (!items.length) return null;
    return (
        <ol className={cn('relative space-y-4 pl-6', className)}>
            <span aria-hidden className="absolute left-2 bottom-2 top-2 w-px bg-neutral-200" />
            {items.map((it) => {
                const Icon = it.icon ?? Circle;
                const tone = it.tone ?? 'neutral';
                return (
                    <li key={it.id} className="relative">
                        <span
                            className={cn(
                                'absolute -left-6 top-0.5 flex size-4 items-center justify-center rounded-full ring-2',
                                TONE_BG[tone],
                                TONE_RING[tone]
                            )}
                        >
                            <Icon
                                className={cn('size-2.5', TONE_TEXT[tone])}
                                weight="fill"
                            />
                        </span>
                        <div className="flex items-start justify-between gap-3">
                            {/* truncate so a long title (e.g. an email subject) is
                                clipped to one line instead of overflowing on top of
                                the meta/timestamp on the right. */}
                            <div className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-800">
                                {it.title}
                            </div>
                            {it.meta && (
                                <div className="shrink-0 text-xs text-neutral-400">{it.meta}</div>
                            )}
                        </div>
                        {/* Body sits BELOW the title+meta row so it spans the full
                            width — the meta no longer reserves space beside it. */}
                        {it.body && (
                            <div className="mt-1.5 text-xs text-neutral-500">{it.body}</div>
                        )}
                    </li>
                );
            })}
        </ol>
    );
};

// ── Inline mini progress bar (for in-row completion %) ────────────────────────

export const ProfileMiniBar = ({
    value,
    tone,
    label,
    className,
}: {
    value: number;
    tone?: Exclude<Tone, 'neutral' | 'info'>;
    /** Defaults to `${pct}%`; pass empty string to suppress. */
    label?: string;
    className?: string;
}) => {
    const clamped = Math.min(100, Math.max(0, value));
    const auto: Exclude<Tone, 'neutral' | 'info'> =
        tone ?? (clamped >= 75 ? 'success' : clamped >= 30 ? 'primary' : 'warning');
    return (
        <div className={cn('flex min-w-0 items-center gap-2', className)}>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-100">
                {/* Width is data-driven (completion %). */}
                <div
                    className={cn('h-full rounded-full transition-all duration-500', TONE_ACCENT[auto])}
                    style={{ width: `${clamped}%` }}
                />
            </div>
            {label !== '' && (
                <span className="shrink-0 text-xs font-semibold text-neutral-600">
                    {label ?? `${Math.round(clamped)}%`}
                </span>
            )}
        </div>
    );
};
