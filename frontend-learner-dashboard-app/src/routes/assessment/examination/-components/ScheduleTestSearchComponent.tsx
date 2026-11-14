import { Input } from "@/components/ui/input";
import { MagnifyingGlass, XCircle } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";

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
    const { t } = useTranslation("assessment");
    const handleSearch = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            onSearch(searchText);
        }
    };

    return (
        <div className="relative w-full">
            <MagnifyingGlass className="absolute start-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                onKeyDown={handleSearch}
                placeholder={t("scheduleTest.search.placeholder")}
                className="ps-9 pe-8 w-full bg-background"
            />
            {searchText && (
                <XCircle
                    className="absolute end-2.5 top-1/2 -translate-y-1/2 h-4 w-4 cursor-pointer text-muted-foreground hover:text-foreground transition-colors"
                    onClick={clearSearch}
                />
            )}
        </div>
    );
};
