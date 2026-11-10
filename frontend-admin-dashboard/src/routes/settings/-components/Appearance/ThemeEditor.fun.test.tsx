// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { StudentDisplaySettingsData } from '@/types/student-display-settings';
import type { StudentUiType } from '@/types/theme-role-settings';

const calls: string[] = [];
const saveThemeRoleSettings = vi.fn(async () => {
    calls.push('theme');
});
const saveStudentDisplaySettings = vi.fn(async (_settings: StudentDisplaySettingsData) => {
    calls.push('display');
});
let savedTheme: unknown = null;
let legacyType: StudentUiType = 'default';

const display = (type: StudentUiType) =>
    ({ ui: { type }, otherSection: { kept: true } }) as unknown as StudentDisplaySettingsData;

vi.mock('@/services/theme-role-settings', () => ({
    getThemeRoleSettings: async () => savedTheme,
    saveThemeRoleSettings,
}));
vi.mock('@/services/student-display-settings', () => ({
    getStudentDisplaySettings: async () => display(legacyType),
    fetchStudentDisplaySettingsForEdit: async () => display(legacyType),
    fetchSavedStudentDisplaySettings: async () => display(legacyType),
    saveStudentDisplaySettings,
}));
vi.mock('@/services/student-list-section/getInstituteDetails', () => ({
    useInstituteQuery: () => ({}),
}));
vi.mock('@/routes/dashboard/-services/dashboard-services', () => ({
    handleUpdateInstituteDashboard: async () => {},
}));
vi.mock('@/providers/theme/theme-provider', () => ({
    useTheme: () => ({
        instituteThemeCode: 'blue',
        setPrimaryTheme: () => {},
        getPrimaryColorCode: () => '#2563eb', // design-lint-ignore: test data
    }),
}));
vi.mock('@tanstack/react-query', async (original) => ({
    ...(await original<typeof import('@tanstack/react-query')>()),
    useSuspenseQuery: () => ({ data: { institute_theme_code: 'blue' } }),
    useQueryClient: () => ({ invalidateQueries: async () => {} }),
}));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
vi.mock('sonner', () => ({ toast: { success: () => {}, error: () => {} } }));

const { ThemeEditor } = await import('./ThemeEditor');
const { legacySkinFor } = await import('./legacy-skin');

const theme = (skin?: StudentUiType) => ({
    version: 3,
    mode: 'legacy',
    roles: {
        density: 'default',
        corners: 'rounded',
        gradient: 'flat',
        ...(skin ? { skin } : {}),
    },
});

const onLegacySkinWritten = vi.fn();

async function openEditor() {
    render(<ThemeEditor onLegacySkinWritten={onLegacySkinWritten} />);
    const button = await screen.findByRole('button', { name: 'save.save' });
    // Hydration has run once the saved skin is the checked one.
    await waitFor(() => expect(screen.getAllByRole('radio', { checked: true }).length).toBeGreaterThan(0));
    return button;
}

async function save(button: HTMLElement) {
    fireEvent.click(button);
    await waitFor(() => expect(saveThemeRoleSettings).toHaveBeenCalled());
    return (saveThemeRoleSettings.mock.calls[0] as unknown as [{ roles: { skin?: string } }])[0];
}

// An option's name is its label plus any description ("Default" carries one).
const radio = (label: string) =>
    screen.getByRole('radio', { name: new RegExp(`^${label.replace(/\./g, '\\.')}(\\s|$)`) });
const pick = (label: string) => fireEvent.click(radio(label));

describe('ThemeEditor and the Fun skin', () => {
    beforeEach(() => {
        saveThemeRoleSettings.mockClear();
        saveStudentDisplaySettings.mockClear();
        onLegacySkinWritten.mockClear();
        calls.length = 0;
    });
    afterEach(cleanup);

    it('lists Fun next to the five existing skins', async () => {
        savedTheme = theme('default');
        legacyType = 'default';
        await openEditor();
        for (const skin of ['default', 'vibrant', 'play', 'cleanerPlay', 'corporate', 'fun']) {
            expect(radio(`learnerUi.skin.${skin}`)).toBeTruthy();
        }
    });

    it('shows a saved Fun skin as chosen', async () => {
        savedTheme = theme('fun');
        legacyType = 'play';
        await openEditor();
        await waitFor(() =>
            expect(radio('learnerUi.skin.fun').getAttribute('aria-checked')).toBe('true')
        );
    });

    it('saves Fun with Play as the fallback older apps read, first', async () => {
        savedTheme = theme('default');
        legacyType = 'default';
        const button = await openEditor();
        pick('learnerUi.skin.fun');
        const saved = await save(button);
        expect(saved.roles.skin).toBe('fun');
        expect(saveStudentDisplaySettings).toHaveBeenCalledTimes(1);
        const written = saveStudentDisplaySettings.mock.calls[0]![0] as unknown as {
            ui: { type: string };
            otherSection: unknown;
        };
        expect(written.ui.type).toBe('play');
        // The rest of the blob goes back as the server had it.
        expect(written.otherSection).toEqual({ kept: true });
        expect(calls).toEqual(['display', 'theme']);
        // A page holding its own copy of the setting hears what was written.
        expect(onLegacySkinWritten).toHaveBeenCalledWith('play');
    });

    it('writes nothing extra when the fallback is already Play', async () => {
        savedTheme = theme('fun');
        legacyType = 'play';
        const button = await openEditor();
        const saved = await save(button);
        expect(saved.roles.skin).toBe('fun');
        expect(saveStudentDisplaySettings).not.toHaveBeenCalled();
        expect(onLegacySkinWritten).not.toHaveBeenCalled();
    });

    it('moves the fallback along when an institute leaves Fun', async () => {
        savedTheme = theme('fun');
        legacyType = 'play';
        const button = await openEditor();
        pick('learnerUi.skin.default');
        const saved = await save(button);
        expect(saved.roles.skin).toBe('default');
        const written = saveStudentDisplaySettings.mock.calls[0]![0] as unknown as {
            ui: { type: string };
        };
        expect(written.ui.type).toBe('default');
    });

    it('leaves ui.type alone for the existing skins, as before', async () => {
        for (const skin of ['default', 'vibrant', 'play', 'cleanerPlay', 'corporate'] as const) {
            saveThemeRoleSettings.mockClear();
            savedTheme = theme('default');
            legacyType = 'vibrant';
            const button = await openEditor();
            pick(`learnerUi.skin.${skin}`);
            const saved = await save(button);
            expect(saved.roles.skin).toBe(skin);
            cleanup();
        }
        expect(saveStudentDisplaySettings).not.toHaveBeenCalled();
    });

    it('still seeds the skin from the legacy location when THEME_SETTING has none', async () => {
        savedTheme = theme();
        legacyType = 'cleanerPlay';
        const button = await openEditor();
        await waitFor(() =>
            expect(radio('learnerUi.skin.cleanerPlay').getAttribute('aria-checked')).toBe('true')
        );
        const saved = await save(button);
        expect(saved.roles.skin).toBe('cleanerPlay');
        expect(saveStudentDisplaySettings).not.toHaveBeenCalled();
    });
});

describe('legacySkinFor', () => {
    it('gives the nearest look an older app knows', () => {
        expect(legacySkinFor('fun', null)).toBe('play');
        expect(legacySkinFor('fun', 'fun')).toBe('play');
        expect(legacySkinFor('corporate', 'fun')).toBe('corporate');
        expect(legacySkinFor('corporate', 'cleanerPlay')).toBeNull();
        expect(legacySkinFor('default', null)).toBeNull();
    });
});
