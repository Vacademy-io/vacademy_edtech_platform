import { Input } from '@/components/ui/input';
import { MagnifyingGlass, XCircle } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';

interface ScheduleTestSearchComponent {
    onSearch: (searchValue: string) => void;
    searchText: string;
    setSearchText: (text: string) => void;
    clearSearch: () => void;
}

export const ScheduleTestSearchComponent = ({
    onSearch,
    searchText,
    setSearchText,
    clearSearch,
}: ScheduleTestSearchComponent) => {
    const { t } = useTranslation('assessmentScheduleTestSearchComponent');
    const handleSearch = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            onSearch(searchText);
        }
    };

    return (
        <div className="relative">
            <MagnifyingGlass className="absolute left-2 top-1/2 -translate-y-1/2 cursor-pointer text-neutral-600" />
            <Input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                onKeyDown={handleSearch}
                placeholder={t('searchPlaceholder')}
                className="pl-8 pr-12"
            />
            {searchText && (
                <XCircle
                    className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer text-neutral-600"
                    onClick={clearSearch}
                />
            )}
        </div>
    );
};
