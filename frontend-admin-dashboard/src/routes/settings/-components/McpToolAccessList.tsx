import { useTranslation } from 'react-i18next';
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import { RadioGroup } from '@/components/ui/radio-group';
import { MyButton } from '@/components/design-system/button';
import type { StatusType } from '@/components/design-system/status-chips';
import { cn } from '@/lib/utils';
import type { McpToolCatalogEntry, McpToolRisk } from '../-constants/mcp-server';

/**
 * The MCP side of Settings → AI access: the tool catalogue as one row per AREA
 * (Website, Courses, …) with an Off / View / Edit control, instead of one switch
 * per tool. The rows themselves are drawn by AiAccess/AccessAreaList.tsx.
 *
 * The setting itself is unchanged — a list of enabled tool keys. An area's
 * level is read from, and written back to, the keys of its view and edit
 * tools. Edit always includes view: every edit tool reads through its view.
 */

export type McpAccessLevel = 'off' | 'view' | 'edit';

export interface McpToolArea {
    key: string;
    label: string;
    summary: string;
    order: number;
    view: McpToolCatalogEntry | null;
    edits: McpToolCatalogEntry[];
    alwaysOn: boolean;
}

/** Groups the catalogue into areas. Tolerates an older backend without area fields. */
export function groupToolsByArea(tools: McpToolCatalogEntry[]): McpToolArea[] {
    const areas = new Map<string, McpToolArea>();
    for (const tool of tools) {
        const key = tool.area ?? tool.key;
        const area = areas.get(key) ?? {
            key,
            label: tool.area_label ?? tool.label,
            summary: tool.area_summary ?? '',
            order: tool.area_order ?? 99,
            view: null,
            edits: [],
            alwaysOn: false,
        };
        const level = tool.level ?? (tool.mode === 'WRITE' ? 'edit' : 'view');
        if (level === 'edit') area.edits.push(tool);
        else area.view = tool;
        area.alwaysOn = area.alwaysOn || Boolean(tool.always_on);
        areas.set(key, area);
    }
    return Array.from(areas.values()).sort((a, b) => a.order - b.order);
}

export function areaLevel(area: McpToolArea, enabled: string[]): McpAccessLevel {
    if (area.edits.some((t) => enabled.includes(t.key))) return 'edit';
    if (area.view && enabled.includes(area.view.key)) return 'view';
    return 'off';
}

/** Risks the Edit level never switches on by itself: the admin opts in to each one. */
const OPT_IN_RISKS: ReadonlySet<McpToolRisk> = new Set<McpToolRisk>(['live_additive', 'outbound']);

/**
 * Risks nothing switches on in bulk — not the Edit level (even as an area's only edit),
 * a preset, or the first Enable — whether or not the server also flags them `opt_in`.
 */
const NEVER_AUTO_RISKS: ReadonlySet<McpToolRisk> = new Set<McpToolRisk>(['outbound']);

/** Turned on one by one: flagged `opt_in` by the server (publishing) or a risk in OPT_IN_RISKS. */
export function isOptInEdit(tool: McpToolCatalogEntry): boolean {
    return Boolean(tool.opt_in) || Boolean(tool.risk && OPT_IN_RISKS.has(tool.risk));
}

/** Only ever turned on by its own switch: flagged `opt_in`, or it calls or messages leads. */
export function isNeverAutoOn(tool: McpToolCatalogEntry): boolean {
    return Boolean(tool.opt_in) || Boolean(tool.risk && NEVER_AUTO_RISKS.has(tool.risk));
}

/**
 * The edits the Edit level turns on: all but the opt-in ones. When an area has only
 * live-additive edits those are turned on, but never one flagged `opt_in` or outbound.
 */
export function autoEditKeys(area: McpToolArea): string[] {
    const eligible = area.edits.filter((t) => !isNeverAutoOn(t));
    const auto = eligible.filter((t) => !isOptInEdit(t));
    return (auto.length ? auto : eligible).map((t) => t.key);
}

export function withAreaLevel(
    area: McpToolArea,
    level: McpAccessLevel,
    enabled: string[]
): string[] {
    const editKeys = area.edits.map((t) => t.key);
    const next = new Set(enabled);
    if (level === 'off') {
        if (area.view) next.delete(area.view.key);
        editKeys.forEach((k) => next.delete(k));
    } else {
        if (area.view) next.add(area.view.key);
        if (level === 'view') editKeys.forEach((k) => next.delete(k));
        // Moving up to Edit turns the area's edits on except the opt-in ones (publishing, edits
        // that write live data, and edits that call or message leads); the admin narrows it, or
        // adds those, in the row's details.
        else if (!editKeys.some((k) => enabled.includes(k)))
            autoEditKeys(area).forEach((k) => next.add(k));
    }
    return Array.from(next);
}

/**
 * The presets' keys. "Everything" leaves opt-in edits as they are (it never
 * turns publishing or live-data edits on); "View only" turns every edit off.
 * `all` is every toggleable key, so a preset replaces exactly those.
 */
export function presetKeys(
    areas: McpToolArea[],
    enabled: string[]
): { all: string[]; viewOnly: string[]; everything: string[] } {
    const toggleable = areas.filter((a) => !a.alwaysOn);
    const views = toggleable.flatMap((a) => (a.view ? [a.view.key] : []));
    const edits = toggleable.flatMap((a) => a.edits);
    return {
        all: [...views, ...edits.map((t) => t.key)],
        viewOnly: views,
        everything: [
            ...views,
            ...edits.filter((t) => !isOptInEdit(t) || enabled.includes(t.key)).map((t) => t.key),
        ],
    };
}

/** Edit includes view — older settings could hold an edit with its view off. */
export function withViewsForEdits(areas: McpToolArea[], enabled: string[]): string[] {
    const next = new Set(enabled);
    for (const area of areas) {
        if (area.view && area.edits.some((t) => next.has(t.key))) next.add(area.view.key);
    }
    return Array.from(next);
}

export const RISK_STATUS: Record<McpToolRisk, StatusType> = {
    drafts: 'INFO',
    additive: 'INFO',
    not_live: 'INFO',
    live_additive: 'WARNING',
    live: 'WARNING',
    outbound: 'DANGER',
};

/** A risk this bundle does not know yet still shows as a warning, never unstyled. */
export const riskStatus = (risk: McpToolRisk): StatusType => RISK_STATUS[risk] ?? 'WARNING';

interface LevelControlProps {
    /** The accessible name, e.g. "Website access, AI apps". */
    label: string;
    value: McpAccessLevel;
    levels: McpAccessLevel[];
    onChange: (level: McpAccessLevel) => void;
    disabled?: boolean;
}

export function LevelControl({ label, value, levels, onChange, disabled }: LevelControlProps) {
    const { t } = useTranslation('settingsMcpServer');
    return (
        // A segmented control is a radio choice: Radix gives it arrow-key navigation.
        <RadioGroup
            value={value}
            onValueChange={(v) => onChange(v as McpAccessLevel)}
            aria-label={label}
            disabled={disabled}
            orientation="horizontal"
            className="flex w-full shrink-0 gap-0 rounded-lg bg-neutral-100 p-0.5 sm:w-auto"
        >
            {levels.map((level) => (
                <RadioGroupPrimitive.Item
                    key={level}
                    value={level}
                    className={cn(
                        'min-h-8 flex-1 whitespace-nowrap rounded-md px-3 py-1 text-caption font-medium text-neutral-500 transition-colors hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 sm:flex-none',
                        'data-[state=checked]:bg-white data-[state=checked]:shadow-sm',
                        level === 'off'
                            ? 'data-[state=checked]:text-neutral-700'
                            : 'data-[state=checked]:text-primary-500'
                    )}
                >
                    {t(`tools.level.${level}`)}
                </RadioGroupPrimitive.Item>
            ))}
        </RadioGroup>
    );
}

interface McpAccessPresetsProps {
    areas: McpToolArea[];
    enabled: string[];
    onChange: (enabled: string[]) => void;
}

/** "3 of 6 areas on · 2 can edit" plus one-click View-only / Everything. */
export function McpAccessPresets({ areas, enabled, onChange }: McpAccessPresetsProps) {
    const { t } = useTranslation('settingsMcpServer');
    const toggleable = areas.filter((a) => !a.alwaysOn);
    const on = toggleable.filter((a) => areaLevel(a, enabled) !== 'off').length;
    const editing = toggleable.filter((a) => areaLevel(a, enabled) === 'edit').length;
    const { all, viewOnly, everything } = presetKeys(areas, enabled);
    // A preset is "current" when the toggleable keys that are on are exactly its keys.
    const same = (keys: string[]) => {
        const on = enabled.filter((k) => all.includes(k));
        return on.length === keys.length && keys.every((k) => on.includes(k));
    };
    const presets: { key: string; keys: string[] }[] = [
        { key: 'viewOnly', keys: viewOnly },
        { key: 'everything', keys: everything },
    ];

    return (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-caption text-neutral-600">
                {t('tools.summaryLine', { on, total: toggleable.length, editing })}
            </p>
            <div className="flex gap-2">
                {presets.map((preset) => (
                    <MyButton
                        key={preset.key}
                        buttonType="secondary"
                        scale="small"
                        // Already in that state: nothing to apply.
                        disable={same(preset.keys)}
                        onClick={() =>
                            onChange([...enabled.filter((k) => !all.includes(k)), ...preset.keys])
                        }
                    >
                        {t(`tools.preset.${preset.key}`)}
                    </MyButton>
                ))}
            </div>
        </div>
    );
}
