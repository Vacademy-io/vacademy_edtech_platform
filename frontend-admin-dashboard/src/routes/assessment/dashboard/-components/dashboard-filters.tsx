import { useState } from 'react';
import { ArrowClockwise, CalendarBlank, X } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import {
    MultiSelectPopover,
    type MultiSelectOption,
} from '@/routes/study-library/live-session/feedback/-components/multi-select-popover';
import {
    DASHBOARD_PRESETS,
    MAX_DASHBOARD_RANGE_DAYS,
    presetForRange,
    rangeForPreset,
    rangeLengthDays,
    type DashboardPreset,
} from '@/routes/study-library/live-session/-utils/dashboard-format';

const CUSTOM = 'custom';

interface DashboardFiltersProps {
    startDate: string;
    endDate: string;
    onRangeChange: (start: string, end: string) => void;
    batchOptions: MultiSelectOption[];
    selectedBatchIds: string[];
    onBatchChange: (ids: string[]) => void;
    typeOptions: MultiSelectOption[];
    selectedTypes: string[];
    onTypeChange: (modes: string[]) => void;
    batchesTerm: string;
    isFetching: boolean;
    onRefresh: () => void;
}

/**
 * One filter row above every chart: a segmented quick range (incl. "next 7
 * days" for what is coming up), an optional custom range, batches and test types.
 */
export function DashboardFilters({
    startDate,
    endDate,
    onRangeChange,
    batchOptions,
    selectedBatchIds,
    onBatchChange,
    typeOptions,
    selectedTypes,
    onTypeChange,
    batchesTerm,
    isFetching,
    onRefresh,
}: DashboardFiltersProps) {
    const { t } = useTranslation('assessmentDashboard');
    const activePreset = presetForRange(startDate, endDate);
    const [customOpen, setCustomOpen] = useState(activePreset === null);
    const [draftStart, setDraftStart] = useState(startDate);
    const [draftEnd, setDraftEnd] = useState(endDate);

    const draftDays = rangeLengthDays(draftStart, draftEnd);
    const draftError =
        draftDays === 0
            ? t('filters.invalidRange')
            : draftDays > MAX_DASHBOARD_RANGE_DAYS
              ? t('filters.rangeTooLong', { days: MAX_DASHBOARD_RANGE_DAYS })
              : null;

    const onRangeTab = (value: string) => {
        if (value === CUSTOM) {
            setCustomOpen(true);
            return;
        }
        const r = rangeForPreset(value as DashboardPreset);
        setCustomOpen(false);
        setDraftStart(r.start);
        setDraftEnd(r.end);
        onRangeChange(r.start, r.end);
    };

    const hasSelection = selectedBatchIds.length > 0 || selectedTypes.length > 0;

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <Tabs
                    value={customOpen || !activePreset ? CUSTOM : activePreset}
                    onValueChange={onRangeTab}
                    aria-label={t('filters.rangeLabel')}
                >
                    <TabsList className="h-auto flex-wrap justify-start border border-neutral-200 bg-white p-1 shadow-sm">
                        {DASHBOARD_PRESETS.map((preset) => (
                            <TabsTrigger
                                key={preset}
                                value={preset}
                                className="px-3 py-1.5 text-body data-[state=active]:bg-primary-500 data-[state=active]:text-white data-[state=active]:shadow-sm"
                            >
                                {t(`presets.${preset}`)}
                            </TabsTrigger>
                        ))}
                        <TabsTrigger
                            value={CUSTOM}
                            className="gap-1.5 px-3 py-1.5 text-body data-[state=active]:bg-primary-500 data-[state=active]:text-white data-[state=active]:shadow-sm"
                        >
                            <CalendarBlank size={16} />
                            {t('presets.custom')}
                        </TabsTrigger>
                    </TabsList>
                </Tabs>

                <div className="flex flex-wrap items-center gap-2">
                    <MultiSelectPopover
                        label={batchesTerm}
                        options={batchOptions}
                        selected={selectedBatchIds}
                        onChange={onBatchChange}
                        allText={t('filters.allOf', { term: batchesTerm })}
                        selectAll
                    />
                    <MultiSelectPopover
                        label={t('filters.types')}
                        options={typeOptions}
                        selected={selectedTypes}
                        onChange={onTypeChange}
                        allText={t('filters.allTypes')}
                        searchable={false}
                    />
                    {hasSelection && (
                        <MyButton
                            type="button"
                            buttonType="text"
                            scale="small"
                            onClick={() => {
                                onBatchChange([]);
                                onTypeChange([]);
                            }}
                        >
                            <X size={14} />
                            {t('filters.clear')}
                        </MyButton>
                    )}
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        layoutVariant="icon"
                        onClick={onRefresh}
                        disabled={isFetching}
                        aria-label={t('filters.refresh')}
                        title={t('filters.refresh')}
                        className="bg-white"
                    >
                        <ArrowClockwise size={16} className={cn(isFetching && 'animate-spin')} />
                    </MyButton>
                </div>
            </div>

            {customOpen && (
                <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-3 shadow-sm sm:flex-row sm:items-end">
                    <div className="flex-1">
                        <MyInput
                            inputType="date"
                            label={t('filters.startDate')}
                            labelStyle="text-caption"
                            input={draftStart}
                            max={draftEnd || undefined}
                            onChangeFunction={(e) => setDraftStart(e.target.value)}
                            size="small"
                            className="w-full"
                        />
                    </div>
                    <div className="flex-1">
                        <MyInput
                            inputType="date"
                            label={t('filters.endDate')}
                            labelStyle="text-caption"
                            input={draftEnd}
                            min={draftStart || undefined}
                            onChangeFunction={(e) => setDraftEnd(e.target.value)}
                            size="small"
                            className="w-full"
                        />
                    </div>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        disabled={!!draftError}
                        onClick={() => onRangeChange(draftStart, draftEnd)}
                    >
                        {t('filters.apply')}
                    </MyButton>
                </div>
            )}
            {customOpen && draftError && (
                <p className="text-caption text-danger-600">{draftError}</p>
            )}
        </div>
    );
}
