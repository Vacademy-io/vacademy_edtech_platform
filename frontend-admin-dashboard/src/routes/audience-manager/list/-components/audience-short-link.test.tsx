import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import campaignLinkStrings from '../../../../../public/locales/en/audienceManagerCampaignLink.json';
import shareQrStrings from '../../../../../public/locales/en/audienceManagerShareQrDialog.json';

/**
 * Resolve a dotted i18n key against the real `en` catalogue. Using the shipped
 * JSON rather than a stub means a key these components ask for but nobody added
 * fails this test instead of shipping as literal `shortLink.shorten` in the UI.
 */
const CATALOGUES: Record<string, unknown> = {
    audienceManagerCampaignLink: campaignLinkStrings,
    audienceManagerShareQrDialog: shareQrStrings,
};

const translate = (namespace: string, key: string) => {
    const value = key
        .split('.')
        .reduce<unknown>(
            (node, part) => (node as Record<string, unknown> | undefined)?.[part],
            CATALOGUES[namespace]
        );
    if (typeof value !== 'string') {
        throw new Error(`Missing translation: ${namespace}:${key}`);
    }
    return value;
};

vi.mock('react-i18next', () => ({
    useTranslation: (namespace: string) => ({
        t: (key: string) => translate(namespace, key),
    }),
}));

const postMock = vi.fn();
vi.mock('axios', () => ({
    default: { post: (...args: unknown[]) => postMock(...args) },
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({
    toast: {
        success: (...a: unknown[]) => toastSuccess(...a),
        error: (...a: unknown[]) => toastError(...a),
    },
}));

vi.mock('@/stores/students/students-list/useInstituteDetailsStore', () => ({
    useInstituteDetailsStore: () => ({
        instituteDetails: { id: 'inst-1', learner_portal_base_url: 'https://learn.example.com' },
    }),
}));

vi.mock('@/lib/auth/instituteUtils', () => ({
    getCurrentInstituteId: () => 'inst-1',
}));

// The institute-level "Short links" switch. Mocked rather than driven through
// the settings service so these tests can flip it without also pulling the whole
// settings-page module graph in; the switch's own default-ON parsing is covered
// in src/services/__tests__/audience-form-settings/test.ts.
let shortLinksEnabled = true;
let shortLinksResolved = true;
vi.mock('@/hooks/use-audience-short-links-enabled', () => ({
    // isResolved:true = the institute's preference is known, which is what gates
    // the WRITE. Tests that need the unresolved state set it explicitly.
    useAudienceShortLinksEnabled: () => ({
        enabled: shortLinksEnabled,
        isResolved: shortLinksResolved,
    }),
}));

// Rendering a real QR needs a canvas 2d context happy-dom does not provide, and
// what these tests care about is *which URL* ends up encoded — so stub the
// symbols down to their value. Both forward their ref: the dialog holds one on
// each to drive the SVG/PNG downloads, and a plain function component would warn
// and drown the run in noise.
vi.mock('qrcode.react', async () => {
    const { forwardRef } = await import('react');
    return {
        QRCodeSVG: forwardRef<SVGSVGElement, { value: string }>(({ value }, ref) => (
            <svg ref={ref} data-testid="qr-preview" data-value={value} />
        )),
        QRCodeCanvas: forwardRef<HTMLCanvasElement, { value: string }>(({ value }, ref) => (
            <canvas ref={ref} data-testid="qr-export" data-value={value} />
        )),
    };
});

import CampaignLink from './create-campaign-dialog/CampaignLink';
import { ShareQrDialog } from './share-qr-dialog/ShareQrDialog';
import type { CampaignItem } from '../-services/get-campaigns-list';

const LONG_URL = 'https://learn.example.com/audience-response?instituteId=inst-1&audienceId=camp-1';
const SHORT_URL = 'https://u.vacademy.io/s/open-day';

const writeText = vi.fn(async () => undefined);

const campaign = {
    id: 'camp-1',
    campaign_name: 'Open Day',
} as unknown as CampaignItem;

const withQuery = (ui: React.ReactElement) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

describe('audience campaign short links', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        shortLinksEnabled = true;
        shortLinksResolved = true;
        postMock.mockResolvedValue({ data: { shortName: 'open-day', absoluteUrl: SHORT_URL } });
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText },
        });
    });

    it('does not shorten until asked, so a list of cards mints no links on render', () => {
        withQuery(<CampaignLink campaignId="camp-1" enableShortLink />);

        expect(screen.getByRole('link')).toHaveAttribute('href', LONG_URL);
        expect(postMock).not.toHaveBeenCalled();
    });

    it('swaps in the short link on demand and copies that one', async () => {
        withQuery(<CampaignLink campaignId="camp-1" enableShortLink />);

        fireEvent.click(screen.getByRole('button', { name: 'Short' }));

        await waitFor(() => expect(screen.getByRole('link')).toHaveAttribute('href', SHORT_URL));
        expect(postMock).toHaveBeenCalledTimes(1);
        expect(postMock.mock.calls[0]?.[1]).toMatchObject({
            source: 'AUDIENCE_CAMPAIGN',
            sourceId: 'camp-1',
            destinationUrl: LONG_URL,
            instituteId: 'inst-1',
        });
        // The code must be 6 lowercase alphanumerics — NOT the campaign name.
        // A name-derived slug is what produced prod's /s/dont-believe-everything-
        // you-think, a "short" link longer than the URL it replaces.
        expect(postMock.mock.calls[0]?.[1]?.shortCode).toMatch(/^[a-z0-9]{6}$/);

        fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
        await waitFor(() => expect(writeText).toHaveBeenCalledWith(SHORT_URL));
    });

    it('falls back to the full address when the shortener is down', async () => {
        postMock.mockRejectedValue(new Error('boom'));
        withQuery(<CampaignLink campaignId="camp-1" enableShortLink />);

        fireEvent.click(screen.getByRole('button', { name: 'Short' }));

        await waitFor(() => expect(toastError).toHaveBeenCalled());
        expect(screen.getByRole('link')).toHaveAttribute('href', LONG_URL);
        expect(screen.getByRole('button', { name: 'Short' })).toBeInTheDocument();
    });

    it('can retry after a failure instead of replaying the stale error', async () => {
        postMock.mockRejectedValueOnce(new Error('boom'));
        withQuery(<CampaignLink campaignId="camp-1" enableShortLink />);

        fireEvent.click(screen.getByRole('button', { name: 'Short' }));
        await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));

        // Second click must issue a fresh request, not short-circuit on the
        // cached error state left behind by the first one.
        fireEvent.click(screen.getByRole('button', { name: 'Short' }));

        await waitFor(() => expect(screen.getByRole('link')).toHaveAttribute('href', SHORT_URL));
        expect(postMock).toHaveBeenCalledTimes(2);
        expect(toastError).toHaveBeenCalledTimes(1);
    });

    it('offers no Short control when the feature is not enabled', () => {
        withQuery(<CampaignLink campaignId="camp-1" />);

        expect(screen.queryByRole('button', { name: 'Short' })).not.toBeInTheDocument();
    });

    it('keeps a printed QR on the long URL until the admin opts in', async () => {
        withQuery(<ShareQrDialog isOpen onClose={vi.fn()} campaign={campaign} />);

        expect(await screen.findByDisplayValue(SHORT_URL)).toBeInTheDocument();
        expect(screen.getByTestId('qr-preview')).toHaveAttribute('data-value', LONG_URL);
        expect(screen.getByTestId('qr-export')).toHaveAttribute('data-value', LONG_URL);
        expect(screen.getByText('This QR code never expires')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('switch'));

        await waitFor(() =>
            expect(screen.getByTestId('qr-preview')).toHaveAttribute('data-value', SHORT_URL)
        );
        // The download and the preview must never disagree about what was encoded.
        expect(screen.getByTestId('qr-export')).toHaveAttribute('data-value', SHORT_URL);
        // ...and the reassurance has to follow the code it describes.
        expect(screen.queryByText('This QR code never expires')).not.toBeInTheDocument();
        expect(screen.getByText('This QR code depends on the short link')).toBeInTheDocument();
    });

    it('toggles exactly once when the switch is clicked by its label text', async () => {
        withQuery(<ShareQrDialog isOpen onClose={vi.fn()} campaign={campaign} />);

        // A <label> wrapping a Radix switch forwards the click to the button. If
        // it ever double-fired, the QR would flip to the short link and straight
        // back, and this assertion would catch it.
        fireEvent.click(await screen.findByText(shareQrStrings.shortLink.useInQr));

        await waitFor(() =>
            expect(screen.getByTestId('qr-preview')).toHaveAttribute('data-value', SHORT_URL)
        );
        expect(screen.getByRole('switch')).toBeChecked();
    });

    it('still attempts the request when the browser reports itself offline', async () => {
        // React Query's default networkMode 'online' would PAUSE the query here:
        // no fetch, no error, no data — and the waiting effects would hang on a
        // dead click with no toast, forever. `networkMode: 'always'` is what
        // turns that into an ordinary failure the UI already knows how to show.
        onlineManager.setOnline(false);
        try {
            postMock.mockRejectedValue(new Error('offline'));
            withQuery(<CampaignLink campaignId="camp-1" enableShortLink />);

            fireEvent.click(screen.getByRole('button', { name: 'Short' }));

            await waitFor(() => expect(toastError).toHaveBeenCalled());
            expect(postMock).toHaveBeenCalledTimes(1);
            expect(screen.getByRole('link')).toHaveAttribute('href', LONG_URL);
        } finally {
            onlineManager.setOnline(true);
        }
    });

    it('shortens a preset link when a campaign id comes with it', async () => {
        // The "share link ready" panel in the create/edit dialog hands CampaignLink
        // an already-built presetLink. It now also passes the campaign id, which is
        // what makes shortening possible there — and the short link must point at
        // the preset URL, not at a URL rebuilt from the id.
        const PRESET =
            'https://learn.example.com/audience-response?instituteId=inst-1&audienceId=camp-1';
        withQuery(<CampaignLink presetLink={PRESET} campaignId="camp-1" enableShortLink />);

        fireEvent.click(screen.getByRole('button', { name: 'Short' }));

        await waitFor(() => expect(screen.getByRole('link')).toHaveAttribute('href', SHORT_URL));
        expect(postMock.mock.calls[0]?.[1]).toMatchObject({
            sourceId: 'camp-1',
            destinationUrl: PRESET,
        });
    });

    it('asks for the same 6-char code every time, so the query key never churns', async () => {
        const first = withQuery(<CampaignLink campaignId="camp-9" enableShortLink />);
        fireEvent.click(screen.getByRole('button', { name: 'Short' }));
        await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
        const codeA = postMock.mock.calls[0]?.[1]?.shortCode;
        first.unmount();

        withQuery(<CampaignLink campaignId="camp-9" enableShortLink />);
        fireEvent.click(screen.getByRole('button', { name: 'Short' }));
        await waitFor(() => expect(postMock).toHaveBeenCalledTimes(2));

        expect(postMock.mock.calls[1]?.[1]?.shortCode).toBe(codeA);
        expect(codeA).toMatch(/^[a-z0-9]{6}$/);
    });

    it('offers no Short control for a preset link with no campaign behind it', () => {
        withQuery(<CampaignLink presetLink="https://example.com/x" enableShortLink />);

        expect(screen.queryByRole('button', { name: 'Short' })).not.toBeInTheDocument();
        expect(postMock).not.toHaveBeenCalled();
    });

    it('writes nothing until the institute preference is actually known', async () => {
        // The switch reads optimistically ON while its request is in flight, so the
        // controls appear immediately. Showing a control speculatively is free;
        // shortening is not — it INSERTs a row. An institute that has explicitly
        // opted out must not get one minted just because an admin clicked fast.
        shortLinksResolved = false;
        withQuery(<CampaignLink campaignId="camp-1" enableShortLink />);

        // Still offered — that is the point of the optimistic read.
        const toggle = screen.getByRole('button', { name: 'Short' });
        fireEvent.click(toggle);

        await waitFor(() => expect(screen.getByRole('link')).toHaveAttribute('href', LONG_URL));
        expect(postMock).not.toHaveBeenCalled();
    });

    it('does not mint a link on dialog open before the preference resolves', async () => {
        shortLinksResolved = false;
        withQuery(<ShareQrDialog isOpen onClose={vi.fn()} campaign={campaign} />);

        expect(await screen.findByDisplayValue(LONG_URL)).toBeInTheDocument();
        expect(postMock).not.toHaveBeenCalled();
        expect(screen.getByTestId('qr-preview')).toHaveAttribute('data-value', LONG_URL);
    });

    it('hides the Short control when the institute switched short links off', () => {
        shortLinksEnabled = false;
        withQuery(<CampaignLink campaignId="camp-1" enableShortLink />);

        expect(screen.queryByRole('button', { name: 'Short' })).not.toBeInTheDocument();
        expect(screen.getByRole('link')).toHaveAttribute('href', LONG_URL);
        expect(postMock).not.toHaveBeenCalled();
    });

    it('drops back to the full address if the switch resolves OFF after toggling', async () => {
        // The switch reads ON while its request is in flight, so an admin can
        // reach the short URL a moment before it resolves OFF. The card must not
        // be left displaying — and copying — a link the institute disabled, with
        // the toggle gone and no way back.
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        // A FRESH element each time: React bails out of re-rendering a child
        // whose element reference is identical, so reusing one would make the
        // rerender below a no-op and the test vacuous.
        const tree = () => (
            <QueryClientProvider client={client}>
                <CampaignLink campaignId="camp-1" enableShortLink />
            </QueryClientProvider>
        );
        const { rerender } = render(tree());

        fireEvent.click(screen.getByRole('button', { name: 'Short' }));
        await waitFor(() => expect(screen.getByRole('link')).toHaveAttribute('href', SHORT_URL));

        // Same client, so the fetched short URL is still cached and `preferShort`
        // is still true — only the institute switch flips. That is exactly the
        // state the bug lived in.
        shortLinksEnabled = false;
        rerender(tree());

        expect(screen.getByRole('link')).toHaveAttribute('href', LONG_URL);
        expect(screen.queryByRole('button', { name: 'Full' })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
        await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(LONG_URL));
    });

    it('mints nothing and shows no short link in the dialog when the switch is off', async () => {
        shortLinksEnabled = false;
        withQuery(<ShareQrDialog isOpen onClose={vi.fn()} campaign={campaign} />);

        expect(await screen.findByDisplayValue(LONG_URL)).toBeInTheDocument();
        expect(screen.queryByDisplayValue(SHORT_URL)).not.toBeInTheDocument();
        expect(screen.queryByText(shareQrStrings.shortLink.label)).not.toBeInTheDocument();
        expect(screen.queryByRole('switch')).not.toBeInTheDocument();
        // The QR must still encode the real form URL, and the switch being off
        // must not cost a single short_links row.
        expect(screen.getByTestId('qr-preview')).toHaveAttribute('data-value', LONG_URL);
        expect(postMock).not.toHaveBeenCalled();
    });

    it('forgets the QR toggle between opens, since the kebab menu never unmounts it', async () => {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const dialog = (open: boolean) => (
            <QueryClientProvider client={client}>
                <ShareQrDialog isOpen={open} onClose={vi.fn()} campaign={campaign} />
            </QueryClientProvider>
        );
        const { rerender } = render(dialog(true));

        expect(await screen.findByDisplayValue(SHORT_URL)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('switch'));
        await waitFor(() =>
            expect(screen.getByTestId('qr-preview')).toHaveAttribute('data-value', SHORT_URL)
        );

        // Close and reopen WITHOUT unmounting — exactly what the card's ⋮ menu
        // does. A printed run must never inherit a previous session's choice to
        // route the code through a revocable redirect.
        rerender(dialog(false));
        rerender(dialog(true));

        expect(await screen.findByDisplayValue(SHORT_URL)).toBeInTheDocument();
        expect(screen.getByRole('switch')).not.toBeChecked();
        expect(screen.getByTestId('qr-preview')).toHaveAttribute('data-value', LONG_URL);
        expect(screen.getByText('This QR code never expires')).toBeInTheDocument();
    });

    it('still shows a usable form link when the shortener fails in the share dialog', async () => {
        postMock.mockRejectedValue(new Error('boom'));
        withQuery(<ShareQrDialog isOpen onClose={vi.fn()} campaign={campaign} />);

        expect(await screen.findByDisplayValue(LONG_URL)).toBeInTheDocument();
        await waitFor(() =>
            expect(screen.getByText(shareQrStrings.shortLink.unavailable)).toBeInTheDocument()
        );
        expect(screen.getByTestId('qr-preview')).toHaveAttribute('data-value', LONG_URL);
        expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    });
});
