import { describe, expect, it } from 'vitest';
import {
    INSTITUTE_SCOPED_STORAGE_KEYS,
    canOfferInstituteSwitch,
    clearInstituteScopedStorage,
    filterInstitutesByQuery,
    formatRoleName,
    getEligibleInstitutes,
    getInstituteScopedStorageKeys,
    getRoleLabelParts,
    restoreInstituteScopedStorage,
} from '@/lib/auth/instituteSwitch';

/** Minimal Storage with real key()/length semantics (Node's global one is unconfigured here). */
const memoryStorage = (initial: Record<string, string> = {}) => {
    const map = new Map(Object.entries(initial));
    return {
        get length() {
            return map.size;
        },
        key: (i: number) => Array.from(map.keys())[i] ?? null,
        getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
        setItem: (k: string, v: string) => void map.set(k, String(v)),
        removeItem: (k: string) => void map.delete(k),
        dump: () => Object.fromEntries(map),
    };
};

describe('getEligibleInstitutes', () => {
    const authorities = {
        'inst-admin': { roles: ['ADMIN'], permissions: [] },
        'inst-learner': { roles: ['STUDENT'], permissions: [] },
        'inst-none': { roles: [], permissions: [] },
        'inst-counsellor': {
            roles: ['STUDENT', 'COUNSELLOR'],
            permissions: ['HAS_FACULTY_ASSIGNED'],
        },
        'inst-teacher': { roles: ['TEACHER'], permissions: [] },
    };

    it('keeps staff institutes in token order and drops learner-only / role-less ones', () => {
        const result = getEligibleInstitutes(authorities);
        expect(result.map((i) => i.id)).toEqual(['inst-admin', 'inst-counsellor', 'inst-teacher']);
    });

    it('ranks the primary role like the login picker (ADMIN, else first non-STUDENT)', () => {
        const byId = Object.fromEntries(
            getEligibleInstitutes(authorities).map((i) => [i.id, i.primaryRole])
        );
        expect(byId).toEqual({
            'inst-admin': 'ADMIN',
            'inst-counsellor': 'COUNSELLOR',
            'inst-teacher': 'TEACHER',
        });
    });

    it('drops non-ADMIN institutes when the portal requires ADMIN for them', () => {
        const result = getEligibleInstitutes(authorities, { requiresAdmin: () => true });
        expect(result.map((i) => i.id)).toEqual(['inst-admin']);
    });

    it('tolerates a missing/malformed authorities map', () => {
        expect(getEligibleInstitutes(undefined)).toEqual([]);
        expect(getEligibleInstitutes(null)).toEqual([]);
        expect(
            getEligibleInstitutes({ x: { roles: undefined, permissions: undefined } } as never)
        ).toEqual([]);
    });
});

describe('canOfferInstituteSwitch', () => {
    it('needs at least two eligible institutes and a host that keeps the selection', () => {
        expect(canOfferInstituteSwitch(0, false)).toBe(false);
        expect(canOfferInstituteSwitch(1, false)).toBe(false);
        expect(canOfferInstituteSwitch(2, false)).toBe(true);
        expect(canOfferInstituteSwitch(5, true)).toBe(false);
    });
});

describe('role label', () => {
    it('formats raw role names', () => {
        expect(formatRoleName('ADMIN')).toBe('Admin');
        expect(formatRoleName('CONTENT CREATOR')).toBe('Content Creator');
        expect(formatRoleName('assessment_creator')).toBe('Assessment Creator');
    });

    it('counts the other staff roles, never learner roles', () => {
        expect(getRoleLabelParts(['ADMIN'])).toEqual({ primary: 'ADMIN', extraCount: 0 });
        expect(getRoleLabelParts(['STUDENT', 'COUNSELLOR'])).toEqual({
            primary: 'COUNSELLOR',
            extraCount: 0,
        });
        expect(getRoleLabelParts(['TEACHER', 'ADMIN', 'EVALUATOR', 'STUDENT'])).toEqual({
            primary: 'ADMIN',
            extraCount: 2,
        });
        expect(getRoleLabelParts(['STUDENT'])).toEqual({ primary: 'UNKNOWN', extraCount: 0 });
    });
});

describe('filterInstitutesByQuery', () => {
    const list = [{ name: 'Shiksha Nation' }, { name: 'École Normale' }, { name: 'Vacademy' }];
    it('matches case- and accent-insensitively; blank query returns all', () => {
        expect(filterInstitutesByQuery(list, '')).toHaveLength(3);
        expect(filterInstitutesByQuery(list, '  nation ').map((i) => i.name)).toEqual([
            'Shiksha Nation',
        ]);
        expect(filterInstitutesByQuery(list, 'ecole').map((i) => i.name)).toEqual([
            'École Normale',
        ]);
        expect(filterInstitutesByQuery(list, 'zzz')).toEqual([]);
    });
});

describe('institute-scoped storage', () => {
    const scoped = {
        ACTIVE_ROLE_DISPLAY_SETTINGS_KEY: 'ADMIN_DISPLAY_SETTINGS',
        faculty_access_data: '{"subOrgs":[]}',
        selected_suborg_id: 'sub-a',
        namingSettings: '[]',
        modules: '[]',
        tabSettings: '[]',
        themeRoleSettings: '{}',
        languageSetting: '{}',
        vacademy_recent_sidebar_tabs: '[]',
        'custom-field-settings-cache': '{}',
        'adminDisplaySettings-inst-a': '{}',
        'teacherDisplaySettings-inst-a': '{}',
        'CUSTOM_ROLE_DISPLAY_SETTINGS_KEY_r1+r2-inst-a': '{}',
        'DISPLAY_SETTINGS_SERVER_VERSION-inst-a': 'v3',
    };
    const kept = {
        selectedInstituteId: 'inst-a',
        'theme-code': 'primary',
        current_domain_branding: '{}',
        'vacademy-locale': '{}',
        'inst-a': '{"instituteName":"A"}', // per-institute branding cache keyed by id
        'course-settings-cache-inst-a': '{}', // already keyed by institute
        'crm-lead-columns:leads': '[]',
    };

    it('selects every institute-scoped key and nothing else', () => {
        const picked = getInstituteScopedStorageKeys(Object.keys({ ...scoped, ...kept }));
        expect(new Set(picked)).toEqual(new Set(Object.keys(scoped)));
    });

    it('covers the login-flow keys and the caches the switch must not leak', () => {
        for (const key of [
            'ACTIVE_ROLE_DISPLAY_SETTINGS_KEY',
            'faculty_access_data',
            'selected_suborg_id',
            'namingSettings',
            'modules',
            'vacademy_recent_sidebar_tabs',
        ]) {
            expect(INSTITUTE_SCOPED_STORAGE_KEYS).toContain(key);
        }
        expect(INSTITUTE_SCOPED_STORAGE_KEYS).not.toContain('selectedInstituteId');
    });

    it('clears scoped keys, snapshots them, and restores exactly on rollback', () => {
        const storage = memoryStorage({ ...scoped, ...kept });
        const snapshot = clearInstituteScopedStorage(storage);

        expect(storage.dump()).toEqual(kept);

        // The target institute's selection writes its own values…
        storage.setItem('selectedInstituteId', 'inst-b');
        storage.setItem('faculty_access_data', '{"subOrgs":[{"subOrgId":"b"}]}');
        storage.setItem('adminDisplaySettings-inst-b', '{}');

        // …which a rollback removes before putting the previous institute back.
        restoreInstituteScopedStorage(storage, snapshot);
        expect(storage.dump()).toEqual({ ...scoped, ...kept });
    });

    it('rollback removes a selectedInstituteId that did not exist before', () => {
        const storage = memoryStorage({ namingSettings: '[]' });
        const snapshot = clearInstituteScopedStorage(storage);
        storage.setItem('selectedInstituteId', 'inst-b');
        restoreInstituteScopedStorage(storage, snapshot);
        expect(storage.dump()).toEqual({ namingSettings: '[]' });
    });
});
