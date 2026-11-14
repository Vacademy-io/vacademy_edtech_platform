/**
 * Phase 2: the download and install half of the update offer (see updateOffer.ts). A lazy
 * chunk: loaded only in a build that has the native `PanelUpdater` plugin.
 *
 * - A failed download is not retried for the same version for UPDATE_RETRY_MS.
 * - After "allow installs from this app", Install runs again when the page comes back.
 */
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { PanelSyncUpdate } from '@/classroom-shared/apiTypes';
import { isMeetingOpen } from './activity';
import { readSessionMeta } from './store';
import {
    getUpdateState,
    hasUpdater,
    rememberUpdate,
    setUpdateState,
    type UpdatePhase,
} from './updateOffer';

/** The system installer's last answer, as the native side recorded it. */
export interface PanelUpdaterResult {
    status: string;
    message?: string | null;
    versionCode?: number | null;
    at?: number | null;
}

/**
 * The direct build's native updater (android src/direct/.../PanelUpdaterPlugin.java).
 * Every call may reject with a string `code` (SHA_MISMATCH, HOST_NOT_ALLOWED, ...).
 */
export interface PanelUpdaterPlugin {
    status(): Promise<{
        canInstall: boolean;
        busy?: boolean;
        installedVersionCode?: number;
        downloaded: { versionCode: number; sha256?: string } | null;
        lastResult?: PanelUpdaterResult | null;
    }>;
    /** Resolves once the file is stored and checked. Progress arrives as downloadProgress. */
    download(options: {
        url: string;
        sha256: string;
        versionCode: number;
        size: number;
    }): Promise<{ versionCode: number; reused?: boolean }>;
    /** Opens the system's confirm dialog, or the "allow installs" setting first. */
    install(): Promise<{ needsPermission?: boolean; opened?: boolean; started?: boolean }>;
    addListener(
        event: 'downloadProgress',
        listener: (event: {
            versionCode: number;
            receivedBytes: number;
            totalBytes: number;
        }) => void
    ): Promise<PluginListenerHandle>;
    addListener(
        event: 'installStatus',
        listener: (event: PanelUpdaterResult) => void
    ): Promise<PluginListenerHandle>;
}

/** A failed download of one version waits this long before another try. */
export const UPDATE_RETRY_MS = 60 * 60 * 1000;

let plugin: PanelUpdaterPlugin | null = null;
let failedVersion: number | null = null;
let failedAtMono = -Infinity;
let listening = false;
let resumeHooked = false;
/** The version the stored file holds, while phase is ready. */
let readyVersion: number | null = null;

function getUpdater(): PanelUpdaterPlugin | null {
    if (!hasUpdater()) return null;
    if (!plugin) plugin = registerPlugin<PanelUpdaterPlugin>('PanelUpdater');
    return plugin;
}

function codeOf(error: unknown): string {
    const code = (error as { code?: unknown } | null)?.code;
    return typeof code === 'string' ? code.slice(0, 40) : 'ERROR';
}

/** The installer's answer, kept when it is newer than what is stored. */
function rememberNative(result: PanelUpdaterResult | null | undefined): void {
    if (!result || typeof result.status !== 'string') return;
    const at = typeof result.at === 'number' ? result.at : Date.now();
    const last = getUpdateState().last;
    if (last && last.at_ms >= at) return;
    rememberUpdate(
        {
            version_code: typeof result.versionCode === 'number' ? result.versionCode : 0,
            outcome: 'INSTALL_RESULT',
            code: result.status.slice(0, 40),
        },
        at
    );
}

/** Progress and installer events, and the installer's last answer. Once per app run. */
function listen(updater: PanelUpdaterPlugin): void {
    if (listening) return;
    listening = true;
    void updater
        .addListener('downloadProgress', (event) => {
            if (getUpdateState().phase !== 'downloading' || !(event.totalBytes > 0)) return;
            const percent = Math.round((event.receivedBytes / event.totalBytes) * 100);
            setUpdateState({ progress: Math.min(100, percent) });
        })
        .catch(() => undefined);
    void updater.addListener('installStatus', rememberNative).catch(() => undefined);
    void updater
        .status()
        .then((current) => rememberNative(current.lastResult))
        .catch(() => undefined);
}

function quiet(): boolean {
    return !readSessionMeta() && !isMeetingOpen();
}

async function download(updater: PanelUpdaterPlugin, offer: PanelSyncUpdate): Promise<void> {
    const version = offer.version_code;
    setUpdateState({ phase: 'downloading', progress: null });
    try {
        const current = await updater.status();
        if (!current.downloaded || current.downloaded.versionCode !== version) {
            await updater.download({
                url: offer.apk_url as string,
                sha256: offer.sha256 as string,
                versionCode: version,
                size: offer.size_bytes as number,
            });
            rememberUpdate({ version_code: version, outcome: 'DOWNLOADED' });
        }
        readyVersion = version;
        // A newer offer may have come in meanwhile; the next sync starts that one.
        const still = getUpdateState().offer;
        setUpdateState({
            phase: still && still.version_code === version ? 'ready' : 'none',
            progress: null,
        });
    } catch (error) {
        failedVersion = version;
        failedAtMono = performance.now();
        rememberUpdate({ version_code: version, outcome: 'DOWNLOAD_FAILED', code: codeOf(error) });
        setUpdateState({ phase: 'none', progress: null });
    }
}

/** The signed-out sync's offer (or null). Starts the download when it is quiet. */
export function considerOffer(update: PanelSyncUpdate | null): void {
    if (readSessionMeta()) return;
    const updater = getUpdater();
    if (!updater) return;
    listen(updater);
    const offer = update && update.apk_url && update.sha256 && update.size_bytes ? update : null;
    const phase = getUpdateState().phase;
    const busy = phase === 'downloading' || phase === 'installing';
    // Pulled, or replaced by a newer build: what is stored is no longer on offer.
    const withdrawn =
        !busy && (!offer || (phase !== 'none' && readyVersion !== offer.version_code));
    setUpdateState({
        offer,
        available: true,
        ...(withdrawn ? { phase: 'none' as UpdatePhase, progress: null } : {}),
    });
    if (!offer || !quiet() || getUpdateState().phase !== 'none') return;
    const version = offer.version_code;
    if (failedVersion === version && performance.now() - failedAtMono < UPDATE_RETRY_MS) return;
    void download(updater, offer);
}

/** Back from the "allow installs" screen: Install again, once per return. */
function retryOnResume(): void {
    if (resumeHooked) return;
    resumeHooked = true;
    const again = () => {
        if (
            document.visibilityState === 'visible' &&
            getUpdateState().phase === 'needsPermission'
        ) {
            void installUpdate();
        }
    };
    // Capacitor fires `resume` on the document; newer WebViews also fire visibilitychange.
    document.addEventListener('resume', again);
    document.addEventListener('visibilitychange', again);
}

export async function installUpdate(): Promise<void> {
    const updater = getUpdater();
    const { offer, phase } = getUpdateState();
    if (!updater || !offer || !quiet()) return;
    if (phase !== 'ready' && phase !== 'needsPermission') return;
    setUpdateState({ phase: 'installing' });
    try {
        const result = await updater.install();
        if (result && result.needsPermission) {
            setUpdateState({ phase: 'needsPermission' });
            retryOnResume();
            return;
        }
        rememberUpdate({ version_code: offer.version_code, outcome: 'INSTALL_STARTED' });
        // The system dialog is up; if it is cancelled the bar offers Install again.
        setUpdateState({ phase: 'ready' });
    } catch (error) {
        rememberUpdate({
            version_code: offer.version_code,
            outcome: 'INSTALL_FAILED',
            code: codeOf(error),
        });
        setUpdateState({ phase: 'ready' });
    }
}
