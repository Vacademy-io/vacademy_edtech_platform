import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// `t` is backed by the REAL en catalogs, one per namespace exactly as i18next scopes them (no
// fallbackNS), so a key rendered from the wrong catalog shows up as the raw key — exactly what an
// admin would see, and what these assertions catch.
vi.mock('react-i18next', async () => {
    const catalogs: Record<string, Record<string, unknown>> = {
        communicationTemplateBuilder: (
            await import('../../../../../public/locales/en/communicationTemplateBuilder.json')
        ).default,
        communicationTemplateValidation: (
            await import('../../../../../public/locales/en/communicationTemplateValidation.json')
        ).default,
    };

    const translateIn = (ns: string) => (key: string, vars?: Record<string, unknown>) => {
        const en = catalogs[ns] ?? {};
        const count = typeof vars?.count === 'number' ? (vars.count as number) : undefined;
        const candidates =
            count === undefined ? [key] : [`${key}_${count === 1 ? 'one' : 'other'}`, key];
        for (const candidate of candidates) {
            const value = candidate
                .split('.')
                .reduce<unknown>(
                    (acc, part) =>
                        acc && typeof acc === 'object'
                            ? (acc as Record<string, unknown>)[part]
                            : undefined,
                    en
                );
            if (typeof value === 'string') {
                return value.replace(/{{(\w+)}}/g, (_, name: string) => String(vars?.[name] ?? ''));
            }
        }
        return key;
    };

    return { useTranslation: (ns: string) => ({ t: translateIn(ns) }) };
});

const { uploadFile, getPublicUrl, toast } = vi.hoisted(() => ({
    uploadFile: vi.fn(),
    getPublicUrl: vi.fn(),
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('@/hooks/use-file-upload', () => ({ useFileUpload: () => ({ uploadFile }) }));
vi.mock('@/services/upload_file', () => ({ getPublicUrl }));
vi.mock('@/utils/userDetails', () => ({ getUserId: () => 'user-1' }));
vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-1' }));
vi.mock('sonner', () => ({ toast }));
vi.mock('../-services/template-api', () => ({
    createTemplateDraft: vi.fn(),
    updateTemplate: vi.fn(),
    submitToMeta: vi.fn(),
}));

import { TemplateBuilder } from './template-builder';
import { looksLikeSignedUrl } from '../-utils/template-validation';

const PUBLIC_URL = 'https://cdn.example.com/WHATSAPP_TEMPLATE_MEDIA/inst-1/2f1c9c7e-banner.png';

/** Builds a File with a real byte length, since the size check reads `file.size`. */
function fakeFile(name: string, type: string, bytes: number): File {
    return new File([new Uint8Array(bytes)], name, { type });
}

function renderWithHeader(headerType: string) {
    render(<TemplateBuilder template={null} onClose={() => {}} />);
    const selects = screen.getAllByRole('combobox');
    // Category, language, then header type — the header select is the one carrying the NONE option.
    const headerSelect = selects.find((s) =>
        Array.from((s as HTMLSelectElement).options).some((o) => o.value === 'NONE')
    ) as HTMLSelectElement;
    fireEvent.change(headerSelect, { target: { value: headerType } });
    return {
        urlInput: screen.getByPlaceholderText(/Sample .* URL/) as HTMLInputElement,
        fileInput: screen.getByTestId('header-sample-file') as HTMLInputElement,
    };
}

describe('TemplateBuilder — header sample upload', () => {
    beforeEach(() => {
        uploadFile.mockReset();
        getPublicUrl.mockReset();
        toast.success.mockReset();
        toast.error.mockReset();
    });

    it('offers an upload next to the URL field only for media headers, with the format rule for that type', () => {
        render(<TemplateBuilder template={null} onClose={() => {}} />);
        expect(screen.queryByRole('button', { name: /upload/i })).toBeNull();

        const { fileInput } = renderWithHeader('IMAGE');
        expect(screen.getByRole('button', { name: 'Upload' })).toBeTruthy();
        expect(screen.getByText(/JPG or PNG, up to 5 MB/)).toBeTruthy();
        expect(fileInput.accept).toBe('image/jpeg,image/png');
    });

    it('uploads the picked image to the public bucket and fills the field with the permanent URL', async () => {
        uploadFile.mockResolvedValue('file-123');
        getPublicUrl.mockResolvedValue(PUBLIC_URL);
        const { urlInput, fileInput } = renderWithHeader('IMAGE');

        fireEvent.change(fileInput, {
            target: { files: [fakeFile('banner.png', 'image/png', 1024)] },
        });

        await waitFor(() => expect(urlInput.value).toBe(PUBLIC_URL));
        // publicUrl is what copies the object to the public bucket — without it the URL Meta and the
        // send-time renderer read would be an expiring signed one.
        expect(uploadFile).toHaveBeenCalledWith(
            expect.objectContaining({
                publicUrl: true,
                source: 'WHATSAPP_TEMPLATE_MEDIA',
                sourceId: 'inst-1',
                userId: 'user-1',
            })
        );
        expect(getPublicUrl).toHaveBeenCalledWith('file-123');
        // The WhatsApp preview picks the uploaded image up straight away.
        const preview = document.querySelector('img[src]') as HTMLImageElement;
        expect(preview.getAttribute('src')).toBe(PUBLIC_URL);
        expect(toast.success).toHaveBeenCalledWith(
            expect.stringContaining('Sample image uploaded')
        );
    });

    it('refuses a file Meta would reject before uploading anything', () => {
        const { urlInput, fileInput } = renderWithHeader('IMAGE');

        fireEvent.change(fileInput, {
            target: { files: [fakeFile('banner.gif', 'image/gif', 1024)] },
        });
        expect(uploadFile).not.toHaveBeenCalled();
        expect(toast.error).toHaveBeenCalledWith(
            "That file isn't a supported image. Use JPG or PNG, up to 5 MB."
        );

        fireEvent.change(fileInput, {
            target: { files: [fakeFile('huge.png', 'image/png', 5 * 1024 * 1024 + 1)] },
        });
        expect(uploadFile).not.toHaveBeenCalled();
        expect(toast.error).toHaveBeenLastCalledWith(
            'That file is too large. Use JPG or PNG, up to 5 MB.'
        );
        expect(urlInput.value).toBe('');
    });

    it('leaves the field untouched and reports the failure when the upload dies', async () => {
        uploadFile.mockRejectedValue(new Error('S3 said no'));
        const { urlInput, fileInput } = renderWithHeader('DOCUMENT');
        expect(fileInput.accept).toBe('application/pdf');

        fireEvent.change(fileInput, {
            target: { files: [fakeFile('brochure.pdf', 'application/pdf', 2048)] },
        });

        await waitFor(() => expect(toast.error).toHaveBeenCalled());
        expect(urlInput.value).toBe('');
        expect(screen.getByRole('button', { name: 'Upload' })).toBeTruthy();
    });

    it('still lets the admin paste a URL by hand', () => {
        const { urlInput } = renderWithHeader('VIDEO');
        fireEvent.change(urlInput, { target: { value: 'https://example.com/intro.mp4' } });
        expect(urlInput.value).toBe('https://example.com/intro.mp4');
    });

    it('blocks submit on a pasted signed/expiring link and explains why in plain English', () => {
        const { urlInput } = renderWithHeader('IMAGE');
        fireEvent.change(screen.getByPlaceholderText(/Hello \{\{1\}\}/), {
            target: { value: 'Hello there' },
        });
        fireEvent.change(screen.getByPlaceholderText('order_confirmation'), {
            target: { value: 'welcome_offer' },
        });
        // A real prod paste: the object lives only in the private bucket and the CDN link carried a
        // signature that expired a week later, taking every send of the template down with it.
        fireEvent.change(urlInput, {
            target: {
                value: 'https://d1om4dxj9e7kkd.cloudfront.net/ADMIN_UPLOAD/178b3266-banner.jpeg?Expires=1789627595&Signature=G3tSbwZy&Key-Pair-Id=K2ABC',
            },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Submit for Approval' }));

        expect(uploadFile).not.toHaveBeenCalled();
        // The message comes from the validation catalog — it must not surface as the raw key.
        expect(screen.getByText(/temporary signed URL/)).toBeTruthy();
        expect(screen.queryByText('headerSampleUrlExpiring')).toBeNull();
        expect(urlInput.getAttribute('aria-invalid')).toBe('true');
    });

    it('renders every local validation problem from its own catalog, not as a raw key', () => {
        render(<TemplateBuilder template={null} onClose={() => {}} />);
        fireEvent.click(screen.getByRole('button', { name: 'Submit for Approval' }));
        expect(screen.getByText('Give the template a name.')).toBeTruthy();
        expect(screen.queryByText('nameRequired')).toBeNull();
    });
});

describe('looksLikeSignedUrl', () => {
    it('flags S3 presigned, CloudFront signed and Azure SAS links', () => {
        expect(
            looksLikeSignedUrl('https://x.cloudfront.net/a.jpg?Expires=1&Signature=s&Key-Pair-Id=k')
        ).toBe(true);
        expect(
            looksLikeSignedUrl(
                'https://b.s3.amazonaws.com/a.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=abc'
            )
        ).toBe(true);
        expect(
            looksLikeSignedUrl('https://acct.blob.core.windows.net/c/a.pdf?sv=2020&sig=abc')
        ).toBe(true);
    });

    it('lets permanent public URLs through, including ones with harmless query strings', () => {
        expect(looksLikeSignedUrl(PUBLIC_URL)).toBe(false);
        expect(looksLikeSignedUrl('https://cdn.example.com/a.png?v=3&w=800')).toBe(false);
        expect(
            looksLikeSignedUrl('https://res.cloudinary.com/x/image/upload/f_auto,q_auto/img')
        ).toBe(false);
    });
});
