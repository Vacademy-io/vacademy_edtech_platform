import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import type { TFunction } from 'i18next';
import {
    GET_VIDEO_BRANDING,
    UPDATE_VIDEO_BRANDING,
    GET_VIDEO_STYLE,
    UPDATE_VIDEO_STYLE,
    GET_VIDEO_TEMPLATES,
} from '@/constants/urls';

const NS = 'videoApiStudioVideoStyleBranding';

export interface VideoIntroOutroConfig {
    enabled: boolean;
    duration_seconds: number;
    html: string;
}

export type WatermarkPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export interface VideoWatermarkConfig {
    enabled: boolean;
    position: WatermarkPosition;
    opacity: number;
    html: string;
    max_width?: number;
    max_height?: number;
    margin?: number;
}

export interface VideoBrandingConfig {
    intro: VideoIntroOutroConfig;
    outro: VideoIntroOutroConfig;
    watermark: VideoWatermarkConfig;
}

export interface VideoStyleConfig {
    background_type: 'white' | 'black';
    primary_color: string;
    heading_font: string;
    body_font: string;
    layout_theme: string;
}

export interface VideoTemplate {
    id: string;
    name: string;
    description: string;
    tags: string[];
    background_type: 'white' | 'black';
    preview_html: string;
}

export const DEFAULT_VIDEO_BRANDING: VideoBrandingConfig = {
    intro: { enabled: false, duration_seconds: 3, html: '' },
    outro: { enabled: false, duration_seconds: 4, html: '' },
    watermark: { enabled: false, position: 'top-right', opacity: 0.5, html: '' },
};

export const DEFAULT_VIDEO_STYLE: VideoStyleConfig = {
    background_type: 'white',
    primary_color: '#6366f1', // design-lint-ignore: functional hex default for the branding API's primary_color / native color-input value, not a CSS class
    heading_font: 'Inter',
    body_font: 'Inter',
    layout_theme: '',
};

export const FONT_OPTIONS = [
    'Inter',
    'Roboto',
    'Open Sans',
    'Poppins',
    'Montserrat',
    'Lato',
    'Playfair Display',
    'Source Serif 4',
] as const;

/**
 * Watermark position options, with translated labels. Call once per render
 * with the caller's `t` (the `videoApiStudioVideoStyleBranding` namespace
 * must be loaded by the caller, e.g. via `useTranslation([..., NS])`).
 */
export function buildWatermarkPositions(
    t: TFunction
): ReadonlyArray<{ value: WatermarkPosition; label: string }> {
    return [
        { value: 'top-left', label: t(`${NS}:watermarkPositions.topLeft`) },
        { value: 'top-right', label: t(`${NS}:watermarkPositions.topRight`) },
        { value: 'bottom-left', label: t(`${NS}:watermarkPositions.bottomLeft`) },
        { value: 'bottom-right', label: t(`${NS}:watermarkPositions.bottomRight`) },
    ];
}

export async function fetchVideoStyle(instituteId: string): Promise<VideoStyleConfig> {
    try {
        const res = await authenticatedAxiosInstance.get(GET_VIDEO_STYLE(instituteId));
        if (res.data?.style) {
            return { ...DEFAULT_VIDEO_STYLE, ...res.data.style };
        }
        return DEFAULT_VIDEO_STYLE;
    } catch (err: unknown) {
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status !== 404) throw err;
        return DEFAULT_VIDEO_STYLE;
    }
}

export async function fetchVideoBranding(instituteId: string): Promise<VideoBrandingConfig> {
    try {
        const res = await authenticatedAxiosInstance.get(GET_VIDEO_BRANDING(instituteId));
        if (res.data?.branding) {
            return {
                intro: { ...DEFAULT_VIDEO_BRANDING.intro, ...res.data.branding.intro },
                outro: { ...DEFAULT_VIDEO_BRANDING.outro, ...res.data.branding.outro },
                watermark: {
                    ...DEFAULT_VIDEO_BRANDING.watermark,
                    ...res.data.branding.watermark,
                },
            };
        }
        return DEFAULT_VIDEO_BRANDING;
    } catch (err: unknown) {
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status !== 404) throw err;
        return DEFAULT_VIDEO_BRANDING;
    }
}

export async function fetchVideoTemplates(): Promise<VideoTemplate[]> {
    const res = await authenticatedAxiosInstance.get(GET_VIDEO_TEMPLATES());
    return res.data?.templates ?? [];
}

export async function updateVideoStyle(
    instituteId: string,
    style: VideoStyleConfig
): Promise<void> {
    await authenticatedAxiosInstance.post(UPDATE_VIDEO_STYLE(instituteId), { style });
}

export async function updateVideoBranding(
    instituteId: string,
    branding: VideoBrandingConfig
): Promise<void> {
    await authenticatedAxiosInstance.post(UPDATE_VIDEO_BRANDING(instituteId), { branding });
}
