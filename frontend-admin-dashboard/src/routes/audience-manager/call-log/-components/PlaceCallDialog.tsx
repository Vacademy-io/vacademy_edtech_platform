import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { MagnifyingGlass, Phone, PhoneOutgoing } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { MyInput } from '@/components/design-system/input';
import { Skeleton } from '@/components/ui/skeleton';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { usePlaceCall } from '@/components/shared/leads';
import { recentLeadToVM } from '@/components/shared/leads/lead-view-model';
import { fetchRecentLeads } from '../../list/-services/get-recent-leads';
import { fetchCallAvailability } from '@/components/shared/leads/services/call-options';

const MIN_CHARS = 3;
/** Call Log queries to refresh when the call ends. */
const CALL_LOG_KEYS = [
    ['crm-call-log-search'],
    ['crm-call-log-metrics'],
    ['crm-call-log-disposition-counts'],
];

/**
 * Call Log: "Place a call" from the page header. Search a lead by name,
 * phone or email (the same search, and the same visibility, as Recent Leads), then
 * dial through the normal click-to-call flow: your phone rings first, the call is
 * logged and the disposition sheet opens when it ends.
 */
export function PlaceCallDialog() {
    const { t } = useTranslation('crmPages');
    const instituteId = getCurrentInstituteId() ?? '';
    const [open, setOpen] = useState(false);
    const [input, setInput] = useState('');
    const [query, setQuery] = useState('');
    useEffect(() => {
        const id = window.setTimeout(() => setQuery(input.trim()), 350);
        return () => window.clearTimeout(id);
    }, [input]);

    const search = useQuery({
        queryKey: ['call-log-place-call', instituteId, query],
        queryFn: () =>
            fetchRecentLeads({
                institute_id: instituteId,
                search_query: query,
                conversion_status_filter: 'ALL',
                page: 0,
                size: 8,
            }),
        enabled: open && !!instituteId && query.length >= MIN_CHARS,
        staleTime: 30 * 1000,
    });
    const leads = useMemo(() => (search.data?.content ?? []).map(recentLeadToVM), [search.data]);
    const placeCall = usePlaceCall({ invalidateKeys: CALL_LOG_KEYS });
    // Same availability check (and cache) the row Call buttons use: hidden when the
    // institute has no calling, disabled with the reason when this user cannot dial.
    const availability = useQuery({
        queryKey: ['telephony-availability', instituteId],
        queryFn: () => fetchCallAvailability(instituteId),
        enabled: !!instituteId,
        staleTime: 5 * 60 * 1000,
    });

    const close = (next: boolean) => {
        setOpen(next);
        if (!next) setInput('');
    };

    if (!availability.data?.enabled) return null;
    const callerReady = availability.data.callerReady;

    return (
        <MyDialog
            open={open}
            onOpenChange={close}
            heading={t('callLog.place.title')}
            dialogWidth="max-w-lg"
            trigger={
                <MyButton
                    buttonType="primary"
                    scale="small"
                    disable={!callerReady}
                    title={callerReady ? undefined : availability.data.reason ?? undefined}
                >
                    <PhoneOutgoing size={14} />
                    {t('callLog.place.button')}
                </MyButton>
            }
        >
            <div className="flex flex-col gap-3 p-4">
                <p className="text-neutral-600">
                    <span className="text-caption">{t('callLog.place.subtitle')}</span>
                </p>
                <div className="relative">
                    <MagnifyingGlass
                        size={14}
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
                    />
                    <MyInput
                        inputType="text"
                        input={input}
                        onChangeFunction={(e) => setInput(e.target.value)}
                        inputPlaceholder={t('callLog.place.search')}
                        className="w-full pl-8"
                        size="large"
                    />
                </div>
                {query.length < MIN_CHARS ? (
                    <p className="py-6 text-center text-neutral-500">
                        <span className="text-caption">{t('callLog.place.hint')}</span>
                    </p>
                ) : search.isLoading ? (
                    <div className="flex flex-col gap-2">
                        {[0, 1, 2].map((i) => (
                            <Skeleton key={i} className="h-12 rounded-lg" />
                        ))}
                    </div>
                ) : search.isError ? (
                    <p className="py-6 text-center text-danger-600">
                        <span className="text-caption">{t('callLog.place.error')}</span>
                    </p>
                ) : leads.length === 0 ? (
                    <p className="py-6 text-center text-neutral-500">
                        <span className="text-caption">{t('callLog.place.empty')}</span>
                    </p>
                ) : (
                    <div className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
                        {leads.map((vm) => {
                            const phone = vm.phone && vm.phone !== '-' ? vm.phone : '';
                            const canCall = !!phone && !!vm.responseId && !placeCall.isPending;
                            return (
                                <div
                                    key={vm.responseId ?? vm.userId ?? vm.name}
                                    className="flex items-center gap-3 px-3 py-2.5"
                                >
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate font-semibold text-neutral-900">
                                            <span className="text-body">{vm.name}</span>
                                        </span>
                                        <span className="block truncate text-neutral-500">
                                            <span className="text-caption">
                                                {phone || t('callLog.place.noPhone')}
                                                {vm.audience && vm.audience !== '-'
                                                    ? ` · ${vm.audience}`
                                                    : ''}
                                            </span>
                                        </span>
                                    </span>
                                    <MyButton
                                        buttonType="secondary"
                                        scale="small"
                                        disable={!canCall}
                                        onClick={() => {
                                            if (!vm.responseId) return;
                                            placeCall.mutate({
                                                responseId: vm.responseId,
                                                userId: vm.userId ?? undefined,
                                                leadName: vm.name,
                                            });
                                            close(false);
                                        }}
                                    >
                                        <Phone size={14} />
                                        {t('callLog.place.call')}
                                    </MyButton>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </MyDialog>
    );
}
