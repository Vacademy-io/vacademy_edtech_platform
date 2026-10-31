import { GET_INSTITUTE_SETTING_DATA, SAVE_INSTITUTE_SETTING } from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { getInstituteId } from '@/constants/helper';

// Per-institute brand kit for the email template editor. Stored through the generic
// institute-setting endpoint (no backend handler needed — GenericSettingStrategy).
export const SETTING_KEY_EMAIL_BRAND = 'EMAIL_BRAND_SETTING';

export interface EmailBrandColor {
    name: string;
    hex: string;
}

export interface EmailBrandFont {
    name: string;
    // Stylesheet URL emitted as <mj-font href>; e.g. a Google Fonts css2 link.
    href: string;
}

export interface EmailBrandSettings {
    colors: EmailBrandColor[];
    font: EmailBrandFont | null;
    logoUrl: string;
}

export const EMPTY_EMAIL_BRAND: EmailBrandSettings = { colors: [], font: null, logoUrl: '' };

export const googleFontHref = (name: string): string =>
    `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name.trim()).replace(/%20/g, '+')}:wght@400;600;700&display=swap`;

export const isValidHex = (hex: string): boolean => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex.trim());

export const getEmailBrandSettings = async (): Promise<EmailBrandSettings> => {
    try {
        const instituteId = getInstituteId();
        if (!instituteId) return EMPTY_EMAIL_BRAND;
        const response = await authenticatedAxiosInstance.get(GET_INSTITUTE_SETTING_DATA, {
            params: { instituteId, settingKey: SETTING_KEY_EMAIL_BRAND },
        });
        const raw = response.data;
        if (!raw || typeof raw !== 'object') return EMPTY_EMAIL_BRAND;
        return {
            colors: Array.isArray(raw.colors)
                ? raw.colors.filter((c: EmailBrandColor) => c && isValidHex(c.hex || ''))
                : [],
            font: raw.font?.name ? { name: raw.font.name, href: raw.font.href || '' } : null,
            logoUrl: typeof raw.logoUrl === 'string' ? raw.logoUrl : '',
        };
    } catch (err) {
        console.error('Failed to load email brand settings', err);
        return EMPTY_EMAIL_BRAND;
    }
};

export const saveEmailBrandSettings = async (settings: EmailBrandSettings): Promise<void> => {
    const instituteId = getInstituteId();
    // GenericSettingRequest is snake_case on the wire.
    await authenticatedAxiosInstance.post(
        SAVE_INSTITUTE_SETTING,
        { setting_name: 'Email Brand Setting', setting_data: settings },
        { params: { instituteId, settingKey: SETTING_KEY_EMAIL_BRAND } }
    );
};
