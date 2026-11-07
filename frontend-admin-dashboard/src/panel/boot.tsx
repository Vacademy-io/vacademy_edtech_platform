/**
 * boot(): splash first, then i18n + cached branding, then the app.
 *
 * Does NOT set __PANEL_BOOTED__ (owner decision 1): BootMarker in PanelApp
 * does that after the first committed screen, so the panel.html watchdog still
 * fires if the first render throws or never commits.
 */
import { createRoot } from 'react-dom/client';
import { CircleNotch } from '@phosphor-icons/react';
import { getCachedBranding, applyCachedBranding, refreshBranding } from './lib/branding';
import { initPanelI18n } from './i18n';
import { loadPanelDeviceInfo } from './device/deviceInfo';
import { startSyncLoop } from './device/syncLoop';
import { startOffline } from './offline/init';
import { applyBootResume } from './offline/resume';
import { clearStrayCookies, enforceIdleSignOutAtBoot, refreshSessionAtBoot } from './lib/session';
import { PanelApp } from './PanelApp';

function PanelSplash({ name }: { name: string }) {
    return (
        <div className="panel-stage items-center justify-center space-y-6">
            <CircleNotch size={72} className="animate-spin text-primary-500" aria-hidden />
            <p className="text-h2 font-semibold text-neutral-700">{name}</p>
        </div>
    );
}

function recordBootError(stage: string, error: unknown): void {
    const text = error instanceof Error ? error.message : String(error);
    try {
        (window.__PANEL_ERRORS__ || (window.__PANEL_ERRORS__ = [])).push(`boot/${stage}: ${text}`);
    } catch {
        /* ignore */
    }
    console.error(`[panel/boot] ${stage} failed`, error);
}

export function boot(): void {
    document.documentElement.classList.add('panel-root');
    const container = document.getElementById('root');
    if (!container) {
        window.__PANEL_SHOW_FAILED__?.('The page has no #root element.');
        return;
    }
    const root = createRoot(container);
    // Product name, not translated: i18n is not initialised yet.
    root.render(<PanelSplash name={getCachedBranding()?.name || 'Vacademy Classroom'} />);

    // Let the splash paint, then do the synchronous setup and mount the app.
    window.setTimeout(() => {
        try {
            initPanelI18n();
        } catch (error) {
            recordBootError('i18n', error);
        }
        try {
            applyCachedBranding();
        } catch (error) {
            recordBootError('branding', error);
        }
        // Paired: cookies with no session behind them go, the sync loop starts, and a
        // session refreshes once before the first authenticated render, so one that
        // ended while the panel was off never shows. Bounded at 3 s for no network.
        // Phase 0: a session left idle past the 3 h limit (panel powered off, app
        // restarted) is signed out BEFORE the first authenticated render (review
        // finding SEC-1). Resolves at once unless a stale live-session record has to
        // be ended (≤ 5 s).
        let mounted = false;
        const mount = () => {
            if (mounted) return;
            mounted = true;
            root.render(<PanelApp />);
        };
        const idleFailed = (error: unknown) => {
            recordBootError('idleSignOut', error);
            mount();
        };
        try {
            clearStrayCookies();
            void loadPanelDeviceInfo();
            startSyncLoop();
            startOffline();
        } catch (error) {
            recordBootError('device', error);
        }
        const brand = () => {
            refreshBranding().catch((error) => recordBootError('refreshBranding', error));
        };
        try {
            enforceIdleSignOutAtBoot()
                .then(() => refreshSessionAtBoot())
                .then(() => {
                    try {
                        applyBootResume();
                    } catch (error) {
                        recordBootError('resume', error);
                    }
                })
                .then(mount, idleFailed)
                .then(brand);
        } catch (error) {
            idleFailed(error);
            brand();
        }
    }, 0);
}
