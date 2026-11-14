import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ChartBar, PhoneCall, Robot, Timer } from '@phosphor-icons/react';
import { StatStrip } from '@/components/shared/crm-enhance';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import {
    fetchCallMetrics,
    type CallLogScope,
} from '@/routes/audience-manager/call-log/-services/call-log-service';
import {
    formatNumber,
    formatPercent,
    formatTalkTime,
    isoDay,
    pctChange,
} from '@/routes/dashboard/-utils/crm-dashboard';

const shift = (d: Date, n: number) => {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
};

/**
 * AI Agents: how many agents are live and what AI calling did in the last
 * 30 days (the Call Log metrics with call type AI — same scope as the Call Log).
 */
export function AiAgentsEnhancedHeader({ total, active }: { total: number; active: number }) {
    const { t } = useTranslation('crmPages');
    const instituteId = getCurrentInstituteId() || '';
    const scopes = useMemo(() => {
        const today = new Date();
        const from = shift(today, -29);
        const prevTo = shift(from, -1);
        return {
            cur: { instituteId, fromDate: isoDay(from), toDate: isoDay(today) } as CallLogScope,
            prev: {
                instituteId,
                fromDate: isoDay(shift(prevTo, -29)),
                toDate: isoDay(prevTo),
            } as CallLogScope,
        };
    }, [instituteId]);
    const opts = {
        enabled: !!instituteId,
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
    } as const;
    const cur = useQuery({
        queryKey: ['ai-agents-metrics', scopes.cur],
        queryFn: () => fetchCallMetrics(scopes.cur, { callType: 'AI' }),
        ...opts,
    });
    const prev = useQuery({
        queryKey: ['ai-agents-metrics', scopes.prev],
        queryFn: () => fetchCallMetrics(scopes.prev, { callType: 'AI' }),
        ...opts,
    });
    const m = cur.data;
    const loading = cur.isLoading;
    return (
        <StatStrip
            deltaTitle={t('common.vsPrevious')}
            items={[
                {
                    key: 'agents',
                    icon: Robot,
                    label: t('aiAgents.stats.agents'),
                    value: total,
                    detail: t('aiAgents.stats.agentsDetail', { total: active }),
                },
                {
                    key: 'calls',
                    icon: PhoneCall,
                    tint: 'info',
                    label: t('aiAgents.stats.calls'),
                    value: m?.total_calls,
                    delta:
                        m && prev.data
                            ? pctChange(m.total_calls, prev.data.total_calls)
                            : undefined,
                    href: '/calling/dashboard',
                    loading,
                },
                {
                    key: 'connect',
                    icon: ChartBar,
                    tint: 'success',
                    label: t('aiAgents.stats.connect'),
                    value: m ? formatPercent(m.connected_calls, m.total_calls, 0) : undefined,
                    detail: m
                        ? t('aiAgents.stats.connectDetail', {
                              total: formatNumber(m.connected_calls),
                          })
                        : undefined,
                    loading,
                },
                {
                    key: 'talk',
                    icon: Timer,
                    tint: 'warning',
                    label: t('aiAgents.stats.talk'),
                    value: m ? formatTalkTime(m.total_talk_seconds) : undefined,
                    detail: m
                        ? t('aiAgents.stats.talkDetail', {
                              avg: formatTalkTime(m.avg_talk_seconds),
                          })
                        : undefined,
                    loading,
                },
            ]}
        />
    );
}
