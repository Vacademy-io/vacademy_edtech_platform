/**
 * Settings → AI access — the pure logic behind the screen.
 *
 *  - buildAccessAreas: one row per capability area, with the in-product
 *    assistant's groups and the MCP tools of that area side by side.
 *  - assistant levels: Off / View / Edit for the assistant's groups in a row
 *    (the MCP side keeps its own rules in McpToolAccessList.tsx).
 *  - merge*ForSave: what a save writes. Each setting is saved by reading the
 *    latest stored value and changing only what this screen changed, so a
 *    value saved meanwhile by someone else, a key this screen does not show, or
 *    a group outside the plan stays exactly as it is.
 */
import type { AccessCatalog, AssistantGroupEntry } from '../-constants/ai-access';
import type { AssistantToolsSettingData } from '../-constants/assistant-tools';
import type { McpServerSettingData } from '../-constants/mcp-server';
import {
    groupToolsByArea,
    withViewsForEdits,
    type McpAccessLevel,
    type McpToolArea,
} from '../-components/McpToolAccessList';

// ─── Areas ──────────────────────────────────────────────────────────────────

/** The assistant's groups in one area, split like the MCP side: what reads, what proposes changes. */
export interface AssistantDoorArea {
    views: AssistantGroupEntry[];
    edits: AssistantGroupEntry[];
    alwaysOn: boolean;
}

export interface AccessArea {
    key: string;
    label: string;
    summary: string;
    order: number;
    /** The assistant's groups the plan includes; null when there are none. */
    assistant: AssistantDoorArea | null;
    /** The area has assistant groups, but the plan includes none of them. */
    assistantOutsidePlan: boolean;
    /** The MCP tools the plan includes; null when there are none. */
    mcp: McpToolArea | null;
    /** The area has MCP tools, but the plan includes none of them. */
    mcpOutsidePlan: boolean;
}

/**
 * Rows for the screen. Groups and tools outside the plan are left out of the
 * rows (so no control, preset or level change touches their saved values); a
 * side with nothing left in the plan is flagged instead.
 */
export function buildAccessAreas(
    catalog: AccessCatalog,
    isAssistantGroupEntitled: (group: string) => boolean = () => true
): AccessArea[] {
    const info = new Map(catalog.areas.map((a) => [a.key, a]));
    const allMcp = new Map(groupToolsByArea(catalog.mcp_tools).map((a) => [a.key, a]));
    const entitledMcp = new Map(
        groupToolsByArea(catalog.mcp_tools.filter((t) => t.entitled !== false)).map((a) => [
            a.key,
            a,
        ])
    );
    const assistantByArea = new Map<string, AssistantGroupEntry[]>();
    for (const group of catalog.assistant_groups) {
        const list = assistantByArea.get(group.area) ?? [];
        list.push(group);
        assistantByArea.set(group.area, list);
    }

    const keys = new Set([...info.keys(), ...allMcp.keys(), ...assistantByArea.keys()]);
    const rows: AccessArea[] = [];
    for (const key of keys) {
        const groups = assistantByArea.get(key) ?? [];
        const inPlan = groups.filter(
            (g) => g.entitled !== false && isAssistantGroupEntitled(g.key)
        );
        const anyMcp = allMcp.get(key) ?? null;
        if (!groups.length && !anyMcp) continue;
        const meta = info.get(key);
        rows.push({
            key,
            label: meta?.label ?? anyMcp?.label ?? groups[0]?.area_label ?? key,
            summary: meta?.summary ?? anyMcp?.summary ?? '',
            order: meta?.order ?? anyMcp?.order ?? groups[0]?.area_order ?? 99,
            assistant: inPlan.length
                ? {
                      views: inPlan.filter((g) => g.level !== 'edit'),
                      edits: inPlan.filter((g) => g.level === 'edit'),
                      alwaysOn: inPlan.every((g) => g.always_on),
                  }
                : null,
            assistantOutsidePlan: groups.length > 0 && inPlan.length === 0,
            mcp: entitledMcp.get(key) ?? null,
            mcpOutsidePlan: Boolean(anyMcp) && !entitledMcp.has(key),
        });
    }
    return rows.sort((a, b) => a.order - b.order);
}

// ─── Assistant levels ───────────────────────────────────────────────────────

const switchable = (groups: AssistantGroupEntry[]) =>
    groups.filter((g) => !g.always_on).map((g) => g.key);

/** The levels the assistant side of a row offers: Off, plus View and Edit when it has them. */
export function assistantLevels(area: AssistantDoorArea): McpAccessLevel[] {
    const levels: McpAccessLevel[] = ['off'];
    if (switchable(area.views).length) levels.push('view');
    if (switchable(area.edits).length) levels.push('edit');
    return levels;
}

export function assistantAreaLevel(area: AssistantDoorArea, enabled: string[]): McpAccessLevel {
    if (switchable(area.edits).some((k) => enabled.includes(k))) return 'edit';
    if (switchable(area.views).some((k) => enabled.includes(k))) return 'view';
    return 'off';
}

/**
 * Off removes every group of the area; View turns its reads on and its changes
 * off; Edit turns everything on (each change still needs the user's Confirm in
 * the assistant). Moving to Edit keeps the changes as they are when one is on.
 */
export function withAssistantAreaLevel(
    area: AssistantDoorArea,
    level: McpAccessLevel,
    enabled: string[]
): string[] {
    const views = switchable(area.views);
    const edits = switchable(area.edits);
    const next = new Set(enabled);
    if (level === 'off') {
        [...views, ...edits].forEach((k) => next.delete(k));
    } else {
        views.forEach((k) => next.add(k));
        if (level === 'view') edits.forEach((k) => next.delete(k));
        else if (!edits.some((k) => enabled.includes(k))) edits.forEach((k) => next.add(k));
    }
    return Array.from(next);
}

// ─── Loading ────────────────────────────────────────────────────────────────

type Raw = Record<string, unknown>;

const isRecord = (value: unknown): value is Raw =>
    Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const stringList = (value: unknown): string[] | null =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : null;

function overridesFrom(value: unknown): Record<string, { enabled_tools: string[] }> {
    const out: Record<string, { enabled_tools: string[] }> = {};
    if (!isRecord(value)) return out;
    for (const [role, node] of Object.entries(value)) {
        if (isRecord(node)) out[role] = { enabled_tools: stringList(node.enabled_tools) ?? [] };
    }
    return out;
}

/** The stored assistant setting as the screen edits it; never saved = the registry's defaults. */
export function normalizeAssistantSetting(
    raw: unknown,
    defaults: AssistantToolsSettingData
): AssistantToolsSettingData {
    if (!isRecord(raw)) {
        return {
            enabled_tools: [...defaults.enabled_tools],
            role_overrides: overridesFrom(defaults.role_overrides),
        };
    }
    return {
        enabled_tools: stringList(raw.enabled_tools) ?? [...defaults.enabled_tools],
        role_overrides: overridesFrom(raw.role_overrides),
    };
}

// ─── Comparing ──────────────────────────────────────────────────────────────

export function sameKeys(a: readonly string[], b: readonly string[]): boolean {
    const left = new Set(a);
    const right = new Set(b);
    return left.size === right.size && [...left].every((k) => right.has(k));
}

function sameOverrides(
    a: Record<string, { enabled_tools: string[] }>,
    b: Record<string, { enabled_tools: string[] }>
): boolean {
    const roles = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const role of roles) {
        const left = a[role];
        const right = b[role];
        if (!left || !right) return false;
        if (!sameKeys(left.enabled_tools, right.enabled_tools)) return false;
    }
    return true;
}

export function sameAssistantSetting(
    a: AssistantToolsSettingData,
    b: AssistantToolsSettingData
): boolean {
    return (
        sameKeys(a.enabled_tools, b.enabled_tools) &&
        sameOverrides(a.role_overrides, b.role_overrides)
    );
}

export function sameMcpSetting(a: McpServerSettingData, b: McpServerSettingData): boolean {
    return (
        a.enabled === b.enabled &&
        sameKeys(a.allowed_roles, b.allowed_roles) &&
        sameKeys(a.enabled_tools, b.enabled_tools) &&
        sameOverrides(a.role_overrides, b.role_overrides)
    );
}

// ─── Saving ─────────────────────────────────────────────────────────────────

/**
 * `latest` with this screen's changes (`base` → `mine`) applied: what the
 * screen removed is removed, what it added is added, and everything else in
 * `latest` (including entries the screen never knew about) stays, in order.
 */
export function mergeKeyList(latest: unknown, base: string[], mine: string[]): unknown[] {
    const removed = new Set(base.filter((k) => !mine.includes(k)));
    const out = (Array.isArray(latest) ? latest : base).filter(
        (k) => !(typeof k === 'string' && removed.has(k))
    );
    for (const key of mine) {
        if (!base.includes(key) && !out.includes(key)) out.push(key);
    }
    return out;
}

type Overrides = Record<string, { enabled_tools: string[] }>;

/** Role by role: only roles this screen created, removed or changed are touched. */
function mergeOverrides(
    latest: unknown,
    base: Overrides,
    mine: Overrides,
    finish: (list: unknown[]) => unknown[] = (list) => list
): Raw {
    const out: Raw = isRecord(latest) ? { ...latest } : {};
    const roles = new Set([...Object.keys(base), ...Object.keys(mine)]);
    for (const role of roles) {
        const before = base[role]?.enabled_tools;
        const after = mine[role]?.enabled_tools;
        if (before && !after) {
            delete out[role];
            continue;
        }
        if (!after || (before && sameKeys(before, after))) continue;
        const node: Raw = isRecord(out[role]) ? { ...(out[role] as Raw) } : {};
        const stored = Array.isArray(node.enabled_tools) ? node.enabled_tools : before ?? [];
        node.enabled_tools = finish(mergeKeyList(stored, before ?? [], after));
        out[role] = node;
    }
    return out;
}

/** A setting never saved starts from what the screen showed for it. */
const startFrom = (latest: unknown, base: object): Raw =>
    isRecord(latest) ? { ...latest } : JSON.parse(JSON.stringify(base));

/**
 * The assistant setting to save: the latest stored value with only this
 * screen's changes applied. Keys the screen does not show stay as they are.
 */
export function mergeAssistantSettingForSave(
    latest: unknown,
    base: AssistantToolsSettingData,
    mine: AssistantToolsSettingData
): Raw {
    const out = startFrom(latest, base);
    if (!sameKeys(base.enabled_tools, mine.enabled_tools)) {
        out.enabled_tools = mergeKeyList(out.enabled_tools, base.enabled_tools, mine.enabled_tools);
    }
    if (!sameOverrides(base.role_overrides, mine.role_overrides)) {
        out.role_overrides = mergeOverrides(
            out.role_overrides,
            base.role_overrides,
            mine.role_overrides
        );
    }
    return out;
}

/**
 * The MCP setting to save, the same way. Every list this save writes also gets
 * the view of each edit it holds (edit includes view; `areas` = the catalogue's).
 */
export function mergeMcpSettingForSave(
    latest: unknown,
    base: McpServerSettingData,
    mine: McpServerSettingData,
    areas: McpToolArea[]
): Raw {
    const withViews = (list: unknown[]) => withViewsForEdits(areas, list as string[]);
    const out = startFrom(latest, base);
    if (base.enabled !== mine.enabled) out.enabled = mine.enabled;
    if (!sameKeys(base.allowed_roles, mine.allowed_roles)) {
        out.allowed_roles = mergeKeyList(out.allowed_roles, base.allowed_roles, mine.allowed_roles);
    }
    if (!sameKeys(base.enabled_tools, mine.enabled_tools)) {
        out.enabled_tools = withViews(
            mergeKeyList(out.enabled_tools, base.enabled_tools, mine.enabled_tools)
        );
    }
    if (!sameOverrides(base.role_overrides, mine.role_overrides)) {
        out.role_overrides = mergeOverrides(
            out.role_overrides,
            base.role_overrides,
            mine.role_overrides,
            withViews
        );
    }
    return out;
}
