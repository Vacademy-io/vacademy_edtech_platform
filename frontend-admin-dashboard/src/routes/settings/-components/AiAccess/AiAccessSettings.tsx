import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Robot, WarningCircle } from '@phosphor-icons/react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { MyButton } from '@/components/design-system/button';
import { useEntitlement } from '@/lib/capabilities/use-entitlement';
import {
    getAllRoles,
    type CustomRole,
} from '@/routes/manage-custom-teams/-services/custom-team-services';
import {
    ASSISTANT_ROLE_PRESETS,
    ASSISTANT_TOOLS_SETTING_KEY,
    NON_LEARNER_SYSTEM_ROLES,
    type AssistantToolsSettingData,
} from '../../-constants/assistant-tools';
import {
    MCP_LEARNER_ROLE_NAMES,
    MCP_SERVER_SETTING_KEY,
    mergeMcpSettingWithDefaults,
    type McpServerSettingData,
} from '../../-constants/mcp-server';
import {
    fetchAccessCatalog,
    fetchSettingData,
    saveAssistantSettingMerged,
    saveMcpSettingMerged,
} from '../../-services/ai-access-service';
import { fetchMcpConnectionInfo } from '../../-services/mcp-server-service';
import {
    buildAccessAreas,
    normalizeAssistantSetting,
    sameAssistantSetting,
    sameMcpSetting,
} from '../../-utils/ai-access';
import { McpAccessPresets, groupToolsByArea, isNeverAutoOn } from '../McpToolAccessList';
import { AccessAreaList, type DoorState } from './AccessAreaList';
import {
    McpConnectCard,
    McpConnectionsCard,
    McpEnableCard,
    McpRolesCard,
    formatRoleName,
} from './McpConnectionCards';

/**
 * Settings → AI access: the in-product assistant and AI apps connected over
 * MCP, configured on one screen. Each capability area appears once, with a
 * control for each side; a role picker edits either side's per-role extras.
 *
 * The two settings stay separate (ASSISTANT_TOOLS_SETTING and
 * MCP_SERVER_SETTING). Each save reads the latest stored value and applies only
 * what changed here (see -utils/ai-access.ts), so nothing else is overwritten.
 */

const EVERYONE = '__everyone__';

type Overrides = Record<string, { enabled_tools: string[] }>;

/** The stored value the screen loaded (`base`) and the screen's edited copy (`current`). */
interface Draft<T> {
    base: T;
    current: T;
}

export const AI_ACCESS_QUERY_KEYS = {
    catalog: ['ai-access-catalog'],
    assistant: ['ai-access-setting', ASSISTANT_TOOLS_SETTING_KEY],
    mcp: ['ai-access-setting', MCP_SERVER_SETTING_KEY],
} as const;

export default function AiAccessSettings() {
    const { t } = useTranslation('settingsAiAccess');
    const queryClient = useQueryClient();
    const entitlement = useEntitlement();
    const [scope, setScope] = useState<string>(EVERYONE);

    const catalogQuery = useQuery({
        queryKey: AI_ACCESS_QUERY_KEYS.catalog,
        queryFn: fetchAccessCatalog,
        staleTime: 60 * 1000,
    });
    const assistantQuery = useQuery({
        queryKey: AI_ACCESS_QUERY_KEYS.assistant,
        queryFn: () => fetchSettingData(ASSISTANT_TOOLS_SETTING_KEY),
        staleTime: 5 * 60 * 1000,
    });
    const mcpQuery = useQuery({
        queryKey: AI_ACCESS_QUERY_KEYS.mcp,
        queryFn: () => fetchSettingData(MCP_SERVER_SETTING_KEY),
        staleTime: 5 * 60 * 1000,
    });
    const infoQuery = useQuery({
        queryKey: ['mcp-connection-info'],
        queryFn: fetchMcpConnectionInfo,
        staleTime: 60 * 1000,
    });
    const { data: customRoles } = useQuery({ queryKey: ['custom-roles'], queryFn: getAllRoles });

    const catalog = catalogQuery.data;
    const areas = useMemo(
        () => (catalog ? buildAccessAreas(catalog, entitlement.isAssistantGroupEntitled) : []),
        [catalog, entitlement]
    );
    // Every MCP area, in the plan or not: a save gives each edit it writes its view.
    const allMcpAreas = useMemo(() => groupToolsByArea(catalog?.mcp_tools ?? []), [catalog]);

    // ── What is stored, and the screen's copy ──
    const assistantStored = useMemo<AssistantToolsSettingData | null>(
        () =>
            catalog && assistantQuery.isSuccess
                ? normalizeAssistantSetting(assistantQuery.data, catalog.assistant_default_setting)
                : null,
        [catalog, assistantQuery.isSuccess, assistantQuery.data]
    );
    const mcpStored = useMemo<McpServerSettingData | null>(
        () =>
            mcpQuery.isSuccess
                ? mergeMcpSettingWithDefaults(
                      (mcpQuery.data ?? null) as Partial<McpServerSettingData> | null
                  )
                : null,
        [mcpQuery.isSuccess, mcpQuery.data]
    );
    const [assistantDraft, setAssistantDraft] = useState<Draft<AssistantToolsSettingData> | null>(
        null
    );
    const [mcpDraft, setMcpDraft] = useState<Draft<McpServerSettingData> | null>(null);

    // A refetch replaces the copy only while nothing is being edited.
    useEffect(() => {
        if (!assistantStored) return;
        setAssistantDraft((prev) =>
            prev && !sameAssistantSetting(prev.base, prev.current)
                ? prev
                : { base: assistantStored, current: assistantStored }
        );
    }, [assistantStored]);
    useEffect(() => {
        if (!mcpStored) return;
        setMcpDraft((prev) =>
            prev && !sameMcpSetting(prev.base, prev.current)
                ? prev
                : { base: mcpStored, current: mcpStored }
        );
    }, [mcpStored]);

    const assistantDirty = Boolean(
        assistantDraft && !sameAssistantSetting(assistantDraft.base, assistantDraft.current)
    );
    const mcpDirty = Boolean(mcpDraft && !sameMcpSetting(mcpDraft.base, mcpDraft.current));

    const updateAssistant = (fn: (s: AssistantToolsSettingData) => AssistantToolsSettingData) =>
        setAssistantDraft((prev) => (prev ? { ...prev, current: fn(prev.current) } : prev));
    const updateMcp = (fn: (s: McpServerSettingData) => McpServerSettingData) =>
        setMcpDraft((prev) => (prev ? { ...prev, current: fn(prev.current) } : prev));

    // ── Saving: each setting merged into its latest stored value ──
    const { mutate: save, isPending: saving } = useMutation({
        mutationFn: async () => {
            if (assistantDraft && assistantDirty) {
                await saveAssistantSettingMerged(assistantDraft.base, assistantDraft.current);
                // Saved: the copy is now what is stored, so a refetch may replace it.
                setAssistantDraft((prev) => prev && { base: prev.current, current: prev.current });
            }
            if (mcpDraft && mcpDirty) {
                await saveMcpSettingMerged(mcpDraft.base, mcpDraft.current, allMcpAreas);
                setMcpDraft((prev) => prev && { base: prev.current, current: prev.current });
            }
        },
        onSuccess: () => toast.success(t('toasts.saved')),
        onError: () => toast.error(t('toasts.saveFailed')),
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: AI_ACCESS_QUERY_KEYS.assistant });
            queryClient.invalidateQueries({ queryKey: AI_ACCESS_QUERY_KEYS.mcp });
            queryClient.invalidateQueries({ queryKey: ['assistant-capabilities'] });
        },
    });

    // ── Roles ──
    // Staff roles: the system set, custom roles, and any role a saved setting names.
    const roleNames = useMemo(() => {
        const names = new Set(NON_LEARNER_SYSTEM_ROLES);
        for (const r of customRoles || []) {
            const upper = (r as CustomRole).name?.toUpperCase();
            if (upper) names.add(upper);
        }
        Object.keys(assistantDraft?.current.role_overrides ?? {}).forEach((r) => names.add(r));
        Object.keys(mcpDraft?.current.role_overrides ?? {}).forEach((r) => names.add(r));
        (mcpDraft?.current.allowed_roles ?? []).forEach((r) => names.add(r));
        // Learners and parents never use either: the assistant is in the admin portal, MCP is staff-only.
        return Array.from(names).filter((r) => !MCP_LEARNER_ROLE_NAMES.has(r.toUpperCase()));
    }, [customRoles, assistantDraft, mcpDraft]);

    const assistant = assistantDraft?.current ?? null;
    const mcp = mcpDraft?.current ?? null;
    const role = scope === EVERYONE ? null : scope;
    const assistantCustomized = Boolean(role && assistant?.role_overrides[role]);
    const mcpRoleAllowed = Boolean(role && mcp?.allowed_roles.includes(role));
    const mcpCustomized = Boolean(role && mcpRoleAllowed && mcp?.role_overrides[role]);
    const preset = role ? ASSISTANT_ROLE_PRESETS.find((p) => p.role === role) : undefined;

    const assistantDoor: DoorState = {
        enabled:
            (role && assistant?.role_overrides[role]?.enabled_tools) ||
            assistant?.enabled_tools ||
            [],
        editable: Boolean(assistant) && (!role || assistantCustomized),
        onChange: (next) =>
            updateAssistant((s) =>
                role
                    ? {
                          ...s,
                          role_overrides: { ...s.role_overrides, [role]: { enabled_tools: next } },
                      }
                    : { ...s, enabled_tools: next }
            ),
    };
    const mcpDoor: DoorState = {
        enabled:
            (role && mcpCustomized && mcp?.role_overrides[role]?.enabled_tools) ||
            mcp?.enabled_tools ||
            [],
        editable: Boolean(mcp) && (!role || mcpCustomized),
        onChange: (next) =>
            updateMcp((s) =>
                role
                    ? {
                          ...s,
                          role_overrides: { ...s.role_overrides, [role]: { enabled_tools: next } },
                      }
                    : { ...s, enabled_tools: next }
            ),
    };

    // A role's own list starts as a copy of what everyone has; switching it off removes it.
    const withRoleList = <T extends { enabled_tools: string[]; role_overrides: Overrides }>(
        s: T,
        on: boolean
    ): T => {
        if (!role) return s;
        const next = { ...s.role_overrides };
        if (on) next[role] = { enabled_tools: [...s.enabled_tools] };
        else delete next[role];
        return { ...s, role_overrides: next };
    };
    const customizeAssistant = (on: boolean) => updateAssistant((s) => withRoleList(s, on));
    const customizeMcp = (on: boolean) => updateMcp((s) => withRoleList(s, on));

    /** One-click preset: grant the suggested groups to the role (additive). */
    const applyPreset = () => {
        if (!role || !preset) return;
        const offered = new Set((catalog?.assistant_groups ?? []).map((g) => g.key));
        const listed = preset.tools.filter((key) => offered.has(key));
        updateAssistant((s) => {
            const current = s.role_overrides[role]?.enabled_tools ?? [];
            return {
                ...s,
                role_overrides: {
                    ...s.role_overrides,
                    [role]: { enabled_tools: Array.from(new Set([...current, ...listed])) },
                },
            };
        });
        toast.info(t('scope.presetApplied'));
    };

    const toggleMcpEnabled = (on: boolean) =>
        updateMcp((s) => {
            // Turning the server on with nothing ticked produced a connection that
            // listed zero tools, which reads as broken. Enabling means "make this
            // usable", so switch on the catalogue with it, never an opt-in edit
            // (publishing, live data) or one that calls or messages people.
            const seedable = (catalog?.mcp_tools ?? []).filter(
                (tool) => !tool.always_on && tool.entitled !== false && !isNeverAutoOn(tool)
            );
            const enabled_tools =
                on && s.enabled_tools.length === 0 && seedable.length > 0
                    ? seedable.map((tool) => tool.key)
                    : s.enabled_tools;
            return { ...s, enabled: on, enabled_tools };
        });

    const toggleMcpRole = (name: string, on: boolean) =>
        updateMcp((s) => {
            const allowed_roles = on
                ? Array.from(new Set([...s.allowed_roles, name]))
                : s.allowed_roles.filter((r) => r !== name);
            // Dropping a role from "who can connect" also drops its per-role list.
            const role_overrides = { ...s.role_overrides };
            if (!on) delete role_overrides[name];
            return { ...s, allowed_roles, role_overrides };
        });

    const loading = catalogQuery.isLoading || assistantQuery.isLoading || mcpQuery.isLoading;
    const settingsError = assistantQuery.isError || mcpQuery.isError;
    const dirty = assistantDirty || mcpDirty;
    const mcpAreasInPlan = areas.flatMap((a) => (a.mcp ? [a.mcp] : []));
    const scopeLabel = (name: string) => {
        const custom =
            Boolean(assistant?.role_overrides[name]) ||
            Boolean(mcp?.allowed_roles.includes(name) && mcp?.role_overrides[name]);
        return custom
            ? t('scope.customized', { role: formatRoleName(name) })
            : formatRoleName(name);
    };

    if (loading) {
        return <div className="p-4 text-body text-neutral-500 sm:p-6">{t('loading')}</div>;
    }

    return (
        <div className="space-y-6 p-4 sm:p-6">
            <Card>
                <CardHeader>
                    <div className="flex items-center gap-2">
                        <Robot size={20} weight="fill" className="shrink-0 text-primary-500" />
                        <CardTitle>{t('header.title')}</CardTitle>
                    </div>
                    <CardDescription>{t('header.description')}</CardDescription>
                </CardHeader>
            </Card>

            {(catalogQuery.isError || settingsError) && (
                <div className="flex items-start gap-2 rounded-lg bg-warning-50 p-3">
                    <WarningCircle size={18} className="mt-0.5 shrink-0 !text-warning-600" />
                    <p className="text-caption text-warning-700">
                        {settingsError
                            ? t('errors.settingsUnavailable')
                            : t('errors.catalogUnavailable')}
                    </p>
                </div>
            )}

            {catalog && assistant && mcp && (
                <Card>
                    <CardHeader>
                        <CardTitle>{t('capabilities.title')}</CardTitle>
                        <CardDescription>{t('capabilities.description')}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-3 rounded-lg bg-neutral-50 p-3">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                                <label
                                    htmlFor="ai-access-scope"
                                    className="shrink-0 text-caption font-medium text-neutral-700"
                                >
                                    {t('scope.label')}
                                </label>
                                <Select value={scope} onValueChange={setScope}>
                                    <SelectTrigger
                                        id="ai-access-scope"
                                        className="h-10 w-full bg-white sm:max-w-xs"
                                    >
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value={EVERYONE}>
                                            {t('scope.everyone')}
                                        </SelectItem>
                                        {roleNames.map((name) => (
                                            <SelectItem key={name} value={name}>
                                                {scopeLabel(name)}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <p className="text-caption text-neutral-600">
                                {role
                                    ? t('scope.roleHint', { role: formatRoleName(role) })
                                    : t('scope.everyoneHint')}
                            </p>
                            {role && (
                                <div className="flex flex-col gap-3 border-t border-neutral-200 pt-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6">
                                    <label className="flex items-center gap-2">
                                        <Switch
                                            checked={assistantCustomized}
                                            onCheckedChange={customizeAssistant}
                                        />
                                        <span className="text-caption text-neutral-700">
                                            {t('scope.customizeAssistant')}
                                        </span>
                                    </label>
                                    {mcpRoleAllowed ? (
                                        <label className="flex items-center gap-2">
                                            <Switch
                                                checked={mcpCustomized}
                                                onCheckedChange={customizeMcp}
                                            />
                                            <span className="text-caption text-neutral-700">
                                                {t('scope.customizeMcp')}
                                            </span>
                                        </label>
                                    ) : (
                                        <p className="text-caption text-neutral-500">
                                            {t('scope.notAllowedMcp')}
                                        </p>
                                    )}
                                    {preset && (
                                        <MyButton
                                            buttonType="secondary"
                                            scale="small"
                                            onClick={applyPreset}
                                        >
                                            {t('scope.applyPreset')}
                                        </MyButton>
                                    )}
                                </div>
                            )}
                        </div>

                        {!mcp.enabled && (
                            <p className="text-caption text-neutral-600">{t('mcpOff')}</p>
                        )}

                        {mcpDoor.editable && mcpAreasInPlan.length > 0 && (
                            <div className="flex flex-col gap-1">
                                <span className="text-caption font-medium text-neutral-700">
                                    {t('mcpPresetsLabel')}
                                </span>
                                <McpAccessPresets
                                    areas={mcpAreasInPlan}
                                    enabled={mcpDoor.enabled}
                                    onChange={mcpDoor.onChange}
                                />
                            </div>
                        )}

                        <AccessAreaList
                            areas={areas}
                            assistant={assistantDoor}
                            mcp={mcpDoor}
                            idPrefix={`ai-access-${role ?? 'everyone'}`}
                        />
                    </CardContent>
                </Card>
            )}

            {mcp && (
                <section className="space-y-4">
                    <div>
                        <h2 className="text-subtitle font-semibold text-neutral-800">
                            {t('section.mcpTitle')}
                        </h2>
                        <p className="text-caption text-neutral-600">
                            {t('section.mcpDescription')}
                        </p>
                    </div>
                    <McpEnableCard enabled={mcp.enabled} onToggle={toggleMcpEnabled} />
                    <McpRolesCard
                        roleNames={roleNames}
                        allowedRoles={mcp.allowed_roles}
                        onToggleRole={toggleMcpRole}
                    />
                    {mcp.enabled && (
                        <McpConnectCard
                            info={infoQuery.data}
                            infoLoading={infoQuery.isLoading}
                            infoError={infoQuery.isError}
                        />
                    )}
                    <McpConnectionsCard info={infoQuery.data} />
                </section>
            )}

            <div className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-2 border-t border-neutral-200 bg-white px-4 py-3 sm:-mx-6 sm:flex-row sm:items-center sm:justify-end sm:px-6">
                {dirty && (
                    <p className="text-caption text-neutral-600 sm:me-auto">
                        {t('footer.unsaved')}
                    </p>
                )}
                <MyButton
                    buttonType="primary"
                    scale="medium"
                    onClick={() => save()}
                    disable={saving || !dirty}
                >
                    {saving ? t('footer.saving') : t('footer.save')}
                </MyButton>
            </div>
        </div>
    );
}
