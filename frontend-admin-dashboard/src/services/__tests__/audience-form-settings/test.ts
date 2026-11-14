import { beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.fn();
const axiosInstance = vi.fn();

vi.mock('@/lib/auth/axiosInstance', () => ({
    default: Object.assign(axiosInstance, { post }),
}));
vi.mock('@/lib/auth/instituteUtils', () => ({
    getCurrentInstituteId: () => 'inst-1',
}));

const load = async () => await import('../../audience-post-submit-settings');

describe('the Form Appearance feature switch', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
    });

    it('is OFF for an institute that has never saved the setting', async () => {
        const { fetchAudienceFormSettings } = await load();
        axiosInstance.mockResolvedValueOnce({ data: { data: {} } });
        const settings = await fetchAudienceFormSettings();
        expect(settings.formAppearanceEnabled).toBe(false);
    });

    it('is OFF when the whole request fails', async () => {
        const { fetchAudienceFormSettings } = await load();
        axiosInstance.mockRejectedValueOnce(new Error('network'));
        const settings = await fetchAudienceFormSettings();
        expect(settings.formAppearanceEnabled).toBe(false);
    });

    it.each([
        ['a missing key', {}],
        ['null', { formAppearanceEnabled: null }],
        ['the string "true"', { formAppearanceEnabled: 'true' }],
        ['the number 1', { formAppearanceEnabled: 1 }],
    ])('stays OFF for %s — only a real boolean opts in', async (_label, data) => {
        const { fetchAudienceFormSettings } = await load();
        axiosInstance.mockResolvedValueOnce({ data: { data } });
        const settings = await fetchAudienceFormSettings();
        expect(settings.formAppearanceEnabled).toBe(false);
    });

    it('is ON once the institute saved it', async () => {
        const { fetchAudienceFormSettings } = await load();
        axiosInstance.mockResolvedValueOnce({
            data: { data: { formAppearanceEnabled: true } },
        });
        const settings = await fetchAudienceFormSettings();
        expect(settings.formAppearanceEnabled).toBe(true);
    });

    it('still returns the post-submit defaults alongside it', async () => {
        const { fetchAudienceFormSettings, DEFAULT_POST_SUBMIT_CONFIGURATION } = await load();
        axiosInstance.mockResolvedValueOnce({ data: { data: {} } });
        const settings = await fetchAudienceFormSettings();
        expect(settings.postSubmit).toEqual(DEFAULT_POST_SUBMIT_CONFIGURATION);
    });
});

describe('the Short links feature switch', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
    });

    it.each([
        ['an institute that never saved the setting', {}],
        ['a setting saved before short links existed', { formAppearanceEnabled: true }],
        ['an explicit true', { shortLinksEnabled: true }],
    ])('is ON for %s', async (_label, data) => {
        const { fetchAudienceFormSettings } = await load();
        axiosInstance.mockResolvedValueOnce({ data: { data } });
        const settings = await fetchAudienceFormSettings();
        expect(settings.shortLinksEnabled).toBe(true);
    });

    it('is ON when the whole request fails — a settings outage must not hide the feature', async () => {
        const { fetchAudienceFormSettings } = await load();
        axiosInstance.mockRejectedValueOnce(new Error('network'));
        const settings = await fetchAudienceFormSettings();
        expect(settings.shortLinksEnabled).toBe(true);
    });

    it('is OFF only for an explicit false', async () => {
        const { fetchAudienceFormSettings } = await load();
        axiosInstance.mockResolvedValueOnce({ data: { data: { shortLinksEnabled: false } } });
        const settings = await fetchAudienceFormSettings();
        expect(settings.shortLinksEnabled).toBe(false);
    });

    it.each([
        ['null', null],
        ['the string "false"', 'false'],
        ['the number 0', 0],
    ])('stays ON for %s — only a real boolean false opts out', async (_label, value) => {
        const { fetchAudienceFormSettings } = await load();
        axiosInstance.mockResolvedValueOnce({ data: { data: { shortLinksEnabled: value } } });
        const settings = await fetchAudienceFormSettings();
        expect(settings.shortLinksEnabled).toBe(true);
    });

    it('ships enabled in the hardcoded defaults', async () => {
        const { DEFAULT_AUDIENCE_FORM_SETTINGS } = await load();
        expect(DEFAULT_AUDIENCE_FORM_SETTINGS.shortLinksEnabled).toBe(true);
    });
});

describe('saving the institute setting', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
    });

    it('writes ALL keys — the POST replaces setting_data, so any omission wipes the rest', async () => {
        const { saveAudienceFormSettings, DEFAULT_POST_SUBMIT_CONFIGURATION } = await load();
        post.mockResolvedValueOnce({});

        await saveAudienceFormSettings({
            postSubmit: { ...DEFAULT_POST_SUBMIT_CONFIGURATION, enabled: true },
            formAppearanceEnabled: true,
            shortLinksEnabled: true,
        });

        const [, payload] = post.mock.calls[0] as [
            string,
            { setting_data: Record<string, unknown> },
        ];
        expect(Object.keys(payload.setting_data).sort()).toEqual([
            'formAppearanceEnabled',
            'postSubmitConfiguration',
            'shortLinksEnabled',
        ]);
        expect(payload.setting_data.formAppearanceEnabled).toBe(true);
    });

    it('persists an explicit short-link opt-out rather than dropping the key', async () => {
        const { saveAudienceFormSettings, DEFAULT_POST_SUBMIT_CONFIGURATION } = await load();
        post.mockResolvedValueOnce({});

        await saveAudienceFormSettings({
            postSubmit: DEFAULT_POST_SUBMIT_CONFIGURATION,
            formAppearanceEnabled: false,
            shortLinksEnabled: false,
        });

        const [, payload] = post.mock.calls[0] as [
            string,
            { setting_data: Record<string, unknown> },
        ];
        // A dropped key would read back as ON (absence means ON), silently
        // undoing the institute's opt-out on the next save from this page.
        expect(payload.setting_data.shortLinksEnabled).toBe(false);
    });

    it('round-trips a switched-off institute without losing the thank-you config', async () => {
        const { saveAudienceFormSettings, DEFAULT_POST_SUBMIT_CONFIGURATION } = await load();
        post.mockResolvedValueOnce({});

        await saveAudienceFormSettings({
            postSubmit: { ...DEFAULT_POST_SUBMIT_CONFIGURATION, successTitle: 'Kept' },
            formAppearanceEnabled: false,
            shortLinksEnabled: true,
        });

        const [, payload] = post.mock.calls[0] as [
            string,
            { setting_data: Record<string, unknown> },
        ];
        expect(payload.setting_data.formAppearanceEnabled).toBe(false);
        expect(
            (payload.setting_data.postSubmitConfiguration as { successTitle: string }).successTitle
        ).toBe('Kept');
    });
});
