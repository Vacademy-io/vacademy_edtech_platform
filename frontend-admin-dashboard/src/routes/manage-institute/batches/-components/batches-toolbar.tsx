import { MyInput } from '@/components/design-system/input';
import { MyDropdown } from '@/components/design-system/dropdown';
import { MyButton } from '@/components/design-system/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import {
    ArrowsDownUp,
    CalendarBlank,
    CaretDown,
    FunnelSimple,
    ListBullets,
    MagnifyingGlass,
    SquaresFour,
} from '@phosphor-icons/react';
import dayjs from 'dayjs';
import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
    BatchFilters,
    BatchSort,
    BatchStatusFilter,
} from '@/routes/manage-institute/batches/-utils/batch-filters';

export type BatchView = 'grid' | 'list';

const SORTS: BatchSort[] = ['newest', 'oldest', 'name', 'learners'];
const STATUSES: BatchStatusFilter[] = ['all', 'active', 'upcoming', 'inactive'];

const ToolbarTrigger = ({
    icon,
    label,
    active = false,
}: {
    icon: ReactNode;
    label: string;
    active?: boolean;
}) => (
    <span
        className={cn(
            'flex h-10 items-center gap-2 whitespace-nowrap rounded-lg border bg-white px-3 text-body text-neutral-700 hover:border-primary-200',
            active ? 'border-primary-500 text-primary-500' : 'border-neutral-200'
        )}
    >
        {icon}
        {label}
        <CaretDown size={14} className="text-neutral-500" />
    </span>
);

interface BatchesToolbarProps {
    filters: BatchFilters;
    onChange: (filters: BatchFilters) => void;
    view: BatchView;
    onViewChange: (view: BatchView) => void;
}

export const BatchesToolbar = ({ filters, onChange, view, onViewChange }: BatchesToolbarProps) => {
    const { t } = useTranslation('manageInstituteManageBatches');
    const set = (patch: Partial<BatchFilters>) => onChange({ ...filters, ...patch });

    const dateLabel =
        filters.from || filters.to
            ? `${filters.from ? dayjs(filters.from).format('DD MMM') : '…'} – ${
                  filters.to ? dayjs(filters.to).format('DD MMM') : '…'
              }`
            : t('toolbar.dateRange');

    return (
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative grow">
                <MagnifyingGlass
                    size={18}
                    className="pointer-events-none absolute start-3 top-1/2 z-10 -translate-y-1/2 text-neutral-400"
                />
                <MyInput
                    inputType="text"
                    input={filters.search}
                    onChangeFunction={(e) => set({ search: e.target.value })}
                    inputPlaceholder={t('toolbar.searchPlaceholder')}
                    size="large"
                    className="w-full rounded-lg border-neutral-200 ps-10 sm:w-full"
                />
            </div>

            <div className="flex flex-wrap items-center gap-2">
                <MyDropdown
                    currentValue={filters.sort}
                    dropdownList={SORTS.map((sort) => ({
                        value: sort,
                        label: t(`toolbar.sort.${sort}`),
                    }))}
                    handleChange={(value) => set({ sort: value as BatchSort })}
                >
                    <ToolbarTrigger
                        icon={<ArrowsDownUp size={16} />}
                        label={t(`toolbar.sort.${filters.sort}`)}
                    />
                </MyDropdown>

                <MyDropdown
                    currentValue={filters.status}
                    dropdownList={STATUSES.map((status) => ({
                        value: status,
                        label: t(`toolbar.status.${status}`),
                    }))}
                    handleChange={(value) => set({ status: value as BatchStatusFilter })}
                >
                    <ToolbarTrigger
                        icon={<FunnelSimple size={16} />}
                        label={
                            filters.status === 'all'
                                ? t('toolbar.statusLabel')
                                : t(`toolbar.status.${filters.status}`)
                        }
                        active={filters.status !== 'all'}
                    />
                </MyDropdown>

                <Popover>
                    <PopoverTrigger className="focus:outline-none">
                        <ToolbarTrigger
                            icon={<CalendarBlank size={16} />}
                            label={dateLabel}
                            active={!!(filters.from || filters.to)}
                        />
                    </PopoverTrigger>
                    <PopoverContent align="end" className="flex w-72 flex-col gap-3 p-4">
                        <p className="text-caption text-neutral-500">{t('toolbar.dateHint')}</p>
                        <MyInput
                            label={t('toolbar.from')}
                            inputType="date"
                            input={filters.from}
                            onChangeFunction={(e) => set({ from: e.target.value })}
                            className="w-full sm:w-full"
                        />
                        <MyInput
                            label={t('toolbar.to')}
                            inputType="date"
                            input={filters.to}
                            onChangeFunction={(e) => set({ to: e.target.value })}
                            className="w-full sm:w-full"
                        />
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            disable={!filters.from && !filters.to}
                            onClick={() => set({ from: '', to: '' })}
                        >
                            {t('toolbar.clearDates')}
                        </MyButton>
                    </PopoverContent>
                </Popover>

                <div className="flex items-center gap-1 rounded-lg border border-neutral-200 bg-white p-1">
                    {(
                        [
                            ['grid', SquaresFour, t('toolbar.gridView')],
                            ['list', ListBullets, t('toolbar.listView')],
                        ] as const
                    ).map(([value, Icon, label]) => (
                        <button
                            key={value}
                            type="button"
                            aria-label={label}
                            aria-pressed={view === value}
                            onClick={() => onViewChange(value)}
                            className={cn(
                                'flex size-8 items-center justify-center rounded-md transition-colors',
                                view === value
                                    ? 'bg-primary-500 text-white'
                                    : 'text-neutral-500 hover:bg-neutral-100'
                            )}
                        >
                            <Icon size={18} />
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};
