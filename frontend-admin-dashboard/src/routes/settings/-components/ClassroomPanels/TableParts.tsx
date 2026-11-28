import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { MagnifyingGlass, WarningCircle } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import type { TableData } from '@/components/design-system/table';
import { panelErrorMessage } from './api';

const PAGE_SIZE = 10;

/** The rooms and devices endpoints return whole lists, so paging happens here. */
export function useClientPage<T>(rows: T[]) {
    const [page, setPage] = useState(0);
    const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));

    // A search or a removal can leave the current page past the end of the list.
    useEffect(() => {
        if (page > totalPages - 1) setPage(totalPages - 1);
    }, [page, totalPages]);

    const tableData = useMemo<TableData<T>>(() => {
        const start = page * PAGE_SIZE;
        return {
            content: rows.slice(start, start + PAGE_SIZE),
            total_pages: totalPages,
            page_no: page,
            page_size: PAGE_SIZE,
            total_elements: rows.length,
            last: page >= totalPages - 1,
        };
    }, [rows, page, totalPages]);

    return { page, setPage, totalPages, pageSize: PAGE_SIZE, tableData };
}

export function TableError({
    message,
    error,
    onRetry,
}: {
    message: string;
    error: unknown;
    onRetry: () => void;
}) {
    const { t } = useTranslation('settingsClassroomPanels');
    return (
        <Alert variant="destructive" role="alert">
            <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <span>
                    {message} {panelErrorMessage(t, error)}
                </span>
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="medium"
                    className="shrink-0"
                    onClick={onRetry}
                >
                    {t('common.retry')}
                </MyButton>
            </AlertDescription>
        </Alert>
    );
}

/** A background refresh failed: the rows are still shown, and say that they may be old. */
export function StaleNote({ onRetry }: { onRetry: () => void }) {
    const { t } = useTranslation('settingsClassroomPanels');
    return (
        <div
            role="status"
            className="flex flex-wrap items-center gap-2 text-caption text-warning-600"
        >
            <WarningCircle size={16} className="shrink-0" />
            <span>{t('common.stale')}</span>
            <MyButton type="button" buttonType="text" scale="small" onClick={onRetry}>
                {t('common.retry')}
            </MyButton>
        </div>
    );
}

export function TableEmpty({
    title,
    body,
    action,
}: {
    title: string;
    body: string;
    action?: ReactNode;
}) {
    return (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-neutral-200 px-6 py-10 text-center">
            <p className="text-subtitle font-medium text-neutral-700">{title}</p>
            <p className="max-w-md text-body text-neutral-500">{body}</p>
            {action}
        </div>
    );
}

export function TableSearch({
    label,
    value,
    onChange,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
}) {
    return (
        <div className="relative w-full sm:w-64">
            <MagnifyingGlass
                size={16}
                className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-neutral-400"
            />
            <MyInput
                inputType="text"
                inputPlaceholder={label}
                aria-label={label}
                input={value}
                onChangeFunction={(event) => onChange(event.target.value)}
                className="w-full ps-9 sm:w-full"
            />
        </div>
    );
}
