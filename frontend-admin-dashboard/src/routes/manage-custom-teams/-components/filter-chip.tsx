import { X } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';

/**
 * One applied filter, shown as a removable chip under a toolbar.
 *
 * The filter controls already tint themselves when active, but that only says *a* status
 * filter is on — not which values. Reading the current query used to mean opening the
 * popovers one at a time; the chips put the whole query on screen and make each clause
 * individually removable, which is the part a single "Clear" button cannot do.
 *
 * Shared by the Manage <SubOrgs> list and the team-member list so the two toolbars in this
 * module cannot drift apart.
 */
export function FilterChip({
    label,
    value,
    onRemove,
}: {
    label: string;
    value: string;
    onRemove: () => void;
}) {
    const { t } = useTranslation('manageCustomTeamsFilterChip');
    return (
        <span className="inline-flex max-w-56 items-center gap-1 rounded-full border border-primary-200 bg-primary-50 py-1 pl-2.5 pr-1 text-xs text-primary-600">
            <span className="shrink-0 font-medium">{t('labelSeparator', { label })}</span>
            <span className="truncate" title={value}>
                {value}
            </span>
            <button
                type="button"
                onClick={onRemove}
                aria-label={t('removeFilter', { label, value })}
                className="ml-0.5 rounded-full p-0.5 text-primary-500 transition-colors hover:bg-primary-100 hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
            >
                <X className="size-3" weight="bold" />
            </button>
        </span>
    );
}
