import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import enStrings from '../../../../../public/locales/en/settingsBadgesRewards.json';
import BadgesRewardsSettings from './BadgesRewardsSettings';
import type { BadgeDefinitionConfig } from '../../-constants/badge-config';
import { DEFAULT_SCORING } from '../../-constants/badge-config';
import type { BadgesRewardsState } from '../../-services/badges-settings';

/**
 * Resolve against the REAL `en` catalogue (CopyToRolesDialog.test.tsx pattern) so a key the
 * component uses but the JSON lacks surfaces as a raw key in the DOM. `defaultValue` is honoured
 * the way i18next does it, because trigger copy is looked up by dynamic key with a fallback.
 */
function translate(key: string, vars?: Record<string, unknown>): string {
    const count = vars?.count as number | undefined;
    const lookup = (path: string) =>
        path.split('.').reduce<unknown>((node, part) => {
            if (node && typeof node === 'object') return (node as Record<string, unknown>)[part];
            return undefined;
        }, enStrings as unknown);

    let value = count !== undefined && count !== 1 ? lookup(`${key}_other`) : undefined;
    if (typeof value !== 'string' && count === 1) value = lookup(`${key}_one`);
    if (typeof value !== 'string') value = lookup(key);
    if (typeof value !== 'string') {
        if (typeof vars?.defaultValue === 'string') return vars.defaultValue;
        return key;
    }
    return value.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(vars?.[name] ?? ''));
}

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: translate }),
}));

const toastSpies = vi.hoisted(() => ({
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: toastSpies }));

const settingsService = vi.hoisted(() => ({
    getBadgesRewardsConfig: vi.fn(),
    getBadgesRewardsConfigStrict: vi.fn(),
    saveBadgesSettings: vi.fn(),
}));
vi.mock('@/routes/settings/-services/badges-settings', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../-services/badges-settings')>();
    return { ...actual, ...settingsService };
});

vi.mock('@/services/upload_file', () => ({
    UploadFileInS3: vi.fn(),
    getPublicUrl: vi.fn().mockResolvedValue(''),
}));
vi.mock('@/utils/userDetails', () => ({ getUserId: () => 'admin-1' }));
vi.mock('./BadgeLibraryPicker', () => ({
    BadgeLibraryPicker: () => <div data-testid="library-picker" />,
}));

const MANUAL_BADGE: BadgeDefinitionConfig = {
    id: 'badge_manual_1',
    name: 'Helping Hand',
    description: 'Recognised for helping classmates',
    icon: 'Star',
    trigger: 'manual',
    threshold: 0,
    enabled: true,
};

const AUTO_BADGE: BadgeDefinitionConfig = {
    id: 'first_course',
    name: 'First Steps',
    description: 'Enrol in your first course',
    icon: 'lib:first_steps-bronze',
    trigger: 'course_count',
    threshold: 1,
    enabled: true,
};

const state = (
    badges: BadgeDefinitionConfig[],
    overrides: Partial<BadgesRewardsState> = {}
): BadgesRewardsState => ({
    enabled: true,
    scoring: DEFAULT_SCORING,
    badges,
    publicShowFullNames: false,
    storedBadgesEmpty: false,
    ...overrides,
});

function renderPage() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={queryClient}>
            <BadgesRewardsSettings />
        </QueryClientProvider>
    );
}

const cardFor = (name: string) => {
    const card = screen.getByText(name).closest<HTMLElement>('[data-testid="badge-card"]');
    if (!card) throw new Error(`no card found for ${name}`);
    return card;
};

beforeEach(() => {
    vi.clearAllMocks();
    settingsService.saveBadgesSettings.mockResolvedValue(undefined);
});

describe('BadgesRewardsSettings — staff-awarded (manual) badges', () => {
    it('hides the threshold input for a manual badge and shows the staff-award hint', async () => {
        settingsService.getBadgesRewardsConfig.mockResolvedValue(state([MANUAL_BADGE, AUTO_BADGE]));
        renderPage();
        await screen.findByText('Helping Hand');

        // Only the auto badge has a threshold field.
        const thresholds = screen.getAllByRole('spinbutton', { name: /^Threshold/ });
        expect(thresholds).toHaveLength(1);
        expect(thresholds[0]).toHaveAccessibleName('Threshold (courses)');

        const manualCard = cardFor('Helping Hand');
        expect(within(manualCard).getByText(enStrings.badgeCard.manualHint)).toBeInTheDocument();
        // The preview chip reads the trigger label only — no "· 0" threshold suffix.
        const chip = within(manualCard).getByTestId('trigger-chip');
        expect(chip).toHaveTextContent(enStrings.triggers.manual.label);
        expect(chip.textContent).not.toContain('·');

        // The auto badge keeps "label · threshold unit".
        const autoChip = within(cardFor('First Steps')).getByTestId('trigger-chip');
        expect(autoChip).toHaveTextContent('Courses enrolled · 1 courses');

        // No raw i18n keys leaked anywhere.
        expect(document.body.textContent).not.toMatch(/\b(badgeCard|triggers|toasts)\.[a-z]/i);
    });

    it('"Add staff-awarded badge" appends a manual badge with no threshold', async () => {
        settingsService.getBadgesRewardsConfig.mockResolvedValue(state([AUTO_BADGE]));
        renderPage();
        await screen.findByText('First Steps');

        fireEvent.click(screen.getByRole('button', { name: enStrings.addManualBadge }));

        expect(screen.getAllByText(enStrings.badgeCard.manualHint)).toHaveLength(1);
        expect(screen.getAllByRole('spinbutton', { name: /^Threshold/ })).toHaveLength(1);
        expect(screen.getByText(enStrings.unsavedBanner.text)).toBeInTheDocument();
    });
});

describe('BadgesRewardsSettings — hidden until earned', () => {
    it('toggling the switch sets `hidden` on the badge and saves it', async () => {
        settingsService.getBadgesRewardsConfig.mockResolvedValue(state([MANUAL_BADGE]));
        settingsService.getBadgesRewardsConfigStrict.mockResolvedValue(state([MANUAL_BADGE]));
        renderPage();
        await screen.findByText('Helping Hand');

        const hiddenSwitch = screen.getByRole('switch', { name: enStrings.badgeCard.hiddenLabel });
        expect(hiddenSwitch).toHaveAttribute('aria-checked', 'false');
        fireEvent.click(hiddenSwitch);
        expect(hiddenSwitch).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByTestId('hidden-chip')).toHaveTextContent(enStrings.badgeCard.hiddenChip);

        fireEvent.click(screen.getByRole('button', { name: enStrings.header.saveChanges }));

        await waitFor(() => expect(settingsService.saveBadgesSettings).toHaveBeenCalledTimes(1));
        const [savedBadges] = settingsService.saveBadgesSettings.mock.calls[0] as [
            BadgeDefinitionConfig[],
        ];
        expect(savedBadges).toHaveLength(1);
        expect(savedBadges[0]).toMatchObject({ id: MANUAL_BADGE.id, hidden: true });
    });
});

describe('BadgesRewardsSettings — save guard', () => {
    it('keeps badges created elsewhere while the page was open (server-only ids are merged)', async () => {
        const createdElsewhere: BadgeDefinitionConfig = {
            ...MANUAL_BADGE,
            id: 'badge_from_student_view',
            name: 'Most Improved',
        };
        settingsService.getBadgesRewardsConfig.mockResolvedValue(state([AUTO_BADGE]));
        settingsService.getBadgesRewardsConfigStrict.mockResolvedValue(
            state([AUTO_BADGE, createdElsewhere])
        );
        renderPage();
        await screen.findByText('First Steps');

        // Local edit wins for a shared id.
        const nameInput = screen.getByDisplayValue('First Steps');
        fireEvent.change(nameInput, { target: { value: 'First Steps!' } });
        fireEvent.click(screen.getByRole('button', { name: enStrings.header.saveChanges }));

        await waitFor(() => expect(settingsService.saveBadgesSettings).toHaveBeenCalledTimes(1));
        expect(settingsService.getBadgesRewardsConfigStrict).toHaveBeenCalledTimes(1);
        const [savedBadges, enabled] = settingsService.saveBadgesSettings.mock.calls[0] as [
            BadgeDefinitionConfig[],
            boolean,
        ];
        expect(enabled).toBe(true);
        expect(savedBadges.map((b) => b.id)).toEqual(['first_course', 'badge_from_student_view']);
        expect(savedBadges[0]?.name).toBe('First Steps!');
        expect(toastSpies.info).toHaveBeenCalledWith('1 badge created elsewhere was kept');
        // The merged badge is now visible in the editor too.
        expect(await screen.findByText('Most Improved')).toBeInTheDocument();
    });

    it('keeps a badge the admin deleted out of the save even though the server still has it', async () => {
        settingsService.getBadgesRewardsConfig.mockResolvedValue(state([AUTO_BADGE, MANUAL_BADGE]));
        // The server is unchanged since load: both badges are still there.
        settingsService.getBadgesRewardsConfigStrict.mockResolvedValue(
            state([AUTO_BADGE, MANUAL_BADGE])
        );
        renderPage();
        await screen.findByText('Helping Hand');

        const deleteButtons = screen.getAllByRole('button', {
            name: enStrings.badgeCard.deleteAriaLabel,
        });
        fireEvent.click(deleteButtons[1]!); // Helping Hand
        fireEvent.click(screen.getByRole('button', { name: enStrings.header.saveChanges }));

        await waitFor(() => expect(settingsService.saveBadgesSettings).toHaveBeenCalledTimes(1));
        const [savedBadges] = settingsService.saveBadgesSettings.mock.calls[0] as [
            BadgeDefinitionConfig[],
        ];
        expect(savedBadges.map((b) => b.id)).toEqual(['first_course']);
        expect(toastSpies.info).not.toHaveBeenCalled();
    });

    it('does not resurrect defaults when the server holds no list (storedBadgesEmpty)', async () => {
        settingsService.getBadgesRewardsConfig.mockResolvedValue(
            state(
                [
                    AUTO_BADGE,
                    {
                        ...AUTO_BADGE,
                        id: 'streak_7',
                        name: 'On Fire',
                        trigger: 'streak',
                        threshold: 7,
                    },
                ],
                {
                    storedBadgesEmpty: true,
                }
            )
        );
        settingsService.getBadgesRewardsConfigStrict.mockResolvedValue(
            state(
                [
                    AUTO_BADGE,
                    {
                        ...AUTO_BADGE,
                        id: 'streak_7',
                        name: 'On Fire',
                        trigger: 'streak',
                        threshold: 7,
                    },
                ],
                {
                    storedBadgesEmpty: true,
                }
            )
        );
        renderPage();
        await screen.findByText('On Fire');

        // Admin deletes one of the defaults, then saves.
        const onFireCard = cardFor('On Fire');
        fireEvent.click(
            within(onFireCard).getByRole('button', { name: enStrings.badgeCard.deleteAriaLabel })
        );
        fireEvent.click(screen.getByRole('button', { name: enStrings.header.saveChanges }));

        await waitFor(() => expect(settingsService.saveBadgesSettings).toHaveBeenCalledTimes(1));
        const [savedBadges] = settingsService.saveBadgesSettings.mock.calls[0] as [
            BadgeDefinitionConfig[],
        ];
        expect(savedBadges.map((b) => b.id)).toEqual(['first_course']);
        expect(toastSpies.info).not.toHaveBeenCalled();
    });

    it('aborts the save when the strict server read fails', async () => {
        settingsService.getBadgesRewardsConfig.mockResolvedValue(state([AUTO_BADGE]));
        settingsService.getBadgesRewardsConfigStrict.mockRejectedValue(new Error('network'));
        renderPage();
        await screen.findByText('First Steps');

        fireEvent.change(screen.getByDisplayValue('First Steps'), {
            target: { value: 'Renamed' },
        });
        fireEvent.click(screen.getByRole('button', { name: enStrings.header.saveChanges }));

        await waitFor(() =>
            expect(toastSpies.error).toHaveBeenCalledWith(enStrings.toasts.saveGuardFailed)
        );
        expect(settingsService.saveBadgesSettings).not.toHaveBeenCalled();
        // Still dirty, so the admin can retry.
        expect(screen.getByText(enStrings.unsavedBanner.text)).toBeInTheDocument();
    });
});

describe('BadgesRewardsSettings — reset to defaults', () => {
    it('warns that staff-awarded badges leave the catalogue', async () => {
        settingsService.getBadgesRewardsConfig.mockResolvedValue(state([MANUAL_BADGE, AUTO_BADGE]));
        renderPage();
        await screen.findByText('Helping Hand');

        fireEvent.click(screen.getByRole('button', { name: enStrings.header.resetDefaults }));

        expect(toastSpies.info).toHaveBeenCalledWith(
            translate('toasts.resetRemovesManual', { count: 1 })
        );
        expect(screen.queryByText('Helping Hand')).not.toBeInTheDocument();
        expect(screen.getByText('Dedicated Learner')).toBeInTheDocument();
    });
});
