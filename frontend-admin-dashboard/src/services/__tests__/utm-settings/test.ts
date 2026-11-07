import { describe, expect, it, vi, beforeEach } from 'vitest';

const get = vi.fn();
const post = vi.fn();
vi.mock('@/lib/auth/axiosInstance', () => ({
    default: Object.assign((cfg: unknown) => get(cfg), { post: (...a: unknown[]) => post(...a) }),
}));
vi.mock('@/lib/auth/instituteUtils', () => ({ getCurrentInstituteId: () => 'inst-1' }));

import { fetchUtmSettings } from '../../utm-settings';

describe('reading the UTM setting', () => {
    beforeEach(() => {
        get.mockReset();
        post.mockReset();
    });

    it('uses its own key once the institute has saved since the split', async () => {
        get.mockResolvedValueOnce({
            data: { data: { enabled: true, sources: ['meta'], mediums: [], requireCampaign: false } },
        });

        const settings = await fetchUtmSettings();

        expect(settings.enabled).toBe(true);
        expect(settings.sources).toEqual(['meta']);
    });

    /**
     * The guard that matters. An institute configured BEFORE UTM became its own
     * setting still holds the toggle inside GTM_SETTING. Without this fallback
     * their toggle would read false the moment this build shipped, the
     * "Generate UTM link" action would vanish from all six share surfaces, and
     * nothing would explain why.
     */
    it('falls back to the legacy GTM_SETTING.utm blob when its own key is absent', async () => {
        get.mockResolvedValueOnce({ data: { data: null } }) // UTM_SETTING: not there yet
            .mockResolvedValueOnce({
                data: { data: { enabled: true, containerId: 'GTM-X', utm: { enabled: true, sources: ['whatsapp'] } } },
            });

        const settings = await fetchUtmSettings();

        expect(settings.enabled).toBe(true);
        expect(settings.sources).toEqual(['whatsapp']);
    });

    it('is off when neither location has anything', async () => {
        get.mockResolvedValue({ data: { data: null } });
        await expect(fetchUtmSettings()).resolves.toMatchObject({ enabled: false });
    });

    it('degrades to off rather than throwing when settings are unreachable', async () => {
        get.mockRejectedValue(new Error('network down'));
        // A settings outage must hide the feature, never break the dropdown.
        await expect(fetchUtmSettings()).resolves.toMatchObject({ enabled: false });
    });
});
