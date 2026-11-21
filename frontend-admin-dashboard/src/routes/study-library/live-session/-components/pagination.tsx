import React from 'react';
import { useTranslation } from 'react-i18next';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { MyButton } from '@/components/design-system/button';

interface PaginationProps {
    currentPage: number;
    totalPages: number;
    onPageChange: (page: number) => void;
    onPrevious: () => void;
    onNext: () => void;
}

export default function Pagination({
    currentPage,
    totalPages,
    onPageChange,
    onPrevious,
    onNext,
}: PaginationProps) {
    const { t } = useTranslation('studyLibraryPagination');
    if (totalPages <= 1) return null;

    const renderPageNumbers = () => {
        const pages = [];

        if (totalPages <= 3) {
            // If total pages are 3 or less, show all pages
            for (let i = 1; i <= totalPages; i++) {
                pages.push(
                    <button
                        key={i}
                        onClick={() => onPageChange(i)}
                        className={`rounded px-3 py-1.5 text-sm ${
                            currentPage === i
                                ? 'bg-primary-500 text-white'
                                : 'text-gray-600 hover:bg-gray-100'
                        }`}
                    >
                        {i}
                    </button>
                );
            }
        } else {
            // Show page 1
            pages.push(
                <button
                    key={1}
                    onClick={() => onPageChange(1)}
                    className={`rounded px-3 py-1.5 text-sm ${
                        currentPage === 1
                            ? 'bg-primary-500 text-white'
                            : 'text-gray-600 hover:bg-gray-100'
                    }`}
                >
                    1
                </button>
            );

            // Show dots if current page is far from start
            if (currentPage > 3) {
                pages.push(
                    <span key="dots1" className="px-2 text-gray-400">
                        ...
                    </span>
                );
            }

            // Show current page if it's not 1 or last page
            if (currentPage > 1 && currentPage < totalPages) {
                pages.push(
                    <button
                        key={currentPage}
                        onClick={() => onPageChange(currentPage)}
                        className="rounded bg-primary-500 px-3 py-1.5 text-sm text-white"
                    >
                        {currentPage}
                    </button>
                );
            }

            // Show dots if current page is far from end
            if (currentPage < totalPages - 2) {
                pages.push(
                    <span key="dots2" className="px-2 text-gray-400">
                        ...
                    </span>
                );
            }

            // Show last page
            if (totalPages > 1) {
                pages.push(
                    <button
                        key={totalPages}
                        onClick={() => onPageChange(totalPages)}
                        className={`rounded px-3 py-1.5 text-sm ${
                            currentPage === totalPages
                                ? 'bg-primary-500 text-white'
                                : 'text-gray-600 hover:bg-gray-100'
                        }`}
                    >
                        {totalPages}
                    </button>
                );
            }
        }

        return pages;
    };

    return (
        <div className="mt-6 flex items-center justify-center gap-2">
            {/* Previous Button */}
            <button
                onClick={onPrevious}
                disabled={currentPage === 1}
                className={`flex items-center gap-1 rounded px-3 py-1.5 text-sm ${
                    currentPage === 1
                        ? 'cursor-not-allowed text-gray-400'
                        : 'text-gray-600 hover:bg-gray-100'
                }`}
            >
                <CaretLeft size={16} />
                {t('previous')}
            </button>

            {/* Page Numbers */}
            <div className="flex items-center gap-1">{renderPageNumbers()}</div>

            {/* Next Button */}
            <button
                onClick={onNext}
                disabled={currentPage === totalPages}
                className={`flex items-center gap-1 rounded px-3 py-1.5 text-sm ${
                    currentPage === totalPages
                        ? 'cursor-not-allowed text-gray-400'
                        : 'text-gray-600 hover:bg-gray-100'
                }`}
            >
                {t('next')}
                <CaretRight size={16} />
            </button>

            {/* Go to page input */}
            <div className="ms-4 flex items-center gap-2">
                <span className="text-sm text-gray-600">{t('goTo')}</span>
                <input
                    type="number"
                    min={1}
                    max={totalPages}
                    className="w-16 rounded border border-gray-300 px-2 py-1 text-sm"
                    placeholder="1"
                    onKeyPress={(e) => {
                        if (e.key === 'Enter') {
                            const page = parseInt(e.currentTarget.value);
                            if (page >= 1 && page <= totalPages) {
                                onPageChange(page);
                                e.currentTarget.value = '';
                            }
                        }
                    }}
                />
            </div>
        </div>
    );
}
