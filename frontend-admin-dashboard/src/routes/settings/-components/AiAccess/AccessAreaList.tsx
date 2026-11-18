import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CaretRight } from '@phosphor-icons/react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Switch } from '@/components/ui/switch';
import { StatusChip } from '@/components/design-system/status-chips';
import { cn } from '@/lib/utils';
import type { AssistantGroupEntry } from '../../-constants/ai-access';
import type { McpToolCatalogEntry } from '../../-constants/mcp-server';
import {
    assistantAreaLevel,
    assistantAutoEditKeys,
    assistantLevels,
    withAssistantAreaLevel,
    type AccessArea,
} from '../../-utils/ai-access';
import {
    LevelControl,
    areaLevel,
    autoEditKeys,
    isNeverAutoOn,
    levelsBelow,
    riskStatus,
    withAreaLevel,
    type McpAccessLevel,
} from '../McpToolAccessList';

/**
 * The capability list of Settings → AI access: one row per area, with an
 * Off / View / Edit control for the in-product assistant and one for AI apps.
 * Opening a row shows each side's single capabilities with their own switches.
 */

/** One side's list as the current role picker shows it. */
export interface DoorState {
    /** The setting keys switched on for the scope shown (with a role picked: everyone's plus its own). */
    enabled: string[];
    /**
     * With a role picked: the keys on for everyone. They show as "On for
     * everyone" and can't be switched off here, only under Everyone.
     */
    inherited?: string[];
    /** False while the picker shows a role that has no list of its own on this side, or while saving. */
    editable: boolean;
    onChange: (next: string[]) => void;
}

interface AccessAreaListProps {
    areas: AccessArea[];
    assistant: DoorState;
    mcp: DoorState;
    /** Unique per list on the page, so control ids don't collide. */
    idPrefix: string;
}

export function AccessAreaList({ areas, assistant, mcp, idPrefix }: AccessAreaListProps) {
    const { t } = useTranslation('settingsAiAccess');
    // Role names can hold spaces; an id with a space breaks htmlFor.
    const safePrefix = idPrefix.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
    return (
        <div className="rounded-lg border border-neutral-200">
            <div className="hidden items-center gap-4 border-b border-neutral-200 bg-neutral-50 px-4 py-2 lg:flex">
                <span className="flex-1" />
                <span className="w-56 text-caption font-medium text-neutral-600">
                    {t('doors.assistant')}
                </span>
                <span className="w-56 text-caption font-medium text-neutral-600">
                    {t('doors.mcp')}
                </span>
            </div>
            <ul className="divide-y divide-neutral-100">
                {areas.map((area) => (
                    <AreaRow
                        key={area.key}
                        area={area}
                        assistant={assistant}
                        mcp={mcp}
                        idPrefix={safePrefix}
                    />
                ))}
            </ul>
        </div>
    );
}

/** A side's cell in a row. Its caption shows on narrow screens, where there is no column header. */
function DoorCell({ caption, children }: { caption: string; children: ReactNode }) {
    return (
        <div className="flex min-w-0 flex-col gap-1 lg:w-56">
            <span className="text-caption font-medium text-neutral-500 lg:sr-only">{caption}</span>
            <div className="flex flex-wrap items-center gap-2">{children}</div>
        </div>
    );
}

interface AreaRowProps {
    area: AccessArea;
    assistant: DoorState;
    mcp: DoorState;
    idPrefix: string;
}

function AreaRow({ area, assistant, mcp, idPrefix }: AreaRowProps) {
    const { t } = useTranslation('settingsAiAccess');
    const { t: tMcp } = useTranslation('settingsMcpServer');
    const { t: tAssistant } = useTranslation('settingsAssistantTools');
    const [open, setOpen] = useState(false);

    const label = t(`areas.${area.key}.label`, { defaultValue: area.label });
    const summary = t(`areas.${area.key}.summary`, { defaultValue: area.summary });

    // ── In-product assistant ──
    const asst = area.assistant;
    const asstLevel = asst ? assistantAreaLevel(asst, assistant.enabled) : 'off';
    // With a role picked: the level everyone has here, which the role can't go below.
    const asstInheritedLevel = asst ? assistantAreaLevel(asst, assistant.inherited ?? []) : 'off';
    const asstInherited = (key: string) => Boolean(assistant.inherited?.includes(key));
    const changeAssistantLevel = (next: McpAccessLevel) => {
        if (!asst) return;
        // Edit turns nothing on in an area whose changes are all turned on one by
        // one: open the row so the admin sees the switches.
        if (next === 'edit' && !assistantAutoEditKeys(asst).length && asstLevel !== 'edit')
            setOpen(true);
        assistant.onChange(withAssistantAreaLevel(asst, next, assistant.enabled));
    };
    const groupLabel = (group: AssistantGroupEntry) =>
        tAssistant(`tools.${group.key}.label`, { defaultValue: group.label });
    const groupDescription = (group: AssistantGroupEntry) =>
        tAssistant(`tools.${group.key}.description`, { defaultValue: '' });
    const toggleGroup = (key: string, on: boolean) => {
        const next = new Set(assistant.enabled);
        if (on) next.add(key);
        else next.delete(key);
        assistant.onChange(Array.from(next));
    };

    // ── AI apps (MCP) ──
    const tools = area.mcp;
    const mcpLevel: McpAccessLevel = tools
        ? tools.alwaysOn
            ? 'view'
            : areaLevel(tools, mcp.enabled)
        : 'off';
    const mcpInheritedLevel: McpAccessLevel =
        tools && !tools.alwaysOn ? areaLevel(tools, mcp.inherited ?? []) : 'off';
    const mcpInherited = (key: string) => Boolean(mcp.inherited?.includes(key));
    const mcpLevels: McpAccessLevel[] = tools?.edits.length
        ? ['off', 'view', 'edit']
        : ['off', 'view'];
    // Edits the Edit level turns on by itself; the rest each get their own switch,
    // even when the area has just one edit.
    const autoKeys = tools ? autoEditKeys(tools) : [];
    const ownSwitch = (tool: McpToolCatalogEntry) =>
        (tools?.edits.length ?? 0) > 1 || !autoKeys.includes(tool.key);
    const liveEditOn = Boolean(
        tools?.edits.some(
            (tool) =>
                (tool.risk === 'live' || tool.risk === 'live_additive') &&
                mcp.enabled.includes(tool.key)
        )
    );
    const outboundEditOn = Boolean(
        tools?.edits.some((tool) => tool.risk === 'outbound' && mcp.enabled.includes(tool.key))
    );
    const changeMcpLevel = (next: McpAccessLevel) => {
        if (!tools) return;
        // Edit turns nothing on in an area whose edits are all opt-in: open the
        // row so the admin sees the switches instead of a control that did nothing.
        if (next === 'edit' && !autoKeys.length && mcpLevel !== 'edit') setOpen(true);
        mcp.onChange(withAreaLevel(tools, next, mcp.enabled));
    };
    const toggleTool = (key: string, on: boolean) => {
        const next = new Set(mcp.enabled);
        if (on) {
            next.add(key);
            if (tools?.view) next.add(tools.view.key);
        } else {
            next.delete(key);
        }
        mcp.onChange(Array.from(next));
    };

    const alwaysOnChip = (
        <StatusChip
            status="SUCCESS"
            textSize="text-caption"
            showIcon={false}
            text={tMcp('tools.alwaysOn')}
        />
    );
    const outsidePlanChip = (
        <StatusChip
            status="INFO"
            textSize="text-caption"
            showIcon={false}
            text={t('door.outsidePlan')}
        />
    );
    const notOffered = <span className="text-caption text-neutral-400">{t('door.none')}</span>;
    const everyoneChip = (
        <StatusChip
            status="INFO"
            textSize="text-caption"
            showIcon={false}
            text={t('door.everyoneOn')}
        />
    );

    const assistantCell = asst ? (
        asst.alwaysOn ? (
            alwaysOnChip
        ) : (
            <>
                <LevelControl
                    label={t('doors.levelAria', { area: label, door: t('doors.assistant') })}
                    value={asstLevel}
                    levels={assistantLevels(asst)}
                    disabled={!assistant.editable}
                    disabledLevels={levelsBelow(asstInheritedLevel)}
                    onChange={changeAssistantLevel}
                />
                {asstInheritedLevel !== 'off' && everyoneChip}
            </>
        )
    ) : area.assistantOutsidePlan ? (
        outsidePlanChip
    ) : (
        notOffered
    );

    const mcpCell = tools ? (
        tools.alwaysOn ? (
            alwaysOnChip
        ) : (
            <>
                <LevelControl
                    label={t('doors.levelAria', { area: label, door: t('doors.mcp') })}
                    value={mcpLevel}
                    levels={mcpLevels}
                    disabled={!mcp.editable}
                    disabledLevels={levelsBelow(mcpInheritedLevel)}
                    onChange={changeMcpLevel}
                />
                {mcpInheritedLevel !== 'off' && everyoneChip}
                {liveEditOn && (
                    <StatusChip
                        status="WARNING"
                        textSize="text-caption"
                        showIcon={false}
                        text={tMcp('tools.risk.live')}
                    />
                )}
                {outboundEditOn && (
                    <StatusChip
                        status="DANGER"
                        textSize="text-caption"
                        showIcon={false}
                        text={tMcp('tools.risk.outbound')}
                    />
                )}
            </>
        )
    ) : area.mcpOutsidePlan ? (
        outsidePlanChip
    ) : (
        notOffered
    );

    const unavailable = (outsidePlan: boolean) => (
        <p className="text-caption text-neutral-500">
            {outsidePlan ? t('door.outsidePlanHint') : t('door.none')}
        </p>
    );

    return (
        <Collapsible open={open} onOpenChange={setOpen} asChild>
            <li className="p-3 sm:px-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
                    <CollapsibleTrigger className="group flex min-w-0 flex-1 items-start gap-2 rounded-md text-start focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                        <CaretRight
                            size={16}
                            className={cn(
                                'mt-0.5 shrink-0 text-neutral-500 transition-transform',
                                open ? 'rotate-90' : 'rtl:rotate-180'
                            )}
                        />
                        <span className="min-w-0">
                            <span className="block text-body font-medium text-neutral-800">
                                {label}
                            </span>
                            {summary && (
                                <span className="mt-0.5 block text-caption text-neutral-500">
                                    {summary}
                                </span>
                            )}
                        </span>
                    </CollapsibleTrigger>
                    <div className="grid grid-cols-1 gap-3 ps-6 sm:grid-cols-2 lg:flex lg:shrink-0 lg:gap-4 lg:ps-0">
                        <DoorCell caption={t('doors.assistant')}>{assistantCell}</DoorCell>
                        <DoorCell caption={t('doors.mcp')}>{mcpCell}</DoorCell>
                    </div>
                </div>

                <CollapsibleContent>
                    <div className="ms-6 mt-3 grid grid-cols-1 gap-4 border-s border-neutral-200 ps-4 sm:grid-cols-2">
                        <section className="min-w-0 space-y-3">
                            <p className="text-caption font-semibold text-neutral-700">
                                {t('doors.assistant')}
                            </p>
                            {!asst
                                ? unavailable(area.assistantOutsidePlan)
                                : [...asst.views, ...asst.edits].map((group) => {
                                      const switchId = `${idPrefix}-assistant-${group.key}`;
                                      const description = groupDescription(group);
                                      return (
                                          <div key={group.key} className="flex items-start gap-3">
                                              {!group.always_on && (
                                                  <Switch
                                                      id={switchId}
                                                      checked={assistant.enabled.includes(
                                                          group.key
                                                      )}
                                                      disabled={
                                                          !assistant.editable ||
                                                          asstInherited(group.key)
                                                      }
                                                      onCheckedChange={(v) =>
                                                          toggleGroup(group.key, v)
                                                      }
                                                  />
                                              )}
                                              <div className="min-w-0">
                                                  <div className="flex flex-wrap items-center gap-2">
                                                      {group.always_on ? (
                                                          <span className="text-caption font-medium text-neutral-700">
                                                              {groupLabel(group)}
                                                          </span>
                                                      ) : (
                                                          <label
                                                              htmlFor={switchId}
                                                              className="cursor-pointer text-caption font-medium text-neutral-700"
                                                          >
                                                              {groupLabel(group)}
                                                          </label>
                                                      )}
                                                      {group.always_on && alwaysOnChip}
                                                      {!group.always_on &&
                                                          asstInherited(group.key) &&
                                                          everyoneChip}
                                                      {group.opt_in && (
                                                          <StatusChip
                                                              status="INFO"
                                                              textSize="text-caption"
                                                              showIcon={false}
                                                              text={tMcp('tools.optIn')}
                                                          />
                                                      )}
                                                  </div>
                                                  {description && (
                                                      <p className="text-caption text-neutral-600">
                                                          {description}
                                                      </p>
                                                  )}
                                              </div>
                                          </div>
                                      );
                                  })}
                            {asst &&
                                asst.edits.some((g) => !g.always_on) &&
                                !assistantAutoEditKeys(asst).length && (
                                    <p className="text-caption text-neutral-500">
                                        {tMcp('tools.eachOnItsOwn')}
                                    </p>
                                )}
                            {asst && asst.edits.length > 0 && (
                                <p className="text-caption text-neutral-500">
                                    {t('door.assistantEdits')}
                                </p>
                            )}
                        </section>

                        <section className="min-w-0 space-y-3">
                            <p className="text-caption font-semibold text-neutral-700">
                                {t('doors.mcp')}
                            </p>
                            {!tools ? (
                                unavailable(area.mcpOutsidePlan)
                            ) : (
                                <>
                                    {tools.view && (
                                        <div>
                                            <p className="text-caption font-medium text-neutral-700">
                                                {tMcp('tools.level.view')}
                                            </p>
                                            <p className="text-caption text-neutral-600">
                                                {tools.view.summary || tools.view.description}
                                            </p>
                                        </div>
                                    )}
                                    {tools.edits.length > 0 && !autoKeys.length && (
                                        <p className="text-caption text-neutral-500">
                                            {tMcp('tools.eachOnItsOwn')}
                                        </p>
                                    )}
                                    {tools.edits.map((tool) => {
                                        const on = mcp.enabled.includes(tool.key);
                                        const switchId = `${idPrefix}-mcp-${tool.key}`;
                                        return (
                                            <div key={tool.key} className="flex items-start gap-3">
                                                {ownSwitch(tool) && (
                                                    <Switch
                                                        id={switchId}
                                                        checked={on}
                                                        disabled={
                                                            !mcp.editable || mcpInherited(tool.key)
                                                        }
                                                        onCheckedChange={(v) =>
                                                            toggleTool(tool.key, v)
                                                        }
                                                    />
                                                )}
                                                <div className="min-w-0">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        {ownSwitch(tool) ? (
                                                            <label
                                                                htmlFor={switchId}
                                                                className="cursor-pointer text-caption font-medium text-neutral-700"
                                                            >
                                                                {tool.sub_label ?? tool.label}
                                                            </label>
                                                        ) : (
                                                            <span className="text-caption font-medium text-neutral-700">
                                                                {tMcp('tools.level.edit')}
                                                            </span>
                                                        )}
                                                        {tool.risk && (
                                                            <StatusChip
                                                                status={riskStatus(tool.risk)}
                                                                textSize="text-caption"
                                                                showIcon={false}
                                                                text={tMcp(
                                                                    `tools.risk.${tool.risk}`
                                                                )}
                                                            />
                                                        )}
                                                        {ownSwitch(tool) &&
                                                            mcpInherited(tool.key) &&
                                                            everyoneChip}
                                                        {isNeverAutoOn(tool) && (
                                                            <StatusChip
                                                                status="INFO"
                                                                textSize="text-caption"
                                                                showIcon={false}
                                                                text={tMcp('tools.optIn')}
                                                            />
                                                        )}
                                                    </div>
                                                    <p className="text-caption text-neutral-600">
                                                        {tool.summary || tool.description}
                                                    </p>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </>
                            )}
                        </section>
                    </div>
                </CollapsibleContent>
            </li>
        </Collapsible>
    );
}
