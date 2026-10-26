import { useState } from 'react';
import {
    ArrowSquareOut,
    CaretDown,
    CaretUp,
    Check,
    EnvelopeSimple,
    MapPin,
    Phone,
    X,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTime } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import type { CandidateSummary, ScoreParts } from '../-types';
import {
    CANDIDATE_STATUS_LABEL,
    CONTACT_QUALITY_LABEL,
    flagLabel,
    isRiskFlag,
} from '../-utils/lead-agent-options';
import { useCandidate } from '../-hooks/use-lead-agent';

const safeHref = (url: string | null | undefined): string | null => {
    if (!url) return null;
    const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    try {
        const u = new URL(withScheme);
        return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
    } catch {
        return null;
    }
};

const PART_LABELS: { key: keyof ScoreParts; label: string }[] = [
    { key: 'fit', label: 'Fit' },
    { key: 'intent', label: 'Intent' },
    { key: 'reach', label: 'Reach' },
    { key: 'risk', label: 'Risk' },
];

export function ScoreBars({ parts }: { parts: ScoreParts }) {
    return (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
            {PART_LABELS.map(({ key, label }) => {
                const v = Math.max(0, Math.min(100, Math.round(parts[key])));
                return (
                    <div key={key} className="flex flex-col gap-1">
                        <div className="flex items-center justify-between text-caption text-neutral-500">
                            <span>{label}</span>
                            <span className="font-semibold text-neutral-700">{v}</span>
                        </div>
                        <Progress
                            value={v}
                            className="h-1.5 !bg-neutral-100"
                            aria-label={`${label} ${v} of 100${key === 'risk' ? ', lower is better' : ''}`}
                        />
                    </div>
                );
            })}
        </div>
    );
}

const scoreTone = (score: number | null) =>
    score === null
        ? 'border-neutral-200 bg-neutral-50 text-neutral-600'
        : score >= 70
          ? 'border-success-300 bg-success-50 text-success-700'
          : score >= 45
            ? 'border-warning-300 bg-warning-50 text-warning-700'
            : 'border-danger-200 bg-danger-50 text-danger-700';

function Details({ candidateId, fallbackParts }: { candidateId: string; fallbackParts: boolean }) {
    const q = useCandidate(candidateId, true);
    if (q.isLoading) return <Skeleton className="h-24 w-full" />;
    if (q.isError || !q.data)
        return (
            <p className="text-caption text-danger-600">
                Could not load the details.{' '}
                <button
                    type="button"
                    className="font-semibold underline"
                    onClick={() => void q.refetch()}
                >
                    Try again
                </button>
            </p>
        );
    const c = q.data;
    const reasons = c.score_json?.reasons ?? [];
    return (
        <div className="flex flex-col gap-4">
            {fallbackParts && c.score_json && <ScoreBars parts={c.score_json} />}
            {reasons.length > 0 && (
                <div className="flex flex-col gap-1">
                    <span className="text-caption font-semibold text-neutral-700">Why</span>
                    <ul className="list-disc ps-5 text-body text-neutral-700">
                        {reasons.slice(0, 6).map((r) => (
                            <li key={r}>{r}</li>
                        ))}
                    </ul>
                </div>
            )}
            {(c.score_json?.products ?? []).length > 0 && (
                <div className="flex flex-wrap gap-2 text-caption text-neutral-600">
                    {(c.score_json?.products ?? []).map((p, i) => (
                        <span key={`${p.key}-${i}`} className="rounded-md bg-neutral-100 px-2 py-1">
                            {p.name}: {p.score ?? '—'}
                        </span>
                    ))}
                </div>
            )}
            <div className="flex flex-col gap-2">
                <span className="text-caption font-semibold text-neutral-700">Evidence</span>
                {c.evidence.length === 0 ? (
                    <p className="text-caption text-neutral-500">No quotes saved for this lead.</p>
                ) : (
                    <ul className="flex flex-col gap-2">
                        {c.evidence.map((e, i) => {
                            const href = safeHref(e.url);
                            return (
                                <li
                                    key={`${e.field}-${i}`}
                                    className="rounded-md border border-neutral-200 p-2 text-body"
                                >
                                    {e.field && (
                                        <span className="text-caption font-semibold text-neutral-600">
                                            {e.field}
                                        </span>
                                    )}
                                    {e.quote && <p className="text-neutral-700">“{e.quote}”</p>}
                                    {href && (
                                        <a
                                            href={href}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex max-w-full items-center gap-1 truncate text-caption text-primary-500 hover:underline"
                                        >
                                            <ArrowSquareOut className="size-3 shrink-0" />
                                            <span className="truncate">{e.url}</span>
                                        </a>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </div>
    );
}

export function CandidateCard({
    candidate: c,
    selectable,
    selected,
    onSelectedChange,
    onApprove,
    onReject,
    busy,
    listLink,
}: {
    candidate: CandidateSummary;
    selectable?: boolean;
    selected?: boolean;
    onSelectedChange?: (on: boolean) => void;
    onApprove?: () => void;
    onReject?: () => void;
    busy?: boolean;
    listLink?: React.ReactNode;
}) {
    const [open, setOpen] = useState(false);
    const website = safeHref(c.org.website ?? c.org.domain);
    const contact = c.best_contact;
    const ContactIcon = contact?.kind === 'email' ? EnvelopeSimple : Phone;

    return (
        <article
            className={cn(
                'flex flex-col gap-3 rounded-lg border bg-card p-4',
                selected ? 'border-primary-300' : 'border-neutral-200'
            )}
        >
            <div className="flex items-start gap-3">
                {selectable && (
                    <Checkbox
                        checked={!!selected}
                        onCheckedChange={(on) => onSelectedChange?.(on === true)}
                        aria-label={`Select ${c.org.name}`}
                        className="mt-1"
                    />
                )}
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <h3 className="truncate text-subtitle font-semibold text-neutral-800">
                        {c.org.name}
                    </h3>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-neutral-500">
                        {website && (
                            <a
                                href={website}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-primary-500 hover:underline"
                            >
                                {c.org.domain || website}
                                <ArrowSquareOut className="size-3" />
                            </a>
                        )}
                        {c.org.city && (
                            <span className="inline-flex items-center gap-1">
                                <MapPin className="size-3" />
                                {c.org.city}
                            </span>
                        )}
                        {c.status !== 'REVIEW' && <span>{CANDIDATE_STATUS_LABEL[c.status]}</span>}
                    </div>
                </div>
                <div
                    className={cn(
                        'flex shrink-0 flex-col items-center rounded-md border px-3 py-1',
                        scoreTone(c.score)
                    )}
                    aria-label={`Score ${c.score ?? 'not scored'}`}
                >
                    <span className="text-title font-semibold">{c.score ?? '—'}</span>
                    <span className="text-caption">score</span>
                </div>
            </div>

            {c.parts && <ScoreBars parts={c.parts} />}

            {c.flags.length > 0 && (
                <ul className="flex flex-wrap gap-2" aria-label="Flags">
                    {c.flags.map((f) => (
                        <li
                            key={f}
                            className={cn(
                                'rounded-full border px-2 py-0.5 text-caption',
                                isRiskFlag(f)
                                    ? 'border-warning-300 bg-warning-50 text-warning-700'
                                    : 'border-info-200 bg-info-50 text-info-700'
                            )}
                        >
                            {flagLabel(f)}
                        </li>
                    ))}
                </ul>
            )}

            <div className="flex flex-col gap-1 text-body">
                {contact ? (
                    <div className="flex flex-wrap items-center gap-2 text-neutral-700">
                        <ContactIcon className="size-4 text-neutral-500" />
                        <span className="font-semibold">{contact.value}</span>
                        <span className="rounded-md bg-neutral-100 px-2 py-0.5 text-caption text-neutral-600">
                            {CONTACT_QUALITY_LABEL[contact.quality] ?? contact.quality}
                        </span>
                        {contact.label && (
                            <span className="text-caption text-neutral-500">{contact.label}</span>
                        )}
                    </div>
                ) : (
                    <span className="text-caption text-neutral-500">No contact found</span>
                )}
                {c.top_reason && <p className="text-neutral-600">{c.top_reason}</p>}
                {c.status === 'REJECTED' && c.reject_reason && (
                    <p className="text-caption text-danger-700">Rejected: {c.reject_reason}</p>
                )}
                {c.status === 'DELIVERED' && (
                    <p className="flex flex-wrap items-center gap-2 text-caption text-success-700">
                        Delivered{c.delivered_at ? ` ${formatDateTime(c.delivered_at)}` : ''}
                        {listLink}
                    </p>
                )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
                <MyButton
                    type="button"
                    buttonType="text"
                    scale="small"
                    onClick={() => setOpen((o) => !o)}
                    aria-expanded={open}
                    className="px-0"
                >
                    {open ? <CaretUp className="size-4" /> : <CaretDown className="size-4" />}
                    {open ? 'Hide evidence' : 'Show evidence'}
                </MyButton>
                {(onApprove || onReject) && (
                    <div className="flex gap-2">
                        {onReject && (
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="small"
                                disable={busy}
                                onClick={onReject}
                            >
                                <X className="size-4" /> Reject
                            </MyButton>
                        )}
                        {onApprove && (
                            <MyButton
                                type="button"
                                buttonType="primary"
                                scale="small"
                                disable={busy}
                                onClick={onApprove}
                            >
                                <Check className="size-4" /> Approve
                            </MyButton>
                        )}
                    </div>
                )}
            </div>
            {open && <Details candidateId={c.id} fallbackParts={!c.parts} />}
        </article>
    );
}
