import type { ReactNode } from 'react';
import {
    Barbell,
    ChatCenteredText,
    ClipboardText,
    Exam,
    Scan,
    Timer,
    type Icon,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

/**
 * Shared look-and-feel for the assessments module — one place for how a play
 * mode, a status or a tag is drawn, so the list, the table and the create
 * picker agree with each other.
 */

export type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

// [container, foreground] per tone, used by tags and icon boxes.
const TONE_CLASSES: Record<Tone, { bg: string; fg: string; border: string }> = {
    neutral: { bg: 'bg-neutral-100', fg: 'text-neutral-600', border: 'border-transparent' },
    primary: { bg: 'bg-primary-50', fg: 'text-primary-600', border: 'border-primary-100' },
    success: { bg: 'bg-success-50', fg: 'text-success-700', border: 'border-success-100' },
    warning: { bg: 'bg-warning-50', fg: 'text-warning-700', border: 'border-warning-100' },
    danger: { bg: 'bg-danger-50', fg: 'text-danger-700', border: 'border-danger-100' },
    info: { bg: 'bg-info-50', fg: 'text-info-700', border: 'border-info-100' },
};

export interface AssessmentTypeMeta {
    /** i18n key under assessmentScheduleTestDetails:types */
    key: string;
    Icon: Icon;
    tone: Tone;
}

const EXAM_META: AssessmentTypeMeta = { key: 'examination', Icon: Exam, tone: 'primary' };

// Keyed by the backend play_mode (AssessmentModeEnum). Legacy values map onto
// the same six the create picker offers.
export const ASSESSMENT_TYPE_META: Record<string, AssessmentTypeMeta> = {
    EXAM: EXAM_META,
    MOCK: { key: 'mock', Icon: Timer, tone: 'info' },
    PRACTICE: { key: 'practice', Icon: Barbell, tone: 'success' },
    SURVEY: { key: 'survey', Icon: ChatCenteredText, tone: 'warning' },
    MANUAL_UPLOAD: { key: 'offline', Icon: Scan, tone: 'neutral' },
    MANUAL_UPLOAD_EXAM: { key: 'offline', Icon: Scan, tone: 'neutral' },
    ASSIGNMENT: { key: 'assignment', Icon: ClipboardText, tone: 'info' },
    HOMEWORK: { key: 'assignment', Icon: ClipboardText, tone: 'info' },
};

export const typeMetaFor = (playMode: string | null | undefined): AssessmentTypeMeta =>
    ASSESSMENT_TYPE_META[(playMode ?? '').toUpperCase()] ?? EXAM_META;

// The list tab decides the status chip: the API only says PUBLISHED/DRAFT and
// the tab is what separates live from upcoming from closed.
const LIVE_STATUS = { key: 'live', tone: 'success' as Tone };

export const STATUS_BY_TAB: Record<string, { key: string; tone: Tone }> = {
    liveTests: LIVE_STATUS,
    upcomingTests: { key: 'upcoming', tone: 'info' },
    previousTests: { key: 'closed', tone: 'neutral' },
    draftTests: { key: 'draft', tone: 'warning' },
};

export const statusForTab = (selectedTab: string) => STATUS_BY_TAB[selectedTab] ?? LIVE_STATUS;

export function AssessmentTag({
    tone = 'neutral',
    dot,
    icon,
    children,
    className,
}: {
    tone?: Tone;
    dot?: boolean;
    icon?: ReactNode;
    children: ReactNode;
    className?: string;
}) {
    const c = TONE_CLASSES[tone];
    return (
        <span
            className={cn(
                'inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-caption font-semibold',
                c.bg,
                c.fg,
                c.border,
                className
            )}
        >
            {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
            {icon}
            {children}
        </span>
    );
}

export function AssessmentIconBox({
    Icon,
    tone = 'primary',
    size = 'md',
    className,
}: {
    Icon: AssessmentTypeMeta['Icon'];
    tone?: Tone;
    size?: 'sm' | 'md' | 'lg';
    className?: string;
}) {
    const c = TONE_CLASSES[tone];
    const box = { sm: 'size-8', md: 'size-10', lg: 'size-12' }[size];
    const glyph = { sm: 16, md: 20, lg: 24 }[size];
    return (
        <span
            className={cn(
                'inline-flex shrink-0 items-center justify-center rounded-lg',
                box,
                c.bg,
                c.fg,
                className
            )}
        >
            <Icon size={glyph} />
        </span>
    );
}

export function AssessmentMeta({
    icon,
    children,
    className,
}: {
    icon: ReactNode;
    children: ReactNode;
    className?: string;
}) {
    return (
        <span
            className={cn(
                'inline-flex min-w-0 items-center gap-1.5 text-caption text-neutral-600',
                className
            )}
        >
            <span className="shrink-0 text-neutral-500">{icon}</span>
            <span className="truncate">{children}</span>
        </span>
    );
}
