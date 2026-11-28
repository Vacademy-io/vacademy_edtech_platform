/**
 * A device frame (phone, tablet, Windows window, browser) drawn around a
 * learner-app iframe, scaled to fit its panel. Shared by the Student Display
 * live preview and the Learner home preview.
 *
 * The frame always has the same three slots (top chrome, viewport, bottom
 * chrome), so switching device never remounts the iframe inside it.
 */
import { useLayoutEffect, useState, type ReactNode, type RefObject } from 'react';
import {
    AppWindow,
    BatteryFull,
    CellSignalFull,
    DeviceMobile,
    DeviceTablet,
    Globe,
    Minus,
    Square,
    WifiHigh,
    X,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { BASE_URL_LEARNER_DASHBOARD } from '@/constants/urls';

/** Must match frontend-learner-dashboard-app/src/lib/student-preview.ts. */
export const PREVIEW_MESSAGE_SOURCE = 'vx-student-preview';
export const PREVIEW_QUERY_PARAM = 'vx_preview';
export const PREVIEW_FRAME_NAME = 'vx-student-preview';

export type PreviewDevice = 'mobile' | 'tablet' | 'windows' | 'website';
type FrameChrome = 'phone' | 'tablet' | 'window' | 'browser';

/**
 * w × h is the learner app's real viewport; the chrome (bezel, status bar,
 * window title bar, browser bar) is drawn around it. Windows app and website
 * are both the learner app's "desktop" layout.
 */
export const DEVICES: Record<PreviewDevice, { w: number; h: number; chrome: FrameChrome }> = {
    mobile: { w: 390, h: 800, chrome: 'phone' },
    tablet: { w: 820, h: 1140, chrome: 'tablet' },
    windows: { w: 1280, h: 768, chrome: 'window' },
    website: { w: 1440, h: 864, chrome: 'browser' },
};

export const DEVICE_ICON = {
    mobile: DeviceMobile,
    tablet: DeviceTablet,
    windows: AppWindow,
    website: Globe,
};

/** Extra size the chrome adds around the viewport (px, before scaling). */
const CHROME_EXTRA: Record<FrameChrome, { w: number; h: number }> = {
    phone: { w: 24, h: 24 + 28 + 20 },
    tablet: { w: 32, h: 32 + 24 },
    window: { w: 2, h: 2 + 32 },
    browser: { w: 2, h: 2 + 40 },
};

export function frameSize(device: PreviewDevice): { w: number; h: number } {
    const size = DEVICES[device];
    const extra = CHROME_EXTRA[size.chrome];
    return { w: size.w + extra.w, h: size.h + extra.h };
}

/** The institute's learner site, with a scheme and no trailing slash. */
export function learnerBaseUrl(portalUrl: string | null | undefined): string {
    const raw = (portalUrl || BASE_URL_LEARNER_DASHBOARD).trim().replace(/\/+$/, '');
    return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

/**
 * Scale that fits `device`'s frame into the element's width and the window
 * height minus `reservedHeight`.
 */
export function useFitScale(
    wrapRef: RefObject<HTMLElement>,
    device: PreviewDevice,
    reservedHeight: number
): number {
    const [scale, setScale] = useState(1);
    const { w: frameW, h: frameH } = frameSize(device);
    useLayoutEffect(() => {
        const el = wrapRef.current;
        if (!el) return;
        const fit = () => {
            const maxW = el.clientWidth;
            const maxH = Math.max(320, window.innerHeight - reservedHeight);
            setScale(Math.min(1, maxW / frameW, maxH / frameH));
        };
        fit();
        const ro = new ResizeObserver(fit);
        ro.observe(el);
        window.addEventListener('resize', fit);
        return () => {
            ro.disconnect();
            window.removeEventListener('resize', fit);
        };
    }, [wrapRef, frameW, frameH, reservedHeight]);
    return scale;
}

interface DeviceFrameProps {
    device: PreviewDevice;
    scale: number;
    /** Window title (Windows chrome). */
    appName: string;
    /** Address bar text (browser chrome). */
    addressText: string;
    /** The viewport content: the learner iframe. */
    children: ReactNode;
}

export function DeviceFrame({ device, scale, appName, addressText, children }: DeviceFrameProps) {
    const size = DEVICES[device];
    const { w: frameW, h: frameH } = frameSize(device);
    return (
        <div
            style={{ width: frameW * scale, height: frameH * scale }} // design-lint-ignore: device frame size is computed
        >
            <div
                className={cn(
                    'flex origin-top-left flex-col overflow-hidden',
                    size.chrome === 'phone' && 'rounded-3xl bg-neutral-900 p-3 shadow-xl',
                    size.chrome === 'tablet' && 'rounded-3xl bg-neutral-800 p-4 shadow-xl',
                    (size.chrome === 'window' || size.chrome === 'browser') &&
                        'rounded-md border border-neutral-300 bg-white shadow-xl'
                )}
                style={{ width: frameW, height: frameH, transform: `scale(${scale})` }} // design-lint-ignore: real device size, scaled to fit
            >
                <div
                    className={cn(
                        'flex shrink-0 items-center',
                        size.chrome === 'phone' &&
                            'h-7 justify-between rounded-t-2xl bg-white px-6 text-xs font-semibold text-neutral-900',
                        size.chrome === 'tablet' &&
                            'h-6 justify-between rounded-t-xl bg-white px-5 text-xs font-semibold text-neutral-900',
                        size.chrome === 'window' &&
                            'h-8 justify-between border-b border-neutral-200 bg-neutral-50 ps-3',
                        size.chrome === 'browser' &&
                            'h-10 gap-3 border-b border-neutral-200 bg-neutral-100 px-3'
                    )}
                >
                    {(size.chrome === 'phone' || size.chrome === 'tablet') && (
                        <>
                            <span>9:41</span>
                            <span className="flex items-center gap-1">
                                <CellSignalFull className="size-3.5" weight="fill" />
                                <WifiHigh className="size-3.5" weight="bold" />
                                <BatteryFull className="size-4" weight="fill" />
                            </span>
                        </>
                    )}
                    {size.chrome === 'window' && (
                        <>
                            <span className="flex min-w-0 items-center gap-2 text-xs text-neutral-700">
                                <span className="size-3.5 shrink-0 rounded-sm bg-primary-500" />
                                <span className="truncate">{appName}</span>
                            </span>
                            <span className="flex h-full text-neutral-600">
                                <span className="flex w-11 items-center justify-center">
                                    <Minus className="size-3.5" />
                                </span>
                                <span className="flex w-11 items-center justify-center">
                                    <Square className="size-3" />
                                </span>
                                <span className="flex w-11 items-center justify-center">
                                    <X className="size-3.5" />
                                </span>
                            </span>
                        </>
                    )}
                    {size.chrome === 'browser' && (
                        <>
                            <span className="flex gap-1.5">
                                <span className="size-3 rounded-full bg-danger-400" />
                                <span className="size-3 rounded-full bg-warning-400" />
                                <span className="size-3 rounded-full bg-success-400" />
                            </span>
                            <span className="min-w-0 flex-1 truncate rounded-full bg-white px-4 py-1 text-xs text-neutral-600">
                                {addressText}
                            </span>
                        </>
                    )}
                </div>
                <div
                    className="shrink-0 overflow-hidden bg-white"
                    style={{ width: size.w, height: size.h }} // design-lint-ignore: the learner app's real viewport
                >
                    {children}
                </div>
                <div
                    className={cn(
                        'shrink-0 items-center justify-center',
                        size.chrome === 'phone' ? 'flex h-5 rounded-b-2xl bg-white' : 'hidden'
                    )}
                >
                    <span className="h-1 w-28 rounded-full bg-neutral-900" />
                </div>
            </div>
        </div>
    );
}
