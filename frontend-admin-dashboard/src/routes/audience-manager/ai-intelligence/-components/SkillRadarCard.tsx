import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Target } from '@phosphor-icons/react';
import {
    PolarAngleAxis,
    PolarGrid,
    PolarRadiusAxis,
    Radar,
    RadarChart,
    ResponsiveContainer,
    Tooltip,
} from 'recharts';
import { fetchTeamCoaching } from '@/components/shared/leads/services/call-intelligence';
import { humanizeKey } from '@/routes/dashboard/-utils/crm-dashboard';
import {
    EmptyChart,
    SectionCard,
} from '@/routes/study-library/live-session/-components/dashboard/dashboard-charts';

/**
 * AI Intelligence: team skill profile as a radar, this period against the
 * previous one. The current period reuses the coaching request the page already
 * makes (same key); the previous period is one extra request, only when switched on.
 */
export function SkillRadarCard({
    instituteId,
    current,
    previous,
}: {
    instituteId: string;
    current: { from: number; to: number };
    previous: { from: number; to: number };
}) {
    const enabled = !!instituteId;
    const { t } = useTranslation('crmPages');
    const cur = useQuery({
        queryKey: ['team-coaching', instituteId, current.from, current.to],
        queryFn: () => fetchTeamCoaching(instituteId, current.from, current.to),
        enabled,
        staleTime: 60 * 1000,
    });
    const prev = useQuery({
        queryKey: ['team-coaching', instituteId, previous.from, previous.to],
        queryFn: () => fetchTeamCoaching(instituteId, previous.from, previous.to),
        enabled,
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
    });
    if (!enabled) return null;
    const prevBy = new Map(
        (prev.data?.qualityAverages ?? []).map((q) => [q.key, q.avgScore ?? null])
    );
    const data = (cur.data?.qualityAverages ?? []).map((q) => ({
        skill: humanizeKey(q.key),
        current: q.avgScore ?? 0,
        previous: prevBy.get(q.key) ?? null,
    }));
    return (
        <SectionCard icon={Target} title={t('ai.radar.title')} subtitle={t('ai.radar.subtitle')}>
            {data.length < 3 ? (
                <EmptyChart text={t('ai.radar.empty')} />
            ) : (
                <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                        <RadarChart data={data} outerRadius="75%">
                            <PolarGrid stroke="hsl(var(--border))" />
                            <PolarAngleAxis
                                dataKey="skill"
                                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                            />
                            <PolarRadiusAxis tick={false} axisLine={false} domain={[0, 'auto']} />
                            <Tooltip />
                            <Radar
                                name={t('ai.radar.previous')}
                                dataKey="previous"
                                stroke="hsl(var(--neutral-400))"
                                fill="hsl(var(--neutral-400))"
                                fillOpacity={0.1}
                                isAnimationActive={false}
                            />
                            <Radar
                                name={t('ai.radar.current')}
                                dataKey="current"
                                stroke="hsl(var(--primary-500))"
                                fill="hsl(var(--primary-500))"
                                fillOpacity={0.25}
                                isAnimationActive={false}
                            />
                        </RadarChart>
                    </ResponsiveContainer>
                </div>
            )}
        </SectionCard>
    );
}
