import { useCallback, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { DownloadSimple } from '@phosphor-icons/react';
import type { PanelUsageSessionRow } from '@/classroom-shared/apiTypes';
import { MyButton } from '@/components/design-system/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { MyTable } from '@/components/design-system/table';
import { formatDate, formatDateTime } from '@/lib/formatters';
import { getBrowserTimezone } from '@/utils/timezone';
import { panelApiError, panelErrorMessage } from '../api';
import { StaleNote, TableEmpty, TableError } from '../TableParts';
import { adminInstituteIds } from './adminInstitutes';
import {
    collectSessions,
    multiToCsv,
    sessionsToCsv,
    usageCsvFileName,
    type CsvLabels,
} from './exportCsv';
import { MultiSchools, useMultiRows } from './MultiSchools';
import { RangeControls, dayLabel } from './RangeControls';
import { SessionsSheet, useEndReasonLabel, useStartedViaLabel } from './SessionsSheet';
import { UsageChart } from './UsageChart';
import { UsageKpis, UsageKpisSkeleton } from './UsageKpis';
import {
    ContentTable,
    IdleRoomsTable,
    RoomsTable,
    TeachersTable,
    useKindLabel,
    type SessionsTarget,
} from './UsageTables';
import {
    DEFAULT_PRESET,
    MULTI_MAX_INSTITUTES,
    defaultUsageRange,
    durationLabel,
    presetRange,
    rangeProblem,
    useUsageQuery,
    type UsageRange,
    type UsageRangeChoice,
} from './usageApi';

/**
 * Loaded on first export: it carries the native-app save path, which the settings screen does
 * not need until someone exports.
 */
async function saveFile(blob: Blob, fileName: string): Promise<void> {
    const { saveBlob } = await import('@/lib/save-blob');
    await saveBlob(blob, fileName);
}

export interface UsageTabProps {
    instituteId: string;
}

/**
 * Settings, Classroom Panels, Usage: how much the panels were used in a date range, by room,
 * teacher and content, with a session drawer and a CSV export. Shown only while the usage
 * endpoint answers (see probe.ts).
 */
export function UsageTab({ instituteId }: UsageTabProps) {
    const { t } = useTranslation('settingsClassroomPanels');
    const [tz] = useState(() => getBrowserTimezone());
    const [choice, setChoice] = useState<UsageRangeChoice>(DEFAULT_PRESET);
    const [range, setRange] = useState<UsageRange>(defaultUsageRange);
    const [comparing, setComparing] = useState(false);
    const [target, setTarget] = useState<SessionsTarget | null>(null);

    const adminIds = useMemo(
        () => adminInstituteIds(instituteId).slice(0, MULTI_MAX_INSTITUTES),
        [instituteId]
    );
    const canCompare = adminIds.length > 1;
    const showMulti = canCompare && comparing;
    const valid = rangeProblem(range) === null;

    const usage = useUsageQuery(instituteId, range, tz, { enabled: valid && !showMulti });
    const multi = useMultiRows(adminIds, range, tz, valid && showMulti);

    const kindLabel = useKindLabel();
    const endReason = useEndReasonLabel();
    const startedVia = useStartedViaLabel();

    const onPreset = useCallback((option: UsageRangeChoice) => {
        setChoice(option);
        // Custom keeps the dates on screen as the starting point.
        if (option !== 'custom') setRange(presetRange(option));
    }, []);
    const openSessions = useCallback((next: SessionsTarget) => setTarget(next), []);

    const exportCsv = async () => {
        try {
            if (showMulti) {
                const csv = multiToCsv(
                    multi.rows.map((row) => ({ name: row.name, ...row.totals })),
                    {
                        school: t('usage.multi.columns.school'),
                        hours: t('usage.multi.columns.hours'),
                        sessions: t('usage.multi.columns.sessions'),
                        roomsUsed: t('usage.export.columns.roomsUsed'),
                        roomsWithPanel: t('usage.export.columns.roomsWithPanel'),
                        teachers: t('usage.multi.columns.teachers'),
                        idle: t('usage.multi.columns.idle'),
                    }
                );
                await saveFile(
                    new Blob([csv], { type: 'text/csv;charset=utf-8' }),
                    usageCsvFileName(range.from, range.to)
                );
                toast.success(t('usage.export.doneSchools', { count: multi.rows.length }));
                return;
            }
            const collected = await collectSessions({
                institute_id: instituteId,
                from: range.from,
                to: range.to,
                tz,
            });
            if (collected.rows.length === 0) {
                toast.info(t('usage.export.empty'));
                return;
            }
            const labels: CsvLabels = {
                columns: {
                    date: t('usage.export.columns.date'),
                    room: t('usage.export.columns.room'),
                    teacher: t('usage.export.columns.teacher'),
                    started: t('usage.export.columns.started'),
                    ended: t('usage.export.columns.ended'),
                    minutes: t('usage.export.columns.minutes'),
                    endReason: t('usage.export.columns.endReason'),
                    startedVia: t('usage.export.columns.startedVia'),
                    content: t('usage.export.columns.content'),
                },
                dateTime: (iso) => formatDateTime(iso),
                date: (iso) => formatDate(iso),
                endReason: (row: PanelUsageSessionRow) => endReason(row.end_reason),
                startedVia: (row: PanelUsageSessionRow) => startedVia(row.started_via),
                event: (event) =>
                    `${kindLabel(event.kind)}: ${event.title || t('usage.content.untitled')} (${durationLabel(t, event.minutes)})`,
            };
            await saveFile(
                new Blob([sessionsToCsv(collected.rows, labels)], {
                    type: 'text/csv;charset=utf-8',
                }),
                usageCsvFileName(range.from, range.to)
            );
            if (collected.truncated) {
                toast.warning(t('usage.export.truncated', { count: collected.rows.length }));
            } else {
                toast.success(t('usage.export.done', { count: collected.rows.length }));
            }
        } catch (error) {
            toast.error(`${t('usage.export.error')} ${panelErrorMessage(t, error)}`);
        }
    };

    const canExport = showMulti
        ? multi.rows.length > 0
        : valid && (usage.data?.totals.sessions ?? 0) > 0;

    return (
        <div className="flex flex-col gap-6">
            <Card>
                <CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex flex-col gap-1.5">
                        <CardTitle>
                            <h2 className="text-h3 font-medium">{t('usage.title')}</h2>
                        </CardTitle>
                        <CardDescription>{t('usage.description', { tz })}</CardDescription>
                    </div>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        className="shrink-0 gap-2"
                        disable={canExport ? undefined : true}
                        onAsyncClick={exportCsv}
                        loadingText={t('usage.export.working')}
                    >
                        <DownloadSimple size={16} />
                        {t('usage.export.button')}
                    </MyButton>
                </CardHeader>
                <CardContent>
                    <RangeControls
                        choice={choice}
                        range={range}
                        today={format(new Date(), 'yyyy-MM-dd')}
                        onPreset={onPreset}
                        onCustom={setRange}
                        canCompare={canCompare}
                        comparing={comparing}
                        onCompare={setComparing}
                    />
                </CardContent>
            </Card>

            {valid && showMulti && <MultiSchools instituteIds={adminIds} rows={multi} />}
            {valid && !showMulti && <UsageBody usage={usage} range={range} onOpen={openSessions} />}

            <SessionsSheet
                instituteId={instituteId}
                range={range}
                tz={tz}
                target={showMulti ? null : target}
                onClose={() => setTarget(null)}
            />
        </div>
    );
}

function UsageBody({
    usage,
    range,
    onOpen,
}: {
    usage: ReturnType<typeof useUsageQuery>;
    range: UsageRange;
    onOpen: (target: SessionsTarget) => void;
}) {
    const { t } = useTranslation('settingsClassroomPanels');

    if (usage.isPending) {
        return (
            <div className="flex flex-col gap-6" aria-busy="true">
                <UsageKpisSkeleton />
                <Skeleton className="h-72 w-full rounded-lg" />
                <MyTable<object>
                    data={undefined}
                    columns={[]}
                    isLoading
                    error={null}
                    currentPage={0}
                    enableColumnPinning={false}
                />
            </div>
        );
    }
    if (!usage.data) {
        const featureOff = panelApiError(usage.error)?.code === 'FEATURE_OFF';
        return featureOff ? (
            <TableEmpty title={t('usage.featureOffTitle')} body={t('usage.featureOff')} />
        ) : (
            <TableError
                message={t('usage.loadError')}
                error={usage.error}
                onRetry={() => void usage.refetch()}
            />
        );
    }

    const data = usage.data;
    const stale = usage.isError ? <StaleNote onRetry={() => void usage.refetch()} /> : null;

    if (data.totals.sessions === 0) {
        return (
            <div className="flex flex-col gap-6">
                {stale}
                {data.totals.rooms_with_panel > 0 && <UsageKpis totals={data.totals} />}
                <TableEmpty
                    title={t('usage.empty.title')}
                    body={t('usage.empty.body', {
                        from: dayLabel(range.from),
                        to: dayLabel(range.to),
                    })}
                />
                {data.idle_rooms.length > 0 && <IdleRoomsTable rooms={data.idle_rooms} />}
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-6">
            {stale}
            <UsageKpis totals={data.totals} />
            <UsageChart days={data.by_day} range={range} />
            <RoomsTable rooms={data.by_room} onOpen={onOpen} />
            <TeachersTable teachers={data.by_teacher} onOpen={onOpen} />
            <IdleRoomsTable rooms={data.idle_rooms} />
            <ContentTable usage={data} />
        </div>
    );
}
