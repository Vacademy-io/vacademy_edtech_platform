/**
 * The update offer: nothing without the native updater, a background download only while
 * signed out and not in a meeting, Install only once the file is checked, a failed
 * version left alone for an hour, and the channel reported on /sync.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PanelSyncUpdate } from '@/classroom-shared/apiTypes';

const native = vi.hoisted(() => ({ isNative: true, available: true }));
const updater = vi.hoisted(() => ({
    status: vi.fn(),
    download: vi.fn(),
    install: vi.fn(),
    addListener: vi.fn(),
    listeners: {} as Record<string, (event: never) => void>,
}));
const info = vi.hoisted(() => ({ value: null as null | { channel?: string } }));
const mono = vi.hoisted(() => ({ value: 0 }));

vi.mock('@capacitor/core', () => ({ registerPlugin: () => updater }));
vi.mock('./deviceInfo', () => ({ getCachedDeviceInfo: () => info.value }));

type OfferModule = typeof import('./updateOffer');

const OFFER: PanelSyncUpdate = {
    version_code: 4,
    version_name: '0.4.0',
    apk_url: 'https://cdn.example/classroom-direct-4.apk',
    sha256: 'ab'.repeat(32),
    size_bytes: 1000,
    required: false,
};

async function load(): Promise<OfferModule> {
    vi.resetModules();
    const module = await import('./updateOffer');
    // The download half is a lazy chunk; load it now so a flush is enough to reach it.
    await import('./updateNative');
    return module;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function signIn(): void {
    localStorage.setItem(
        'panel.sessionMeta',
        JSON.stringify({ session_id: 's', user_id: 'u', started_at_ms: 1, last_refresh_wall_ms: 1 })
    );
}

describe('update offer', () => {
    let offer: OfferModule;

    beforeEach(async () => {
        localStorage.clear();
        native.isNative = true;
        native.available = true;
        // What the native bridge installs.
        (window as unknown as { Capacitor: object }).Capacitor = {
            isNativePlatform: () => native.isNative,
            isPluginAvailable: (name: string) => name === 'PanelUpdater' && native.available,
        };
        info.value = null;
        mono.value = 0;
        vi.spyOn(performance, 'now').mockImplementation(() => mono.value);
        updater.status.mockReset().mockResolvedValue({ canInstall: true, downloaded: null });
        updater.download.mockReset().mockResolvedValue({ versionCode: 4 });
        updater.install.mockReset().mockResolvedValue({});
        updater.listeners = {};
        updater.addListener.mockReset().mockImplementation(async (event, listener) => {
            updater.listeners[event] = listener;
            return { remove: vi.fn() };
        });
        offer = await load();
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('does nothing in a build without the updater', async () => {
        native.available = false;
        offer.noteUpdateOffer(OFFER);
        await flush();
        expect(updater.download).not.toHaveBeenCalled();
        expect(offer.getUpdateState()).toMatchObject({ available: false, phase: 'none' });
    });

    it('downloads in the background while signed out, then offers Install', async () => {
        offer.noteUpdateOffer(OFFER);
        await flush();
        expect(updater.download).toHaveBeenCalledWith({
            url: OFFER.apk_url,
            sha256: OFFER.sha256,
            versionCode: 4,
            size: 1000,
        });
        expect(offer.getUpdateState()).toMatchObject({ phase: 'ready', available: true });
        expect(JSON.parse(localStorage.getItem('panel.update') ?? '{}')).toMatchObject({
            version_code: 4,
            outcome: 'DOWNLOADED',
        });
    });

    it('reports download progress', async () => {
        let finish: (value: { versionCode: number }) => void = () => undefined;
        updater.download.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
        offer.noteUpdateOffer(OFFER);
        await flush();
        (updater.listeners.downloadProgress as (e: object) => void)({
            versionCode: 4,
            receivedBytes: 250,
            totalBytes: 1000,
        });
        expect(offer.getUpdateState()).toMatchObject({ phase: 'downloading', progress: 25 });
        finish({ versionCode: 4 });
        await flush();
        expect(offer.getUpdateState().phase).toBe('ready');
    });

    it('uses a file already downloaded for the same version', async () => {
        updater.status.mockResolvedValue({
            canInstall: true,
            downloaded: { versionCode: 4, path: '/files/updates/4.apk' },
        });
        offer.noteUpdateOffer(OFFER);
        await flush();
        expect(updater.download).not.toHaveBeenCalled();
        expect(offer.getUpdateState().phase).toBe('ready');
    });

    it('never starts a download during a session, and a signed-in answer changes nothing', async () => {
        signIn();
        offer.noteUpdateOffer(OFFER);
        await flush();
        expect(updater.download).not.toHaveBeenCalled();
        expect(offer.getUpdateState().offer).toBeNull();
    });

    it('keeps a finished download through a session (signed-in answers carry no offer)', async () => {
        offer.noteUpdateOffer(OFFER);
        await flush();
        signIn();
        offer.noteUpdateOffer(null);
        expect(offer.getUpdateState()).toMatchObject({ phase: 'ready', offer: OFFER });
    });

    it('never starts a download in a meeting', async () => {
        const activity = await import('./activity');
        activity.setMeetingOpen(true);
        offer.noteUpdateOffer(OFFER);
        await flush();
        activity.setMeetingOpen(false);
        expect(updater.download).not.toHaveBeenCalled();
    });

    it('ignores an offer without a file, checksum or size', async () => {
        offer.noteUpdateOffer({ ...OFFER, sha256: null });
        offer.noteUpdateOffer({ ...OFFER, apk_url: null });
        offer.noteUpdateOffer({ ...OFFER, size_bytes: null });
        await flush();
        expect(updater.download).not.toHaveBeenCalled();
    });

    it('a pulled offer hides Install; a newer one replaces the stored file', async () => {
        offer.noteUpdateOffer(OFFER);
        await flush();
        offer.noteUpdateOffer(null);
        await flush();
        expect(offer.getUpdateState()).toMatchObject({ phase: 'none', offer: null });

        offer.noteUpdateOffer(OFFER);
        await flush();
        expect(offer.getUpdateState().phase).toBe('ready');
        updater.download.mockResolvedValue({ versionCode: 5 });
        offer.noteUpdateOffer({ ...OFFER, version_code: 5, version_name: '0.5.0' });
        await flush();
        expect(updater.download).toHaveBeenLastCalledWith(
            expect.objectContaining({ versionCode: 5 })
        );
        expect(offer.getUpdateState().phase).toBe('ready');
    });

    it('a failed download waits an hour before the same version is tried again', async () => {
        updater.download.mockRejectedValueOnce({ code: 'SHA_MISMATCH' });
        offer.noteUpdateOffer(OFFER);
        await flush();
        expect(offer.getUpdateState().phase).toBe('none');
        expect(offer.getUpdateState().last).toMatchObject({
            outcome: 'DOWNLOAD_FAILED',
            code: 'SHA_MISMATCH',
        });
        offer.noteUpdateOffer(OFFER);
        await flush();
        expect(updater.download).toHaveBeenCalledTimes(1);
        mono.value += 60 * 60 * 1000;
        offer.noteUpdateOffer(OFFER);
        await flush();
        expect(updater.download).toHaveBeenCalledTimes(2);
    });

    it('Install hands over to the system installer, or asks for the permission first', async () => {
        offer.noteUpdateOffer(OFFER);
        await flush();
        updater.install.mockResolvedValueOnce({ needsPermission: true });
        await offer.installUpdate();
        expect(offer.getUpdateState().phase).toBe('needsPermission');
        await offer.installUpdate();
        expect(updater.install).toHaveBeenCalledTimes(2);
        expect(offer.getUpdateState().phase).toBe('ready');
        expect(offer.getUpdateState().last).toMatchObject({ outcome: 'INSTALL_STARTED' });
    });

    it('after the permission screen, Install runs again when the page comes back', async () => {
        offer.noteUpdateOffer(OFFER);
        await flush();
        updater.install.mockResolvedValueOnce({ needsPermission: true, opened: true });
        await offer.installUpdate();
        document.dispatchEvent(new Event('resume'));
        await flush();
        expect(updater.install).toHaveBeenCalledTimes(2);
        expect(offer.getUpdateState().phase).toBe('ready');
    });

    it("keeps the system installer's answer for Diagnostics", async () => {
        updater.status.mockResolvedValue({
            canInstall: true,
            downloaded: null,
            lastResult: { status: 'SUCCESS', versionCode: 4, at: Date.now() + 1000 },
        });
        offer.noteUpdateOffer(null);
        await flush();
        expect(offer.getUpdateState().last).toMatchObject({
            outcome: 'INSTALL_RESULT',
            code: 'SUCCESS',
            version_code: 4,
        });
        (updater.listeners.installStatus as (e: object) => void)({
            status: 'FAILURE_ABORTED',
            versionCode: 4,
            at: Date.now() + 2000,
        });
        expect(offer.getUpdateState().last).toMatchObject({ code: 'FAILURE_ABORTED' });
    });

    it('Install does nothing before the file is ready or once a session started', async () => {
        await offer.installUpdate();
        expect(updater.install).not.toHaveBeenCalled();
        offer.noteUpdateOffer(OFFER);
        await flush();
        signIn();
        await offer.installUpdate();
        expect(updater.install).not.toHaveBeenCalled();
    });

    it('the last result survives a restart for Diagnostics', async () => {
        offer.noteUpdateOffer(OFFER);
        await flush();
        offer = await load();
        expect(offer.getUpdateState().last).toMatchObject({
            version_code: 4,
            outcome: 'DOWNLOADED',
        });
    });

    it('reports the native channel, and nothing for an unknown or missing one', () => {
        expect(offer.getAppChannelForSync()).toBeNull();
        info.value = { channel: 'DIRECT' };
        expect(offer.getAppChannelForSync()).toBe('DIRECT');
        info.value = { channel: 'SIDELOAD' };
        expect(offer.getAppChannelForSync()).toBeNull();
        info.value = {};
        expect(offer.getAppChannelForSync()).toBeNull();
    });
});
