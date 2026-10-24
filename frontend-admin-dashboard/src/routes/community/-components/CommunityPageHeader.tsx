import HeadingSvg1 from '../-svgs/headerDisplay-1.svg';
import HeadingSvg2 from '../-svgs/headerDisplay-2.svg';
import HeadingSvg3 from '../-svgs/headerDisplay-3.svg';
import HeadingSvg4 from '../-svgs/headerDisplay-4.svg';
import HeadingSvg5 from '../-svgs/headerDisplay-5.svg';
import HeadingSvg6 from '../-svgs/headerDisplay-6.svg';
import { FilterLevelDropdown } from '../-components/FilterDropdown';
import { useFilterStore } from '../-store/useFilterOptions';
import { useSelectedFilterStore } from '../-store/useSlectedFilterOption';
import { SearchInput } from '@/routes/manage-students/students-list/-components/students-list/student-list-section/search-input';
import { useState } from 'react';
import { debounce } from 'lodash';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

export const CommunityPageHeader = () => {
    const { t } = useTranslation('communityPageHeader');
    const { options } = useFilterStore();
    const { setName } = useSelectedFilterStore();
    const [search, setSearch] = useState<string>('');
    const debouncedSetName = useCallback(
        debounce((value: string) => {
            setName(value);
        }, 1000), // 300ms delay
        []
    );
    const onSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        debouncedSetName(e.target.value);
        setSearch(e.target.value);
    };
    return (
        <div className="flex h-[380px] flex-col items-center justify-center py-5">
            <div className="flex w-full flex-row items-center justify-center">
                <div className="relative">
                    <HeadingSvg1 className="absolute -bottom-5 right-0" />
                </div>
                <div className="ms-[40px] me-[120px] text-center text-h2">
                    {t('heroLine1')} <br /> {t('heroLine2')}
                </div>
                <div className="relative">
                    <HeadingSvg2 className="absolute -bottom-5 left-0" />
                </div>
            </div>
            <div className="mt-10 flex w-full flex-row items-center justify-center">
                <div className="relative -translate-x-10 translate-y-4">
                    <HeadingSvg3 />
                </div>
                <div className="relative -translate-x-4">
                    <HeadingSvg4 />
                </div>
                <div className="ms-[40px] me-[50px] flex flex-col gap-4 text-center text-h2">
                    <SearchInput
                        searchInput={search}
                        onSearchChange={onSearchChange}
                        placeholder={t('searchPlaceholder')}
                    />
                    <FilterLevelDropdown
                        placeholder={t('selectLevelPlaceholder')}
                        FilterList={options.levels}
                    />
                </div>
                <div className="relative -translate-y-6 translate-x-6">
                    <HeadingSvg5 />
                </div>
                <div className="relative translate-x-6 translate-y-10">
                    <HeadingSvg6 />
                </div>
            </div>
        </div>
    );
};
