/**
 * Full-screen container for every panel screen (.panel-stage in panel.css:
 * position fixed + top/right/bottom/left 0 — never `inset`, Chrome 87).
 *
 * Fullscreen API: web only. In the APK native immersive mode already hides the
 * system bars and Capacitor cancels custom fullscreen views
 * (BridgeWebChromeClient.java:86), so the toggle is hidden there.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowsIn, ArrowsOut } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';
import { isNative } from '@/native/platform';

type FullscreenDocument = Document & {
    webkitFullscreenElement?: Element | null;
    webkitExitFullscreen?: () => Promise<void> | void;
    webkitFullscreenEnabled?: boolean;
};
type FullscreenElement = HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void> | void;
};

function fullscreenSupported(): boolean {
    if (isNative()) return false;
    const doc = document as FullscreenDocument;
    return !!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);
}

function isFullscreen(): boolean {
    const doc = document as FullscreenDocument;
    return !!(doc.fullscreenElement || doc.webkitFullscreenElement);
}

async function toggleFullscreen(): Promise<void> {
    const doc = document as FullscreenDocument;
    const root = document.documentElement as FullscreenElement;
    try {
        if (isFullscreen()) {
            if (doc.exitFullscreen) await doc.exitFullscreen();
            else if (doc.webkitExitFullscreen) await doc.webkitExitFullscreen();
        } else if (root.requestFullscreen) {
            await root.requestFullscreen();
        } else if (root.webkitRequestFullscreen) {
            await root.webkitRequestFullscreen();
        }
    } catch (error) {
        console.warn('[panel] fullscreen toggle failed', error);
    }
}

/** Icon button that enters/leaves browser fullscreen. Renders nothing in the APK. */
export function PanelFullscreenButton({ className }: { className?: string }) {
    const { t } = useTranslation('panel');
    const [active, setActive] = useState(isFullscreen);
    useEffect(() => {
        const update = () => setActive(isFullscreen());
        document.addEventListener('fullscreenchange', update);
        document.addEventListener('webkitfullscreenchange', update);
        return () => {
            document.removeEventListener('fullscreenchange', update);
            document.removeEventListener('webkitfullscreenchange', update);
        };
    }, []);
    if (!fullscreenSupported()) return null;
    const label = active ? t('topBar.exitFullscreen') : t('topBar.fullscreen');
    return (
        <MyButton
            buttonType="secondary"
            layoutVariant="icon"
            scale="large"
            className={cn('size-16', className)}
            aria-label={label}
            title={label}
            onClick={() => void toggleFullscreen()}
        >
            {active ? <ArrowsIn size={32} /> : <ArrowsOut size={32} />}
        </MyButton>
    );
}

export interface PanelStageProps {
    children: ReactNode;
    className?: string;
}

/** Fixed full-viewport flex column. Put a PanelTopBar first and a .panel-stage-body after it. */
export function PanelStage({ children, className }: PanelStageProps) {
    return <div className={cn('panel-stage', className)}>{children}</div>;
}

/** The scrollable area under the top bar. */
export function PanelStageBody({ children, className }: PanelStageProps) {
    return <main className={cn('panel-stage-body', className)}>{children}</main>;
}
