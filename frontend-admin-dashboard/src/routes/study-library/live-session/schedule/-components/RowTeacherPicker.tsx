import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ChalkboardTeacher,
    CircleNotch,
    MagnifyingGlass,
    Warning,
    X as XIcon,
} from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { InstituteUser } from '@/routes/manage-institute/teams/-services/institute-users-service';
import {
    resolveTeacherEntry,
    resolvedTeacherIds,
    type TeacherIndex,
} from '../-utils/teacherDirectory';

export type TeacherDirectory = {
    status: 'loading' | 'ready' | 'error';
    users: InstituteUser[];
    /** Null until the directory has loaded; entries then show as typed. */
    index: TeacherIndex | null;
    /** The fetch came back a full page, so someone may be missing from it. */
    truncated: boolean;
};

interface RowTeacherPickerProps {
    /** User ids picked here, and/or CSV emails / usernames / ids as typed. */
    value: string[];
    onChange: (next: string[]) => void;
    directory: TeacherDirectory;
    onApplyToAll: (entries: string[]) => void;
}

/**
 * The per-row Teacher cell: a searchable multi-select over the institute's
 * staff. A CSV import's emails / usernames show up here as the people they
 * matched; anything that matched nobody (or two people) stays visible and
 * flagged until the admin removes or replaces it. Empty = whoever schedules.
 */
export const RowTeacherPicker = ({
    value,
    onChange,
    directory,
    onApplyToAll,
}: RowTeacherPickerProps) => {
    const { t } = useTranslation('studyLibraryBulkScheduleGrid');
    const [search, setSearch] = useState('');
    const { index } = directory;

    const entries = useMemo(
        () =>
            value.map((entry) => ({
                entry,
                match: index ? resolveTeacherEntry(index, entry) : null,
            })),
        [value, index]
    );
    const selectedIds = useMemo(
        () => (index ? resolvedTeacherIds(index, value) : []),
        [index, value]
    );
    const problemCount = entries.filter((e) => e.match && e.match.kind !== 'user').length;

    const visibleUsers = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return directory.users;
        return directory.users.filter(
            (u) =>
                u.full_name?.toLowerCase().includes(q) ||
                u.email?.toLowerCase().includes(q) ||
                u.username?.toLowerCase().includes(q)
        );
    }, [directory.users, search]);

    const toggle = (userId: string, checked: boolean) => {
        if (checked) {
            if (!selectedIds.includes(userId)) onChange([...value, userId]);
            return;
        }
        // Drop every entry pointing at this person — their id, email or username.
        onChange(
            value.filter((entry) => {
                const match = index ? resolveTeacherEntry(index, entry) : null;
                return !(match?.kind === 'user' && match.user.id === userId);
            })
        );
    };

    const labelFor = (item: (typeof entries)[number]) =>
        item.match?.kind === 'user'
            ? item.match.user.full_name || item.match.user.email || item.entry
            : item.entry;
    const firstLabel = entries[0] ? labelFor(entries[0]) : '';
    const triggerLabel =
        value.length === 0
            ? t('rowTeacherPicker.defaultYou')
            : value.length === 1
              ? firstLabel
              : t('rowTeacherPicker.nameAndMore', { name: firstLabel, more: value.length - 1 });

    return (
        <div>
            <Popover onOpenChange={(open) => !open && setSearch('')}>
                <PopoverTrigger asChild>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className={cn(
                            'h-8 w-full justify-start gap-1.5 text-xs',
                            value.length === 0 && 'font-normal text-neutral-500',
                            value.length > 0 &&
                                problemCount === 0 &&
                                'border-primary-300 bg-primary-50',
                            problemCount > 0 && 'border-warning-300 bg-warning-50 text-warning-700'
                        )}
                    >
                        {problemCount > 0 ? (
                            <Warning size={14} className="shrink-0" />
                        ) : (
                            <ChalkboardTeacher size={14} className="shrink-0" />
                        )}
                        <span className="truncate">{triggerLabel}</span>
                    </Button>
                </PopoverTrigger>
                <PopoverContent
                    align="start"
                    className="w-80 p-0"
                    onOpenAutoFocus={(e) => e.preventDefault()}
                >
                    {entries.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 border-b border-neutral-200 p-3">
                            {entries.map((item, i) => {
                                const problem = !!item.match && item.match.kind !== 'user';
                                return (
                                    <Badge
                                        key={`${item.entry}-${i}`}
                                        variant="secondary"
                                        className={cn(
                                            'flex max-w-full items-center gap-1 py-0.5 pe-1 ps-2 text-xs font-normal',
                                            problem && 'bg-warning-50 text-warning-700'
                                        )}
                                    >
                                        <span className="truncate">{labelFor(item)}</span>
                                        {item.match?.kind === 'unmatched' && (
                                            <span className="shrink-0">
                                                {t('rowTeacherPicker.notFound')}
                                            </span>
                                        )}
                                        {item.match?.kind === 'ambiguous' && (
                                            <span className="shrink-0">
                                                {t('rowTeacherPicker.ambiguous', {
                                                    people: item.match.matches.length,
                                                })}
                                            </span>
                                        )}
                                        <button
                                            type="button"
                                            aria-label={t('rowTeacherPicker.remove')}
                                            className="shrink-0 rounded-full p-0.5 hover:bg-neutral-200"
                                            onClick={() =>
                                                onChange(value.filter((_, j) => j !== i))
                                            }
                                        >
                                            <XIcon size={10} />
                                        </button>
                                    </Badge>
                                );
                            })}
                        </div>
                    )}
                    <div className="border-b border-neutral-200 p-3">
                        <div className="relative">
                            <MagnifyingGlass
                                size={14}
                                className="absolute start-2.5 top-1/2 -translate-y-1/2 text-neutral-400"
                            />
                            <Input
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder={t('rowTeacherPicker.searchPlaceholder')}
                                className="h-8 px-7 text-xs"
                            />
                            {search && (
                                <button
                                    type="button"
                                    onClick={() => setSearch('')}
                                    className="absolute end-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-neutral-400 hover:text-neutral-600"
                                    aria-label={t('rowTeacherPicker.clearSearch')}
                                >
                                    <XIcon size={12} />
                                </button>
                            )}
                        </div>
                    </div>
                    <div className="max-h-64 overflow-y-auto p-1.5">
                        {directory.status === 'loading' ? (
                            <div className="flex items-center justify-center gap-2 py-6 text-xs text-neutral-500">
                                <CircleNotch size={14} className="animate-spin" />
                                {t('rowTeacherPicker.loading')}
                            </div>
                        ) : directory.status === 'error' ? (
                            <p className="px-2 py-6 text-center text-xs text-danger-600">
                                {t('rowTeacherPicker.loadFailed')}
                            </p>
                        ) : visibleUsers.length === 0 ? (
                            <p className="py-6 text-center text-xs text-neutral-500">
                                {search.trim()
                                    ? t('rowTeacherPicker.noMatch')
                                    : t('rowTeacherPicker.noStaff')}
                            </p>
                        ) : (
                            visibleUsers.map((user) => {
                                const checked = selectedIds.includes(user.id);
                                return (
                                    <label
                                        key={user.id}
                                        className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1.5 text-xs hover:bg-neutral-50"
                                    >
                                        <Checkbox
                                            checked={checked}
                                            onCheckedChange={(c) => toggle(user.id, c === true)}
                                            className={cn(
                                                'size-3.5 rounded-sm border-2 shadow-none',
                                                checked && 'border-none bg-primary-500 text-white'
                                            )}
                                        />
                                        <span className="flex min-w-0 flex-col">
                                            <span className="truncate text-neutral-800">
                                                {user.full_name || user.email || user.username}
                                            </span>
                                            {user.full_name && (user.email || user.username) && (
                                                <span className="truncate text-neutral-500">
                                                    {user.email || user.username}
                                                </span>
                                            )}
                                        </span>
                                    </label>
                                );
                            })
                        )}
                    </div>
                    <div className="flex items-center justify-between gap-2 border-t border-neutral-200 px-3 py-2">
                        {value.length === 0 ? (
                            <span className="text-xs text-neutral-500">
                                {t('rowTeacherPicker.emptyHint')}
                            </span>
                        ) : (
                            <>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 text-xs"
                                    onClick={() => onApplyToAll(value)}
                                >
                                    {t('rowTeacherPicker.applyToAll')}
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 text-xs text-danger-600"
                                    onClick={() => onChange([])}
                                >
                                    {t('rowTeacherPicker.clear')}
                                </Button>
                            </>
                        )}
                    </div>
                </PopoverContent>
            </Popover>
            {problemCount > 0 && (
                <p className="mt-1 text-2xs text-warning-700">
                    {t('rowTeacherPicker.problemCount', { count: problemCount })}
                </p>
            )}
        </div>
    );
};
