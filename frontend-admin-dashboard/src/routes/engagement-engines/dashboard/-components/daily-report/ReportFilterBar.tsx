import { useMemo } from 'react';
import {
    CaretDown,
    CaretLeft,
    CaretRight,
    DownloadSimple,
    FilePdf,
    FileXls,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import {
    SearchableSelect,
    type SearchableSelectOption,
} from '@/components/design-system/searchable-select';
import { DatePickerButton } from '@/components/shared/crm-enhance/date-picker-button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { DailyReportEngineOption } from '@/services/engagement-daily-report';
import { buildEngineStatusMeta } from '../../../-constants';
import type { EngineStatus } from '../../../-types';

/** Value of the "All engines" option (the picker has no empty value). */
const ALL_ENGINES = 'all';

export type ExportKind = 'xlsx' | 'pdf';

const ALL_EXPORT_KINDS: ExportKind[] = ['xlsx', 'pdf'];

interface ReportFilterBarProps {
    engines: DailyReportEngineOption[];
    /** null = all engines. */
    engineId: string | null;
    onEngineChange: (engineId: string | null) => void;
    /** yyyy-MM-dd */
    date: string;
    minDate: string;
    maxDate: string;
    onDateChange: (date: string) => void;
    onPreviousDay: () => void;
    onNextDay: () => void;
    onExport: (kind: ExportKind) => void;
    exporting: boolean;
    exportDisabled: boolean;
    /** The formats on offer. With one, Export is a plain button; with two, a menu (the default). */
    exportKinds?: ExportKind[];
}

/** Engine picker, date picker with previous/next day, and the Export menu. */
export function ReportFilterBar({
    engines,
    engineId,
    onEngineChange,
    date,
    minDate,
    maxDate,
    onDateChange,
    onPreviousDay,
    onNextDay,
    onExport,
    exporting,
    exportDisabled,
    exportKinds = ALL_EXPORT_KINDS,
}: ReportFilterBarProps) {
    const { t } = useTranslation('engagementDailyReport');
    const { t: tConstants } = useTranslation('engagementEnginesConstants');

    const options = useMemo<SearchableSelectOption[]>(() => {
        const statusMeta = buildEngineStatusMeta(tConstants);
        const labelOf = (e: DailyReportEngineOption) => {
            if (e.system) return t('filter.systemEngine');
            const status =
                e.status && e.status !== 'ACTIVE' ? statusMeta[e.status as EngineStatus] : null;
            return status ? `${e.name} (${status.label})` : e.name;
        };
        const list: SearchableSelectOption[] = [
            { value: ALL_ENGINES, label: t('filter.allEngines') },
            ...engines.map((e) => ({ value: e.id, label: labelOf(e), keywords: [e.name] })),
        ];
        // The report for this engine is still loading, so its name is not known yet.
        if (engineId && !engines.some((e) => e.id === engineId)) {
            list.push({ value: engineId, label: t('filter.selectedEngine') });
        }
        return list;
    }, [engines, engineId, t, tConstants]);

    // With a single format there is no menu to choose from: Export is that format.
    const onlyKind = exportKinds.length === 1 ? exportKinds[0] : undefined;

    return (
        <div className="flex flex-wrap items-center gap-3">
            <div className="w-full sm:w-72">
                <SearchableSelect
                    options={options}
                    value={engineId ?? ALL_ENGINES}
                    onChange={(v) => onEngineChange(v === ALL_ENGINES ? null : v)}
                    placeholder={t('filter.allEngines')}
                    searchPlaceholder={t('filter.searchEngines')}
                    emptyText={t('filter.noEngines')}
                    triggerClassName="h-9"
                />
            </div>
            <div className="flex items-center gap-1">
                <MyButton
                    buttonType="secondary"
                    layoutVariant="icon"
                    scale="medium"
                    aria-label={t('filter.previousDay')}
                    title={t('filter.previousDay')}
                    disable={date <= minDate}
                    onClick={onPreviousDay}
                >
                    <CaretLeft size={16} />
                </MyButton>
                <DatePickerButton
                    label={t('filter.date')}
                    value={date}
                    onChange={onDateChange}
                    min={minDate}
                    max={maxDate}
                />
                <MyButton
                    buttonType="secondary"
                    layoutVariant="icon"
                    scale="medium"
                    aria-label={t('filter.nextDay')}
                    title={t('filter.nextDay')}
                    disable={date >= maxDate}
                    onClick={onNextDay}
                >
                    <CaretRight size={16} />
                </MyButton>
            </div>
            <div className="sm:ms-auto">
                {onlyKind ? (
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        className="gap-2"
                        disable={exportDisabled || exporting}
                        onClick={() => onExport(onlyKind)}
                    >
                        <DownloadSimple size={16} />
                        {exporting
                            ? t('filter.exporting')
                            : onlyKind === 'pdf'
                              ? t('filter.exportPdf')
                              : t('filter.exportExcel')}
                    </MyButton>
                ) : (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <MyButton
                                buttonType="secondary"
                                scale="medium"
                                className="gap-2"
                                disable={exportDisabled || exporting}
                            >
                                <DownloadSimple size={16} />
                                {exporting ? t('filter.exporting') : t('filter.export')}
                                <CaretDown size={14} />
                            </MyButton>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem className="gap-2" onSelect={() => onExport('xlsx')}>
                                <FileXls size={16} />
                                {t('filter.exportExcel')}
                            </DropdownMenuItem>
                            <DropdownMenuItem className="gap-2" onSelect={() => onExport('pdf')}>
                                <FilePdf size={16} />
                                {t('filter.exportPdf')}
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}
            </div>
        </div>
    );
}
