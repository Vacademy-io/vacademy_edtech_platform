/**
 * In-memory stand-in for the Learner home admin API, used by tests and, with
 * VITE_LEARNER_HOME_MOCK=true, by a local dev build while the backend is not
 * deployed. It follows the versioning rules of spec 2.5: one draft, optimistic
 * revision, publish = archive old + new version, restore into the draft.
 */
import type {
    AcksResponse,
    AnalyticsResponse,
    DraftResponse,
    HomeBlock,
    Layout,
    LayoutSettings,
    PublishResponse,
    ResolvedHome,
    VersionRow,
} from '../-types/learner-home-types';
import { runPublishChecks, errorsOf, warningsOf } from '../-utils/publish-checks';
import { normalizeLayout } from '../-utils/normalize';
import { LearnerHomeApiError } from './learner-home-errors';
import type { LearnerHomeApi } from './learner-home-service';

interface StoredVersion {
    version: number;
    status: 'PUBLISHED' | 'ARCHIVED';
    published_at: string;
    published_by: string;
    settings: LayoutSettings;
    blocks: HomeBlock[];
}

export interface MockState {
    moduleEnabled: boolean;
    draft: Layout | null;
    versions: StoredVersion[];
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function createMockLearnerHomeApi(initial?: Partial<MockState>): LearnerHomeApi & {
    state: MockState;
} {
    const state: MockState = {
        moduleEnabled: initial?.moduleEnabled ?? true,
        draft: initial?.draft ?? null,
        versions: initial?.versions ?? [],
    };
    let ids = 0;
    const published = () => state.versions.find((v) => v.status === 'PUBLISHED') ?? null;
    const requireModule = () => {
        if (!state.moduleEnabled) {
            throw new LearnerHomeApiError({
                status: 403,
                code: 'MODULE_OFF',
                message: 'Module off',
            });
        }
    };
    const requireDraft = (): Layout => {
        if (!state.draft) {
            throw new LearnerHomeApiError({ status: 404, code: 'NOT_FOUND', message: 'No draft' });
        }
        return state.draft;
    };
    const newDraft = (
        blocks: HomeBlock[],
        settings: LayoutSettings,
        template: Layout['template_key'],
        base: number | null
    ): Layout => ({
        id: `mock-${++ids}`,
        status: 'DRAFT',
        version: 0,
        base_version: base,
        revision: 1,
        template_key: template,
        settings: clone(settings),
        blocks: clone(blocks),
        updated_at: new Date().toISOString(),
        updated_by: 'mock-admin',
    });
    const wait = () => new Promise((r) => setTimeout(r, 120));

    return {
        state,
        async getDraft(): Promise<DraftResponse> {
            await wait();
            const pub = published();
            return {
                module_enabled: state.moduleEnabled,
                holistic: false,
                draft: state.draft ? clone(state.draft) : null,
                published: pub
                    ? {
                          version: pub.version,
                          published_at: pub.published_at,
                          published_by: pub.published_by,
                      }
                    : null,
            };
        },
        async createDraft(_id, body) {
            await wait();
            requireModule();
            if (state.draft) {
                throw new LearnerHomeApiError({
                    status: 409,
                    code: 'DRAFT_EXISTS',
                    message: 'Draft exists',
                });
            }
            state.draft = newDraft(body.blocks, body.settings, body.template_key, null);
            return clone(state.draft);
        },
        async createDraftFromPublished() {
            await wait();
            requireModule();
            if (state.draft) {
                throw new LearnerHomeApiError({
                    status: 409,
                    code: 'DRAFT_EXISTS',
                    message: 'Draft exists',
                });
            }
            const pub = published();
            if (!pub)
                throw new LearnerHomeApiError({
                    status: 404,
                    code: 'NOT_FOUND',
                    message: 'Nothing published',
                });
            state.draft = newDraft(pub.blocks, pub.settings, null, pub.version);
            return clone(state.draft);
        },
        async saveDraft(_id, body) {
            await wait();
            requireModule();
            const draft = requireDraft();
            if (draft.revision !== body.revision) {
                throw new LearnerHomeApiError({
                    status: 409,
                    code: 'STALE_DRAFT',
                    message: 'Draft changed',
                    updatedBy: draft.updated_by ?? null,
                    updatedAt: draft.updated_at ?? null,
                });
            }
            draft.revision += 1;
            draft.blocks = normalizeLayout({ blocks: clone(body.blocks) }).blocks;
            draft.settings = clone(body.settings);
            draft.updated_at = new Date().toISOString();
            return { revision: draft.revision };
        },
        async deleteDraft() {
            await wait();
            state.draft = null;
        },
        async getPublishChecks() {
            await wait();
            const draft = requireDraft();
            const issues = runPublishChecks(draft.blocks, { settings: draft.settings });
            return { errors: errorsOf(issues), warnings: warningsOf(issues) };
        },
        async publish(_id, revision): Promise<PublishResponse> {
            await wait();
            requireModule();
            const draft = requireDraft();
            if (draft.revision !== revision) {
                throw new LearnerHomeApiError({
                    status: 409,
                    code: 'STALE_DRAFT',
                    message: 'Draft changed',
                });
            }
            const issues = runPublishChecks(draft.blocks, { settings: draft.settings });
            const errors = errorsOf(issues);
            if (errors.length > 0) {
                throw new LearnerHomeApiError({
                    status: 422,
                    code: 'VALIDATION',
                    message: 'Publish checks failed',
                    issues: errors,
                    warnings: warningsOf(issues),
                });
            }
            state.versions.forEach((v) => {
                if (v.status === 'PUBLISHED') v.status = 'ARCHIVED';
            });
            const version = Math.max(0, ...state.versions.map((v) => v.version)) + 1;
            state.versions.unshift({
                version,
                status: 'PUBLISHED',
                published_at: new Date().toISOString(),
                published_by: 'mock-admin',
                settings: clone(draft.settings),
                blocks: clone(draft.blocks),
            });
            state.versions = state.versions.slice(0, 21);
            state.draft = null;
            return { version, warnings: warningsOf(issues) };
        },
        async unpublish() {
            await wait();
            state.versions.forEach((v) => {
                if (v.status === 'PUBLISHED') v.status = 'ARCHIVED';
            });
        },
        async listVersions(): Promise<VersionRow[]> {
            await wait();
            return state.versions.slice(0, 20).map((v) => ({
                version: v.version,
                status: v.status,
                published_at: v.published_at,
                published_by: v.published_by,
                block_count: v.blocks.length,
            }));
        },
        async restoreVersion(_id, version, force) {
            await wait();
            requireModule();
            const v = state.versions.find((x) => x.version === version);
            if (!v)
                throw new LearnerHomeApiError({
                    status: 404,
                    code: 'NOT_FOUND',
                    message: 'No such version',
                });
            if (state.draft && !force) {
                throw new LearnerHomeApiError({
                    status: 409,
                    code: 'DRAFT_EXISTS',
                    message: 'Draft exists',
                });
            }
            state.draft = newDraft(v.blocks, v.settings, null, v.version);
            return clone(state.draft);
        },
        async preview(_id, body): Promise<ResolvedHome> {
            await wait();
            const blocks = body.source === 'INLINE' ? body.blocks ?? [] : state.draft?.blocks ?? [];
            return {
                mode: 'BUILDER',
                layout_version: 0,
                server_time: new Date().toISOString(),
                settings: body.settings ?? state.draft?.settings,
                preview: true,
                blocks: blocks
                    .filter((b) => b.enabled)
                    .map((b) => ({
                        key: b.block_key,
                        type: b.type,
                        builtin_widget: b.builtin_widget ?? undefined,
                        placement: b.desktop_placement,
                        devices: b.devices,
                        ends_at: b.ends_at,
                        config: b.config as unknown as Record<string, unknown>,
                    })),
            };
        },
        async getAnalytics(): Promise<AnalyticsResponse> {
            await wait();
            const pub = published();
            return {
                blocks: (pub?.blocks ?? []).map((b, i) => ({
                    block_key: b.block_key,
                    admin_label: b.admin_label,
                    type: b.type,
                    views: 1000 - i * 70,
                    clicks: b.type === 'BUILTIN' ? 0 : 40 - i,
                    ctr: b.type === 'BUILTIN' ? null : (40 - i) / (1000 - i * 70),
                    by_device: {
                        PHONE: { views: 700 - i * 50, clicks: b.type === 'BUILTIN' ? 0 : 30 - i },
                        DESKTOP: { views: 300 - i * 20, clicks: b.type === 'BUILTIN' ? 0 : 10 },
                    },
                    items:
                        b.type === 'BANNER_CAROUSEL'
                            ? b.config.slides.map((s, j) => ({
                                  item_key: s.key,
                                  label: null,
                                  views: 500 - j * 100,
                                  clicks: 20 - j * 5,
                              }))
                            : b.type === 'SHORTCUTS'
                              ? b.config.tiles.map((t) => ({
                                    item_key: t.key,
                                    label: t.label,
                                    views: 400,
                                    clicks: 12,
                                }))
                              : [],
                    dismisses: b.type === 'NOTICE' ? 12 : 0,
                    acks: b.type === 'NOTICE' && b.config.require_ack ? 87 : 0,
                })),
            };
        },
        async getAcks(_id, _blockKey, page, size): Promise<AcksResponse> {
            await wait();
            const total = 87;
            const start = page * size;
            const rows = Array.from(
                { length: Math.max(0, Math.min(size, total - start)) },
                (_, i) => ({
                    user_id: `u-${start + i}`,
                    full_name: `Learner ${start + i + 1}`,
                    email: `learner${start + i + 1}@example.com`,
                    acknowledged_at: new Date(Date.now() - (start + i) * 3600_000).toISOString(),
                })
            );
            return { total, rows };
        },
    };
}
