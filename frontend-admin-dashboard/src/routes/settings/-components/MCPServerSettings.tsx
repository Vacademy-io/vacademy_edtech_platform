import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Check, Copy, Plus, PlugsConnected, Trash, WarningCircle } from '@phosphor-icons/react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { MyButton } from '@/components/design-system/button';
import { MyDropdown } from '@/components/design-system/dropdown';
import {
    getAllRoles,
    type CustomRole,
} from '@/routes/manage-custom-teams/-services/custom-team-services';
import {
    createMcpManualClient,
    deleteMcpManualClient,
    fetchMcpConnectionInfo,
    fetchMcpSettings,
    revokeMcpConnection,
    saveMcpSettings,
} from '../-services/mcp-server-service';
import {
    MCP_LEARNER_ROLE_NAMES,
    MCP_SYSTEM_ROLES,
    defaultMcpServerSetting,
    type McpServerSettingData,
    type McpToolCatalogEntry,
} from '../-constants/mcp-server';
import {
    McpAccessPresets,
    McpToolAccessList,
    groupToolsByArea,
    isNeverAutoOn,
    withViewsForEdits,
} from './McpToolAccessList';

export default function MCPServerSettings() {
    const { t, i18n } = useTranslation('settingsMcpServer');
    const queryClient = useQueryClient();
    const [settings, setSettings] = useState<McpServerSettingData>(defaultMcpServerSetting);
    const [hasChanges, setHasChanges] = useState(false);
    const [copiedKey, setCopiedKey] = useState<string | null>(null);
    const [newClientName, setNewClientName] = useState('');
    const [newClientRedirects, setNewClientRedirects] = useState('');
    const [showClientForm, setShowClientForm] = useState(false);

    const { data, isLoading } = useQuery({
        queryKey: ['mcp-server-settings'],
        queryFn: fetchMcpSettings,
        staleTime: 5 * 60 * 1000,
    });

    const {
        data: info,
        isLoading: infoLoading,
        isError: infoError,
    } = useQuery({
        queryKey: ['mcp-connection-info'],
        queryFn: fetchMcpConnectionInfo,
        staleTime: 60 * 1000,
    });

    const { data: customRoles } = useQuery({ queryKey: ['custom-roles'], queryFn: getAllRoles });

    useEffect(() => {
        if (data) {
            setSettings(data);
            setHasChanges(false);
        }
    }, [data]);

    const { mutate: save, isPending: saving } = useMutation({
        mutationFn: saveMcpSettings,
        onSuccess: () => {
            toast.success(t('toasts.settingsSaved'));
            setHasChanges(false);
            queryClient.invalidateQueries({ queryKey: ['mcp-server-settings'] });
        },
        onError: () => toast.error(t('toasts.saveFailed')),
    });

    const { mutate: createClient, isPending: creatingClient } = useMutation({
        mutationFn: createMcpManualClient,
        onSuccess: () => {
            toast.success(t('clients.created'));
            setNewClientName('');
            setNewClientRedirects('');
            queryClient.invalidateQueries({ queryKey: ['mcp-connection-info'] });
        },
        onError: () => toast.error(t('clients.createFailed')),
    });

    const { mutate: removeClient } = useMutation({
        mutationFn: deleteMcpManualClient,
        onSuccess: () => {
            toast.success(t('clients.removed'));
            queryClient.invalidateQueries({ queryKey: ['mcp-connection-info'] });
        },
        onError: () => toast.error(t('clients.removeFailed')),
    });

    const { mutate: revokeConnection } = useMutation({
        mutationFn: revokeMcpConnection,
        onSuccess: () => {
            toast.success(t('connections.revoked'));
            queryClient.invalidateQueries({ queryKey: ['mcp-connection-info'] });
        },
        onError: () => toast.error(t('connections.revokeFailed')),
    });

    // Roles that may connect: the system set + any custom roles, minus learners.
    const roleNames = useMemo(() => {
        const names = new Set(MCP_SYSTEM_ROLES);
        for (const r of customRoles || []) {
            const upper = (r as CustomRole).name?.toUpperCase();
            if (upper && !MCP_LEARNER_ROLE_NAMES.has(upper)) names.add(upper);
        }
        return Array.from(names);
    }, [customRoles]);

    const tools: McpToolCatalogEntry[] = useMemo(() => info?.tools ?? [], [info?.tools]);
    // Always-on tools (identity) are shown but never written into the setting.
    const toggleableTools = tools.filter((tool) => !tool.always_on);
    // One row per area (Website, Courses, …) with Off / View / Edit.
    const areas = useMemo(() => groupToolsByArea(tools), [tools]);

    // The allow-list as a LIST, not a switch per role: institutes have a dozen+
    // roles and only a couple ever connect, so the page shows who is allowed
    // and offers the rest in a dropdown.
    const allowedRoles = useMemo(
        () => roleNames.filter((role) => settings.allowed_roles.includes(role)),
        [roleNames, settings.allowed_roles]
    );
    const addableRoles = useMemo(
        () => roleNames.filter((role) => !settings.allowed_roles.includes(role)),
        [roleNames, settings.allowed_roles]
    );
    const formatRoleName = (role: string) =>
        role
            .toLowerCase()
            .split('_')
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ');

    // The institute's own client ID is provisioned by the backend and cannot be
    // removed; anything else in the list is one an admin added for a specific app.
    const primaryClient = useMemo(
        () => (info?.manual_clients ?? []).find((c) => c.is_primary) ?? null,
        [info?.manual_clients]
    );
    const customClients = useMemo(
        () => (info?.manual_clients ?? []).filter((c) => !c.is_primary),
        [info?.manual_clients]
    );

    const copyToClipboard = async (key: string, value: string) => {
        if (!value) return;
        try {
            await navigator.clipboard.writeText(value);
            setCopiedKey(key);
            setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 2000);
        } catch {
            // Clipboard access can be blocked by the browser; the value is still
            // visible/selectable in the field, so this is a silent no-op.
        }
    };

    const toggleEnabled = (on: boolean) => {
        setSettings((prev) => {
            // Turning the server on with nothing ticked produced a connection that
            // listed zero tools — technically correct, but it reads as broken. An
            // admin enabling the server means "make this usable", so switch the
            // read-only catalogue on with it. They can untick individually below.
            // Opt-in capabilities (website publishing) and edits that call or message
            // leads are never seeded.
            const seedTools =
                on && prev.enabled_tools.length === 0 && toggleableTools.length > 0
                    ? toggleableTools.filter((tool) => !isNeverAutoOn(tool)).map((tool) => tool.key)
                    : prev.enabled_tools;
            return { ...prev, enabled: on, enabled_tools: seedTools };
        });
        setHasChanges(true);
    };

    const isRoleAllowed = (role: string) => settings.allowed_roles.includes(role);

    const toggleRoleAllowed = (role: string, on: boolean) => {
        setSettings((prev) => {
            const allowed_roles = on
                ? Array.from(new Set([...prev.allowed_roles, role]))
                : prev.allowed_roles.filter((r) => r !== role);
            // Dropping a role from "who can connect" also drops its per-role overrides.
            const role_overrides = { ...prev.role_overrides };
            if (!on) delete role_overrides[role];
            return { ...prev, allowed_roles, role_overrides };
        });
        setHasChanges(true);
    };

    const setEnabledTools = (enabled_tools: string[]) => {
        setSettings((prev) => ({ ...prev, enabled_tools }));
        setHasChanges(true);
    };

    const isRoleCustomized = (role: string) => Boolean(settings.role_overrides[role]);

    const toggleRoleCustomized = (role: string, on: boolean) => {
        setSettings((prev) => {
            const next = { ...prev.role_overrides };
            if (on) next[role] = { enabled_tools: [...prev.enabled_tools] };
            else delete next[role];
            return { ...prev, role_overrides: next };
        });
        setHasChanges(true);
    };

    const setRoleTools = (role: string, enabled_tools: string[]) => {
        setSettings((prev) => ({
            ...prev,
            role_overrides: { ...prev.role_overrides, [role]: { enabled_tools } },
        }));
        setHasChanges(true);
    };

    // Edit includes view: settings saved before areas existed could hold an edit
    // tool with its view off, so every save tops the views up.
    const handleSave = () =>
        save({
            ...settings,
            enabled_tools: withViewsForEdits(areas, settings.enabled_tools),
            role_overrides: Object.fromEntries(
                Object.entries(settings.role_overrides).map(([role, o]) => [
                    role,
                    { ...o, enabled_tools: withViewsForEdits(areas, o.enabled_tools) },
                ])
            ),
        });

    const handleCreateClient = () => {
        const client_name = newClientName.trim();
        const redirect_uris = newClientRedirects
            .split(',')
            .map((uri) => uri.trim())
            .filter(Boolean);
        if (!client_name || redirect_uris.length === 0) return;
        createClient({ client_name, redirect_uris });
    };

    if (isLoading) {
        return <div className="p-6 text-body text-neutral-500">{t('loading')}</div>;
    }

    return (
        <div className="space-y-6 p-6">
            <Card>
                <CardHeader>
                    <div className="flex items-center gap-2">
                        <PlugsConnected size={20} weight="fill" className="text-primary-500" />
                        <CardTitle>{t('header.title')}</CardTitle>
                    </div>
                    <CardDescription>{t('header.description')}</CardDescription>
                </CardHeader>
            </Card>

            {infoError && (
                <div className="flex items-start gap-2 rounded-lg bg-warning-50 p-3">
                    <WarningCircle size={18} className="mt-0.5 shrink-0 !text-warning-600" />
                    <p className="text-caption text-warning-700">{t('errors.infoUnavailable')}</p>
                </div>
            )}

            <Card>
                <CardHeader>
                    <CardTitle>{t('enable.title')}</CardTitle>
                    <CardDescription>{t('enable.description')}</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex items-start gap-3">
                        <Switch
                            id="mcp-enabled"
                            checked={settings.enabled}
                            onCheckedChange={toggleEnabled}
                        />
                        <div>
                            <Label
                                htmlFor="mcp-enabled"
                                className="cursor-pointer text-body font-medium text-neutral-800"
                            >
                                {t('enable.label')}
                            </Label>
                            <p className="mt-0.5 text-caption text-neutral-600">
                                {t('enable.hint')}
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {settings.enabled && (
                <Card>
                    <CardHeader>
                        <CardTitle>{t('connect.title')}</CardTitle>
                        <CardDescription>{t('connect.description')}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-5">
                        {infoError ? (
                            <p className="flex items-center gap-2 text-body text-danger-600">
                                <WarningCircle size={18} />
                                {t('errors.infoUnavailable')}
                            </p>
                        ) : infoLoading ? (
                            <div className="text-body text-neutral-500">{t('loading')}</div>
                        ) : (
                            <>
                                <div className="space-y-1.5">
                                    <Label className="text-caption font-medium text-neutral-600">
                                        {t('connect.serverUrlLabel')}
                                    </Label>
                                    <div className="flex items-center gap-2">
                                        <div className="flex-1 truncate rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 font-mono text-body text-neutral-800">
                                            {info?.server_url}
                                        </div>
                                        <MyButton
                                            buttonType="secondary"
                                            scale="small"
                                            onClick={() =>
                                                copyToClipboard(
                                                    'server-url',
                                                    info?.server_url ?? ''
                                                )
                                            }
                                        >
                                            {copiedKey === 'server-url' ? (
                                                <span className="flex items-center gap-1">
                                                    <Check size={14} />
                                                    {t('connect.copied')}
                                                </span>
                                            ) : (
                                                <span className="flex items-center gap-1">
                                                    <Copy size={14} />
                                                    {t('connect.copy')}
                                                </span>
                                            )}
                                        </MyButton>
                                    </div>
                                </div>

                                {primaryClient && (
                                    <div className="space-y-1.5">
                                        <Label className="text-caption font-medium text-neutral-600">
                                            {t('connect.clientIdLabel')}
                                        </Label>
                                        <div className="flex items-center gap-2">
                                            <div className="flex-1 break-all rounded-md border border-primary-200 bg-primary-50 px-4 py-3 font-mono text-subtitle font-medium text-neutral-800">
                                                {primaryClient.client_id}
                                            </div>
                                            <MyButton
                                                buttonType="secondary"
                                                scale="small"
                                                onClick={() =>
                                                    copyToClipboard(
                                                        'primary-client',
                                                        primaryClient.client_id
                                                    )
                                                }
                                            >
                                                {copiedKey === 'primary-client' ? (
                                                    <span className="flex items-center gap-1">
                                                        <Check size={14} />
                                                        {t('connect.copied')}
                                                    </span>
                                                ) : (
                                                    <span className="flex items-center gap-1">
                                                        <Copy size={14} />
                                                        {t('connect.copy')}
                                                    </span>
                                                )}
                                            </MyButton>
                                        </div>
                                        <p className="text-caption text-neutral-500">
                                            {t('connect.clientIdHint')}
                                        </p>
                                    </div>
                                )}

                                <div className="space-y-1.5 rounded-lg bg-neutral-50 p-3">
                                    <p className="text-caption font-medium text-neutral-700">
                                        {t('connect.howToTitle')}
                                    </p>
                                    <p className="text-caption text-neutral-600">
                                        {t('connect.howToClaude')}
                                    </p>
                                    <p className="text-caption text-neutral-600">
                                        {t('connect.howToCursor')}
                                    </p>
                                    <p className="text-caption text-neutral-600">
                                        {t('connect.howToManual')}
                                    </p>
                                </div>

                                {(customClients.length > 0 || showClientForm) && (
                                    <div className="space-y-2 border-t border-neutral-200 pt-4">
                                        <p className="text-body font-medium text-neutral-800">
                                            {t('clients.title')}
                                        </p>
                                        {customClients.map((client) => (
                                            <div
                                                key={client.client_id}
                                                className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3 sm:flex-row sm:items-center sm:justify-between"
                                            >
                                                <div className="min-w-0 space-y-1">
                                                    <p className="text-body font-medium text-neutral-800">
                                                        {client.client_name || client.client_id}
                                                    </p>
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-caption font-medium text-neutral-500">
                                                            {t('connect.clientIdLabel')}
                                                        </span>
                                                        <span className="truncate font-mono text-body text-neutral-600">
                                                            {client.client_id}
                                                        </span>
                                                        <MyButton
                                                            buttonType="text"
                                                            layoutVariant="icon"
                                                            scale="small"
                                                            aria-label={t('connect.copy')}
                                                            onClick={() =>
                                                                copyToClipboard(
                                                                    `client-${client.client_id}`,
                                                                    client.client_id
                                                                )
                                                            }
                                                        >
                                                            {copiedKey ===
                                                            `client-${client.client_id}` ? (
                                                                <Check size={14} />
                                                            ) : (
                                                                <Copy size={14} />
                                                            )}
                                                        </MyButton>
                                                    </div>
                                                </div>
                                                <MyButton
                                                    buttonType="text"
                                                    scale="small"
                                                    className="shrink-0 !text-danger-600"
                                                    onClick={() => removeClient(client.client_id)}
                                                >
                                                    <span className="flex items-center gap-1">
                                                        <Trash size={14} />
                                                        {t('clients.remove')}
                                                    </span>
                                                </MyButton>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {showClientForm ? (
                                    <div className="grid gap-3 rounded-lg border border-dashed border-neutral-300 p-3 sm:grid-cols-2">
                                        <div className="space-y-1.5">
                                            <Label
                                                htmlFor="mcp-new-client-name"
                                                className="text-caption font-medium text-neutral-600"
                                            >
                                                {t('clients.nameLabel')}
                                            </Label>
                                            <Input
                                                id="mcp-new-client-name"
                                                value={newClientName}
                                                placeholder={t('clients.namePlaceholder')}
                                                onChange={(e) => setNewClientName(e.target.value)}
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label
                                                htmlFor="mcp-new-client-redirects"
                                                className="text-caption font-medium text-neutral-600"
                                            >
                                                {t('clients.redirectLabel')}
                                            </Label>
                                            <Input
                                                id="mcp-new-client-redirects"
                                                value={newClientRedirects}
                                                placeholder={t('clients.redirectPlaceholder')}
                                                onChange={(e) =>
                                                    setNewClientRedirects(e.target.value)
                                                }
                                            />
                                            <p className="text-caption text-neutral-500">
                                                {t('clients.redirectHint')}
                                            </p>
                                        </div>
                                        <div className="flex justify-end gap-2 sm:col-span-2">
                                            <MyButton
                                                buttonType="secondary"
                                                scale="small"
                                                onClick={() => setShowClientForm(false)}
                                            >
                                                {t('clients.cancel')}
                                            </MyButton>
                                            <MyButton
                                                buttonType="primary"
                                                scale="small"
                                                disable={
                                                    creatingClient ||
                                                    !newClientName.trim() ||
                                                    !newClientRedirects.trim()
                                                }
                                                onClick={handleCreateClient}
                                            >
                                                {creatingClient
                                                    ? t('clients.creating')
                                                    : t('clients.create')}
                                            </MyButton>
                                        </div>
                                    </div>
                                ) : (
                                    <MyButton
                                        buttonType="secondary"
                                        scale="small"
                                        onClick={() => setShowClientForm(true)}
                                    >
                                        <span className="flex items-center gap-1">
                                            <Plus size={14} />
                                            {t('clients.addCustom')}
                                        </span>
                                    </MyButton>
                                )}
                            </>
                        )}
                    </CardContent>
                </Card>
            )}

            <Card>
                <CardHeader>
                    <CardTitle>{t('tools.title')}</CardTitle>
                    <CardDescription>{t('tools.description')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {tools.length === 0 ? (
                        <p className="text-body text-neutral-500">
                            {infoLoading
                                ? t('loading')
                                : infoError
                                  ? t('errors.infoUnavailable')
                                  : t('tools.empty')}
                        </p>
                    ) : (
                        <>
                            <McpAccessPresets
                                areas={areas}
                                enabled={settings.enabled_tools}
                                onChange={setEnabledTools}
                            />
                            <McpToolAccessList
                                areas={areas}
                                enabled={settings.enabled_tools}
                                onChange={setEnabledTools}
                                idPrefix="mcp-tools"
                            />
                        </>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>{t('roles.title')}</CardTitle>
                    <CardDescription>{t('roles.description')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    {allowedRoles.length === 0 ? (
                        <p className="text-body text-neutral-500">{t('roles.empty')}</p>
                    ) : (
                        <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
                            {allowedRoles.map((role) => (
                                <li
                                    key={role}
                                    className="flex items-center justify-between gap-3 px-3 py-2"
                                >
                                    <span className="text-body text-neutral-800">
                                        {formatRoleName(role)}
                                    </span>
                                    <MyButton
                                        buttonType="text"
                                        scale="small"
                                        className="shrink-0 !text-danger-600"
                                        onClick={() => toggleRoleAllowed(role, false)}
                                    >
                                        <span className="flex items-center gap-1">
                                            <Trash size={14} />
                                            {t('roles.remove')}
                                        </span>
                                    </MyButton>
                                </li>
                            ))}
                        </ul>
                    )}
                    {addableRoles.length > 0 && (
                        <div className="max-w-sm">
                            <MyDropdown
                                key={`add-role-${allowedRoles.length}`}
                                dropdownList={addableRoles.map((role) => ({
                                    label: formatRoleName(role),
                                    value: role,
                                }))}
                                placeholder={t('roles.addPlaceholder')}
                                handleChange={(role) => toggleRoleAllowed(role, true)}
                            />
                        </div>
                    )}
                    <p className="text-caption text-neutral-500">{t('roles.learnerNote')}</p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>{t('perRole.title')}</CardTitle>
                    <CardDescription>{t('perRole.description')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    {roleNames
                        .filter((role) => isRoleAllowed(role))
                        .map((role) => {
                            const customized = isRoleCustomized(role);
                            return (
                                <div
                                    key={role}
                                    className="space-y-3 rounded-lg border border-neutral-200 p-3"
                                >
                                    <div className="flex items-center justify-between gap-3">
                                        <span className="text-body font-medium text-neutral-800">
                                            {formatRoleName(role)}
                                        </span>
                                        <label className="flex items-center gap-2">
                                            <Switch
                                                checked={customized}
                                                onCheckedChange={(v) =>
                                                    toggleRoleCustomized(role, v)
                                                }
                                            />
                                            <span className="text-caption text-neutral-600">
                                                {t('perRole.customize')}
                                            </span>
                                        </label>
                                    </div>

                                    {customized && toggleableTools.length === 0 && (
                                        <p className="border-t border-neutral-100 pt-3 text-caption text-neutral-500">
                                            {infoError
                                                ? t('errors.infoUnavailable')
                                                : t('tools.empty')}
                                        </p>
                                    )}

                                    {customized && toggleableTools.length > 0 && (
                                        <McpToolAccessList
                                            areas={areas.filter((area) => !area.alwaysOn)}
                                            enabled={
                                                settings.role_overrides[role]?.enabled_tools ?? []
                                            }
                                            onChange={(next) => setRoleTools(role, next)}
                                            idPrefix={`mcp-role-${role}`}
                                        />
                                    )}
                                </div>
                            );
                        })}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>{t('connections.title')}</CardTitle>
                    <CardDescription>{t('connections.description')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                    {(info?.connections ?? []).length === 0 ? (
                        <p className="text-body text-neutral-500">{t('connections.empty')}</p>
                    ) : (
                        (info?.connections ?? []).map((conn) => (
                            <div
                                key={conn.pair_id}
                                className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3 sm:flex-row sm:items-center sm:justify-between"
                            >
                                <div className="min-w-0 space-y-0.5">
                                    <p className="truncate text-body font-medium text-neutral-800">
                                        {conn.client_name || conn.client_id}
                                    </p>
                                    <p className="text-caption text-neutral-600">
                                        {t('connections.connectedBy')}{' '}
                                        {conn.username || conn.user_id}
                                    </p>
                                    <p className="text-caption text-neutral-500">
                                        {t('connections.lastUsed')}{' '}
                                        {conn.last_used_at
                                            ? new Date(conn.last_used_at).toLocaleString(
                                                  i18n.language
                                              )
                                            : t('connections.never')}
                                    </p>
                                </div>
                                <MyButton
                                    buttonType="text"
                                    scale="small"
                                    className="shrink-0 !text-danger-600"
                                    onClick={() => revokeConnection(conn.pair_id)}
                                >
                                    {t('connections.revoke')}
                                </MyButton>
                            </div>
                        ))
                    )}
                </CardContent>
            </Card>

            <div className="flex justify-end">
                <MyButton
                    buttonType="primary"
                    scale="medium"
                    onClick={handleSave}
                    disable={saving || !hasChanges}
                >
                    {saving ? t('footer.saving') : t('footer.save')}
                </MyButton>
            </div>
        </div>
    );
}
