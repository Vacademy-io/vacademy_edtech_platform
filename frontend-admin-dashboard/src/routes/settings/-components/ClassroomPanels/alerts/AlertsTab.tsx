import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { PanelFleetAlert } from '@/classroom-shared/apiTypes';
import { StatusChip } from '@/components/design-system/status-chips';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatRelative, getActiveLocale } from '@/lib/formatters';
import { StaleNote, TableEmpty, TableError } from '../TableParts';
import {
    alertKindLabel,
    alertTodo,
    SEVERITY_CHIP,
    SEVERITY_LABEL,
    groupBySeverity,
    useFleetQuery,
} from './api';
import { NotifySettingsCard } from './NotifySettingsCard';

export interface AlertsTabProps {
    instituteId: string;
}

/**
 * Settings, Classroom Panels, Alerts: what needs a look across the institute's panels,
 * the most urgent first, each with what to do. Below it, the daily email setting.
 */
export function AlertsTab({ instituteId }: AlertsTabProps) {
    const { t } = useTranslation('settingsClassroomPanels');
    const fleet = useFleetQuery(instituteId);
    const groups = useMemo(
        () => (fleet.data ? groupBySeverity(fleet.data.alerts ?? [], getActiveLocale()) : []),
        [fleet.data]
    );

    return (
        <div className="flex flex-col gap-6">
            <Card>
                <CardHeader className="flex flex-col gap-1.5 space-y-0">
                    <CardTitle>
                        <h2 className="text-h3 font-medium">{t('alerts.title')}</h2>
                    </CardTitle>
                    <CardDescription>{t('alerts.description')}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                    {fleet.isPending && (
                        <div aria-busy="true" className="flex flex-col gap-3">
                            {[0, 1, 2].map((index) => (
                                <Skeleton key={index} className="h-16 w-full" />
                            ))}
                        </div>
                    )}
                    {fleet.isError && !fleet.data && (
                        <TableError
                            message={t('alerts.loadError')}
                            error={fleet.error}
                            onRetry={() => void fleet.refetch()}
                        />
                    )}
                    {fleet.data && (
                        <>
                            {fleet.isError && <StaleNote onRetry={() => void fleet.refetch()} />}
                            {groups.length === 0 ? (
                                <TableEmpty
                                    title={t('alerts.empty.title')}
                                    body={t('alerts.empty.body')}
                                />
                            ) : (
                                groups.map((group) => (
                                    <section
                                        key={group.severity}
                                        aria-labelledby={`classroom-alerts-${group.severity}`}
                                        className="flex flex-col gap-2"
                                    >
                                        <h3
                                            id={`classroom-alerts-${group.severity}`}
                                            className="text-subtitle font-medium text-neutral-700"
                                        >
                                            {t(SEVERITY_LABEL[group.severity])}
                                        </h3>
                                        <ul className="flex flex-col divide-y divide-neutral-200 rounded-lg border border-neutral-200">
                                            {group.alerts.map((alert) => (
                                                <AlertRow
                                                    key={`${alert.kind}-${alert.device_id ?? ''}-${alert.incident_key}`}
                                                    alert={alert}
                                                />
                                            ))}
                                        </ul>
                                    </section>
                                ))
                            )}
                        </>
                    )}
                </CardContent>
            </Card>
            <NotifySettingsCard instituteId={instituteId} />
        </div>
    );
}

function AlertRow({ alert }: { alert: PanelFleetAlert }) {
    const { t } = useTranslation('settingsClassroomPanels');
    return (
        <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 flex-col gap-1">
                <span className="break-words text-body font-medium text-neutral-700">
                    {alert.room?.name ?? t('alerts.institute')}
                </span>
                <span className="text-body text-neutral-600">{t(alertTodo(alert.kind))}</span>
                {alert.since && (
                    <span className="text-caption text-neutral-500">
                        {t('alerts.since', { when: formatRelative(alert.since) })}
                    </span>
                )}
            </div>
            <StatusChip
                text={t(alertKindLabel(alert.kind))}
                textSize="text-caption"
                status={SEVERITY_CHIP[alert.severity] ?? 'INFO'}
            />
        </li>
    );
}
