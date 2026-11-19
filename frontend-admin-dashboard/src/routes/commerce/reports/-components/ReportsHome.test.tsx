/**
 * M6 on screen: the reports home leaves the GST cards out for a reader the
 * places answer (R9) says is limited to some places, and says why.
 */
import { screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', async () => {
    const kit = await import('./report-test-kit');
    return { useTranslation: () => ({ t: kit.tWithValues, i18n: { language: 'en' } }) };
});
vi.mock('@tanstack/react-router', () => ({
    Link: ({ children, ...rest }: { children: ReactNode; 'data-testid'?: string }) => (
        <a href="/" data-testid={rest['data-testid']}>
            {children}
        </a>
    ),
}));
vi.mock('@/lib/commerce/use-commerce-access', async () => {
    const { accessFor, MANAGER } = await import('@/routes/commerce/inventory/-shared/inventory-test-fixtures');
    return { useCommerceAccess: () => accessFor(MANAGER) };
});
vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-1' }));
vi.mock('../-shared/reports-api', () => ({
    REPORT_PAGE_SIZE: 100,
    fetchReportPlaces: vi.fn(),
}));

import * as api from '../-shared/reports-api';
import { renderWithQuery } from './report-test-kit';
import { ReportsHome } from './ReportsHome';

const fetchReportPlaces = vi.mocked(api.fetchReportPlaces);

describe('ReportsHome', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('a manager at some places: no GST cards, a line says why', async () => {
        fetchReportPlaces.mockResolvedValue({ places: [{ id: 'L1', name: 'Test Store', code: null, gstin: null }], allPlaces: false });
        renderWithQuery(<ReportsHome />);
        expect(await screen.findByTestId('reports-gst-needs-all-places')).toBeTruthy();
        expect(screen.queryByTestId('report-card-gstr1')).toBeNull();
        expect(screen.queryByTestId('report-card-salesRegister')).toBeNull();
        expect(screen.getByTestId('report-card-dayBook')).toBeTruthy();
    });

    it('a manager at every place keeps the GST cards', async () => {
        fetchReportPlaces.mockResolvedValue({ places: [], allPlaces: true });
        renderWithQuery(<ReportsHome />);
        expect(await screen.findByTestId('report-card-gstr1')).toBeTruthy();
        expect(screen.queryByTestId('reports-gst-needs-all-places')).toBeNull();
    });

    it('gst_reports false hides the GST cards even at every place, without the "every place" line', async () => {
        fetchReportPlaces.mockResolvedValue({ places: [], allPlaces: true, gstReports: false });
        renderWithQuery(<ReportsHome />);
        expect(await screen.findByTestId('report-card-dayBook')).toBeTruthy();
        await waitFor(() => expect(screen.queryByTestId('report-card-gstr1')).toBeNull());
        expect(screen.queryByTestId('report-card-salesRegister')).toBeNull();
        expect(screen.queryByTestId('reports-gst-needs-all-places')).toBeNull();
    });

    it('gst_reports true keeps the GST cards even when all_places is false', async () => {
        fetchReportPlaces.mockResolvedValue({ places: [], allPlaces: false, gstReports: true });
        renderWithQuery(<ReportsHome />);
        await waitFor(() => expect(fetchReportPlaces).toHaveBeenCalled());
        // Let the answer land (all_places false alone would take the cards away).
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(screen.getByTestId('report-card-gstr1')).toBeTruthy();
        expect(screen.queryByTestId('reports-gst-needs-all-places')).toBeNull();
    });
});
