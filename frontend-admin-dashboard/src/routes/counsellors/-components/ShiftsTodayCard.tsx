import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { useCrmDashboardBlocks } from '@/routes/dashboard/-services/use-crm-blocks';
import type { CrmShiftsBlock } from '@/routes/dashboard/-services/crm-dashboard';
import { SectionCard } from '@/routes/study-library/live-session/-components/dashboard/dashboard-charts';
import type { WorkbenchCounsellor } from '../-services/counsellor-workbench-services';

const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
};
const DAY = 24 * 60;
const TICKS = [0, 6, 12, 18, 24];
const barStyle = (from: number, to: number) => ({
    left: `${(from / DAY) * 100}%`,
    width: `${((to - from) / DAY) * 100}%`,
});

/**
 * Counsellors: today's pool shifts on one timeline, for the counsellors
 * this page lists, with who is on shift right now. Shifts come from Lead Settings →
 * Pools; the card hides itself when the institute uses no shifts.
 */
export function ShiftsTodayCard({ counsellors }: { counsellors: WorkbenchCounsellor[] }) {
    const { t } = useTranslation('crmPages');
    const { pick } = useCrmDashboardBlocks(['shifts'], {
        enabled: counsellors.length > 0,
    });
    const block = pick<CrmShiftsBlock>('shifts');

    const rows = useMemo(() => {
        if (!block) return [];
        const byUser = new Map<string, CrmShiftsBlock['rows']>();
        block.rows.forEach((r) => byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r]));
        return counsellors
            .filter((c) => byUser.has(c.user_id))
            .map((c) => ({ c, shifts: byUser.get(c.user_id)! }));
    }, [block, counsellors]);

    if (rows.length === 0) return null;
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const onNow = rows.filter(({ shifts }) =>
        shifts.some((s) => toMin(s.start_time) <= nowMin && nowMin < toMin(s.end_time))
    ).length;

    return (
        <SectionCard
            className="mb-4"
            icon={Clock}
            title={t('counsellors.shifts.title')}
            subtitle={t('counsellors.shifts.subtitle')}
            right={
                <span className="rounded-full bg-success-50 px-2.5 py-0.5 font-semibold text-success-700">
                    <span className="text-caption">
                        {t('counsellors.shifts.onNow', { total: onNow })}
                    </span>
                </span>
            }
        >
            <div className="space-y-2">
                <div className="grid grid-cols-12 gap-3 text-neutral-400">
                    <span className="col-span-3" />
                    <span className="col-span-9 flex justify-between">
                        {TICKS.map((h) => (
                            <span key={h} className="text-caption">
                                {String(h).padStart(2, '0')}:00
                            </span>
                        ))}
                    </span>
                </div>
                {rows.map(({ c, shifts }) => {
                    const on = shifts.some(
                        (s) => toMin(s.start_time) <= nowMin && nowMin < toMin(s.end_time)
                    );
                    return (
                        <div key={c.user_id} className="grid grid-cols-12 items-center gap-3">
                            <span className="col-span-3 flex min-w-0 items-center gap-1.5">
                                <span
                                    className={cn(
                                        'size-2 shrink-0 rounded-full',
                                        on ? 'bg-success-500' : 'bg-neutral-300'
                                    )}
                                />
                                <span
                                    className="truncate text-neutral-800"
                                    title={c.full_name ?? ''}
                                >
                                    <span className="text-caption">
                                        {c.full_name || c.email || '—'}
                                    </span>
                                </span>
                            </span>
                            <span className="relative col-span-9 h-5 rounded bg-neutral-100">
                                {shifts.map((s, i) => {
                                    const a = toMin(s.start_time);
                                    const b = Math.max(a + 15, toMin(s.end_time));
                                    return (
                                        <span
                                            key={`${s.pool_id}-${i}`}
                                            title={`${s.pool_name ?? ''}${s.label ? ` · ${s.label}` : ''} · ${s.start_time}–${s.end_time}`}
                                            className={cn(
                                                'absolute inset-y-0 rounded',
                                                on ? 'bg-success-400' : 'bg-primary-300'
                                            )}
                                            style={barStyle(a, b)} // design-lint-ignore: shift position from data
                                        />
                                    );
                                })}
                                <span
                                    className="absolute inset-y-0 w-px bg-danger-500"
                                    style={{ left: `${(nowMin / DAY) * 100}%` }} // design-lint-ignore: current time marker
                                />
                            </span>
                        </div>
                    );
                })}
                <p className="pt-1 text-neutral-500">
                    <span className="text-caption">{t('counsellors.shifts.foot')}</span>
                </p>
            </div>
        </SectionCard>
    );
}
