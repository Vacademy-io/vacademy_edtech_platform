import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Camera, Flag, Warning, Image as ImageIcon } from '@phosphor-icons/react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { getPublicUrl } from '@/services/upload_file';
import { getInstituteId } from '@/constants/helper';
import { cn } from '@/lib/utils';
import {
    getAttemptProctorReview,
    type ProctorEvent,
} from '@/services/proctoring-review';

/**
 * The reviewer's view of one attempt's proctoring log: counts up top, the
 * timeline below, evidence loaded lazily as the reviewer opens it. Nothing here
 * changes the attempt — a decision (void / reattempt) is taken through the
 * existing menu items once the reviewer has looked.
 */
export const ProctoringReviewDialog = ({
    attemptId,
    studentName,
    open,
    onOpenChange,
}: {
    attemptId: string;
    studentName: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) => {
    const { t } = useTranslation('assessmentStudentAttemptDropdown');
    const instituteId = getInstituteId();
    const [severityFilter, setSeverityFilter] = useState<'ALL' | 'FLAGS'>('FLAGS');

    const { data, isLoading, isError } = useQuery({
        queryKey: ['PROCTOR_REVIEW', attemptId],
        queryFn: () => getAttemptProctorReview(attemptId, instituteId),
        enabled: open,
        staleTime: 10_000,
        // A reviewer often watches an attempt that is still in progress.
        refetchInterval: open ? 15_000 : false,
    });

    const events = (data?.events ?? []).filter((event) =>
        severityFilter === 'ALL' ? true : event.severity !== 'INFO'
    );

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-dialog-tall w-full max-w-3xl flex-col gap-0 overflow-hidden p-0">
                <DialogHeader className="border-b border-slate-100 px-5 py-4">
                    <DialogTitle className="flex items-center gap-2 text-base">
                        <Camera className="size-5 text-primary-500" />
                        {t('proctoring.title', { name: studentName })}
                    </DialogTitle>
                </DialogHeader>

                {isLoading ? (
                    <div className="p-8">
                        <DashboardLoader />
                    </div>
                ) : isError || !data ? (
                    <p className="p-6 text-sm text-danger-600">{t('proctoring.loadError')}</p>
                ) : (
                    <>
                        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3">
                            <Chip
                                icon={<Flag className="size-3.5" weight="fill" />}
                                tone={data.flag_count > 0 ? 'danger' : 'muted'}
                                label={t('proctoring.flags', { count: data.flag_count })}
                            />
                            <Chip
                                icon={<Warning className="size-3.5" />}
                                tone={data.warn_count > 0 ? 'warning' : 'muted'}
                                label={t('proctoring.warnings', { count: data.warn_count })}
                            />
                            <Chip
                                icon={<ImageIcon className="size-3.5" />}
                                tone="muted"
                                label={t('proctoring.snapshots', { count: data.snapshot_count })}
                            />
                            <span className="ms-auto text-xs text-slate-500">
                                {t('proctoring.tier', { tier: String(data.config?.tier ?? 'NONE') })}
                            </span>
                        </div>

                        <div className="flex items-center gap-1 px-5 pt-3">
                            {(['FLAGS', 'ALL'] as const).map((value) => (
                                <button
                                    key={value}
                                    type="button"
                                    onClick={() => setSeverityFilter(value)}
                                    className={cn(
                                        'rounded-full border px-3 py-1 text-xs',
                                        severityFilter === value
                                            ? 'border-primary-400 bg-primary-50 text-primary-600'
                                            : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                                    )}
                                >
                                    {value === 'FLAGS'
                                        ? t('proctoring.filter.flagsOnly')
                                        : t('proctoring.filter.everything')}
                                </button>
                            ))}
                        </div>

                        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
                            {events.length === 0 ? (
                                <p className="py-8 text-center text-sm text-slate-500">
                                    {data.events.length === 0
                                        ? t('proctoring.empty')
                                        : t('proctoring.noFlags')}
                                </p>
                            ) : (
                                <ol className="flex flex-col gap-2">
                                    {events.map((event) => (
                                        <EventRow key={event.id} event={event} />
                                    ))}
                                </ol>
                            )}
                        </div>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
};

const Chip = ({
    icon,
    label,
    tone,
}: {
    icon: React.ReactNode;
    label: string;
    tone: 'danger' | 'warning' | 'muted';
}) => (
    <span
        className={cn(
            'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium',
            tone === 'danger' && 'border-danger-200 bg-danger-50 text-danger-700',
            tone === 'warning' && 'border-warning-200 bg-warning-50 text-warning-700',
            tone === 'muted' && 'border-slate-200 bg-slate-50 text-slate-600'
        )}
    >
        {icon}
        {label}
    </span>
);

const EventRow = ({ event }: { event: ProctorEvent }) => {
    const { t } = useTranslation('assessmentStudentAttemptDropdown');
    const [showEvidence, setShowEvidence] = useState(false);
    const isFlag = event.severity === 'FLAG';
    const isWarn = event.severity === 'WARN';
    const label = t(`proctoring.events.${event.event_type}`, {
        defaultValue: event.event_type,
    });
    const when = new Date(event.occurred_at).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
    const detail = describeMeta(event.meta);

    return (
        <li className="flex items-start gap-3 rounded-md border border-slate-100 p-3">
            <span
                className={cn(
                    'mt-0.5 size-2.5 shrink-0 rounded-full',
                    isFlag ? 'bg-danger-500' : isWarn ? 'bg-warning-500' : 'bg-slate-300'
                )}
                aria-hidden
            />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-900">{label}</span>
                    <span className="text-xs text-slate-400">{when}</span>
                </div>
                {detail && <span className="text-xs text-slate-500">{detail}</span>}
                {event.evidence_file_id && (
                    <div className="mt-1">
                        {showEvidence ? (
                            <Evidence fileId={event.evidence_file_id} />
                        ) : (
                            <button
                                type="button"
                                onClick={() => setShowEvidence(true)}
                                className="text-xs font-medium text-primary-500 hover:underline"
                            >
                                {t('proctoring.viewSnapshot')}
                            </button>
                        )}
                    </div>
                )}
            </div>
        </li>
    );
};

/** Signed URLs are fetched one at a time and only when asked for — a long log has hundreds. */
const Evidence = ({ fileId }: { fileId: string }) => {
    const { t } = useTranslation('assessmentStudentAttemptDropdown');
    const { data: url, isLoading } = useQuery({
        queryKey: ['PROCTOR_EVIDENCE_URL', fileId],
        queryFn: () => getPublicUrl(fileId),
        staleTime: 10 * 60_000,
    });
    if (isLoading) return <span className="text-xs text-slate-400">…</span>;
    if (!url) return <span className="text-xs text-slate-400">{t('proctoring.snapshotMissing')}</span>;
    return (
        <a href={url} target="_blank" rel="noreferrer">
            <img
                src={url}
                alt={t('proctoring.snapshotAlt')}
                className="max-h-48 rounded-md border border-slate-200 object-contain"
            />
        </a>
    );
};

const describeMeta = (meta: ProctorEvent['meta']) => {
    if (!meta) return '';
    const parts: string[] = [];
    if (typeof meta.faces === 'number') parts.push(`faces: ${meta.faces}`);
    if (typeof meta.seconds === 'number') parts.push(`${meta.seconds}s`);
    if (typeof meta.count === 'number') parts.push(`#${meta.count}`);
    if (typeof meta.detector === 'string') parts.push(String(meta.detector));
    return parts.join(' · ');
};
