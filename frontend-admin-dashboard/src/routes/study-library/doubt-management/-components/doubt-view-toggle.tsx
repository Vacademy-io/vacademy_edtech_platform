import { useTranslation } from 'react-i18next';
import { Kanban, Tray } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { DoubtView } from '../-stores/view-store';

/** Inbox ⇄ Board switch for Doubt Management. Same look as the leads surfaces' view toggle. */
export const DoubtViewToggle = ({
    value,
    onChange,
    className,
}: {
    value: DoubtView;
    onChange: (view: DoubtView) => void;
    className?: string;
}) => {
    const { t } = useTranslation('studyLibraryDoubtBoard');
    const options: { value: DoubtView; label: string; icon: typeof Tray }[] = [
        { value: 'inbox', label: t('viewInbox'), icon: Tray },
        { value: 'board', label: t('viewBoard'), icon: Kanban },
    ];
    return (
        <div
            role="tablist"
            aria-label={t('viewToggle')}
            className={cn(
                'inline-flex items-center gap-0.5 rounded-lg border border-neutral-200 bg-neutral-50 p-0.5',
                className
            )}
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
