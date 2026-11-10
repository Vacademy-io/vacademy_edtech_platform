import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_STUDENT_DISPLAY_SETTINGS } from '@/constants/display-settings/student-defaults';

// The server, as the settings endpoints see it.
let serverBody: unknown = '';
let failRead = false;
const order: string[] = [];
const get = vi.fn(async (_url: string, _config?: unknown) => {
    order.push('get');
    if (failRead) throw new Error('network');
    return { data: serverBody };
});
const post = vi.fn(async (_url: string, _body: unknown, _config?: unknown) => {
    order.push('post');
    return { data: 'Setting saved successfully' };
});
vi.mock('@/lib/auth/axiosInstance', () => ({
    default: {
        get: (...args: [string, unknown?]) => get(...args),
        post: (...args: [string, unknown, unknown?]) => post(...args),
    },
}));
vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-1' }));
vi.mock('@/constants/urls', () => ({ BASE_URL: 'https://backend.example.invalid' }));

const { keepLegacySkinReadable, legacySkinPatch } = await import('./legacy-skin');
const { fetchStudentDisplaySettingsForEdit } = await import('@/services/student-display-settings');

/** Every leaf path where two values differ. */
function differingPaths(a: unknown, b: unknown, at = ''): string[] {
    if (Object.is(a, b)) return [];
    if (a && b && typeof a === 'object' && typeof b === 'object') {
        const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
        return [...keys].flatMap((k) =>
            differingPaths(
                (a as Record<string, unknown>)[k],
                (b as Record<string, unknown>)[k],
                at ? `${at}.${k}` : k
            )
        );
    }
    return [at || '(root)'];
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** A real-looking saved blob whose values differ from every default the admin app has. */
function fullSaved(): Record<string, unknown> {
    const s = clone(DEFAULT_STUDENT_DISPLAY_SETTINGS) as unknown as Record<string, any>;
    s.ui = { type: 'vibrant' };
    s.permissions.canEditProfile = false;
    s.courseSettings.quiz.moveOnlyOnCorrectAnswer = true;
    s.signup.providers = {
        google: false,
        github: true,
        usernamePassword: false,
        emailOtp: true,
        defaultProvider: 'emailOtp',
    };
    s.signup.usernameStrategy = 'manual';
    s.sidebar.tabs = s.sidebar.tabs.map((t: { order: number }, i: number) => ({
        ...t,
        order: 100 - i,
    }));
    // Keys this admin build does not know must survive too.
    s.liveClasses = { showPastSessions: true };
    s.someFutureBlock = { nested: [1, 2, { deep: 'x' }] };
    return s;
}

const RAW_READS: Array<[string, unknown, Record<string, unknown> | null]> = [
    ['an empty body (never saved)', '', null],
    ['a null body', null, null],
    ['data: null', { key: 'STUDENT_DISPLAY_SETTINGS', name: 'x', data: null }, null],
    ['an empty object', { key: 'STUDENT_DISPLAY_SETTINGS', name: 'x', data: {} }, {}],
    [
        'a partial object',
        {
            key: 'STUDENT_DISPLAY_SETTINGS',
            name: 'x',
            data: { permissions: { canEditProfile: false }, ui: { type: 'default', extra: 1 } },
        },
        { permissions: { canEditProfile: false }, ui: { type: 'default', extra: 1 } },
    ],
    ['a full object', { key: 'STUDENT_DISPLAY_SETTINGS', name: 'x', data: fullSaved() }, fullSaved()],
];

function lastWritten(): Record<string, unknown> {
    const body = post.mock.calls.at(-1)![1] as { setting_data: Record<string, unknown> };
    return body.setting_data;
}

describe('choosing Fun writes only ui.type into what the server holds', () => {
    beforeEach(() => {
        get.mockClear();
        post.mockClear();
        order.length = 0;
        failRead = false;
    });

    for (const [name, body, held] of RAW_READS) {
        it(`with ${name}`, async () => {
            serverBody = clone(body);
            const written = await keepLegacySkinReadable('fun', 'default');
            expect(written).toBe('play');
            // Read from the server right before the write, never from a cache.
            expect(order).toEqual(['get', 'post']);
            expect(get.mock.calls[0]![1]).toEqual({
                params: { instituteId: 'inst-1', settingKey: 'STUDENT_DISPLAY_SETTINGS' },
            });
            const sent = lastWritten();
            if (held === null) {
                // Nothing saved: no defaults, only the one field.
                expect(sent).toEqual({ ui: { type: 'play' } });
            } else {
                // Field by field: everything but ui.type exactly as read.
                const { ui: heldUi, ...heldRest } = held;
                const { ui: sentUi, ...sentRest } = sent;
                expect(differingPaths(heldRest, sentRest)).toEqual([]);
                expect(differingPaths(heldUi ?? {}, sentUi)).toEqual(['type']);
                expect((sentUi as { type: string }).type).toBe('play');
            }
        });
    }

    it('reads again on every save, so a change made elsewhere since is kept', async () => {
        serverBody = { data: { ui: { type: 'default' }, permissions: { canEditProfile: false } } };
        await keepLegacySkinReadable('fun', 'default');
        serverBody = { data: { ui: { type: 'default' }, permissions: { canEditProfile: true } } };
        await keepLegacySkinReadable('fun', 'default');
        expect(get).toHaveBeenCalledTimes(2);
        expect(lastWritten()).toEqual({
            ui: { type: 'play' },
            permissions: { canEditProfile: true },
        });
    });

    it('writes nothing when the server already holds the fallback', async () => {
        serverBody = { data: { ui: { type: 'play' }, permissions: { canEditProfile: false } } };
        expect(await keepLegacySkinReadable('fun', null)).toBeNull();
        expect(post).not.toHaveBeenCalled();
    });

    it('writes nothing when the read fails or holds something it cannot read', async () => {
        failRead = true;
        await expect(keepLegacySkinReadable('fun', null)).rejects.toThrow();
        failRead = false;
        serverBody = { data: 'not an object' };
        await expect(keepLegacySkinReadable('fun', null)).rejects.toThrow();
        serverBody = { data: [1, 2] };
        await expect(keepLegacySkinReadable('fun', null)).rejects.toThrow();
        expect(post).not.toHaveBeenCalled();
    });
});

describe('leaving Fun', () => {
    beforeEach(() => {
        get.mockClear();
        post.mockClear();
        order.length = 0;
        failRead = false;
    });

    it('replaces only the fallback it wrote, keeping every other field', async () => {
        const held = { ...fullSaved(), ui: { type: 'play' } };
        serverBody = { data: clone(held) };
        expect(await keepLegacySkinReadable('vibrant', 'fun')).toBe('vibrant');
        expect(differingPaths(held, lastWritten())).toEqual(['ui.type']);
        expect((lastWritten().ui as { type: string }).type).toBe('vibrant');
    });

    it('writes nothing where there is nothing of its own to undo', async () => {
        for (const body of [
            '',
            { data: null },
            { data: {} },
            { data: { ui: { type: 'default' } } },
            { data: { permissions: { canEditProfile: false } } },
        ]) {
            serverBody = body;
            expect(await keepLegacySkinReadable('corporate', 'fun')).toBeNull();
        }
        // Moving to Play itself: the fallback already says so.
        serverBody = { data: { ui: { type: 'play' } } };
        expect(await keepLegacySkinReadable('play', 'fun')).toBeNull();
        expect(post).not.toHaveBeenCalled();
    });

    it('never reads or writes for a change between the existing skins', async () => {
        for (const skin of ['default', 'vibrant', 'play', 'cleanerPlay', 'corporate'] as const) {
            for (const before of [null, 'default', 'play', 'cleanerPlay', 'corporate'] as const) {
                expect(await keepLegacySkinReadable(skin, before)).toBeNull();
            }
        }
        expect(get).not.toHaveBeenCalled();
        expect(post).not.toHaveBeenCalled();
    });
});

describe('legacySkinPatch', () => {
    it('never fills in a default', () => {
        expect(legacySkinPatch(null, 'play', false)).toEqual({ ui: { type: 'play' } });
        expect(legacySkinPatch({ a: 1 }, 'play', false)).toEqual({
            a: 1,
            ui: { type: 'play' },
        });
        // A ui that is not an object is replaced by one holding only the type.
        expect(legacySkinPatch({ ui: 'x' }, 'play', false)).toEqual({ ui: { type: 'play' } });
    });
});

describe('the admin app reads an object holding only ui.type as it reads nothing saved', () => {
    it('apart from ui.type itself', async () => {
        serverBody = '';
        const nothing = await fetchStudentDisplaySettingsForEdit();
        serverBody = { data: { ui: { type: 'play' } } };
        const partial = await fetchStudentDisplaySettingsForEdit();
        expect(differingPaths(nothing, partial)).toEqual(['ui.type']);
    });
});
