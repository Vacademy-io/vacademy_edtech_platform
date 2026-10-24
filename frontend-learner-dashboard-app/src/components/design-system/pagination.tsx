import {
    Pagination,
    PaginationContent,
    PaginationEllipsis,
    PaginationItem,
    PaginationLink,
    PaginationNext,
    PaginationPrevious,
} from "@/components/ui/pagination";
import { MyInput } from "./input";
import { useState, useMemo } from "react";
import { KeyReturn, XCircle } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";

interface PaginationProps {
    currentPage: number;
    totalPages: number;
    onPageChange: (page: number) => void;
}

export function MyPagination({ currentPage, totalPages, onPageChange }: PaginationProps) {
    const { t } = useTranslation("uiAtomsA");
    const [pageInput, setPageInput] = useState("");
    const [submittedPage, setSubmittedPage] = useState("");
    // Compute page numbers for pagination control
    const pageNumbers = useMemo(() => {
        const pages: number[] = [];
        if (totalPages <= 5) {
            for (let i = 0; i < totalPages; i++) pages.push(i);
        } else {
            pages.push(0);
            if (currentPage > 2) pages.push(-1);
            const start = Math.max(1, currentPage - 1);
            const end = Math.min(totalPages - 2, currentPage + 1);
            for (let i = start; i <= end; i++) pages.push(i);
            if (currentPage < totalPages - 3) pages.push(-1);
            pages.push(totalPages - 1);
        }
        return pages;
    }, [currentPage, totalPages]);

    const handlePageInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const input = event.target.value;
        const numericValue = input.replace(/[^0-9]/g, ""); // Remove non-numeric characters
        setPageInput(numericValue);
    };

    const handlePageInputSubmit = () => {
        const newPage = parseInt(pageInput);
        if (!isNaN(newPage) && newPage >= 1 && newPage <= totalPages) {
            onPageChange(newPage - 1);
            setSubmittedPage(pageInput);
        }
    };

    const handleClearPageInput = () => {
        setPageInput("");
        setSubmittedPage("");
    };

    const handlePreviousPage = () => {
        if (currentPage > 0) {
            onPageChange(currentPage - 1);
        }
    };

    const handleNextPage = () => {
        if (currentPage < totalPages - 1) {
            onPageChange(currentPage + 1);
        }
    };

    return (
        <div className="flex w-full items-center justify-center gap-16 text-body text-neutral-600">
            <Pagination className="mx-0 w-fit">
                <PaginationContent className="w-fit">
                    <PaginationItem>
                        <PaginationPrevious
                            onClick={handlePreviousPage}
                            className={
                                currentPage === 0
                                    ? "pointer-events-none opacity-50"
                                    : "cursor-pointer"
                            }
                        />
                    </PaginationItem>
                    {pageNumbers.map((pageIndex, idx) =>
                        pageIndex === -1 ? (
                            <PaginationItem key={`ellipsis-${idx}`}>  
                                <PaginationEllipsis />
                            </PaginationItem>
                        ) : (
                            <PaginationItem key={pageIndex}>
                                <PaginationLink
                                    onClick={() => onPageChange(pageIndex)}
                                    isActive={currentPage === pageIndex}
                                    className="cursor-pointer"
                                >
                                    {pageIndex + 1}
                                </PaginationLink>
                            </PaginationItem>
                        )
                    )}
                    <PaginationItem>
                        <PaginationNext
                            onClick={handleNextPage}
                            className={
                                currentPage === totalPages - 1
                                    ? "pointer-events-none opacity-50"
                                    : "cursor-pointer"
                            }
                        />
                    </PaginationItem>
                </PaginationContent>
            </Pagination>

            <div className="flex items-center gap-2">
                <div>{t("pagination.goTo")}</div>
                <div className="relative">
                    <MyInput
                        inputType="text"
                        input={pageInput}
                        onChangeFunction={handlePageInputChange}
                        className="h-7 w-12 pe-7"
                    />
                    <KeyReturn
                        weight="fill"
                        className={`absolute end-2 top-1/4 size-5 cursor-pointer text-primary-500 ${
                            (pageInput.length || (submittedPage.length && !pageInput.length)) &&
                            submittedPage !== pageInput
                                ? "visible"
                                : "hidden"
                        }`}
                        onClick={handlePageInputSubmit}
                    />
                    <XCircle
                        className={`absolute end-2 top-1/4 size-5 cursor-pointer text-neutral-400 ${
                            pageInput === submittedPage && pageInput !== "" ? "visible" : "hidden"
                        }`}
                        onClick={handleClearPageInput}
                    />
                </div>
            </div>
        </div>
    );
}
