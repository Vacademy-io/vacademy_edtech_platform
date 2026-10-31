import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import enDialog from '../../../../../../../../public/locales/en/manageStudentsBulkAwardBadge.json';
import enBadges from '../../../../../../../../public/locales/en/manageStudentsBadges.json';
import enMenu from '../../../../../../../../public/locales/en/manageStudentsBulkActionsMenu.json';
import type { AwardBadgeResponse } from '@/services/student-badges';
import type { BadgesRewardsState } from '@/routes/settings/-services/badges-settings';
import type { BadgeDefinitionConfig } from '@/routes/settings/-constants/badge-config';
import type { StudentTable } from '@/types/student-table-types';

/**
 * Resolves t() against the REAL en catalogues per namespace, including i18next's `_one` /
 * `_other` plural suffixes, so a key the component uses but the JSON lacks shows up as a raw
 * dotted key and fails the "no raw keys" assertion.
 */
const CATALOGUES: Record<string, unknown> = {
    manageStudentsBulkAwardBadge: enDialog,
    manageStudentsBadges: enBadges,
    manageStudentsBulkActionsMenu: enMenu,
};

function translateFor(ns: string) {
    const lookup = (path: string) =>
        path.split('.').reduce<unknown>((node, part) => {
            if (node && typeof node === 'object') return (node as Record<string, unknown>)[part];
            return undefined;
        }, CATALOGUES[ns]);
    return (key: string, vars?: Record<string, unknown>): string => {
        let value: unknown;
        if (typeof vars?.count === 'number') {
            value = lookup(`${key}_${vars.count === 1 ? 'one' : 'other'}`);
        }
        if (typeof value !== 'string') value = lookup(key);
        if (typeof value !== 'string') {
            return typeof vars?.defaultValue === 'string' ? vars.defaultValue : key;
        }
        return value.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(vars?.[name] ?? ''));
    };
}

vi.mock('react-i18next', () => ({
    useTranslation: (ns: string) => ({ t: translateFor(ns) }),
}));

const toastSpies = vi.hoisted(() => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: toastSpies }));

const services = vi.hoisted(() => ({
    awardBadge: vi.fn(),
    getStudentAwardedBadges: vi.fn(),
    revokeBadge: vi.fn(),
    createCatalogueBadge: vi.fn(),
}));
vi.mock('@/services/student-badges', () => ({
    ...services,
    awardSource: (a: { source?: string | null }) => (a.source === 'AUTO' ? 'AUTO' : 'MANUAL'),
    AWARD_BATCH_LIMIT: 500,
}));

const settings = vi.hoisted(() => ({ getBadgesRewardsConfig: vi.fn() }));
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

const navigate = vi.hoisted(() => vi.fn());
vi.mock('@tanstack/react-router', () => ({
    useRouter: () => ({ navigate }),
}));

const openBulkAcceptRequestDialog = vi.hoisted(() => vi.fn());
vi.mock(
    '@/routes/manage-students/enroll-requests/-components/bulk-actions/bulk-actions-store',
    () => ({
        useEnrollRequestsDialogStore: () => ({ openBulkAcceptRequestDialog }),
    })
);

import { useDialogStore } from '@/routes/manage-students/students-list/-hooks/useDialogStore';
import { BulkAwardBadgeDialog, AWARD_CHUNK_SIZE, chunk } from './bulk-award-badge-dialog';
import { BulkActionsMenu } from './bulk-actions-menu';

const student = (n: number, over: Partial<StudentTable> = {}): StudentTable =>
    ({
        id: `row-${n}`,
        user_id: `user-${n}`,
        full_name: `Learner ${n}`,
        package_session_id: 'ps-1',
        ...over,
    }) as unknown as StudentTable;

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

const envelope = (over: Partial<AwardBadgeResponse> = {}): AwardBadgeResponse => ({
    results: [],
    awardedCount: 0,
    alreadyHadCount: 0,
    upgradedCount: 0,
    notEnrolledCount: 0,
    notified: true,
    ...over,
});

/** Envelope that mirrors the chunk it was asked for (N learners → N NEW). */
const echoNew = (payload: { userIds: string[] }) =>
    envelope({ awardedCount: payload.userIds.length });

function openStoreWith(students: StudentTable[]) {
    useDialogStore.setState({
        isAwardBadgeOpen: true,
        isBulkAction: true,
        bulkActionInfo: {
            selectedStudentIds: students.map((s) => s.id),
            selectedStudents: students,
            displayText: `${students.length} students`,
        },
    });
}

function renderDialog() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <BulkAwardBadgeDialog />
        </QueryClientProvider>
    );
}

const awaitCatalogue = () =>
    waitFor(() =>
        expect(screen.getByRole('combobox', { name: enBadges.picker.label })).toBeInTheDocument()
    );

const pickBadge = async (name: string) => {
    await awaitCatalogue();
    const trigger = screen.getByRole('combobox', { name: enBadges.picker.label });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    const option = await screen.findByRole('option', { name: new RegExp(name) });
    fireEvent.keyDown(option, { key: 'Enter' });
};

const awardButton = (count: number) =>
    screen.getByRole('button', {
        name: translateFor('manageStudentsBulkAwardBadge')('footer.award', { count }),
    });

beforeEach(() => {
    Object.values(toastSpies).forEach((spy) => spy.mockReset());
    services.awardBadge.mockReset().mockImplementation(async (p) => echoNew(p));
    settings.getBadgesRewardsConfig.mockReset().mockResolvedValue(config());
    userDetails.isUserAdmin.mockReset().mockReturnValue(true);
    useDialogStore.getState().closeAllDialogs();
});

describe('chunk()', () => {
    it('splits 60 ids into 25 / 25 / 10 at the dialog chunk size', () => {
        const ids = Array.from({ length: 60 }, (_, i) => `u${i}`);
        const parts = chunk(ids, AWARD_CHUNK_SIZE);
        expect(AWARD_CHUNK_SIZE).toBe(25);
        expect(parts.map((p) => p.length)).toEqual([25, 25, 10]);
        expect(parts.flat()).toEqual(ids);
        expect(chunk([], 25)).toEqual([]);
    });
});

describe('BulkAwardBadgeDialog — chunking + aggregation', () => {
    it('awards 60 deduped learners in 3 sequential POSTs and aggregates the counts', async () => {
        // 62 rows: learner 3 and learner 7 each appear in two batches → 60 unique user ids.
        const rows = [
            ...Array.from({ length: 60 }, (_, i) => student(i + 1)),
            student(3, { id: 'row-3-dup', package_session_id: 'ps-2' }),
            student(7, { id: 'row-7-dup', package_session_id: 'ps-2' }),
        ];
        let call = 0;
        services.awardBadge.mockImplementation(async (p: { userIds: string[] }) => {
            call += 1;
            // Chunk 1: all new. Chunk 2: 5 already held it, 5 upgraded from auto, rest new,
            // and this chunk reports the notify toggle off. Chunk 3: all new.
            if (call === 2) {
                return envelope({
                    awardedCount: p.userIds.length - 10,
                    alreadyHadCount: 5,
                    upgradedCount: 5,
                    notified: false,
                });
            }
            return echoNew(p);
        });

        openStoreWith(rows);
        renderDialog();

        expect(
            screen.getByText(enDialog.intro_other.replace('{{count}}', '60'))
        ).toBeInTheDocument();
        expect(
            screen.getByText(enDialog.duplicateRowsHint_other.replace('{{count}}', '2'))
        ).toBeInTheDocument();

        await pickBadge('Helping Hand');
        fireEvent.change(screen.getByLabelText(enDialog.noteLabel), {
            target: { value: '  Great teamwork  ' },
        });
        fireEvent.click(awardButton(60));

        await waitFor(() => expect(services.awardBadge).toHaveBeenCalledTimes(3));
        const calls = services.awardBadge.mock.calls.map((c) => c[0] as { userIds: string[] });
        expect(calls.map((c) => c.userIds.length)).toEqual([25, 25, 10]);
        expect(new Set(calls.flatMap((c) => c.userIds)).size).toBe(60);
        expect(calls[0]).toMatchObject({
            badgeId: 'helping_hand',
            badgeName: 'Helping Hand',
            badgeIcon: 'Star',
            badgeDescription: 'Helps classmates',
            reason: 'Great teamwork',
        });

        // Results step: 25 + 15 + 10 new, 5 upgraded, 5 already had, nothing failed.
        await screen.findByText(enDialog.results.awarded_other.replace('{{count}}', '50'));
        expect(
            screen.getByText(enDialog.results.upgraded_other.replace('{{count}}', '5'))
        ).toBeInTheDocument();
        expect(
            screen.getByText(enDialog.results.alreadyHad_other.replace('{{count}}', '5'))
        ).toBeInTheDocument();
        expect(screen.queryByText(/could not be awarded/)).not.toBeInTheDocument();
        // One chunk said notified=false → the whole run is reported as not notified.
        expect(screen.getByText(enDialog.results.notNotified)).toBeInTheDocument();
        expect(toastSpies.success).toHaveBeenCalledWith(
            enDialog.toasts.success_other.replace('{{count}}', '55')
        );
        expect(toastSpies.info).toHaveBeenCalledWith(enDialog.toasts.notNotified);
        expect(toastSpies.error).not.toHaveBeenCalled();

        expect(document.body.textContent).not.toMatch(
            /\b(intro|footer|results|running|toasts|picker|preview|noteLabel|disabledBanner)[._][a-zA-Z]/
        );

        // Done closes everything via the shared store.
        fireEvent.click(screen.getByRole('button', { name: enDialog.footer.done }));
        expect(useDialogStore.getState().isAwardBadgeOpen).toBe(false);
        expect(useDialogStore.getState().bulkActionInfo).toBeNull();
    });

    it('keeps going after a failed chunk, counts its learners as failed and toasts once', async () => {
        let call = 0;
        services.awardBadge.mockImplementation(async (p: { userIds: string[] }) => {
            call += 1;
            if (call === 2) throw new Error('boom');
            return echoNew(p);
        });
        openStoreWith(Array.from({ length: 30 }, (_, i) => student(i + 1)));
        renderDialog();

        await pickBadge('On Fire');
        fireEvent.click(awardButton(30));

        await screen.findByText(enDialog.results.awarded_other.replace('{{count}}', '25'));
        expect(services.awardBadge).toHaveBeenCalledTimes(2);
        expect(
            screen.getByText(enDialog.results.failed_other.replace('{{count}}', '5'))
        ).toBeInTheDocument();
        expect(toastSpies.error).toHaveBeenCalledTimes(1);
        expect(toastSpies.error).toHaveBeenCalledWith(
            enDialog.toasts.partialFailure_other.replace('{{count}}', '5')
        );
        expect(toastSpies.success).toHaveBeenCalledWith(
            enDialog.toasts.success_other.replace('{{count}}', '25')
        );
    });

    it('blocks closing while requests are in flight, then allows it on the results step', async () => {
        let resolveFirst: (v: AwardBadgeResponse) => void = () => {};
        services.awardBadge.mockImplementation(
            (p: { userIds: string[] }) =>
                new Promise<AwardBadgeResponse>((resolve) => {
                    resolveFirst = () => resolve(echoNew(p));
                })
        );
        openStoreWith([student(1), student(2)]);
        renderDialog();

        await pickBadge('Helping Hand');
        fireEvent.click(awardButton(2));

        await screen.findByText(enDialog.running.title);
        expect(
            screen.getByText(
                enDialog.running.progress.replace('{{done}}', '0').replace('{{total}}', '2')
            )
        ).toBeInTheDocument();

        // Escape and the X button both route through onOpenChange(false) — ignored while running.
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
        fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
        expect(useDialogStore.getState().isAwardBadgeOpen).toBe(true);
        expect(screen.getByText(enDialog.running.title)).toBeInTheDocument();

        await act(async () => {
            resolveFirst(envelope());
        });
        await screen.findByText(enDialog.results.awarded_other.replace('{{count}}', '2'));
        fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
        expect(useDialogStore.getState().isAwardBadgeOpen).toBe(false);
    });

    it('reports "nothing new" when every learner already held the badge', async () => {
        services.awardBadge.mockResolvedValue(envelope({ alreadyHadCount: 2 }));
        openStoreWith([student(1), student(2)]);
        renderDialog();

        await pickBadge('Helping Hand');
        fireEvent.click(awardButton(2));

        await screen.findByText(enDialog.results.alreadyHad_other.replace('{{count}}', '2'));
        expect(toastSpies.info).toHaveBeenCalledWith(enDialog.toasts.nothingNew);
        expect(toastSpies.success).not.toHaveBeenCalled();
        // No notification line when nothing changed.
        expect(screen.queryByText(enDialog.results.notified)).not.toBeInTheDocument();
    });
});

describe('BulkAwardBadgeDialog — pick step', () => {
    it('shows the warning banner when the master toggle is off, and hides it when on', async () => {
        settings.getBadgesRewardsConfig.mockResolvedValue(config({ enabled: false }));
        openStoreWith([student(1)]);
        const { unmount } = renderDialog();
        await awaitCatalogue();
        expect(screen.getByRole('status')).toHaveTextContent(enDialog.disabledBanner);
        unmount();

        settings.getBadgesRewardsConfig.mockResolvedValue(config({ enabled: true }));
        openStoreWith([student(1)]);
        renderDialog();
        await awaitCatalogue();
        expect(screen.queryByText(enDialog.disabledBanner)).not.toBeInTheDocument();
    });

    it('disables Award until a badge is picked, skips disabled catalogue entries, shows the preview chip', async () => {
        openStoreWith([student(1)]);
        renderDialog();
        await awaitCatalogue();
        expect(awardButton(1)).toBeDisabled();

        await pickBadge('On Fire');
        expect(awardButton(1)).toBeEnabled();
        expect(screen.getByText('Daily streak · 7 days')).toBeInTheDocument();

        const trigger = screen.getByRole('combobox', { name: enBadges.picker.label });
        fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
        const listbox = await screen.findByRole('listbox');
        expect(listbox).not.toHaveTextContent('Retired');
    });

    it('offers "Create a new badge" only to institute admins', async () => {
        openStoreWith([student(1)]);
        const { unmount } = renderDialog();
        await awaitCatalogue();
        expect(screen.getByRole('button', { name: enBadges.picker.create })).toBeInTheDocument();
        unmount();

        userDetails.isUserAdmin.mockReturnValue(false);
        openStoreWith([student(1)]);
        renderDialog();
        await awaitCatalogue();
        expect(
            screen.queryByRole('button', { name: enBadges.picker.create })
        ).not.toBeInTheDocument();
    });
});

describe('BulkActionsMenu — Award Badge entry', () => {
    const renderMenu = (students: StudentTable[]) => {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        return render(
            <QueryClientProvider client={client}>
                <BulkActionsMenu
                    selectedCount={students.length}
                    selectedStudentIds={students.map((s) => s.id)}
                    selectedStudents={students}
                    trigger={<span>Bulk actions</span>}
                />
            </QueryClientProvider>
        );
    };

    const openMenu = async () => {
        const trigger = screen.getByText('Bulk actions');
        fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
        await screen.findByRole('menu');
    };

    it('lists Award Badge and opens the dialog (mounted inside the menu) with the selection', async () => {
        // An audience-only contact (no package session) is still eligible: awards are
        // person-scoped, so only rows without a user account are excluded.
        const students = [
            student(1),
            student(2, { package_session_id: null as unknown as string }),
            student(3, { user_id: '' }),
        ];
        renderMenu(students);

        await openMenu();
        const item = screen.getByRole('menuitem', { name: enMenu.menu.awardBadge });
        expect(item).toBeInTheDocument();
        fireEvent.click(item);

        const state = useDialogStore.getState();
        expect(state.isAwardBadgeOpen).toBe(true);
        expect(state.isBulkAction).toBe(true);
        expect(state.bulkActionInfo?.selectedStudents.map((s) => s.user_id)).toEqual([
            'user-1',
            'user-2',
        ]);
        expect(toastSpies.warning).toHaveBeenCalledWith(enMenu.errors.someNoAccount_one);

        // The dialog is a sibling of the dropdown, so it appears without any page-level mount.
        await screen.findByRole('dialog');
        expect(screen.getByText(enDialog.dialogTitle)).toBeInTheDocument();
        expect(
            screen.getByText(enDialog.intro_other.replace('{{count}}', '2'))
        ).toBeInTheDocument();
    });
});
