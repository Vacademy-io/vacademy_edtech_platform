import type { ReactNode } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { AxiosError, type AxiosResponse } from 'axios';
import type { ReportAnswer, ReportColumn } from '../-shared/report-types';

/**
 * Neutral data and helpers for the report screen tests (no real shop, place
 * or person). `t` in these tests returns the key followed by the values it
 * was given, so a test can read both the sentence chosen and the figures.
 */

export const tWithValues = (key: string, values?: Record<string, unknown>) => {
    if (!values) return key;
    const shown = Object.entries(values)
        .filter(([name]) => name !== 'defaultValue')
        .map(([, value]) => String(value));
    return shown.length > 0 ? `${key} ${shown.join(' ')}` : key;
};

export const column = (key: string, type: ReportColumn['type'] = 'TEXT', label = key): ReportColumn => ({
    key,
    label: null,
    labelEn: label,
    labelHi: null,
    type,
});

export const answer = (overrides: Partial<ReportAnswer> = {}): ReportAnswer => ({
    report: 'sales-register',
    from: '2026-11-01',
    to: '2026-11-19',
    filters: {},
    columns: [],
    rows: [],
    totals: null,
    sections: [],
    check: null,
    warnings: [],
    nextCursor: null,
    asOf: '2026-11-19T08:30:00Z',
    ...overrides,
});

export function serverError(status: number, message: string): AxiosError {
    const response = { status, data: { message }, headers: {}, statusText: 'Error', config: {} } as unknown as AxiosResponse;
    return new AxiosError(message, String(status), undefined, undefined, response);
}

export function renderWithQuery(ui: ReactNode) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

/**
 * Stand-in for the design-system `MyTable` in these tests: the real one pulls
 * in the student-list dialogs (and the app's i18n set-up with them). Same
 * props, same `cell` renderers, plain table.
 */
export function MockTable<T>({ data, columns }: { data?: { content: T[] }; columns: ColumnDef<T>[] }) {
    return (
        <table>
            <thead>
                <tr>
                    {columns.map((c) => (
                        <th key={c.id}>{typeof c.header === 'string' ? c.header : c.id}</th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {(data?.content ?? []).map((row, index) => (
                    <tr key={index}>
                        {columns.map((c) => (
                            <td key={c.id}>
                                {typeof c.cell === 'function'
                                    ? (c.cell as (ctx: { row: { original: T } }) => ReactNode)({ row: { original: row } })
                                    : null}
                            </td>
                        ))}
                    </tr>
                ))}
            </tbody>
        </table>
    );
}
