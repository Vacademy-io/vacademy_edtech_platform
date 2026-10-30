import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import { PhoneCall, Tray } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SectionCard } from '@/routes/study-library/live-session/-components/dashboard/dashboard-charts';
import { Chip, SubHeading } from './engine-ui';
import { useUpcomingCalls } from '../-hooks/actions';
import { useTaskPeople } from '../-hooks';
import { formatDateTime } from '../-utils';
import type { TaskPerson } from '../-types';
import type { UpcomingCall, UpcomingCallState, UpcomingCalls } from '../-types/actions';

const SECTION_ORDER: UpcomingCallState[] = ['NEEDS_APPROVAL', 'SCHEDULED', 'IN_QUEUE', 'PLACED'];

const STATE_TINT: Record<UpcomingCallState, string> = {
    NEEDS_APPROVAL: 'bg-warning-50 text-warning-700',
    SCHEDULED: 'bg-info-50 text-info-700',
    IN_QUEUE: 'bg-primary-50 text-primary-500',
    PLACED: 'bg-success-50 text-success-700',
};

/** Call results the card names; anything else shows as it comes. */
const CALL_RESULTS = ['COMPLETED', 'NO_ANSWER', 'BUSY', 'FAILED'] as const;

/** The person a call is for, as one line: name, else phone, else email. */
function personTitle(p?: TaskPerson): string | undefined {
    return p?.name?.trim() || p?.phone?.trim() || p?.email?.trim() || undefined;
}

const isPast = (iso?: string | null) => !!iso && new Date(iso).getTime() <= Date.now();

/**
 * The engine page's answer to "when will it call, and whom": whether calls still need approval
 * (and how many approvals until they go out on their own), every call waiting for approval, held
 * for a later time or in the dialer queue, the calls placed in the last day, and the people whose
 * first touch will be a call.
 */
export function UpcomingAiCallsCard({ engineId }: { engineId: string }) {
    const { t } = useTranslation('engagementEnginesActions');
    const navigate = useNavigate();
    const { data, isLoading, isError } = useUpcomingCalls(engineId);
    const memberIds = [
        ...(data?.calls ?? []).map((c) => c.memberId),
        ...(data?.firstCalls ?? []).map((f) => f.memberId),
    ];
    const { data: people } = useTaskPeople(memberIds);

    // An older backend (no endpoint) or an engine without calls: nothing to show.
    if (isError || (data && !data.callingOn && data.calls.length === 0)) return null;

    const needsApproval = data?.calls.filter((c) => c.state === 'NEEDS_APPROVAL').length ?? 0;
    const nameOf = (memberId: string) =>
        personTitle(people?.[memberId]) ?? t('upcomingCalls.someone');

    return (
        <SectionCard
            title={t('upcomingCalls.title')}
            subtitle={data ? modeLine(data, t) : undefined}
            icon={PhoneCall}
            right={
                needsApproval > 0 ? (
                    <MyButton
                        buttonType="primary"
                        scale="small"
                        onClick={() =>
                            navigate({
                                to: '/engagement-engines/inbox',
                                search: { filter: 'approvals', engine: engineId },
                            })
                        }
                    >
                        <Tray className="me-1 size-4" />{' '}
                        {t('upcomingCalls.review', { count: needsApproval })}
                    </MyButton>
                ) : undefined
            }
        >
            {isLoading && (
                <div className="flex flex-col gap-2">
                    {[0, 1].map((i) => (
                        <Skeleton key={i} className="h-12 w-full rounded-lg" />
                    ))}
                </div>
            )}
            {data && (
                <div className="flex flex-col">
                    {data.calls.length === 0 && data.firstCallsTotal === 0 && (
                        <p className="text-neutral-500">
                            <span className="text-body">{t('upcomingCalls.empty')}</span>
                        </p>
                    )}
                    {SECTION_ORDER.map((state) => {
                        const rows = data.calls.filter((c) => c.state === state);
                        if (rows.length === 0) return null;
                        return (
                            <section key={state}>
                                <SubHeading>
                                    {t(`upcomingCalls.section.${state}`, { count: rows.length })}
                                </SubHeading>
                                <ul className="flex flex-col divide-y divide-neutral-100">
                                    {rows.map((c) => (
                                        <CallRow
                                            key={c.actionId}
                                            call={c}
                                            name={nameOf(c.memberId)}
                                        />
                                    ))}
                                </ul>
                            </section>
                        );
                    })}
                    {data.firstCallsTotal > 0 && (
                        <section>
                            <SubHeading>
                                {t('upcomingCalls.section.FIRST', { count: data.firstCallsTotal })}
                            </SubHeading>
                            <p className="mb-1 text-neutral-500">
                                <span className="text-caption">{t('upcomingCalls.firstHint')}</span>
                            </p>
                            <ul className="flex flex-col divide-y divide-neutral-100">
                                {data.firstCalls.map((f) => {
                                    const person = people?.[f.memberId];
                                    const noPhone = !!person && !person.phone?.trim();
                                    return (
                                        <li
                                            key={f.memberId}
                                            className="flex flex-wrap items-center justify-between gap-2 py-2"
                                        >
                                            <span className="min-w-0 truncate font-medium text-neutral-800">
                                                <span className="text-body">
                                                    {nameOf(f.memberId)}
                                                </span>
                                            </span>
                                            <span className="flex flex-wrap items-center gap-2">
                                                {noPhone && (
                                                    <Chip
                                                        label={t('upcomingCalls.noPhone')}
                                                        className="bg-neutral-100 text-neutral-500"
                                                    />
                                                )}
                                                <span className="text-neutral-600">
                                                    <span className="text-caption">
                                                        {isPast(f.nextLookAt)
                                                            ? t('upcomingCalls.nextCheck')
                                                            : t('upcomingCalls.around', {
                                                                  time: formatDateTime(
                                                                      f.nextLookAt ?? undefined
                                                                  ),
                                                              })}
                                                    </span>
                                                </span>
                                            </span>
                                        </li>
                                    );
                                })}
                            </ul>
                            {data.firstCallsTotal > data.firstCalls.length && (
                                <p className="pt-1 text-neutral-500">
                                    <span className="text-caption">
                                        {t('upcomingCalls.more', {
                                            count: data.firstCallsTotal - data.firstCalls.length,
                                        })}
                                    </span>
                                </p>
                            )}
                        </section>
                    )}
                </div>
            )}
        </SectionCard>
    );
}

/** One line under the title: who decides when a call goes out. */
function modeLine(
    d: UpcomingCalls,
    t: (key: string, o?: Record<string, unknown>) => string
): string {
    if (!d.engineLive) return t('upcomingCalls.mode.notLive');
    if (d.killed) return t('upcomingCalls.mode.killed');
    if (!d.auto) return t('upcomingCalls.mode.manual');
    if (d.graduated) return t('upcomingCalls.mode.auto');
    return t('upcomingCalls.mode.learning', { approved: d.approved, threshold: d.threshold });
}

function CallRow({ call, name }: { call: UpcomingCall; name: string }) {
    const { t } = useTranslation('engagementEnginesActions');
    const when = (() => {
        switch (call.state) {
            case 'NEEDS_APPROVAL':
                return call.expiresAt
                    ? t('upcomingCalls.expires', { time: formatDateTime(call.expiresAt) })
                    : '';
            case 'SCHEDULED':
                return t('upcomingCalls.callsAt', { time: formatDateTime(call.at ?? undefined) });
            case 'IN_QUEUE':
                return call.at && !isPast(call.at)
                    ? t('upcomingCalls.notBefore', { time: formatDateTime(call.at) })
                    : t('upcomingCalls.nextFreeLine');
            case 'PLACED':
                return t('upcomingCalls.placedAt', { time: formatDateTime(call.at ?? undefined) });
        }
    })();
    const result =
        call.state === 'PLACED' && call.callStatus
            ? (CALL_RESULTS as readonly string[]).includes(call.callStatus)
                ? t(`upcomingCalls.result.${call.callStatus}`)
                : call.callStatus
            : null;
    return (
        <li className="flex flex-col gap-1 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 truncate font-medium text-neutral-800">
                    <span className="text-body">{name}</span>
                </span>
                <span className="flex flex-wrap items-center gap-2">
                    <Chip
                        label={result ?? t(`upcomingCalls.state.${call.state}`)}
                        className={STATE_TINT[call.state]}
                    />
                    {when && (
                        <span className="text-neutral-600">
                            <span className="text-caption">{when}</span>
                        </span>
                    )}
                </span>
            </div>
            {call.rationale && call.state !== 'PLACED' && (
                <p className="line-clamp-2 text-neutral-500" title={call.rationale}>
                    <span className="text-caption">{call.rationale}</span>
                </p>
            )}
        </li>
    );
}
