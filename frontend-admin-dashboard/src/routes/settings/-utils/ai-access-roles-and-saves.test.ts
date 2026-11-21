import { describe, expect, it } from 'vitest';
import type { AccessCatalog, AssistantGroupEntry } from '../-constants/ai-access';
import {
    mergeMcpSettingWithDefaults,
    type McpServerSettingData,
    type McpToolCatalogEntry,
} from '../-constants/mcp-server';
import { groupToolsByArea, levelsBelow } from '../-components/McpToolAccessList';
import {
    assistantAreaLevel,
    assistantAutoEditKeys,
    assistantLevels,
    assistantPresetKeys,
    buildAccessAreas,
    draftAfterSave,
    mergeAssistantSettingForSave,
    mergeMcpSettingForSave,
    normalizeAssistantSetting,
    roleOwnAfterChange,
    roleView,
    sameAssistantSetting,
    sameMcpSetting,
    withAssistantAreaLevel,
} from './ai-access';

const tool = (over: Partial<McpToolCatalogEntry> & { key: string }): McpToolCatalogEntry => ({
    name: over.key,
    label: over.key,
    description: '',
    mode: over.level === 'edit' ? 'WRITE' : 'READ',
    level: 'view',
    ...over,
});

const group = (over: Partial<AssistantGroupEntry> & { key: string; area: string }) =>
    ({
        label: over.key,
        mode: over.level === 'edit' ? 'WRITE' : 'READ',
        level: 'view',
        ...over,
    }) as AssistantGroupEntry;

const catalog: AccessCatalog = {
    areas: [
        { key: 'courses', label: 'Courses', summary: '', order: 7 },
        { key: 'learners', label: 'Learners', summary: '', order: 8 },
        { key: 'sub_orgs', label: 'Sub-organisations', summary: '', order: 15 },
        { key: 'crm_calls', label: 'CRM: Calls', summary: '', order: 17 },
    ],
    mcp_tools: [
        tool({ key: 'courses', area: 'courses' }),
        tool({ key: 'learners', area: 'learners' }),
        tool({ key: 'crm_calls', area: 'crm_calls' }),
        tool({
            key: 'crm_calling_outbound',
            area: 'crm_calls',
            level: 'edit',
            risk: 'outbound',
            opt_in: true,
        }),
        tool({
            key: 'crm_ai_campaigns',
            area: 'crm_calls',
            level: 'edit',
            risk: 'outbound',
            opt_in: true,
            entitled: false,
        }),
    ],
    assistant_groups: [
        group({ key: 'courses', area: 'courses' }),
        group({ key: 'course_edits', area: 'courses', level: 'edit' }),
        group({ key: 'course_structure_edits', area: 'courses', level: 'edit', opt_in: true }),
        group({ key: 'learners', area: 'learners' }),
        group({ key: 'learner_data', area: 'learners' }),
        group({ key: 'learner_reports_x', area: 'learners', entitled: false }),
        group({ key: 'learner_enrollments', area: 'learners', level: 'edit', opt_in: true }),
        group({ key: 'learner_profile_edits', area: 'learners', level: 'edit', opt_in: true }),
        group({ key: 'sub_orgs', area: 'sub_orgs' }),
        group({ key: 'sub_org_edits', area: 'sub_orgs', level: 'edit', opt_in: true }),
    ],
    assistant_default_setting: {
        enabled_tools: ['search_help_knowledge'],
        role_overrides: { ADMIN: { enabled_tools: ['learner_data', 'courses'] } },
    },
};

const areas = buildAccessAreas(catalog);
const row = (key: string) => areas.find((a) => a.key === key)!;

describe('AI access: assistant edits turned on one by one', () => {
    it('Edit never turns on an opt-in group, and leaves an all-opt-in area at its reads', () => {
        const courses = row('courses').assistant!;
        expect(assistantAutoEditKeys(courses)).toEqual(['course_edits']);
        expect(withAssistantAreaLevel(courses, 'edit', []).sort()).toEqual([
            'course_edits',
            'courses',
        ]);

        const learners = row('learners').assistant!;
        expect(assistantLevels(learners)).toEqual(['off', 'view', 'edit']);
        expect(assistantAutoEditKeys(learners)).toEqual([]);
        const next = withAssistantAreaLevel(learners, 'edit', []);
        expect(next.sort()).toEqual(['learner_data', 'learners']);
        expect(next).not.toContain('learner_enrollments');
        expect(next).not.toContain('learner_profile_edits');

        // Switched on by its own switch, it reads as Edit; View and Off turn it off again.
        const own = [...next, 'learner_enrollments'];
        expect(assistantAreaLevel(learners, own)).toBe('edit');
        expect(withAssistantAreaLevel(learners, 'view', own)).not.toContain('learner_enrollments');
        expect(withAssistantAreaLevel(learners, 'off', own)).toEqual([]);
    });

    it('a preset adds only groups in the plan, never an opt-in one, nor what everyone has', () => {
        const preset = [
            'learner_data',
            'learners',
            'learner_reports_x', // outside the plan
            'learner_enrollments', // opt-in
            'not_offered',
        ];
        expect(assistantPresetKeys(areas, preset, ['learners'])).toEqual(['learner_data']);
        // The dashboard's own capability catalogue can leave a group out too.
        const narrower = buildAccessAreas(catalog, (key) => key !== 'learner_data');
        expect(assistantPresetKeys(narrower, preset, [])).toEqual(['learners']);
    });
});

describe('AI access: turning an AI-apps area Off sticks', () => {
    const allMcpAreas = groupToolsByArea(catalog.mcp_tools);

    it('keeps the view off when an edit outside the plan is still listed', () => {
        // Saved: the calls view and AI campaigns, an edit the plan no longer includes.
        const stored = { enabled: true, enabled_tools: ['crm_calls', 'crm_ai_campaigns'] };
        const base = mergeMcpSettingWithDefaults(stored);
        // The admin sets "CRM: Calls" to Off: only the in-plan area's keys change.
        const inPlan = row('crm_calls').mcp!;
        expect(inPlan.edits.map((t) => t.key)).toEqual(['crm_calling_outbound']);
        const mine: McpServerSettingData = {
            ...base,
            enabled_tools: base.enabled_tools.filter(
                (k) => k !== 'crm_calls' && k !== 'crm_calling_outbound'
            ),
        };
        const saved = mergeMcpSettingForSave(stored, base, mine, allMcpAreas);
        expect(saved.enabled_tools).toEqual(['crm_ai_campaigns']);
    });

    it('still gives the view to an edit switched on now, or one on and in the plan', () => {
        const base = mergeMcpSettingWithDefaults({ enabled: true, enabled_tools: [] });
        const mine = { ...base, enabled_tools: ['crm_calling_outbound'] };
        expect(
            [
                ...(mergeMcpSettingForSave(null, base, mine, allMcpAreas)
                    .enabled_tools as string[]),
            ].sort()
        ).toEqual(['crm_calling_outbound', 'crm_calls']);

        // An older list with an in-plan edit but no view: any save gives it its view.
        const stored = { enabled: true, enabled_tools: ['crm_calling_outbound', 'courses'] };
        const older = mergeMcpSettingWithDefaults(stored);
        const changed = { ...older, enabled_tools: ['crm_calling_outbound'] };
        expect(
            [
                ...(mergeMcpSettingForSave(stored, older, changed, allMcpAreas)
                    .enabled_tools as string[]),
            ].sort()
        ).toEqual(['crm_calling_outbound', 'crm_calls']);

        // An edit outside the plan that nobody changed does not bring its view back.
        const outside = { enabled: true, enabled_tools: ['crm_ai_campaigns', 'courses'] };
        const outsideBase = mergeMcpSettingWithDefaults(outside);
        const dropCourses = { ...outsideBase, enabled_tools: ['crm_ai_campaigns'] };
        expect(
            mergeMcpSettingForSave(outside, outsideBase, dropCourses, allMcpAreas).enabled_tools
        ).toEqual(['crm_ai_campaigns']);
    });

    it('applies the same rule to a role’s own list', () => {
        const stored = {
            enabled: true,
            allowed_roles: ['ADMIN', 'TEACHER'],
            enabled_tools: [],
            role_overrides: { TEACHER: { enabled_tools: ['crm_calls', 'crm_ai_campaigns'] } },
        };
        const base = mergeMcpSettingWithDefaults(stored);
        const mine: McpServerSettingData = {
            ...base,
            role_overrides: { TEACHER: { enabled_tools: ['crm_ai_campaigns'] } },
        };
        const saved = mergeMcpSettingForSave(stored, base, mine, allMcpAreas);
        expect(saved.role_overrides).toEqual({
            TEACHER: { enabled_tools: ['crm_ai_campaigns'] },
        });
    });
});

describe('AI access: a role’s view shows what the role really has', () => {
    it('adds everyone’s list and the role’s own, and marks what comes from everyone', () => {
        expect(roleView(['a', 'b'], ['b', 'c'])).toEqual({
            enabled: ['a', 'b', 'c'],
            inherited: ['a', 'b'],
        });
        expect(roleView(['a'], undefined)).toEqual({ enabled: ['a'], inherited: ['a'] });
    });

    it('changes only the role’s own extras; what everyone has stays on', () => {
        // Off for an area everyone can view: the view stays (it is everyone's), the role's edit goes.
        expect(roleOwnAfterChange(['view'], ['edit'], [])).toEqual([]);
        expect(roleOwnAfterChange(['view'], [], ['view', 'edit'])).toEqual(['edit']);
        // An entry of the role's own list that everyone also has is kept as it is.
        expect(roleOwnAfterChange(['view'], ['view', 'edit'], ['view'])).toEqual(['view']);
        expect(roleOwnAfterChange([], undefined, ['x'])).toEqual(['x']);
    });

    it('the area level the role has never reads below what everyone has', () => {
        const courses = row('courses').assistant!;
        const everyone = ['courses'];
        const view = roleView(everyone, ['course_edits']);
        expect(assistantAreaLevel(courses, view.enabled)).toBe('edit');
        expect(assistantAreaLevel(courses, view.inherited)).toBe('view');
        // So Off can't be picked for this role: it is below what everyone has.
        expect(levelsBelow('view')).toEqual(['off']);
        expect(levelsBelow('edit')).toEqual(['off', 'view']);
        expect(levelsBelow('off')).toEqual([]);
        // Picking View for the role removes its own edit and keeps everyone's view.
        const next = withAssistantAreaLevel(courses, 'view', view.enabled);
        expect(roleOwnAfterChange(everyone, ['course_edits'], next)).toEqual([]);
    });
});

describe('AI access: stored values read the way the backend reads them', () => {
    it('a role entry of null is no list, and loading does not make the page unsaved', () => {
        const stored = {
            enabled: true,
            allowed_roles: ['ADMIN', 'TEACHER'],
            enabled_tools: ['courses'],
            role_overrides: { TEACHER: null, EVALUATOR: { enabled_tools: ['learners', 3] } },
        } as unknown as Partial<McpServerSettingData>;
        const base = mergeMcpSettingWithDefaults(stored);
        expect(base.role_overrides).toEqual({ EVALUATOR: { enabled_tools: ['learners'] } });
        expect(sameMcpSetting(base, mergeMcpSettingWithDefaults(stored))).toBe(true);

        // A change elsewhere leaves the null entry exactly as stored.
        const mine = { ...base, enabled: false };
        expect(mergeMcpSettingForSave(stored, base, mine, []).role_overrides).toEqual(
            stored.role_overrides
        );
        // Only when the admin gives that role a list is it written.
        const teacher = {
            ...base,
            role_overrides: { ...base.role_overrides, TEACHER: { enabled_tools: ['learners'] } },
        };
        const saved = mergeMcpSettingForSave(stored, base, teacher, []);
        expect((saved.role_overrides as Record<string, unknown>).TEACHER).toEqual({
            enabled_tools: ['learners'],
        });
    });

    it('an empty "who can connect" list shows as ADMIN and is written only when changed', () => {
        for (const allowed of [[], ['STUDENT'], [' parent ']]) {
            const stored = { enabled: true, allowed_roles: allowed, enabled_tools: [] };
            const base = mergeMcpSettingWithDefaults(stored);
            expect(base.allowed_roles).toEqual(['ADMIN']);
            // Nothing changed: the stored list stays as it is.
            expect(mergeMcpSettingForSave(stored, base, base, []).allowed_roles).toEqual(allowed);
            // Adding a role keeps ADMIN, as the screen showed it.
            const mine = { ...base, allowed_roles: ['ADMIN', 'TEACHER'] };
            expect(mergeMcpSettingForSave(stored, base, mine, []).allowed_roles).toEqual([
                'ADMIN',
                'TEACHER',
            ]);
        }
    });

    it('an assistant setting saved as {} starts from the registry defaults', () => {
        const base = normalizeAssistantSetting({}, catalog.assistant_default_setting);
        expect(base).toEqual(catalog.assistant_default_setting);
        expect(
            sameAssistantSetting(
                base,
                normalizeAssistantSetting(null, catalog.assistant_default_setting)
            )
        ).toBe(true);
        // The first save keeps ADMIN's defaults alongside the change.
        const mine = { ...base, enabled_tools: [...base.enabled_tools, 'courses'] };
        expect(mergeAssistantSettingForSave({}, base, mine)).toEqual({
            enabled_tools: ['search_help_knowledge', 'courses'],
            role_overrides: { ADMIN: { enabled_tools: ['learner_data', 'courses'] } },
        });
        // A saved setting with keys is never replaced by the defaults.
        expect(
            normalizeAssistantSetting({ enabled_tools: [] }, catalog.assistant_default_setting)
        ).toEqual({ enabled_tools: [], role_overrides: {} });
    });
});

describe('AI access: changes made while saving', () => {
    it('stay unsaved: the stored value becomes what was sent, the copy keeps the newer change', () => {
        const loaded = { enabled_tools: ['a'], role_overrides: {} };
        const sent = { enabled_tools: ['a', 'b'], role_overrides: {} };
        const later = { enabled_tools: ['a', 'b', 'c'], role_overrides: {} };
        const after = draftAfterSave({ base: loaded, current: later }, sent)!;
        expect(after).toEqual({ base: sent, current: later });
        expect(sameAssistantSetting(after.base, after.current)).toBe(false);
        // Nothing changed meanwhile: saved and clean.
        const clean = draftAfterSave({ base: loaded, current: sent }, sent)!;
        expect(sameAssistantSetting(clean.base, clean.current)).toBe(true);
        expect(draftAfterSave(null, sent)).toBeNull();
    });
});
