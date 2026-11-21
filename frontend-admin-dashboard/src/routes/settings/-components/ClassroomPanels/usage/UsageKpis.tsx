import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChalkboardTeacher, Clock, DoorOpen, WarningCircle } from '@phosphor-icons/react';
import type { PanelUsageTotals } from '@/classroom-shared/apiTypes';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatNumber } from '@/lib/formatters';
import { cn } from '@/lib/utils';

export const formatHours = (hours: number): string =>
    formatNumber(hours, { maximumFractionDigits: 1 });

function Kpi({
    label,
    value,
    caption,
    icon,
    tone = 'neutral',
}: {
    label: string;
    value: string;
    caption: string;
    icon: ReactNode;
    tone?: 'neutral' | 'warn';
}) {
    return (
        <Card>
            <CardContent className="flex flex-col gap-2 p-4">
                <div className="flex items-center gap-2 text-body text-neutral-500">
                    <span
                        className={cn(
                            'flex size-8 shrink-0 items-center justify-center rounded-md',
                            tone === 'warn'
                                ? 'bg-warning-50 text-warning-600'
                                : 'bg-primary-50 text-primary-500'
                        )}
                    >
                        {icon}
                    </span>
                    <span>{label}</span>
                </div>
                <p className="text-h2 font-semibold text-neutral-700">{value}</p>
                <p className="text-caption text-neutral-500">{caption}</p>
            </CardContent>
        </Card>
    );
}

/** Panel hours, rooms used, teachers and idle rooms for the chosen dates. */
export function UsageKpis({ totals }: { totals: PanelUsageTotals }) {
    const { t } = useTranslation('settingsClassroomPanels');
    return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi
                label={t('usage.kpi.hours')}
                value={formatHours(totals.panel_hours)}
                caption={t('usage.kpi.hoursCaption', { count: totals.sessions })}
                icon={<Clock size={18} />}
            />
            <Kpi
                label={t('usage.kpi.rooms')}
                value={t('usage.kpi.roomsValue', {
                    used: formatNumber(totals.rooms_used),
                    total: formatNumber(totals.rooms_with_panel),
                })}
                caption={t('usage.kpi.roomsCaption')}
                icon={<DoorOpen size={18} />}
            />
            <Kpi
                label={t('usage.kpi.teachers')}
                value={formatNumber(totals.teachers)}
                caption={t('usage.kpi.teachersCaption', { count: totals.classes_started })}
                icon={<ChalkboardTeacher size={18} />}
            />
            <Kpi
                label={t('usage.kpi.idle')}
                value={formatNumber(totals.idle_rooms)}
                caption={t(totals.idle_rooms > 0 ? 'usage.kpi.idleCaption' : 'usage.kpi.idleNone')}
                icon={<WarningCircle size={18} />}
                tone={totals.idle_rooms > 0 ? 'warn' : 'neutral'}
            />
        </div>
    );
}

export function UsageKpisSkeleton() {
    return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((index) => (
                <Skeleton key={index} className="h-32 w-full rounded-lg" />
            ))}
        </div>
    );
}
