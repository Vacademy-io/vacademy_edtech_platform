import { useState } from 'react';
import {
    ArrowSquareOut,
    CaretDown,
    CaretUp,
    Check,
    EnvelopeSimple,
    MapPin,
    MapTrifold,
    Phone,
    UserCircle,
    X,
    type Icon,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { StatusChip } from '@/components/design-system/status-chips';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTime } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import type { CandidateSummary, ScoreParts, SentPhone } from '../-types';
import {
    CANDIDATE_STATUS_LABEL,
    CONTACT_QUALITY_LABEL,
    flagLabel,
    isRiskFlag,
    skippedLabel,
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

/** The pill is read against the agent's minimum score to send: at or above is good, below is weak. */
const scoreTone = (score: number | null, sendScore: number) =>
    score === null
        ? 'border-neutral-200 bg-neutral-50 text-neutral-600'
        : score >= sendScore
          ? 'border-success-300 bg-success-50 text-success-700'
          : 'border-warning-300 bg-warning-50 text-warning-700';

/** Colour is not the only cue: the screen-reader label says which side of the bar the score is on. */
const scoreLabel = (score: number | null, sendScore: number) =>
    score === null
        ? 'Not scored yet'
        : `Score ${score}, ${score >= sendScore ? 'at or above' : 'below'} the minimum score to send (${sendScore})`;

function QualityPill({ quality }: { quality: string }) {
    if (!quality) return null;
    return (
        <span className="rounded-md bg-neutral-100 px-2 py-0.5 text-caption text-neutral-600">
            {CONTACT_QUALITY_LABEL[quality] ?? quality}
        </span>
    );
}

/** The phone came from, or is also on, the organisation's Google Maps listing. */
function MapsCue({ phone }: { phone: SentPhone }) {
    if (!phone.maps_confirmed && !phone.from_maps) return null;
    return (
        <span
            className={cn(
                'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-caption',
                phone.maps_confirmed ? 'bg-success-50 text-success-700' : 'bg-info-50 text-info-700'
            )}
        >
            <MapTrifold className="size-3" aria-hidden />
            {phone.maps_confirmed ? 'Confirmed on Google Maps' : 'From Google Maps'}
        </span>
    );
}

function ContactLine({
    icon: ContactIcon,
    label,
    value,
    quality,
    note,
    children,
}: {
    icon: Icon;
    label: string;
    value: string;
    quality: string;
    note?: string | null;
    children?: React.ReactNode;
}) {
    return (
        <div className="flex flex-wrap items-center gap-2 text-neutral-700">
            <ContactIcon className="size-4 text-neutral-500" aria-label={label} />
            <span className="break-all font-semibold">{value}</span>
            <QualityPill quality={quality} />
            {children}
            {note && <span className="text-caption text-neutral-500">{note}</span>}
        </div>
    );
}

/** The phone, email and name delivery will send (`send`); the older `best_contact` when there is none. */
function WhatIsSent({ c }: { c: CandidateSummary }) {
    const send = c.send;
    if (send && (send.phone || send.email)) {
        const namedAfter = send.name && send.name !== c.org.name ? send.name : null;
        return (
            <>
                {send.phone && (
                    <ContactLine
                        icon={Phone}
                        label="Phone sent"
                        value={send.phone.value}
                        quality={send.phone.quality}
                        note={send.phone.quality_note}
                    >
                        <MapsCue phone={send.phone} />
                    </ContactLine>
                )}
                {send.email && (
                    <ContactLine
                        icon={EnvelopeSimple}
                        label="Email sent"
                        value={send.email.value}
                        quality={send.email.quality}
                        note={send.email.quality_note}
                    />
                )}
                {namedAfter && (
                    <p className="text-caption text-neutral-600">
                        Lead name: {namedAfter}
                        {send.role ? ` (${send.role})` : ''}
                    </p>
                )}
                {send.ask_for && (
                    <p className="flex items-center gap-2 text-neutral-700">
                        <UserCircle className="size-4 shrink-0 text-neutral-500" aria-hidden />
                        <span>
                            Ask for: <span className="font-semibold">{send.ask_for}</span>
                        </span>
                    </p>
                )}
            </>
        );
    }
    const contact = c.best_contact;
    if (!contact) return <span className="text-caption text-neutral-500">No contact found</span>;
    const isEmail = contact.kind === 'published_email' || contact.kind === 'email';
    return (
        <ContactLine
            icon={isEmail ? EnvelopeSimple : Phone}
            label={isEmail ? 'Email' : 'Phone'}
            value={contact.value}
            quality={contact.quality}
            note={contact.label}
        />
    );
}

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
                {c.maps_only && (
                    <p className="flex items-start gap-2 rounded-md border border-info-200 bg-info-50 p-2 text-caption text-info-700">
                        <MapTrifold className="size-4 shrink-0" aria-hidden />
                        Judged from its Google Maps listing — the website could not be read.
                    </p>
                )}
                {c.evidence.length === 0 ? (
                    !c.maps_only && (
                        <p className="text-caption text-neutral-500">
                            No quotes saved for this lead.
                        </p>
                    )
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
    sendScore,
}: {
    candidate: CandidateSummary;
    /** The agent's minimum score to send; the score pill is coloured against it. */
    sendScore: number;
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
    const skipped = c.status === 'SKIPPED';
    // A skip chip that already carries the note does not repeat it as the reason.
    const showTopReason =
        !!c.top_reason && !(skipped && !c.duplicate_of && c.top_reason === c.delivery_note);

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
                        {c.status !== 'REVIEW' && !skipped && (
                            <span>{CANDIDATE_STATUS_LABEL[c.status]}</span>
                        )}
                    </div>
                </div>
                <div
                    className={cn(
                        'flex shrink-0 flex-col items-center rounded-md border px-3 py-1',
                        scoreTone(c.score, sendScore)
                    )}
                    aria-label={scoreLabel(c.score, sendScore)}
                >
                    <span className="text-title font-semibold">{c.score ?? '—'}</span>
                    <span className="text-caption">score</span>
                </div>
            </div>

            {skipped && (
                <StatusChip
                    text={skippedLabel(c.duplicate_of, c.delivery_note)}
                    textSize="text-caption"
                    status="INFO"
                />
            )}

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
                <WhatIsSent c={c} />
                {showTopReason && <p className="text-neutral-600">{c.top_reason}</p>}
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
