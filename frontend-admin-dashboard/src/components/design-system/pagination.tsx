import {
    Pagination,
    PaginationContent,
    PaginationEllipsis,
    PaginationItem,
    PaginationLink,
    PaginationNext,
    PaginationPrevious,
} from '@/components/ui/pagination';
import { MyInput } from './input';
import { useState } from 'react';
import { KeyReturn, XCircle } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

interface PaginationProps {
    /** Zero-indexed. */
    currentPage: number;
    totalPages: number;
    onPageChange: (page: number) => void;
    /**
     * Row count across all pages. Optional: pass it to render a
     * "Showing 1 to 10 of 32 entries" summary on the left. Call sites that omit it
     * keep the original centred, summary-less layout.
     */
    totalElements?: number;
    /** Rows per page. Used for the summary range, and for the selector below. */
    pageSize?: number;
    /**
     * Supply alongside `pageSize` to render a "10 per page" selector. Omit it and the
     * footer stays read-only, which is what every existing call site does.
     */
    onPageSizeChange?: (size: number) => void;
    /** Choices offered by the selector. */
    pageSizeOptions?: number[];
}

/**
 * Which page numbers to render: first, last, and a window around the current page,
 * with ellipses standing in for the gaps.
 *
 * This replaces a version that only ever rendered page 1 and the last page — so a
 * four-page table showed "1 … 4" and pages 2 and 3 could not be clicked at all. The
 * only way to reach them was to type into the Go-to box.
 */
const buildPageItems = (currentPage: number, totalPages: number): (number | 'ellipsis')[] => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index);

    const items: (number | 'ellipsis')[] = [0];
    const start = Math.max(1, currentPage - 1);
    const end = Math.min(totalPages - 2, currentPage + 1);

    if (start > 1) items.push('ellipsis');
    for (let page = start; page <= end; page++) items.push(page);
    if (end < totalPages - 2) items.push('ellipsis');

    items.push(totalPages - 1);
    return items;
};

export function MyPagination({
    currentPage,
    totalPages,
    onPageChange,
    totalElements,
    pageSize,
    onPageSizeChange,
    pageSizeOptions = [10, 25, 50, 100],
}: PaginationProps) {
    const [pageInput, setPageInput] = useState('');
    const [submittedPage, setSubmittedPage] = useState('');

    const handlePageInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const input = event.target.value;
        const numericValue = input.replace(/[^0-9]/g, ''); // Remove non-numeric characters
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
        setPageInput('');
        setSubmittedPage('');
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

    const showSummary = typeof totalElements === 'number' && !!pageSize && totalElements > 0;
    const firstOnPage = currentPage * (pageSize ?? 0) + 1;
    const lastOnPage = Math.min((currentPage + 1) * (pageSize ?? 0), totalElements ?? 0);

    return (
        <div
            className={cn(
                'flex w-full flex-wrap items-center text-body text-neutral-600',
                // Only the summary variant spreads to the edges. Without it the layout is
                // left exactly as it was, so the other call sites are unaffected.
                showSummary ? 'justify-between gap-4' : 'justify-center gap-16'
            )}
        >
            {showSummary && (
                <div className="flex flex-wrap items-center gap-4">
                    <span className="text-neutral-500">
                        Showing {firstOnPage} to {lastOnPage} of {totalElements} entries
                    </span>
                    {onPageSizeChange && (
                        <label className="flex items-center gap-2 text-neutral-500">
                            <select
                                value={pageSize}
                                onChange={(event) => onPageSizeChange(Number(event.target.value))}
                                className="h-8 cursor-pointer rounded-md border border-neutral-300 bg-white px-2 text-body text-neutral-600 outline-none focus:border-primary-500"
                                aria-label="Rows per page"
                            >
                                {pageSizeOptions.map((size) => (
                                    <option key={size} value={size}>
                                        {size} per page
                                    </option>
                                ))}
                            </select>
                        </label>
                    )}
                </div>
            )}
            <div className="flex flex-wrap items-center gap-6">
                <Pagination className="mx-0 w-fit">
                    <PaginationContent className="w-fit">
                        <PaginationItem>
                            <PaginationPrevious
                                onClick={handlePreviousPage}
                                className={
                                    currentPage === 0
                                        ? 'pointer-events-none opacity-50'
                                        : 'cursor-pointer'
                                }
                            />
                        </PaginationItem>

                        {buildPageItems(currentPage, totalPages).map((item, index) =>
                            item === 'ellipsis' ? (
                                <PaginationItem key={`ellipsis-${index}`}>
                                    <PaginationEllipsis />
                                </PaginationItem>
                            ) : (
                                <PaginationItem key={item}>
                                    <PaginationLink
                                        onClick={() => onPageChange(item)}
                                        isActive={currentPage === item}
                                        className="cursor-pointer"
                                    >
                                        {item + 1}
                                    </PaginationLink>
                                </PaginationItem>
                            )
                        )}

                        <PaginationItem>
                            <PaginationNext
                                onClick={handleNextPage}
                                className={
                                    currentPage === totalPages - 1
                                        ? 'pointer-events-none opacity-50'
                                        : 'cursor-pointer'
                                }
                            />
                        </PaginationItem>
                    </PaginationContent>
                </Pagination>

                {totalPages > 1 && (
                    <div className="flex items-center gap-2">
                        <div>Go to</div>
                        <div className="relative">
                            <MyInput
                                inputType="text"
                                input={pageInput}
                                onChangeFunction={handlePageInputChange}
                                className="h-7 w-[50px] pr-7"
                            />
                            <KeyReturn
                                weight="fill"
                                className={`absolute right-2 top-1/4 size-[18px] cursor-pointer text-primary-500 ${
                                    (pageInput.length ||
                                        (submittedPage.length && !pageInput.length)) &&
                                    submittedPage !== pageInput
                                        ? 'visible'
                                        : 'hidden'
                                }`}
                                onClick={handlePageInputSubmit}
                            />
                            <XCircle
                                className={`absolute right-2 top-1/4 size-[18px] cursor-pointer text-neutral-400 ${
                                    pageInput === submittedPage && pageInput !== ''
                                        ? 'visible'
                                        : 'hidden'
                                }`}
                                onClick={handleClearPageInput}
                            />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
