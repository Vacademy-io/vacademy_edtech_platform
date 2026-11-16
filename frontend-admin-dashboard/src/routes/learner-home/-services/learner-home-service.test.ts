import { describe, expect, it, vi } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';

vi.mock('@/lib/auth/axiosInstance', () => ({
    default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock('@/constants/urls', () => ({
    BASE_URL: 'http://x',
    GET_ASSESSMENT_LISTS: 'a',
    GET_UPCOMING_SESSIONS: 'u',
}));
vi.mock('@/services/tag-management', () => ({ getAllTags: vi.fn() }));
vi.mock('@/routes/manage-pages/product-pages/-services/product-pages-service', () => ({
    getAllProductPages: vi.fn(),
}));
vi.mock('@/routes/manage-pages/-services/catalogue-service', () => ({ getCatalogueTags: vi.fn() }));

import { toLearnerHomeError } from './learner-home-errors';
import { createMockLearnerHomeApi } from './learner-home-mock';
import { buildTemplate } from '../-utils/templates';
import { buildCreatePayload, buildSavePayload } from '../-utils/payload';
import { createBuiltinBlock } from '../-utils/block-factory';

const axiosError = (status: number, data: unknown) =>
    new AxiosError('fail', 'ERR', undefined, undefined, {
        status,
        statusText: '',
        data,
        headers: {},
        config: { headers: new AxiosHeaders() },
    });

describe('toLearnerHomeError', () => {
    it('reads a code field, 422 issues and stale-draft details', () => {
        const stale = toLearnerHomeError(
            axiosError(409, {
                code: 'STALE_DRAFT',
                updated_by: 'Asha',
                updated_at: '2026-11-16T09:00:00Z',
            })
        );
        expect(stale.code).toBe('STALE_DRAFT');
        expect(stale.updatedBy).toBe('Asha');
        const invalid = toLearnerHomeError(
            axiosError(422, {
                errors: [{ block_key: 'b1', path: 'config.title', code: 'REQUIRED' }],
                warnings: [{ block_key: null, path: null, code: 'MANY_SLIDES' }],
            })
        );
        expect(invalid.code).toBe('VALIDATION');
        expect(invalid.issues).toEqual([
            {
                block_key: 'b1',
                path: 'config.title',
                code: 'REQUIRED',
                severity: 'error',
                message: null,
                params: undefined,
            },
        ]);
        expect(invalid.warnings[0]!.severity).toBe('warning');
    });

    it('reads a code from the shared "CODE: message" error body', () => {
        const e = toLearnerHomeError(
            axiosError(409, { ex: 'DRAFT_EXISTS: A draft already exists' })
        );
        expect(e.code).toBe('DRAFT_EXISTS');
        expect(e.message).toBe('A draft already exists');
        expect(toLearnerHomeError(axiosError(403, { message: 'MODULE_OFF: off' })).code).toBe(
            'MODULE_OFF'
        );
        expect(toLearnerHomeError(axiosError(403, {})).code).toBe('FORBIDDEN');
        expect(toLearnerHomeError(new Error('boom')).code).toBe('UNKNOWN');
    });

    it('maps the contract codes', () => {
        expect(toLearnerHomeError(axiosError(404, { code: 'NO_DRAFT' })).code).toBe('NO_DRAFT');
        expect(toLearnerHomeError(axiosError(422, { code: 'PAYLOAD_TOO_LARGE' })).code).toBe(
            'PAYLOAD_TOO_LARGE'
        );
        const failed = toLearnerHomeError(
            axiosError(422, {
                code: 'PUBLISH_CHECKS_FAILED',
                errors: [{ block_key: 'b', path: 'config.title', code: 'REQUIRED' }],
                warnings: [],
            })
        );
        expect(failed.code).toBe('VALIDATION');
        expect(failed.issues[0]!.code).toBe('REQUIRED');
        expect(toLearnerHomeError(axiosError(403, { code: 'MODULE_OFF' })).code).toBe('MODULE_OFF');
    });
});

describe('mock API versioning (spec 2.5)', () => {
    it('create → save with revision → stale save → publish → restore', async () => {
        const api = createMockLearnerHomeApi();
        const t = buildTemplate('CLASSROOM');
        const draft = await api.createDraft(
            'i',
            buildCreatePayload('CLASSROOM', t.settings, t.blocks)
        );
        expect(draft.revision).toBe(1);
        await expect(
            api.createDraft('i', buildCreatePayload('CLASSROOM', t.settings, t.blocks))
        ).rejects.toMatchObject({ code: 'DRAFT_EXISTS' });

        const minimal = [createBuiltinBlock('HERO')];
        const saved = await api.saveDraft('i', buildSavePayload(1, t.settings, minimal));
        expect(saved.revision).toBe(2);
        await expect(
            api.saveDraft('i', buildSavePayload(1, t.settings, minimal))
        ).rejects.toMatchObject({ code: 'STALE_DRAFT' });

        const pub = await api.publish('i', 2);
        expect(pub.version).toBe(1);
        const after = await api.getDraft('i');
        expect(after.draft).toBeNull();
        expect(after.published?.version).toBe(1);

        await api.createDraftFromPublished('i');
        await expect(api.restoreVersion('i', 1, false)).rejects.toMatchObject({
            code: 'DRAFT_EXISTS',
        });
        const restored = await api.restoreVersion('i', 1, true);
        expect(restored.base_version).toBe(1);
        expect(restored.blocks.map((b) => b.block_key)).toEqual(minimal.map((b) => b.block_key));
    });

    it('publish refuses a draft with check errors', async () => {
        const api = createMockLearnerHomeApi();
        const t = buildTemplate('COURSES_ONLY');
        await api.createDraft('i', buildCreatePayload('COURSES_ONLY', t.settings, t.blocks));
        await expect(api.publish('i', 1)).rejects.toMatchObject({
            status: 422,
            code: 'VALIDATION',
        });
    });
});
