import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Columns, MagnifyingGlass } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { getInitials } from '../inbox/utils';

export interface BoardStaffOption {
    id: string;
    name: string;
    subtitle?: string;
    /** Cards currently on the board for this person (shown so "hidden but busy" is obvious). */
    count: number;
    visible: boolean;
}

/**
 * "Columns" picker for the doubt board: one checkbox per staff member (ticked = their column is
 * shown). Unlike the shared table ManageColumnsPopover this list is searchable and scrolls —
 * an institute can have dozens of staff, and the default is "show only people with cards".
 */
export const BoardColumnsPopover = ({
    staff,
    onToggle,
    onReset,
    canReset,
}: {
    staff: BoardStaffOption[];
    onToggle: (id: string, visible: boolean) => void;
    onReset: () => void;
    canReset: boolean;
}) => {
    const { t } = useTranslation('studyLibraryDoubtBoard');
    const [search, setSearch] = useState('');
    const needle = search.trim().toLowerCase();
    const filtered = needle ? staff.filter((s) => s.name.toLowerCase().includes(needle)) : staff;

    return (
        <Popover>
            <PopoverTrigger asChild>
                <MyButton buttonType="secondary" scale="small" aria-label={t('columns')}>
                    <Columns className="size-4" />
                    {t('columns')}
                </MyButton>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-3">
                <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                        {t('teacherColumns')}
                    </p>
                    {canReset && (
                        <button
                            type="button"
                            onClick={onReset}
                            className="text-xs font-medium text-primary-600 hover:underline"
                        >
                            {t('reset')}
                        </button>
                    )}
                </div>
                <p className="mb-2 text-caption text-neutral-400">{t('columnsHint')}</p>
                <label className="mb-2 flex items-center gap-2 rounded-md border border-neutral-200 px-2 py-1">
                    <MagnifyingGlass size={14} className="shrink-0 text-neutral-400" aria-hidden />
                    <input
                        type="search"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={t('searchStaff')}
                        aria-label={t('searchStaff')}
                        className="w-full bg-transparent text-xs text-neutral-700 outline-none placeholder:text-neutral-400"
                    />
                </label>
                <div className="max-h-64 space-y-0.5 overflow-y-auto">
                    {filtered.length === 0 ? (
                        <p className="px-1.5 py-3 text-center text-xs text-neutral-400">
                            {t('noStaffMatch')}
                        </p>
                    ) : (
                        filtered.map((s) => (
                            <label
                                key={s.id}
                                className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm text-neutral-700 hover:bg-neutral-50"
                            >
                                <Checkbox
                                    checked={s.visible}
                                    onCheckedChange={(checked) => onToggle(s.id, checked === true)}
                                    aria-label={s.name}
                                />
                                <span
                                    aria-hidden
                                    className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-100 text-caption font-semibold text-primary-700"
                                >
                                    {getInitials(s.name)}
                                </span>
                                <span className="min-w-0 flex-1 truncate">
                                    {s.name}
                                    {s.subtitle && (
                                        <span className="text-neutral-400"> · {s.subtitle}</span>
                                    )}
                                </span>
                                {s.count > 0 && (
                                    <span className="shrink-0 rounded-full bg-neutral-100 px-1.5 text-caption tabular-nums text-neutral-500">
                                        {s.count}
                                    </span>
                                )}
                            </label>
                        ))
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
};
