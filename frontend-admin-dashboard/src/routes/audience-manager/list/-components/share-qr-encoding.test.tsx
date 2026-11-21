import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import shareQrStrings from '../../../../../public/locales/en/audienceManagerShareQrDialog.json';

/**
 * Companion to audience-short-link.test.tsx, which stubs `qrcode.react` down to
 * a `data-value` attribute. That stub proves the right URL is *handed to* the
 * symbol — it cannot prove the rendered symbol actually changes, so on its own
 * it would still pass if the QR silently encoded something else.
 *
 * This file renders the REAL QRCodeSVG and compares the serialised markup, which
 * is literally what "Download SVG" and the print sheet ship to the user. Only
 * QRCodeCanvas is stubbed: it needs a 2d context happy-dom does not provide.
 */
const CATALOGUES: Record<string, unknown> = { audienceManagerShareQrDialog: shareQrStrings };
const translate = (namespace: string, key: string) => {
    const value = key
        .split('.')
        .reduce<unknown>(
            (node, part) => (node as Record<string, unknown> | undefined)?.[part],
            CATALOGUES[namespace]
        );
    if (typeof value !== 'string') throw new Error(`Missing translation: ${namespace}:${key}`);
    return value;
};

vi.mock('react-i18next', () => ({
    useTranslation: (namespace: string) => ({ t: (key: string) => translate(namespace, key) }),
}));

const postMock = vi.fn();
vi.mock('axios', () => ({ default: { post: (...args: unknown[]) => postMock(...args) } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/stores/students/students-list/useInstituteDetailsStore', () => ({
    useInstituteDetailsStore: () => ({
        instituteDetails: { id: 'inst-1', learner_portal_base_url: 'https://learn.example.com' },
    }),
}));
vi.mock('@/lib/auth/instituteUtils', () => ({ getCurrentInstituteId: () => 'inst-1' }));
vi.mock('@/hooks/use-audience-short-links-enabled', () => ({
    useAudienceShortLinksEnabled: () => ({ enabled: true, isResolved: true }),
}));

// Real QRCodeSVG, stubbed QRCodeCanvas.
vi.mock('qrcode.react', async () => {
    const actual = await vi.importActual<typeof import('qrcode.react')>('qrcode.react');
    const { forwardRef } = await import('react');
    return {
        ...actual,
        QRCodeCanvas: forwardRef<HTMLCanvasElement, { value: string }>(({ value }, ref) => (
            <canvas ref={ref} data-testid="qr-export" data-value={value} />
        )),
    };
});

import { ShareQrDialog } from './share-qr-dialog/ShareQrDialog';
import type { CampaignItem } from '../-services/get-campaigns-list';

const SHORT_URL = 'https://u.vacademy.io/s/open-day';
const campaign = { id: 'camp-1', campaign_name: 'Open Day' } as unknown as CampaignItem;

const serialisedQr = () => {
    const svg = document.querySelector('svg[role="img"], svg') as SVGSVGElement | null;
    if (!svg) throw new Error('no QR svg rendered');
    return new XMLSerializer().serializeToString(svg);
};

describe('what the QR actually encodes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        postMock.mockResolvedValue({ data: { shortName: 'open-day', absoluteUrl: SHORT_URL } });
    });

    it('redraws the symbol when the short-link toggle flips', async () => {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        render(
            <QueryClientProvider client={client}>
                <ShareQrDialog isOpen onClose={vi.fn()} campaign={campaign} />
            </QueryClientProvider>
        );

        expect(await screen.findByDisplayValue(SHORT_URL)).toBeInTheDocument();
        const longMarkup = serialisedQr();
        // A real QR of a real URL, not an empty placeholder.
        expect(longMarkup).toContain('<path');
        expect(longMarkup.length).toBeGreaterThan(500);

        fireEvent.click(screen.getByRole('switch'));

        await waitFor(() => expect(serialisedQr()).not.toBe(longMarkup));
        const shortMarkup = serialisedQr();

        // The short URL is far fewer characters, so its symbol is a lower QR
        // version — strictly smaller viewBox. If someone swapped qrValue back to
        // formUrl, the markup would be identical and this would fail.
        const version = (markup: string) => Number(/viewBox="0 0 (\d+)/.exec(markup)?.[1] ?? 0);
        expect(version(shortMarkup)).toBeGreaterThan(0);
        expect(version(shortMarkup)).toBeLessThan(version(longMarkup));

        // And the export canvas the PNG is rasterised from must agree with it.
        expect(screen.getByTestId('qr-export')).toHaveAttribute('data-value', SHORT_URL);
    });
});
