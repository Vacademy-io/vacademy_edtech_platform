import {
    FilterStreamDropdown,
    FilterSubjectDropdown,
    FilterDifficultiesDropdown,
    FilterTypesDropdown,
} from './FilterDropdown';
import { Chip } from './Chips';
import { useState, useRef } from 'react';
import { useSelectedFilterStore } from '../-store/useSlectedFilterOption';
import { useFilterStore } from '../-store/useFilterOptions';
import { useTranslation } from 'react-i18next';

export function FiltersTab() {
    const { t } = useTranslation('communityFiltersTab');
    const { options } = useFilterStore();
    const [expanded, setExpanded] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const { selected } = useSelectedFilterStore();

    return (
        <div className="mx-10 mb-10 flex flex-col gap-6 border-b pb-6">
            <div className="flex flex-row flex-wrap justify-around gap-4 rounded bg-sidebar-background p-4">
                {selected.level && (
                    <FilterStreamDropdown
                        placeholder={t('selectStream')}
                        FilterList={options.streams[selected.level?.levelId] || []}
                    />
                )}
                {selected.stream && (
                    <FilterSubjectDropdown
                        FilterList={options.subjects[selected.stream.streamId] || []}
                        placeholder={t('selectSubject')}
                    />
                )}
                <FilterDifficultiesDropdown
                    FilterList={options.difficulties || []}
                    placeholder={t('selectDifficulty')}
                />
                <FilterTypesDropdown
                    FilterList={options.types || []}
                    placeholder={t('selectType')}
                />
            </div>
            <div
                ref={containerRef}
                className={`relative flex flex-wrap gap-4 pb-6 transition-all duration-300 ${
                    expanded ? 'max-h-[1000px]' : 'max-h-[56px] overflow-hidden'
                }`}
            >
                {options?.tags?.map((tag, index) => <Chip key={index} tag={tag} />)}
                <div className="absolute -bottom-[6px] end-0">
                    <button onClick={() => setExpanded(!expanded)} className="text-primary-500">
                        {!expanded ? t('seeMore') : t('seeLess')}
                    </button>
                </div>
            </div>
        </div>
    );
}
