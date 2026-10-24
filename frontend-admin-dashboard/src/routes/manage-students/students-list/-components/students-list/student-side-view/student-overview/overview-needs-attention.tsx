import { StudentTable } from '@/types/student-table-types';
import {
    Lightning,
    CheckCircle,
    FileX,
    PaperPlaneTilt,
    CurrencyInr,
    Wallet,
    TrendUp,
    CaretRight,
    type Icon as PhosphorIcon,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

type Tone = 'danger' | 'warning' | 'info' | 'success';

interface AttentionItem {
    id: string;
    tone: Tone;
    icon: PhosphorIcon;
    title: string;
    description: string;
    actionLabel: string;
    actionIcon?: PhosphorIcon;
    onAction?: () => void;
}

/** Maps tone → icon-chip background + foreground token classes. */
const TONE_CHIP_CLASSES: Record<Tone, string> = {
    danger: 'bg-danger-50 text-danger-600',
    warning: 'bg-warning-50 text-warning-600',
    info: 'bg-info-50 text-info-600',
    success: 'bg-success-50 text-success-600',
};

/**
 * Soft action-pill classes — per the handoff EVERY row's button uses the
 * BRAND accent (green in default Vacademy / tenant-themed primary in
 * white-labels), regardless of the row's own tone. The row's tone lives in
 * the LEFT icon chip (warning triangle, danger ₹, info phone). Mixing tones
 * across buttons would read as four different actions; keeping them uniform
 * keeps the action surface consistent and the eye lands on the issue's
 * coloured chip first.
 */
const ACTION_PILL_CLASSES =
    'bg-primary-50 text-primary-700 ring-1 ring-primary-100 hover:bg-primary-100 hover:text-primary-800 focus-visible:ring-primary-300';

/**
 * Needs Attention card — the action-first hero strip on the Overview tab.
 *
 * Per Vacademy design handoff. Replaces the previous compact alert chip
 * with a structured card: header row (⚡ + "Needs attention" + count badge)
 * + one row per issue: icon chip + title + description + soft action button.
 *
 * When there's nothing wrong, renders a single green "All clear" bar instead.
 *
 * Per the handoff spec, the action button on each row jumps the admin to the
 * relevant tab (T&C → Send dialog, Outstanding → Payment, Behind → Progress,
 * Follow-up → Lead). For this v1 only T&C is wired (the only condition
 * derivable from the data already loaded on Overview). Outstanding ₹,
 * behind-subjects, and lead inactivity light up once Phase A-2 wires their
 * react-query loaders.
 */
export const OverviewNeedsAttention = ({
    student,
    tncAccepted,
    outstandingAmount,
    behindCount,
    onSendTncReminder,
    onCollect,
    onReviewProgress,
}: {
    student: StudentTable | null;
    tncAccepted: boolean | undefined;
    /** Sum of unpaid invoices in INR. Undefined when not yet loaded. */
    outstandingAmount?: number;
    /** Number of active courses where the learner is behind (handoff #3). */
    behindCount?: number;
    /** Callback for the "Send" T&C reminder action. */
    onSendTncReminder?: () => void;
    /** Callback for the "Collect" outstanding action — jumps to Payment tab. */
    onCollect?: () => void;
    /** Callback for the "Review" behind action — jumps to Progress tab. */
    onReviewProgress?: () => void;
}) => {
    const { t } = useTranslation('manageStudentsOverviewNeedsAttention');

    if (!student) return null;

    const items: AttentionItem[] = [];

    // Condition 1: Terms & Conditions not signed → "Send" reminder.
    if (tncAccepted === false) {
        items.push({
            id: 'tnc',
            tone: 'warning',
            icon: FileX,
            title: t('items.tnc.title'),
            description: t('items.tnc.description'),
            actionLabel: t('actions.send'),
            actionIcon: PaperPlaneTilt,
            onAction: onSendTncReminder,
        });
    }

    // Condition 2: outstanding > 0 → "Collect" — top priority for admins.
    if (outstandingAmount && outstandingAmount > 0) {
        items.push({
            id: 'outstanding',
            tone: 'danger',
            icon: CurrencyInr,
            title: t('items.outstanding.title', {
                amount: outstandingAmount.toLocaleString('en-IN'),
            }),
            description: t('items.outstanding.description'),
            actionLabel: t('actions.collect'),
            actionIcon: Wallet,
            onAction: onCollect,
        });
    }

    // Condition 3: behindSubjects > 0 → "Review" → Progress tab.
    if (behindCount && behindCount > 0) {
        items.push({
            id: 'behind',
            tone: 'warning',
            icon: TrendUp,
            title: t('items.behind.title', { count: behindCount }),
            description: t('items.behind.description'),
            actionLabel: t('actions.review'),
            actionIcon: CaretRight,
            onAction: onReviewProgress,
        });
    }

    // TODO (later): lead inactivityNote -> "Schedule" -> Lead tab.

    // Empty state — green "all clear" bar.
    if (items.length === 0) {
        return (
            <div className="flex items-center gap-2.5 rounded-lg border border-success-200 bg-success-50 px-4 py-3">
                <CheckCircle className="size-5 shrink-0 text-success-600" weight="fill" />
                <span className="text-body font-semibold text-success-700">
                    {t('allClear')}
                </span>
            </div>
        );
    }

    return (
        <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            {/* Header row — plain card surface per handoff (no tinted bg). */}
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                <Lightning className="size-4 text-warning-500" weight="fill" />
                <span className="text-body font-bold text-card-foreground">
                    {t('heading')}
                </span>
                <span className="inline-flex items-center rounded-full bg-warning-50 px-2 py-0.5 text-caption font-bold text-warning-700">
                    {items.length}
                </span>
            </div>

            {/* Rows — each row's action is a tone-coloured SOFT PILL per the
                handoff: tinted bg + matching text colour + subtle ring, so
                the action reads as the row's primary affordance. */}
            <ul className="divide-y divide-border">
                {items.map((it) => {
                    const IconCmp = it.icon;
                    const ActionIcon = it.actionIcon;
                    const disabled = !it.onAction;
                    return (
                        <li
                            key={it.id}
                            className="flex items-center gap-3 px-4 py-3"
                        >
                            <span
                                className={cn(
                                    'flex size-8 shrink-0 items-center justify-center rounded-md',
                                    TONE_CHIP_CLASSES[it.tone]
                                )}
                            >
                                <IconCmp className="size-4" weight="fill" />
                            </span>
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-body font-semibold text-card-foreground">
                                    {it.title}
                                </div>
                                <div className="truncate text-caption text-muted-foreground">
                                    {it.description}
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={it.onAction}
                                disabled={disabled}
                                className={cn(
                                    'inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-caption font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2',
                                    ACTION_PILL_CLASSES,
                                    disabled && 'cursor-not-allowed opacity-60'
                                )}
                            >
                                {it.actionLabel}
                                {ActionIcon && <ActionIcon className="size-3.5" weight="bold" />}
                            </button>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
};
