import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// The `t` used here is backed by the REAL en locale file, so a key this screen renders but the
// locale never defines shows up as the raw `rejection.title` string — which is exactly how it
// would look to an institute admin, and exactly what an assertion on English copy will catch.
vi.mock('react-i18next', async () => {
    const en = (await import('../../../../../../public/locales/en/settingsAppStatus.json'))
        .default as Record<string, unknown>;

    const translate = (key: string, vars?: Record<string, unknown>) => {
        const value = key
            .split('.')
            .reduce<unknown>(
                (acc, part) =>
                    acc && typeof acc === 'object'
                        ? (acc as Record<string, unknown>)[part]
                        : undefined,
                en
            );
        if (typeof value !== 'string') return key;
        return value.replace(/{{(\w+)}}/g, (_, name: string) => String(vars?.[name] ?? ''));
    };

    return { useTranslation: () => ({ t: translate }) };
});

vi.mock('@/constants/helper', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/constants/helper')>();
    return { ...actual, getInstituteId: () => 'inst-1' };
});

vi.mock('@/lib/auth/axiosInstance', () => ({ default: { get: vi.fn() } }));

import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import AppStatusSettings, {
    formatRegistryDate,
    formatSyncedAt,
    versionLabel,
} from '@/routes/settings/-components/AppStatusSettings';

const get = authenticatedAxiosInstance.get as unknown as Mock;

/**
 * The screen formats dates in the viewer's own locale, so an assertion may not hard-code one
 * rendering of 22 Aug 2026 — CI and a browser in Delhi would disagree. Build the expectation with
 * the same formatter the screen uses; what is being asserted is the copy around it.
 */
const line = (prefix: string, iso: string) =>
    new RegExp(`${prefix} ${formatRegistryDate(iso)}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

/** One Android platform block, with only the fields a case actually cares about. */
const platform = (overrides: Record<string, unknown> = {}) => ({
    platform: 'ANDROID',
    enabled: true,
    status: 'LIVE',
    store_url: '',
    current_version: '2.4.5',
    current_build: '245',
    released_at: '',
    last_synced_at: '',
    ...overrides,
});

const respondWith = (platforms: Array<Record<string, unknown>>) => {
    get.mockResolvedValue({
        data: {
            institute_id: 'inst-1',
            apps: [
                {
                    id: 'app-1',
                    name: 'Shiksha Nation',
                    display_name: 'Shiksha Nation',
                    package_name: 'com.vacademy.sn',
                    platforms,
                },
            ],
        },
    });
};

describe('AppStatusSettings — what an institute sees about its own app', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('shows the app, its package and the live version', async () => {
        respondWith([platform()]);
        render(<AppStatusSettings />);

        expect(await screen.findByText('Shiksha Nation')).toBeInTheDocument();
        expect(screen.getByText('com.vacademy.sn')).toBeInTheDocument();
        expect(screen.getByText('2.4.5 (245)')).toBeInTheDocument();
        expect(screen.getByText('Live')).toBeInTheDocument();
    });

    it('tells an institute with no app yet that there is nothing to see, not that it broke', async () => {
        get.mockResolvedValue({ data: { institute_id: 'inst-1', apps: [] } });
        render(<AppStatusSettings />);

        expect(await screen.findByText('No app registered yet')).toBeInTheDocument();
    });

    it('surfaces the failure instead of an empty screen when the call fails', async () => {
        get.mockRejectedValue(new Error('boom'));
        render(<AppStatusSettings />);

        expect(
            await screen.findByText(
                'Could not load app status right now. Try refreshing in a moment.'
            )
        ).toBeInTheDocument();
        expect(screen.queryByText('No app registered yet')).not.toBeInTheDocument();
    });

    describe('release track', () => {
        it('says which track a build is on, so "Live" is not read as publicly downloadable', async () => {
            respondWith([platform({ track: 'Closed testing' })]);
            render(<AppStatusSettings />);

            expect(await screen.findByText('Closed testing')).toBeInTheDocument();
            expect(screen.getByText('Live')).toBeInTheDocument();
        });

        it('shows no track chip at all when ops never recorded one', async () => {
            respondWith([platform()]);
            render(<AppStatusSettings />);

            await screen.findByText('Live');
            expect(screen.queryByText('Production')).not.toBeInTheDocument();
        });
    });

    describe('the store id each platform ships under', () => {
        it('shows an iOS bundle id that differs from the app package name', async () => {
            respondWith([platform({ platform: 'IOS', app_id: 'io.vacademy.sn' })]);
            render(<AppStatusSettings />);

            expect(await screen.findByText('io.vacademy.sn')).toBeInTheDocument();
        });

        it('does not repeat the id already printed under the app name', async () => {
            respondWith([platform({ app_id: 'com.vacademy.sn' })]);
            render(<AppStatusSettings />);

            await screen.findByText('Live');
            // Once, in the card header — not a second time on the Android row.
            expect(screen.getAllByText('com.vacademy.sn')).toHaveLength(1);
        });
    });

    describe('desktop platforms', () => {
        it('shows no OTA line on Windows or macOS — those shells never receive a bundle', async () => {
            respondWith([
                platform({ platform: 'MACOS', app_id: 'io.zoeedtech.app', ota: null }),
                platform({ platform: 'WINDOWS', app_id: 'ShikshaNation.ZOEEdtech', ota: null }),
            ]);
            render(<AppStatusSettings />);

            await screen.findByText('macOS');
            expect(screen.getByText('Windows')).toBeInTheDocument();
            expect(screen.queryByText('App content (OTA)')).not.toBeInTheDocument();
            expect(screen.queryByText(/shared bundle/)).not.toBeInTheDocument();
        });
    });

    describe('how fresh the status is', () => {
        it('says when the store was last checked, so a stale reading is visible as one', async () => {
            respondWith([platform({ last_synced_at: '2026-08-31T06:10:00Z' })]);
            render(<AppStatusSettings />);

            await screen.findByText('Live');
            expect(
                screen.getByText(
                    new RegExp(`Store checked ${formatSyncedAt('2026-08-31T06:10:00Z')}`)
                )
            ).toBeInTheDocument();
        });

        it('says nothing at all when no sync has ever reached the store', async () => {
            respondWith([platform({ last_synced_at: '' })]);
            render(<AppStatusSettings />);

            await screen.findByText('Live');
            expect(screen.queryByText(/Store checked/)).not.toBeInTheDocument();
        });

        it('drops an unparseable timestamp rather than printing Invalid Date', async () => {
            respondWith([platform({ last_synced_at: 'whenever' })]);
            render(<AppStatusSettings />);

            await screen.findByText('Live');
            expect(screen.queryByText(/Store checked/)).not.toBeInTheDocument();
        });
    });

    describe('the OTA bundle the app is actually running', () => {
        const ota = (overrides: Record<string, unknown> = {}) => ({
            version: '2.5.6',
            published_at: '2026-08-26T00:00:00Z',
            release_notes: '',
            min_native_version: '1.0.0',
            force_update: false,
            shared_bundle: false,
            ...overrides,
        });

        it('shows the bundle version and when it was published, next to the store version', async () => {
            respondWith([platform({ ota: ota() })]);
            render(<AppStatusSettings />);

            expect(await screen.findByText('App content (OTA)')).toBeInTheDocument();
            expect(screen.getByText('2.5.6')).toBeInTheDocument();
            expect(screen.getByText(line('published', '2026-08-26T00:00:00Z'))).toBeInTheDocument();
            // The store shell and the bundle inside it are different numbers, and both are shown.
            expect(screen.getByText('2.4.5 (245)')).toBeInTheDocument();
        });

        it('says nothing about OTA when no bundle serves this app', async () => {
            respondWith([platform()]);
            render(<AppStatusSettings />);

            await screen.findByText('Live');
            expect(screen.queryByText('App content (OTA)')).not.toBeInTheDocument();
        });

        it('flags a bundle that was never built for this app', async () => {
            respondWith([platform({ ota: ota({ shared_bundle: true }) })]);
            render(<AppStatusSettings />);

            expect(
                await screen.findByText(/shared bundle, not built for your app/)
            ).toBeInTheDocument();
        });

        it('mentions the native floor only when it is not the default every bundle carries', async () => {
            respondWith([platform({ ota: ota({ min_native_version: '2.0.0' }) })]);
            render(<AppStatusSettings />);

            expect(await screen.findByText(/needs app version 2.0.0 or newer/)).toBeInTheDocument();
        });

        it('does not print the 1.0.0 floor every bundle carries', async () => {
            respondWith([platform({ ota: ota() })]);
            render(<AppStatusSettings />);

            await screen.findByText('App content (OTA)');
            expect(screen.queryByText(/needs app version/)).not.toBeInTheDocument();
        });
    });

    describe('rejections', () => {
        it('spells out the store‑cited reason, the build and when it was decided', async () => {
            respondWith([
                platform({
                    status: 'REJECTED',
                    rejection: {
                        version: '2.5.0',
                        build: '250',
                        reason: 'Guideline 5.1.1 — account deletion missing',
                        submitted_at: '2026-08-20',
                        decided_at: '2026-08-22',
                    },
                }),
            ]);
            render(<AppStatusSettings />);

            expect(await screen.findByText('Rejected by the store')).toBeInTheDocument();
            expect(
                screen.getByText(/Guideline 5.1.1 — account deletion missing/)
            ).toBeInTheDocument();
            expect(screen.getByText('2.5.0 (250)')).toBeInTheDocument();
            expect(screen.getByText(line('Rejected on', '2026-08-22'))).toBeInTheDocument();
        });

        it('falls back to the submitted date when the store never told us when it decided', async () => {
            // Apple's shape: App Store Connect reports that a submission has unresolved issues and
            // when it went in, but never when review decided against it.
            respondWith([
                platform({
                    status: 'REJECTED',
                    rejection: {
                        version: '1.0.5',
                        build: '',
                        reason: '',
                        submitted_at: '2026-05-31T13:15:08Z',
                        decided_at: '',
                    },
                }),
            ]);
            render(<AppStatusSettings />);

            expect(await screen.findByText('Rejected by the store')).toBeInTheDocument();
            expect(screen.getByText(line('Submitted', '2026-05-31T13:15:08Z'))).toBeInTheDocument();
        });

        it('says the reason is not recorded yet rather than showing an empty box', async () => {
            respondWith([
                platform({
                    status: 'REJECTED',
                    rejection: {
                        version: '',
                        build: '',
                        reason: '',
                        submitted_at: '',
                        decided_at: '',
                    },
                }),
            ]);
            render(<AppStatusSettings />);

            expect(await screen.findByText('Rejected by the store')).toBeInTheDocument();
            expect(
                screen.getByText(
                    "The store's reason hasn't been recorded yet — the platform team is following it up."
                )
            ).toBeInTheDocument();
        });

        it('shows no rejection banner when there is no rejection', async () => {
            respondWith([platform()]);
            render(<AppStatusSettings />);

            await screen.findByText('Shiksha Nation');
            expect(screen.queryByText('Rejected by the store')).not.toBeInTheDocument();
        });
    });

    describe('updates', () => {
        it('shows the build in flight with its status and release notes', async () => {
            respondWith([
                platform({
                    update_available: true,
                    pending_update: {
                        version: '2.5.1',
                        build: '251',
                        status: 'IN_REVIEW',
                        release_notes: 'Attendance fixes and a faster login',
                        submitted_at: '2026-08-27',
                        ota_status: 'PENDING',
                    },
                }),
            ]);
            render(<AppStatusSettings />);

            expect(await screen.findByText('Update in progress')).toBeInTheDocument();
            expect(screen.getByText('2.5.1 (251)')).toBeInTheDocument();
            expect(screen.getByText('In Review')).toBeInTheDocument();
            expect(screen.getByText(/Attendance fixes and a faster login/)).toBeInTheDocument();
            expect(screen.getByText(line('Submitted', '2026-08-27'))).toBeInTheDocument();
        });

        it('mentions a newer build even when no submission is on record for it', async () => {
            respondWith([platform({ update_available: true })]);
            render(<AppStatusSettings />);

            expect(
                await screen.findByText('A newer build is ready and not on the store yet.')
            ).toBeInTheDocument();
            expect(screen.queryByText('Update in progress')).not.toBeInTheDocument();
        });

        it('does not repeat the generic line once the real update is shown', async () => {
            respondWith([
                platform({
                    update_available: true,
                    pending_update: {
                        version: '2.5.1',
                        build: '',
                        status: 'SUBMITTED',
                        release_notes: '',
                        submitted_at: '',
                        ota_status: 'NONE',
                    },
                }),
            ]);
            render(<AppStatusSettings />);

            await screen.findByText('Update in progress');
            expect(
                screen.queryByText('A newer build is ready and not on the store yet.')
            ).not.toBeInTheDocument();
        });
    });

    describe('responses this build did not expect', () => {
        it('renders a platform it has no icon for instead of blanking the page', async () => {
            respondWith([platform({ platform: 'LINUX', status: 'DRAFT' })]);
            render(<AppStatusSettings />);

            expect(await screen.findByText('LINUX')).toBeInTheDocument();
            expect(screen.getByText('Draft')).toBeInTheDocument();
        });

        it('survives an older backend that sends no rejection or update fields at all', async () => {
            get.mockResolvedValue({
                data: {
                    institute_id: 'inst-1',
                    apps: [{ id: 'app-1', name: 'Legacy', display_name: '', package_name: '' }],
                },
            });
            render(<AppStatusSettings />);

            expect(await screen.findByText('Legacy')).toBeInTheDocument();
            expect(screen.getByText('No platforms enabled for this app yet.')).toBeInTheDocument();
        });

        it('falls back to a placeholder when the app has no name at all', async () => {
            get.mockResolvedValue({
                data: {
                    institute_id: 'inst-1',
                    apps: [
                        {
                            id: 'app-1',
                            name: '',
                            display_name: '',
                            package_name: '',
                            platforms: [],
                        },
                    ],
                },
            });
            render(<AppStatusSettings />);

            expect(await screen.findByText('Untitled app')).toBeInTheDocument();
        });

        it('reads the institute id off the session, never off the response', async () => {
            respondWith([platform()]);
            render(<AppStatusSettings />);

            await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
            expect(String(get.mock.calls[0][0])).toContain('instituteId=inst-1');
        });
    });
});

describe('formatRegistryDate', () => {
    it('renders nothing for a date nobody recorded', () => {
        expect(formatRegistryDate('')).toBe('');
        expect(formatRegistryDate(undefined)).toBe('');
        expect(formatRegistryDate(null)).toBe('');
    });

    it('reads a bare ops-typed date as that calendar day, in every timezone', () => {
        // Regression: `new Date('2026-08-22')` is UTC midnight, so this read 21 Aug for any viewer
        // behind UTC. Runs green under TZ=America/Los_Angeles as well as IST.
        const formatted = formatRegistryDate('2026-08-22');
        expect(formatted).toContain('2026');
        expect(formatted).toContain('22');
        expect(formatted).not.toBe('2026-08-22');
        expect(formatted).not.toContain('Invalid');
    });

    it('formats the ISO timestamp a live store sync writes', () => {
        // Only the year is asserted: this one IS an instant, so its local calendar day legitimately
        // differs by timezone and pinning it would just re-create the bug above in the test.
        const formatted = formatRegistryDate('2026-08-22T10:15:00Z');
        expect(formatted).toContain('2026');
        expect(formatted).not.toBe('2026-08-22T10:15:00Z');
        expect(formatted).not.toContain('Invalid');
    });

    it('shows whatever was stored rather than the words "Invalid Date"', () => {
        expect(formatRegistryDate('sometime last week')).toBe('sometime last week');
    });
});

describe('versionLabel', () => {
    it('pairs the version with its build', () => {
        expect(versionLabel('2.5.1', '251')).toBe('2.5.1 (251)');
    });

    it('drops whichever half was never recorded', () => {
        expect(versionLabel('2.5.1', '')).toBe('2.5.1');
        expect(versionLabel('', '251')).toBe('(251)');
        expect(versionLabel('', '')).toBe('');
    });
});
