import { useState } from 'react';
import { CaretDown, CaretRight } from '@phosphor-icons/react';
import type { LiveActivityCategory } from '../-services/live-activity-service';
import type { CollapsedActivity, JourneyState } from './collapse-events';
import { describeActivity } from './activity-sentence';

const CATEGORY_TONE: Record<LiveActivityCategory, string> = {
    INVITE_FORM: 'bg-primary-50 text-primary-600',
    LEAD_FORM: 'bg-info-50 text-info-600',
    CALL: 'bg-warning-50 text-warning-600',
    PAYMENT: 'bg-success-50 text-success-600',
    COUNSELLOR: 'bg-neutral-100 text-neutral-600',
};

const CATEGORY_LABEL: Record<LiveActivityCategory, string> = {
    INVITE_FORM: 'Enrolment',
    LEAD_FORM: 'Lead',
    CALL: 'Call',
    PAYMENT: 'Payment',
    COUNSELLOR: 'Counsellor',
};

/**
 * State badges.
 *
 * <p>Stage is a badge rather than a sentence because it is the field an admin scans for.
 * "Payment pending" buried mid-prose in a list of twenty rows is invisible -- as a pill it
 * is the first thing read. Each carries a word, never colour alone.
 */
const STATE_BADGE: Record<JourneyState, { label: string; tone: string } | null> = {
    FORM_FILLED: { label: 'Form filled', tone: 'bg-neutral-100 text-neutral-600' },
    // Amber: this is the one an admin should act on, and the only feed state that is a
    // call to action rather than a record of something finished.
    PAYMENT_PENDING: { label: 'Payment pending', tone: 'bg-warning-50 text-warning-700' },
    PAID: { label: 'Paid', tone: 'bg-success-50 text-success-700' },
    ENROLLED: { label: 'Enrolled', tone: 'bg-success-50 text-success-700' },
    CALL_IN_PROGRESS: { label: 'On call', tone: 'bg-info-50 text-info-700' },
    CALL_ENDED: null,
    NONE: null,
};

export function ActivityRow({ group }: { group: CollapsedActivity }) {
    const [expanded, setExpanded] = useState(false);
    const { latest, transitions, state } = group;
    const sentence = describeActivity(latest);
    const badge = STATE_BADGE[state];
    // Length > 1 only happens for a call, where several transitions fold into one row.
    const hasTransitions = transitions.length > 1;

    return (
        <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2.5">
            <div className="flex items-start gap-3">
                <span
                    className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-caption ${CATEGORY_TONE[latest.category]}`}
                >
                    {CATEGORY_LABEL[latest.category]}
                </span>

                <div className="min-w-0 flex-1">
                    <p className="text-body text-neutral-700">
                        {sentence.subject && (
                            <span className="font-semibold">{sentence.subject}</span>
                        )}{' '}
                        {sentence.verb}
                        {sentence.detail && (
                            <span className="text-neutral-500"> · {sentence.detail}</span>
                        )}
                        {badge && (
                            <span
                                className={`ms-2 inline-block rounded px-1.5 py-0.5 text-caption ${badge.tone}`}
                            >
                                {badge.label}
                            </span>
                        )}
                    </p>

                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-caption text-neutral-500">
                        <span>{formatRelative(latest.occurredAtEpochMillis)}</span>
                        {latest.counsellorName && <span>· {latest.counsellorName}</span>}
                        {latest.subjectMobile && <span>· {latest.subjectMobile}</span>}
                        {hasTransitions && (
                            <button
                                type="button"
                                onClick={() => setExpanded(!expanded)}
                                className="inline-flex items-center gap-0.5 text-primary-600 hover:underline"
                            >
                                {expanded ? (
                                    <CaretDown className="size-3" />
                                ) : (
                                    <CaretRight className="size-3" />
                                )}
                                {transitions.length} steps
                            </button>
                        )}
                    </div>

                    {expanded && hasTransitions && (
                        <ul className="mt-2 border-l border-neutral-200 pl-3 text-caption text-neutral-500">
                            {[...transitions]
                                .sort((a, b) => a.occurredAtEpochMillis - b.occurredAtEpochMillis)
                                .map((step) => (
                                    <li key={step.eventId} className="py-0.5">
                                        {describeActivity(step).verb}
                                        <span className="ml-2">
                                            {formatClock(step.occurredAtEpochMillis)}
                                        </span>
                                    </li>
                                ))}
                        </ul>
                    )}
                </div>
            </div>
        </div>
    );
}

function formatRelative(epochMillis: number): string {
    const seconds = Math.max(0, Math.floor((Date.now() - epochMillis) / 1000));
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

function formatClock(epochMillis: number): string {
    return new Date(epochMillis).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
}
