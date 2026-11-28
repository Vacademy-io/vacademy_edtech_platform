import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/services/gtm-settings', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/services/gtm-settings')>();
    return {
        ...actual,
        fetchGtmSettings: vi.fn(async () => ({
            ...actual.DEFAULT_GTM_SETTINGS,
            utm: { ...actual.DEFAULT_UTM_SETTINGS, enabled: true },
        })),
    };
});

import { UtmBuilderDialog } from '../../utm-builder-dialog';

const AUDIENCE_LINK =
    'https://learn.example.com/audience-response?instituteId=inst-1&audienceId=aud-9';

const renderDialog = (baseUrl = AUDIENCE_LINK) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <UtmBuilderDialog
                open
                onOpenChange={() => {}}
                baseUrl={baseUrl}
                sourceType="AUDIENCE"
                entityName="Diwali enquiries"
            />
        </QueryClientProvider>
    );
};

/** Fields render in a fixed order: source, medium, campaign, content, term. */
const fieldAt = (container: HTMLElement, index: number) =>
    container.ownerDocument.querySelectorAll('input')[index] as HTMLInputElement;

describe('UTM builder dialog', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.clearAllMocks();
    });

    it('renders without a runtime error and shows the destination', () => {
        const { baseElement } = renderDialog();
        expect(baseElement.textContent).toContain(AUDIENCE_LINK);
    });

    // The whole reason this dialog exists: the surface's link already carries a
    // query string, and a naive concatenation would produce two '?' and drop
    // the institute id.
    it('builds a link that keeps the existing parameters and has one query string', async () => {
        const { baseElement } = renderDialog();

        fireEvent.change(fieldAt(baseElement as HTMLElement, 0), {
            target: { value: 'WhatsApp' },
        });
        fireEvent.change(fieldAt(baseElement as HTMLElement, 1), {
            target: { value: 'social' },
        });

        await waitFor(() => {
            const preview = Array.from(baseElement.querySelectorAll('p')).find((p) =>
                p.textContent?.includes('utm_source=whatsapp')
            );
            expect(preview).toBeTruthy();
            const url = preview!.textContent as string;
            expect(url.match(/\?/g)).toHaveLength(1);
            expect(url).toContain('instituteId=inst-1');
            expect(url).toContain('audienceId=aud-9');
            expect(url).toContain('utm_medium=social');
        });
    });

    it('normalises what the admin types so one campaign stays one report row', async () => {
        const { baseElement } = renderDialog();
        fireEvent.change(fieldAt(baseElement as HTMLElement, 0), {
            target: { value: 'Google Ads' },
        });
        await waitFor(() =>
            expect(fieldAt(baseElement as HTMLElement, 0).value).toBe('google-ads')
        );
    });

    it('keeps the copy action disabled until source and medium are both given', async () => {
        const { baseElement } = renderDialog();
        const copyButton = Array.from(baseElement.querySelectorAll('button')).at(-1);
        expect(copyButton).toBeTruthy();
        expect(copyButton).toBeDisabled();

        fireEvent.change(fieldAt(baseElement as HTMLElement, 0), { target: { value: 'meta' } });
        fireEvent.change(fieldAt(baseElement as HTMLElement, 1), { target: { value: 'cpc' } });

        await waitFor(() => expect(copyButton).not.toBeDisabled());
    });

    it('pre-fills from a link that is already tagged instead of losing the tags', async () => {
        const { baseElement } = renderDialog(`${AUDIENCE_LINK}&utm_source=meta&utm_medium=cpc`);
        await waitFor(() => {
            expect(fieldAt(baseElement as HTMLElement, 0).value).toBe('meta');
            expect(fieldAt(baseElement as HTMLElement, 1).value).toBe('cpc');
        });
        // ...and the destination shown is the surface's own link, not the tagged one.
        const destination = Array.from(baseElement.querySelectorAll('p')).find(
            (p) => p.textContent === AUDIENCE_LINK
        );
        expect(destination).toBeTruthy();
    });
});
