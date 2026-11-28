import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import menuStrings from '../../../../../public/locales/en/audienceManagerAudienceCampaignCardMenuOptions.json';

/**
 * The kebab "Copy Short Link" path, which nothing else covers.
 *
 * It is the trickiest of the three surfaces: the dropdown UNMOUNTS on select, so
 * the work continues in an effect on the still-mounted parent and the only
 * feedback the admin ever gets is a toast. Every state transition below has a
 * way of going silently wrong.
 */
const CATALOGUES: Record<string, unknown> = {
    audienceManagerAudienceCampaignCardMenuOptions: menuStrings,
};
const translate = (namespace: string, key: string) => {
    const catalogue = CATALOGUES[namespace];
    // Only the namespace under test is checked strictly. Sibling components pull
    // in catalogues of their own, and failing on those would make this suite
    // break whenever an unrelated dialog adds a string.
    if (!catalogue) return key;
    const value = key
        .split('.')
        .reduce<unknown>(
            (node, part) => (node as Record<string, unknown> | undefined)?.[part],
            catalogue
        );
    if (typeof value !== 'string') throw new Error(`Missing translation: ${namespace}:${key}`);
    return value;
};
vi.mock('react-i18next', () => ({
    useTranslation: (namespace: string) => ({ t: (key: string) => translate(namespace, key) }),
}));

const postMock = vi.fn();
// `create` matters as much as `post`: this component's import graph reaches
// `@/lib/auth/axiosInstance`, which calls `axios.create()` at MODULE scope. A
// mock without it throws "default.create is not a function" before a single test
// runs — the whole file dies at import, which reads as a broken suite rather
// than a broken mock.
vi.mock('axios', () => {
    const instance = Object.assign(vi.fn(), {
        get: vi.fn(),
        post: vi.fn(),
        interceptors: {
            request: { use: vi.fn(), eject: vi.fn() },
            response: { use: vi.fn(), eject: vi.fn() },
        },
    });
    return {
        default: {
            post: (...args: unknown[]) => postMock(...args),
            create: () => instance,
        },
    };
});

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({
    toast: {
        success: (...a: unknown[]) => toastSuccess(...a),
        error: (...a: unknown[]) => toastError(...a),
        info: vi.fn(),
    },
}));

vi.mock('@/stores/students/students-list/useInstituteDetailsStore', () => ({
    useInstituteDetailsStore: () => ({
        instituteDetails: { id: 'inst-1', learner_portal_base_url: 'https://learn.example.com' },
    }),
}));
vi.mock('@/lib/auth/instituteUtils', () => ({ getCurrentInstituteId: () => 'inst-1' }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@/services/workflow-service', () => ({
    getActiveWorkflowsQuery: () => ({ queryKey: ['workflows'], queryFn: async () => [] }),
}));

let shortLinksEnabled = true;
vi.mock('@/hooks/use-audience-short-links-enabled', () => ({
    useAudienceShortLinksEnabled: () => ({ enabled: shortLinksEnabled, isResolved: true }),
}));

// The sibling dialogs are irrelevant here and drag in large trees. Paths are
// written as @/ aliases on purpose: a vi.mock specifier is resolved relative to
// THIS file, so the component's own '../foo' would silently miss and let the real
// dialog load.
// vi.mock is HOISTED above every const, so these specifiers must be inline
// literals — a shared `const B` prefix throws "Cannot access 'B' before
// initialization". They are @/ aliases rather than the component's own '../foo'
// because a vi.mock path resolves relative to THIS file, so a relative copy
// would silently miss and let the real dialog load.
vi.mock(
    '@/routes/audience-manager/list/-components/api-integration-dialog/ApiIntegrationDialog',
    () => ({
        ApiIntegrationDialog: () => null,
    })
);
vi.mock('@/routes/audience-manager/list/-components/embed-code-dialog/EmbedCodeDialog', () => ({
    EmbedCodeDialog: () => null,
}));
vi.mock('@/routes/audience-manager/list/-components/share-qr-dialog/ShareQrDialog', () => ({
    ShareQrDialog: () => null,
}));
vi.mock('@/routes/audience-manager/list/-components/campaign-users/LeadBulkImportDialog', () => ({
    LeadBulkImportDialog: () => null,
}));
vi.mock('@/routes/audience-manager/list/-components/campaign-users/SendMessageDialog', () => ({
    SendMessageDialog: () => null,
}));
vi.mock(
    '@/routes/audience-manager/list/-components/audience-invite/linked-workflows-dialog',
    () => ({
        LinkedWorkflowsDialog: () => null,
    })
);
vi.mock(
    '@/routes/audience-manager/list/-components/audience-invite/configure-audience-workflow-dialog',
    () => ({
        ConfigureAudienceWorkflowDialog: () => null,
    })
);
vi.mock(
    '@/routes/audience-manager/list/-components/booking-settings/BookingSettingsDialog',
    () => ({
        BookingSettingsDialog: () => null,
    })
);

import { AudienceCampaignCardMenuOptions } from './audience-invite/audience-campaign-card-menu-options';
import type { CampaignItem } from '../-services/get-campaigns-list';

const SHORT_URL = 'https://u.vacademy.io/s/open-day';
const writeText = vi.fn(async () => undefined);
const campaign = { id: 'camp-1', campaign_name: 'Open Day' } as unknown as CampaignItem;

const openMenu = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <QueryClientProvider client={client}>
            <AudienceCampaignCardMenuOptions campaign={campaign} />
        </QueryClientProvider>
    );
    // Radix's DropdownMenuTrigger opens on POINTERDOWN, not click — a plain
    // fireEvent.click leaves the menu shut and every query below fails with a
    // confusing "unable to find text".
    fireEvent.pointerDown(screen.getByRole('button', { name: menuStrings.menu.openMenu }), {
        button: 0,
        ctrlKey: false,
    });
};

describe('Copy Short Link (kebab menu)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        shortLinksEnabled = true;
        postMock.mockResolvedValue({ data: { shortName: 'open-day', absoluteUrl: SHORT_URL } });
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    });

    it('shortens on demand and puts the short URL on the clipboard', async () => {
        openMenu();
        expect(postMock).not.toHaveBeenCalled();

        fireEvent.click(await screen.findByText(menuStrings.menu.copyShortLink));

        await waitFor(() => expect(writeText).toHaveBeenCalledWith(SHORT_URL));
        expect(postMock).toHaveBeenCalledTimes(1);
        expect(postMock.mock.calls[0]?.[1]).toMatchObject({
            source: 'AUDIENCE_CAMPAIGN',
            sourceId: 'camp-1',
            destinationUrl:
                'https://learn.example.com/audience-response?instituteId=inst-1&audienceId=camp-1',
        });
        expect(toastSuccess).toHaveBeenCalledWith(menuStrings.toast.shortLinkCopied);
        expect(toastError).not.toHaveBeenCalled();
    });

    it('says so instead of failing silently when the shortener is down', async () => {
        postMock.mockRejectedValue(new Error('boom'));
        openMenu();

        fireEvent.click(await screen.findByText(menuStrings.menu.copyShortLink));

        // The dropdown is gone by now, so a toast is the ONLY feedback there is.
        await waitFor(() =>
            expect(toastError).toHaveBeenCalledWith(menuStrings.toast.shortLinkFailed)
        );
        expect(writeText).not.toHaveBeenCalled();
    });

    it('reports a clipboard rejection rather than claiming success', async () => {
        writeText.mockRejectedValueOnce(new Error('denied'));
        openMenu();

        fireEvent.click(await screen.findByText(menuStrings.menu.copyShortLink));

        await waitFor(() =>
            expect(toastError).toHaveBeenCalledWith(menuStrings.toast.shortLinkCopyFailed)
        );
        expect(toastSuccess).not.toHaveBeenCalled();
    });

    it('hides the item entirely when the institute switched short links off', async () => {
        shortLinksEnabled = false;
        openMenu();

        expect(await screen.findByText(menuStrings.menu.shareQrCode)).toBeInTheDocument();
        expect(screen.queryByText(menuStrings.menu.copyShortLink)).not.toBeInTheDocument();
        expect(postMock).not.toHaveBeenCalled();
    });
});
