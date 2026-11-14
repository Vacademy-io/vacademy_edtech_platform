import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { Phone, PhoneIncoming, PhoneOutgoing } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { MyPagination } from '@/components/design-system/pagination';
import {
    CallStatusPill,
    CallRecordingPlayButton,
    CallIntelligencePanel,
    CallIntelligenceSummary,
    formatCallDuration,
    type CallLogItem,
} from '@/components/shared/leads';
import { useGetUserBasicDetails } from '@/services/get_user_basic_details';
import { fetchCounsellorCalls } from '../-services/telephony-calls-service';

/**
 * CounsellorCallsTab — manager-coaching view of one counsellor's calls inside
 * the workbench drawer: date, lead, direction, outcome, duration, and inline
 * recording playback (presigned URL resolved lazily per call on first Play).
 */

const PAGE_SIZE = 10;

interface Props {
    instituteId: string;
    counsellorUserId: string;
}

export function CounsellorCallsTab({ instituteId, counsellorUserId }: Props) {
    const { t } = useTranslation('counsellorsCallsTab');
    const [page, setPage] = useState(0);

    const callsQuery = useQuery({
        queryKey: ['counsellor-calls', counsellorUserId, instituteId, page],
        enabled: !!instituteId && !!counsellorUserId,
        queryFn: () => fetchCounsellorCalls(counsellorUserId, instituteId, page, PAGE_SIZE),
        placeholderData: (prev) => prev,
        staleTime: 30 * 1000,
    });

    const calls = useMemo(() => callsQuery.data?.content ?? [], [callsQuery.data]);
    const totalPages = Math.max(1, callsQuery.data?.totalPages ?? 1);

    // Lead names live in auth-service — resolve the visible page's user ids in
    // one batched call instead of per-row lookups.
    const leadUserIds = useMemo(
        () => Array.from(new Set(calls.map((c) => c.userId).filter((id): id is string => !!id))),
        [calls]
    );
    const { data: leadUsers } = useGetUserBasicDetails(leadUserIds);
    const nameByUserId = useMemo(() => {
        const map = new Map<string, string>();
        (leadUsers ?? []).forEach((u) => {
            if (u.id && u.name) map.set(u.id, u.name);
        });
        return map;
    }, [leadUsers]);

    if (callsQuery.isLoading) {
        return <div className="p-4 text-subtitle text-neutral-500">{t('loading')}</div>;
    }
    if (callsQuery.isError) {
        return (
            <div className="p-4 text-subtitle text-danger-600">
                {t('error')}
            </div>
        );
    }
    if (calls.length === 0) {
        return (
            <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-neutral-300 p-6 text-center text-subtitle text-neutral-500">
                <Phone size={20} className="text-neutral-400" />
                {t('empty')}
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-2">
            <CallIntelligenceSummary
                mode="counsellor"
                counsellorUserId={counsellorUserId}
                className="mb-1"
            />
            <ul className="space-y-1.5">
                {calls.map((c) => (
                    <CallRow
                        key={c.id}
                        call={c}
                        instituteId={instituteId}
                        leadName={c.userId ? nameByUserId.get(c.userId) : undefined}
                    />
                ))}
            </ul>
            {totalPages > 1 && (
                <div className="mt-1 flex items-center justify-between">
                    <span className="text-caption text-neutral-500">
                        {t('pagination.pageOf', { page: page + 1, total: totalPages })}
                        {callsQuery.isFetching ? t('pagination.loadingSuffix') : ''}
                    </span>
                    <MyPagination
                        currentPage={page + 1}
                        totalPages={totalPages}
                        onPageChange={(p) => setPage(p - 1)}
                    />
                </div>
            )}
        </div>
    );
}

function CallRow({
    call,
    instituteId,
    leadName,
}: {
    call: CallLogItem;
    instituteId: string;
    leadName?: string;
}) {
    const { t } = useTranslation('counsellorsCallsTab');
    const isInbound = call.direction === 'INBOUND';
    // The lead's number is the From on inbound, the To on outbound — masked
    // versions are what the backend exposes.
    const leadPhone = isInbound ? call.fromNumberMasked : call.toNumberMasked;

    return (
        <li className="rounded-md border border-neutral-200 bg-white p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                    {isInbound ? (
                        <PhoneIncoming size={16} className="shrink-0 text-info-600" />
                    ) : (
                        <PhoneOutgoing size={16} className="shrink-0 text-neutral-400" />
                    )}
                    <span
                        className="truncate text-body font-medium text-neutral-900"
                        title={leadName ?? leadPhone ?? undefined}
                    >
                        {leadName ?? leadPhone ?? t('unknownLead')}
                    </span>
                    <CallStatusPill status={call.status} />
                    <span className="text-caption text-neutral-500">
                        · {formatCallDuration(call.durationSeconds)}
                    </span>
                </div>
                <time className="shrink-0 text-caption text-neutral-500">
                    {call.startTime ? format(new Date(call.startTime), 'd MMM yyyy, h:mm a') : '—'}
                </time>
            </div>
            <div
                className={cn(
                    'mt-1 flex flex-wrap items-center gap-2 text-caption text-neutral-500',
                    call.hasRecording && 'justify-between'
                )}
            >
                <span>
                    {isInbound ? t('inbound') : t('outbound')}
                    {leadName && leadPhone ? ` · ${leadPhone}` : ''}
                </span>
                {call.hasRecording && (
                    <CallRecordingPlayButton
                        callLogId={call.id}
                        instituteId={instituteId}
                        className="max-w-xs"
                    />
                )}
            </div>
            <div className="mt-2">
                <CallIntelligencePanel callLogId={call.id} />
            </div>
        </li>
    );
}
