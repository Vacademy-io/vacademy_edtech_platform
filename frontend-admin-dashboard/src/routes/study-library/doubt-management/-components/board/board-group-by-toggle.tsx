import { useTranslation } from 'react-i18next';
import { Flag, UsersThree } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { DoubtBoardGroupBy } from '../../-stores/view-store';

/** Assignee ⇄ Status column layout for the board. Same look as the Inbox/Board switch. */
export const BoardGroupByToggle = ({
    value,
    onChange,
}: {
    value: DoubtBoardGroupBy;
    onChange: (next: DoubtBoardGroupBy) => void;
}) => {
    const { t } = useTranslation('studyLibraryDoubtBoard');
    const options: { value: DoubtBoardGroupBy; label: string; icon: typeof Flag }[] = [
        { value: 'assignee', label: t('groupBy.assignee'), icon: UsersThree },
        { value: 'status', label: t('groupBy.status'), icon: Flag },
    ];
    return (
        <div
            role="tablist"
            aria-label={t('groupBy.label')}
            className="inline-flex items-center gap-0.5 rounded-lg border border-neutral-200 bg-neutral-50 p-0.5"
        >
            {options.map(({ value: v, label, icon: Icon }) => {
                const active = v === value;
                return (
                    <button
                        key={v}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => onChange(v)}
                        className={cn(
                            'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                            active
                                ? 'bg-white text-neutral-900 shadow-sm'
                                : 'text-neutral-500 hover:text-neutral-700'
                        )}
                    >
                        <Icon className="size-3.5" />
                        {label}
                    </button>
                );
            })}
        </div>
    );
};
