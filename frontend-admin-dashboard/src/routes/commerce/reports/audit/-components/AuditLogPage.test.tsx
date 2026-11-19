/**
 * WP-51 contract §7.3, audit log: the filters of the address go to the
 * query; a typed document number goes to the address; each change reads
 * old → new with the reason; the approvals tab lists PIN approvals.
 */
import type { ReactNode } from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', async () => {
    const kit = await import('../../-components/report-test-kit');
    return { useTranslation: () => ({ t: kit.tWithValues, i18n: { language: 'en' } }) };
});
vi.mock('@/components/design-system/table', async () => ({ MyTable: (await import('../../-components/report-test-kit')).MockTable }));
vi.mock('@tanstack/react-router', () => ({
    Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
    useNavigate: () => vi.fn(),
    useSearch: () => ({}),
}));
vi.mock('@/routes/commerce/-components/CommercePage', () => ({
    CommercePage: ({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) => (
        <div>
            <h2>{title}</h2>
            <div>{actions}</div>
            {children}
        </div>
    ),
}));
vi.mock('@/lib/commerce/use-commerce-access', async () => {
    const { accessFor } = await import('@/routes/commerce/inventory/-shared/inventory-test-fixtures');
    return { useCommerceAccess: () => accessFor(['COMMERCE_ACCOUNTANT']) };
});
vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-1' }));
vi.mock('../../-shared/reports-api', () => ({
    REPORT_PAGE_SIZE: 100,
    fetchReport: vi.fn(),
    fetchAudit: vi.fn(),
    fetchApprovals: vi.fn(),
    fetchAuditKinds: vi.fn(async () => ['POS_VOID', 'VARIANT_PRICE_CHANGED']),
    downloadAudit: vi.fn(),
    fetchReportPlaces: vi.fn(async () => ({ places: [], allPlaces: null })),
    fetchAuditActors: vi.fn(async () => []),
}));

import * as api from '../../-shared/reports-api';
import { renderWithQuery } from '../../-components/report-test-kit';
import type { AuditSearch } from '../../-shared/report-search';
import { AuditLog, auditFilters } from './AuditLogPage';

const fetchAudit = vi.mocked(api.fetchAudit);
const fetchApprovals = vi.mocked(api.fetchApprovals);
const downloadAudit = vi.mocked(api.downloadAudit);
const fetchAuditActors = vi.mocked(api.fetchAuditActors);
const fetchReportPlaces = vi.mocked(api.fetchReportPlaces);

const priceChange = {
    id: 'a-1',
    at: '2026-11-19T05:00:00Z',
    actorUserId: 'u-1',
    actorName: 'Test Manager',
    locationId: 'L1',
    locationName: 'Test Store',
    kind: 'VARIANT_PRICE_CHANGED',
    referenceType: 'VARIANT',
    referenceId: 'v-1',
    referenceLabel: 'BOTTLE-1',
    changes: [{ key: 'price', old: '120.00', new: '130.00' }],
    reason: 'New price list',
};

const renderLog = (search: AuditSearch, onSearch = vi.fn()) => {
    renderWithQuery(<AuditLog search={search} onSearch={onSearch} />);
    return onSearch;
};

describe('AuditLog', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        fetchAudit.mockResolvedValue({ rows: [priceChange], nextCursor: null });
        fetchApprovals.mockResolvedValue({
            rows: [
                {
                    id: 'p-1',
                    at: '2026-11-19T06:00:00Z',
                    action: 'POS_VOID',
                    referenceLabel: 'INV/2627-00003',
                    requestedBy: 'Test Cashier',
                    approvedBy: 'Test Manager',
                    amount: '250.00',
                    reason: 'Wrong item',
                },
            ],
            nextCursor: null,
        });
    });

    it('the filters of the address go to the query', async () => {
        renderLog({ from: '2026-11-01', to: '2026-11-19', actor: 'u-1', location: 'L1', kind: 'POS_VOID', reference: 'INV/2627-00003' });
        await screen.findByTestId('audit-changes-table');
        expect(fetchAudit).toHaveBeenCalledWith(
            {
                from: '2026-11-01',
                to: '2026-11-19',
                actorUserId: 'u-1',
                locationId: 'L1',
                kind: 'POS_VOID',
                reference: 'INV/2627-00003',
            },
            null
        );
        expect(fetchApprovals).not.toHaveBeenCalled();
    });

    it('a typed document number and a date go to the address', async () => {
        const onSearch = renderLog({});
        const box = screen.getByTestId('audit-reference');
        fireEvent.change(box, { target: { value: ' INV/2627-00003 ' } });
        fireEvent.keyDown(box, { key: 'Enter' });
        expect(onSearch).toHaveBeenCalledWith({ reference: 'INV/2627-00003' });
        fireEvent.change(screen.getByTestId('audit-from'), { target: { value: '2026-11-05' } });
        expect(onSearch).toHaveBeenCalledWith({ from: '2026-11-05' });
    });

    it('each change reads old → new, with who, the document and the reason', async () => {
        renderLog({});
        const table = await screen.findByTestId('audit-changes-table');
        const changes = screen.getByTestId('audit-changes');
        expect(changes.textContent).toBe('reports.audit.changeKeys.price120.00130.00');
        expect(changes.querySelector('[aria-label="reports.audit.becomes"]')).not.toBeNull();
        expect(table.textContent).toContain('Test Manager');
        expect(table.textContent).toContain('BOTTLE-1');
        expect(table.textContent).toContain('reports.audit.kinds.VARIANT_PRICE_CHANGED');
        expect(table.textContent).toContain('New price list');
    });

    it('the approvals tab lists PIN approvals with who asked and who approved', async () => {
        const onSearch = renderLog({ tab: 'approvals', reference: 'INV/2627-00003' });
        const table = await screen.findByTestId('audit-approvals-table');
        expect(fetchApprovals).toHaveBeenCalledWith(expect.objectContaining({ reference: 'INV/2627-00003' }), null);
        expect(table.textContent).toContain('reports.audit.actions.POS_VOID');
        expect(table.textContent).toContain('Test Cashier');
        expect(table.textContent).toContain('Test Manager');
        expect(table.textContent).toContain('₹250.00');
        expect(fetchAudit).not.toHaveBeenCalled();
        fireEvent.click(screen.getByText('reports.audit.tabs.changes'));
        expect(onSearch).toHaveBeenCalledWith({ tab: 'changes' });
    });

    it('the CSV download sends the same filters', async () => {
        downloadAudit.mockResolvedValue('audit.csv');
        renderLog({ kind: 'POS_VOID' });
        fireEvent.click(screen.getByTestId('report-download-csv'));
        await waitFor(() => expect(downloadAudit).toHaveBeenCalledTimes(1));
        expect(downloadAudit.mock.calls[0]?.[0]).toMatchObject({ kind: 'POS_VOID' });
    });

    it('M9: a kind or key the screen has not named reads as words, not as a code', async () => {
        fetchAudit.mockResolvedValue({
            rows: [{ ...priceChange, kind: 'SOMETHING_NEW_HAPPENED', changes: [{ key: 'courier_slot', old: 'a', new: 'b' }] }],
            nextCursor: null,
        });
        renderLog({});
        const table = await screen.findByTestId('audit-changes-table');
        expect(table.textContent).toContain('Something new happened');
        expect(table.textContent).not.toContain('SOMETHING_NEW_HAPPENED');
        expect(screen.getByTestId('audit-changes').textContent).toContain('Courier slot');
    });

    it('M9: kinds the server records are named (transfers, returns, tracking)', async () => {
        fetchAudit.mockResolvedValue({ rows: [{ ...priceChange, kind: 'TRACKING_EDITED' }], nextCursor: null });
        renderLog({});
        const table = await screen.findByTestId('audit-changes-table');
        expect(table.textContent).toContain('reports.audit.kinds.TRACKING_EDITED');
    });

    it('R9: "who" and the places come from the reports endpoints, not the staff or stock lists', async () => {
        fetchAuditActors.mockResolvedValue([{ userId: 'u-9', name: 'Test Accountant' }]);
        fetchReportPlaces.mockResolvedValue({ places: [{ id: 'L1', name: 'Test Store', code: null, gstin: null }], allPlaces: false });
        renderLog({});
        await screen.findByTestId('audit-changes-table');
        await waitFor(() => expect(fetchAuditActors).toHaveBeenCalledTimes(1));
        expect(fetchReportPlaces).toHaveBeenCalled();
    });

    it('defaults to this month', () => {
        expect(auditFilters({}, '2026-11-19')).toMatchObject({ from: '2026-11-01', to: '2026-11-19' });
    });
});
