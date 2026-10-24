import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import enStrings from '../../../../../../../../public/locales/en/manageStudentsBadges.json';
import type { LearnerBadgeAward, AwardBadgeResponse } from '@/services/student-badges';
import type { BadgesRewardsState } from '@/routes/settings/-services/badges-settings';
import type { BadgeDefinitionConfig } from '@/routes/settings/-constants/badge-config';
import type { StudentTable } from '@/types/student-table-types';

/**
 * Resolves t() against the REAL en catalogue (CopyToRolesDialog.test.tsx pattern) so a key
 * the component uses but the JSON lacks surfaces as a raw dotted key and fails the
 * "no raw keys" assertion below. Mirrors i18next's `defaultValue` fallback.
 */
function translate(key: string, vars?: Record<string, unknown>): string {
    const lookup = (path: string) =>
        path.split('.').reduce<unknown>((node, part) => {
            if (node && typeof node === 'object') return (node as Record<string, unknown>)[part];
            return undefined;
        }, enStrings as unknown);
    const value = lookup(key);
    if (typeof value !== 'string') {
        return typeof vars?.defaultValue === 'string' ? vars.defaultValue : key;
    }
    return value.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(vars?.[name] ?? ''));
}

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: translate }),
}));

const toastSpies = vi.hoisted(() => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: toastSpies }));

const services = vi.hoisted(() => ({
    getStudentAwardedBadges: vi.fn(),
    awardBadge: vi.fn(),
    revokeBadge: vi.fn(),
    createCatalogueBadge: vi.fn(),
}));
vi.mock('@/services/student-badges', () => ({
    ...services,
    awardSource: (a: { source?: string | null }) => (a.source === 'AUTO' ? 'AUTO' : 'MANUAL'),
    AWARD_BATCH_LIMIT: 500,
}));

const settings = vi.hoisted(() => ({
    getBadgesRewardsConfig: vi.fn(),
}));
vi.mock('@/routes/settings/-services/badges-settings', () => settings);

const userDetails = vi.hoisted(() => ({
    isUserAdmin: vi.fn(() => true),
    getUserId: vi.fn(() => 'admin-1'),
}));
vi.mock('@/utils/userDetails', () => userDetails);

vi.mock('@/services/upload_file', () => ({
    UploadFileInS3: vi.fn(),
    getPublicUrl: vi.fn(async () => ''),
}));

vi.mock('@/routes/settings/-components/BadgesRewards/BadgeLibraryPicker', () => ({
    BadgeLibraryPicker: () => null,
}));

const sidebar = vi.hoisted(() => ({
    selectedStudent: null as StudentTable | null,
    isSubmissionTab: undefined as boolean | undefined,
}));
vi.mock('@/routes/manage-students/students-list/-context/selected-student-sidebar-context', () => ({
    useStudentSidebar: () => ({
        selectedStudent: sidebar.selectedStudent,
        isSubmissionTab: sidebar.isSubmissionTab,
    }),
}));

import { StudentBadges } from './student-badges';

const STUDENT = {
    id: 'participant-row-1',
    user_id: 'user-1',
    full_name: 'Asha Verma',
    email: 'asha@example.test',
    institute_id: 'inst-1',
} as unknown as StudentTable;

const badge = (over: Partial<BadgeDefinitionConfig>): BadgeDefinitionConfig => ({
    id: 'b',
    name: 'Badge',
    description: '',
    icon: 'Star',
    trigger: 'manual',
    threshold: 0,
    enabled: true,
    ...over,
});

const CATALOGUE: BadgeDefinitionConfig[] = [
    badge({ id: 'streak_7', name: 'On Fire', trigger: 'streak', threshold: 7, icon: 'Fire' }),
    badge({ id: 'helping_hand', name: 'Helping Hand', description: 'Helps classmates' }),
    badge({ id: 'mystery', name: 'Mystery', hidden: true }),
    badge({ id: 'retired', name: 'Retired', enabled: false }),
];

const config = (over: Partial<BadgesRewardsState> = {}): BadgesRewardsState => ({
    enabled: true,
    scoring: {
        activityPerDay: 10,
        streakPerDay: 5,
        liveClassAttended: 20,
        courseCompletion: 100,
        assessmentBestScore: 50,
    },
    badges: CATALOGUE,
    publicShowFullNames: false,
    storedBadgesEmpty: false,
    ...over,
});

const award = (over: Partial<LearnerBadgeAward>): LearnerBadgeAward => ({
    id: 'a',
    userId: 'user-1',
    instituteId: 'inst-1',
    badgeId: 'helping_hand',
    badgeName: 'Helping Hand',
    badgeIcon: 'Star',
    status: 'ACTIVE',
    awardedAt: '2026-09-10T08:30:00Z',
    ...over,
});

const envelope = (status: string, notified = true): AwardBadgeResponse => ({
    results: [{ userId: 'user-1', status, badge: award({}) }],
    awardedCount: status === 'NEW' ? 1 : 0,
    alreadyHadCount: status === 'ALREADY_ACTIVE' ? 1 : 0,
    notEnrolledCount: status === 'NOT_ENROLLED' ? 1 : 0,
    upgradedCount: status === 'UPGRADED_FROM_AUTO' ? 1 : 0,
    notified,
});

function renderTab(props: { isSubmissionTab?: boolean } = {}) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <StudentBadges {...props} />
        </QueryClientProvider>
    );
}

const openPicker = () => {
    const trigger = screen.getByRole('combobox', { name: enStrings.picker.label });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    return trigger;
};

const pickOption = (name: string) => {
    openPicker();
    const option = screen.getByRole('option', { name: new RegExp(name) });
    fireEvent.keyDown(option, { key: 'Enter' });
};

const awaitLoaded = () =>
    waitFor(() => expect(screen.getByText(enStrings.award.heading)).toBeInTheDocument());

beforeEach(() => {
    Object.values(toastSpies).forEach((spy) => spy.mockReset());
    services.getStudentAwardedBadges.mockReset().mockResolvedValue([]);
    services.awardBadge.mockReset().mockResolvedValue(envelope('NEW'));
    services.revokeBadge.mockReset().mockResolvedValue(undefined);
    services.createCatalogueBadge.mockReset();
    settings.getBadgesRewardsConfig.mockReset().mockResolvedValue(config());
    userDetails.isUserAdmin.mockReset().mockReturnValue(true);
    sidebar.selectedStudent = STUDENT;
    sidebar.isSubmissionTab = undefined;
});

describe('StudentBadges — catalogue picker', () => {
    it('loads awards + config for the learner and renders no raw i18n keys', async () => {
        renderTab();
        await awaitLoaded();

        expect(services.getStudentAwardedBadges).toHaveBeenCalledWith('user-1');
        expect(settings.getBadgesRewardsConfig).toHaveBeenCalledTimes(1);
        expect(document.body.textContent).not.toMatch(
            /\b(picker|award|awarded|preview|create|revoke|trigger|unit|disabledBanner)\.[a-zA-Z]/
        );
    });

    it('groups staff-awarded badges before achievement badges and skips disabled ones', async () => {
        renderTab();
        await awaitLoaded();
        openPicker();

        const listbox = await screen.findByRole('listbox');
        const groups = within(listbox).getAllByRole('group');
        expect(groups).toHaveLength(2);
        expect(groups[0]).toHaveTextContent(enStrings.picker.groupManual);
        expect(
            within(groups[0]!)
                .getAllByRole('option')
                .map((o) => o.textContent)
        ).toEqual(['Helping Hand', 'Mystery']);
        expect(groups[1]).toHaveTextContent(enStrings.picker.groupAuto);
        expect(
            within(groups[1]!)
                .getAllByRole('option')
                .map((o) => o.textContent)
        ).toEqual(['On Fire']);
        expect(within(listbox).queryByText('Retired')).not.toBeInTheDocument();
    });

    it('marks badges the learner already holds as a staff award as Earned (disabled)', async () => {
        services.getStudentAwardedBadges.mockResolvedValue([award({ badgeId: 'helping_hand' })]);
        renderTab();
        await awaitLoaded();
        openPicker();

        const option = await screen.findByRole('option', { name: /Helping Hand/ });
        expect(option).toHaveTextContent(enStrings.picker.earned);
        expect(option).toHaveAttribute('data-disabled');
    });

    it('shows "Create a new badge" only to institute admins', async () => {
        const { unmount } = renderTab();
        await awaitLoaded();
        expect(screen.getByRole('button', { name: enStrings.picker.create })).toBeInTheDocument();
        unmount();

        userDetails.isUserAdmin.mockReturnValue(false);
        renderTab();
        await awaitLoaded();
        expect(
            screen.queryByRole('button', { name: enStrings.picker.create })
        ).not.toBeInTheDocument();
    });
});

describe('StudentBadges — awarding', () => {
    it('previews the selected badge with its trigger chip and awards to selectedStudent.user_id', async () => {
        renderTab();
        await awaitLoaded();
        pickOption('On Fire');

        // Preview card: auto trigger → "<label> · <threshold> <unit>".
        expect(await screen.findByText('Daily streak · 7 days')).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText(enStrings.award.noteLabel), {
            target: { value: '  Kept the streak alive  ' },
        });
        fireEvent.click(screen.getByRole('button', { name: enStrings.award.submit }));

        await waitFor(() => expect(services.awardBadge).toHaveBeenCalledTimes(1));
        expect(services.awardBadge.mock.calls[0]![0]).toEqual({
            userIds: ['user-1'],
            badgeId: 'streak_7',
            badgeName: 'On Fire',
            badgeIcon: 'Fire',
            badgeDescription: '',
            reason: 'Kept the streak alive',
        });
        await waitFor(() =>
            expect(toastSpies.success).toHaveBeenCalledWith(enStrings.award.toastNew)
        );
        expect(toastSpies.info).not.toHaveBeenCalled();
    });

    it('uses selectedStudent.id on the submissions surface and sends no reason when the note is blank', async () => {
        sidebar.isSubmissionTab = true;
        renderTab({ isSubmissionTab: true });
        await awaitLoaded();
        expect(services.getStudentAwardedBadges).toHaveBeenCalledWith('participant-row-1');

        pickOption('Helping Hand');
        fireEvent.click(await screen.findByRole('button', { name: enStrings.award.submit }));

        await waitFor(() => expect(services.awardBadge).toHaveBeenCalledTimes(1));
        expect(services.awardBadge.mock.calls[0]![0]).toMatchObject({
            userIds: ['participant-row-1'],
            badgeId: 'helping_hand',
            reason: undefined,
        });
    });

    it('shows the Hidden chip for hidden badges and the upgrade toast for an auto-held badge', async () => {
        services.getStudentAwardedBadges.mockResolvedValue([
            award({ id: 'auto-row', badgeId: 'mystery', badgeName: 'Mystery', source: 'AUTO' }),
        ]);
        services.awardBadge.mockResolvedValue(envelope('UPGRADED_FROM_AUTO'));
        renderTab();
        await awaitLoaded();

        // Auto-held badges stay selectable (awarding upgrades them to a staff award).
        pickOption('Mystery');
        expect(await screen.findByText(enStrings.preview.autoHeldHint)).toBeInTheDocument();
        const preview = screen.getByText(enStrings.preview.autoHeldHint).parentElement!;
        expect(within(preview).getByText(enStrings.preview.hidden)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: enStrings.award.submit }));
        await waitFor(() =>
            expect(toastSpies.success).toHaveBeenCalledWith(enStrings.award.toastUpgraded)
        );
    });

    it('tells the admin when learners were not notified and when the badge was already held', async () => {
        services.awardBadge.mockResolvedValue(envelope('NEW', false));
        renderTab();
        await awaitLoaded();
        pickOption('Helping Hand');
        fireEvent.click(await screen.findByRole('button', { name: enStrings.award.submit }));
        await waitFor(() =>
            expect(toastSpies.info).toHaveBeenCalledWith(enStrings.award.toastNotNotified)
        );

        services.awardBadge.mockResolvedValue(envelope('ALREADY_ACTIVE'));
        pickOption('Helping Hand');
        fireEvent.click(await screen.findByRole('button', { name: enStrings.award.submit }));
        await waitFor(() =>
            expect(toastSpies.info).toHaveBeenCalledWith(enStrings.award.toastAlreadyActive)
        );
    });

    it('toasts an error and keeps the form when the award call fails', async () => {
        services.awardBadge.mockRejectedValue(new Error('boom'));
        renderTab();
        await awaitLoaded();
        pickOption('Helping Hand');
        fireEvent.click(await screen.findByRole('button', { name: enStrings.award.submit }));

        await waitFor(() =>
            expect(toastSpies.error).toHaveBeenCalledWith(enStrings.award.errorToast)
        );
        expect(screen.getByText('Helps classmates')).toBeInTheDocument();
    });
});

describe('StudentBadges — awarded list + revoke', () => {
    it('describes staff awards and auto-unlocks differently, with the formatted date', async () => {
        services.getStudentAwardedBadges.mockResolvedValue([
            award({
                id: 'row-manual',
                badgeId: 'helping_hand',
                reason: 'Helped the whole batch',
                awardedAt: '2026-09-10T08:30:00Z',
            }),
            award({
                id: 'row-auto',
                badgeId: 'streak_7',
                badgeName: 'On Fire',
                source: 'AUTO',
                awardedAt: '2026-08-01T00:00:00Z',
            }),
            award({
                id: 'row-hidden',
                badgeId: 'mystery',
                badgeName: 'Mystery',
                awardedAt: null,
            }),
        ]);
        renderTab();
        await awaitLoaded();

        expect(screen.getByText('Awarded by staff · 10 Sep 2026')).toBeInTheDocument();
        expect(screen.getByText('Auto-unlocked · recorded 1 Aug 2026')).toBeInTheDocument();
        expect(screen.getByText('“Helped the whole batch”')).toBeInTheDocument();
        expect(screen.getByText(enStrings.awarded.hidden)).toBeInTheDocument();
        expect(screen.getByText(enStrings.awarded.metaManualNoDate)).toBeInTheDocument();
        expect(screen.getByText('3')).toBeInTheDocument();
    });

    it('shows an empty state when the learner holds nothing', async () => {
        renderTab();
        await awaitLoaded();
        expect(screen.getByText(enStrings.awarded.emptyTitle)).toBeInTheDocument();
    });

    it('only revokes after the admin confirms, with source-specific copy', async () => {
        services.getStudentAwardedBadges.mockResolvedValue([
            award({ id: 'row-manual', badgeId: 'helping_hand' }),
            award({
                id: 'row-auto',
                badgeId: 'streak_7',
                badgeName: 'On Fire',
                source: 'AUTO',
            }),
        ]);
        renderTab();
        await awaitLoaded();

        // Manual row: open confirm, cancel → nothing happens.
        fireEvent.click(screen.getByRole('button', { name: 'Revoke Helping Hand' }));
        const manualDialog = await screen.findByRole('alertdialog');
        expect(manualDialog).toHaveTextContent('Revoke "Helping Hand"?');
        expect(manualDialog).toHaveTextContent(enStrings.revoke.manualBody);
        fireEvent.click(
            within(manualDialog).getByRole('button', { name: enStrings.revoke.cancel })
        );
        await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
        expect(services.revokeBadge).not.toHaveBeenCalled();

        // Auto row: different copy, confirm → revoke fires with the learner + badge id.
        fireEvent.click(screen.getByRole('button', { name: 'Revoke On Fire' }));
        const autoDialog = await screen.findByRole('alertdialog');
        expect(autoDialog).toHaveTextContent(enStrings.revoke.autoBody);
        fireEvent.click(within(autoDialog).getByRole('button', { name: enStrings.revoke.confirm }));

        await waitFor(() =>
            expect(services.revokeBadge).toHaveBeenCalledWith('user-1', 'streak_7')
        );
        await waitFor(() =>
            expect(toastSpies.success).toHaveBeenCalledWith(enStrings.awarded.successToast)
        );
    });
});

describe('StudentBadges — states', () => {
    it('shows the disabled banner when the institute master toggle is off', async () => {
        settings.getBadgesRewardsConfig.mockResolvedValue(config({ enabled: false }));
        renderTab();
        await awaitLoaded();
        expect(screen.getByRole('status')).toHaveTextContent(enStrings.disabledBanner.text);
    });

    it('hides the banner when badges are enabled', async () => {
        renderTab();
        await awaitLoaded();
        expect(screen.queryByText(enStrings.disabledBanner.text)).not.toBeInTheDocument();
    });

    it('shows the error state with a retry when loading fails', async () => {
        services.getStudentAwardedBadges.mockRejectedValueOnce(new Error('offline'));
        renderTab();
        expect(await screen.findByText(enStrings.loadError.title)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button'));
        await awaitLoaded();
        expect(services.getStudentAwardedBadges).toHaveBeenCalledTimes(2);
    });
});

describe('StudentBadges — create a new badge', () => {
    it('creates through the catalogue endpoint, selects the new badge and warns on duplicate names', async () => {
        services.createCatalogueBadge.mockResolvedValue({
            badge: badge({ id: 'badge_new', name: 'Most Improved', icon: 'Rocket' }),
            badges: [...CATALOGUE, badge({ id: 'badge_new', name: 'Most Improved' })],
            enabled: true,
        });
        renderTab();
        await awaitLoaded();

        fireEvent.click(screen.getByRole('button', { name: enStrings.picker.create }));
        const dialog = await screen.findByRole('dialog');
        expect(dialog).toHaveTextContent(enStrings.create.title);
        expect(dialog).toHaveTextContent(enStrings.create.hiddenHelp);

        const nameInput = within(dialog).getByPlaceholderText(enStrings.create.namePlaceholder);
        fireEvent.change(nameInput, { target: { value: 'helping hand ' } });
        expect(
            await within(dialog).findByText(
                translate('create.duplicateWarning', { name: 'Helping Hand' })
            )
        ).toBeInTheDocument();

        fireEvent.change(nameInput, { target: { value: 'Most Improved' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Use the Rocket icon' }));
        fireEvent.click(within(dialog).getByRole('switch'));
        fireEvent.click(within(dialog).getByRole('button', { name: enStrings.create.submit }));

        await waitFor(() => expect(services.createCatalogueBadge).toHaveBeenCalledTimes(1));
        expect(services.createCatalogueBadge.mock.calls[0]![0]).toEqual({
            name: 'Most Improved',
            description: '',
            icon: 'Rocket',
            hidden: true,
        });
        await waitFor(() =>
            expect(toastSpies.success).toHaveBeenCalledWith(
                translate('create.successToast', { name: 'Most Improved' })
            )
        );
        // The new badge is selected → its preview shows up in the award card.
        expect(await screen.findByText(enStrings.trigger.manual)).toBeInTheDocument();
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('keeps the dialog open and toasts when the server rejects the badge', async () => {
        services.createCatalogueBadge.mockRejectedValue(new Error('403'));
        renderTab();
        await awaitLoaded();

        fireEvent.click(screen.getByRole('button', { name: enStrings.picker.create }));
        const dialog = await screen.findByRole('dialog');
        fireEvent.change(within(dialog).getByPlaceholderText(enStrings.create.namePlaceholder), {
            target: { value: 'Top Helper' },
        });
        fireEvent.click(within(dialog).getByRole('button', { name: enStrings.create.submit }));

        await waitFor(() =>
            expect(toastSpies.error).toHaveBeenCalledWith(enStrings.create.errorToast)
        );
        expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('blocks an empty name inline without calling the server', async () => {
        renderTab();
        await awaitLoaded();
        fireEvent.click(screen.getByRole('button', { name: enStrings.picker.create }));
        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: enStrings.create.submit }));

        expect(await within(dialog).findByText(enStrings.create.nameRequired)).toBeInTheDocument();
        expect(services.createCatalogueBadge).not.toHaveBeenCalled();
    });
});
