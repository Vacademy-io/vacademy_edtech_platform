/**
 * End to end through the real i18n bootstrap: the course card's "View Course"
 * button follows the institute's Course rename, including a rename that lands
 * after the catalog is already loaded and the card is on screen.
 */
import fs from 'node:fs';
import path from 'node:path';
import { act, render, screen } from '@testing-library/react';
import { useTranslation } from 'react-i18next';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { StorageKey } from '@/constants/storage/storage';
import { notifyNamingSettingsUpdated } from '@/hooks/useNamingSettingsVersion';

// Node >= 25 ships its own global localStorage — undefined unless started with
// --localstorage-file — and it shadows the DOM environment's.
if (!globalThis.localStorage) {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key: string) => store.get(key) ?? null,
            setItem: (key: string, value: string) => void store.set(key, String(value)),
            removeItem: (key: string) => void store.delete(key),
            clear: () => store.clear(),
        },
    });
}

const LOCALES = path.resolve(__dirname, '../../public/locales');

// Serve public/locales the way production does: one merged catalog per locale
// (seedLanguage path), per-namespace JSON only as the fallback.
const mergedCatalog = (lng: string) =>
    Object.fromEntries(
        fs
            .readdirSync(path.join(LOCALES, lng))
            .filter((file) => file.endsWith('.json'))
            .map((file) => [
                file.slice(0, -'.json'.length),
                JSON.parse(fs.readFileSync(path.join(LOCALES, lng, file), 'utf8')),
            ])
    );

vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
        const merged = /\/locales\/_merged\/([^/?]+)\.json/.exec(url);
        if (merged) return { ok: true, status: 200, json: async () => mergedCatalog(merged[1]!) };
        const match = /\/locales\/([^/]+)\/([^/?]+)\.json/.exec(url);
        const file = match && path.join(LOCALES, match[1] ?? '', `${match[2]}.json`);
        if (!file || !fs.existsSync(file))
            return { ok: false, status: 404, json: async () => ({}) };
        return {
            ok: true,
            status: 200,
            json: async () => JSON.parse(fs.readFileSync(file, 'utf8')),
        };
    })
);

const setNaming = (settings: unknown[]) =>
    localStorage.setItem(StorageKey.NAMING_SETTINGS, JSON.stringify(settings));

const ViewCourseButton = () => {
    const { t, ready } = useTranslation('authoredCourses');
    return <button>{ready ? t('viewCourse') : '…'}</button>;
};

describe('course card button', () => {
    let i18n: typeof import('@/i18n').default;

    beforeAll(async () => {
        localStorage.setItem('vacademy-locale', JSON.stringify({ state: { locale: 'en' } }));
        // Agilore's saved settings are already cached when the app boots.
        setNaming([{ key: 'Course', customValue: 'Training Module', systemValue: 'Course' }]);
        const mod = await import('@/i18n');
        await mod.catalogsReady;
        i18n = mod.default;
        // Seeded from the merged catalog — no per-namespace request needed.
        expect(i18n.hasResourceBundle('en', 'authoredCourses')).toBe(true);
        await i18n.loadNamespaces('authoredCourses');
    });

    it('uses the renamed term on first render and follows later renames', async () => {
        render(<ViewCourseButton />);
        expect(await screen.findByRole('button')).toHaveTextContent('View Training Module');

        // Institute switch / Naming Settings save: settings land after mount.
        await act(async () => {
            setNaming([{ key: 'Course', customValue: 'Programme' }]);
            notifyNamingSettingsUpdated();
        });
        expect(screen.getByRole('button')).toHaveTextContent('View Programme');

        // An institute with no renames gets the stock wording back.
        await act(async () => {
            setNaming([]);
            notifyNamingSettingsUpdated();
        });
        expect(screen.getByRole('button')).toHaveTextContent('View Course');
    });
});
