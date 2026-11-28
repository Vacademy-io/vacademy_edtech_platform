import { useTranslation } from 'react-i18next';
import { FileText } from '@phosphor-icons/react';
import { ChipToggleGroup } from '@/components/design-system/chips';
import { MyButton } from '@/components/design-system/button';
import type { SubmissionOutline } from '@/services/submission-review/types';
import type { RowFilter } from '../-utils/filters';

/** Chips All / Needs marking / AI to check / Changed, a section select and the sheet toggle. */
export const FilterBar = ({
    filter,
    counts,
    onFilter,
    sections,
    sectionId,
    onSection,
    sheetOpen,
    hasSheet,
    onToggleSheet,
}: {
    filter: RowFilter;
    counts: Record<RowFilter, number>;
    onFilter: (f: RowFilter) => void;
    sections: SubmissionOutline['sections'];
    sectionId: string | null;
    onSection: (id: string | null) => void;
    sheetOpen: boolean;
    hasSheet: boolean;
    onToggleSheet: () => void;
}) => {
    const { t } = useTranslation('assessmentSubmissionReview');
    return (
        <div className="flex flex-wrap items-center justify-between gap-2">
            <ChipToggleGroup
                size="md"
                variant="outline"
                ariaLabel={t('filters.ariaLabel')}
                value={filter}
                onChange={(next) => onFilter(next as RowFilter)}
                options={[
                    { value: 'all', label: t('filters.all', { count: counts.all }) },
                    { value: 'needs_marking', label: t('filters.needsMarking', { count: counts.needs_marking }) },
                    { value: 'ai', label: t('filters.ai', { count: counts.ai }) },
                    { value: 'changed', label: t('filters.changed', { count: counts.changed }) },
                ]}
            />
            <div className="flex flex-wrap items-center gap-2">
                {sections.length > 1 && (
                    <label className="flex items-center gap-2 text-body text-neutral-600">
                        {t('filters.section')}
                        <select
                            value={sectionId ?? ''}
                            onChange={(e) => onSection(e.target.value || null)}
                            className="h-9 rounded-md border border-neutral-300 bg-white px-2 text-body text-neutral-700"
                        >
                            <option value="">{t('filters.allSections')}</option>
                            {sections.map((s) => (
                                <option key={s.section_id} value={s.section_id}>
                                    {s.name}
                                </option>
                            ))}
                        </select>
                    </label>
                )}
                {hasSheet && (
                    <MyButton
                        type="button"
                        buttonType={sheetOpen ? 'primary' : 'secondary'}
                        scale="medium"
                        className="gap-1.5 sm:min-w-0"
                        aria-pressed={sheetOpen}
                        onClick={onToggleSheet}
                    >
                        <FileText size={16} />
                        {t('filters.answerSheet')}
                    </MyButton>
                )}
            </div>
        </div>
    );
};
