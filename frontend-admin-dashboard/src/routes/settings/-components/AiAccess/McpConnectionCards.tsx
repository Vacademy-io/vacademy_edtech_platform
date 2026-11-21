import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Check, Copy, Plus, Trash, WarningCircle } from '@phosphor-icons/react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { MyButton } from '@/components/design-system/button';
import { MyDropdown } from '@/components/design-system/dropdown';
import {
    createMcpManualClient,
    deleteMcpManualClient,
    revokeMcpConnection,
} from '../../-services/mcp-server-service';
import type { McpConnectionInfo } from '../../-constants/mcp-server';

/**
 * The MCP server's own parts of Settings → AI access: the on/off switch, who may
 * connect, the connection details and client IDs, and active connections. What
 * AI apps may DO is set per area in the capability list above them.
 */

/** "CONTENT_CREATOR" → "Content Creator". */
export const formatRoleName = (role: string) =>
    role
        .toLowerCase()
        .split(/[_ ]/)
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');

interface McpEnableCardProps {
    enabled: boolean;
    onToggle: (on: boolean) => void;
    disabled?: boolean;
}

export function McpEnableCard({ enabled, onToggle, disabled }: McpEnableCardProps) {
    const { t } = useTranslation('settingsMcpServer');
    return (
        <Card>
            <CardHeader>
                <CardTitle>{t('enable.title')}</CardTitle>
                <CardDescription>{t('enable.description')}</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="flex items-start gap-3">
                    <Switch
                        id="mcp-enabled"
                        checked={enabled}
                        disabled={disabled}
                        onCheckedChange={onToggle}
                    />
                    <div>
                        <Label
                            htmlFor="mcp-enabled"
                            className="cursor-pointer text-body font-medium text-neutral-800"
                        >
                            {t('enable.label')}
                        </Label>
                        <p className="mt-0.5 text-caption text-neutral-600">{t('enable.hint')}</p>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}

interface McpRolesCardProps {
    /** Every staff role the institute has (learner roles already left out). */
    roleNames: string[];
    allowedRoles: string[];
    onToggleRole: (role: string, on: boolean) => void;
    disabled?: boolean;
}

/**
 * The allow-list as a LIST, not a switch per role: institutes have a dozen+
 * roles and only a couple ever connect, so the card shows who is allowed and
 * offers the rest in a dropdown.
 */
export function McpRolesCard({
    roleNames,
    allowedRoles,
    onToggleRole,
    disabled,
}: McpRolesCardProps) {
    const { t } = useTranslation('settingsMcpServer');
    const allowed = roleNames.filter((role) => allowedRoles.includes(role));
    const addable = roleNames.filter((role) => !allowedRoles.includes(role));
    return (
        <Card>
            <CardHeader>
                <CardTitle>{t('roles.title')}</CardTitle>
                <CardDescription>{t('roles.description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                {allowed.length === 0 ? (
                    <p className="text-body text-neutral-500">{t('roles.empty')}</p>
                ) : (
                    <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
                        {allowed.map((role) => (
                            <li
                                key={role}
                                className="flex items-center justify-between gap-3 px-3 py-2"
                            >
                                <span className="min-w-0 truncate text-body text-neutral-800">
                                    {formatRoleName(role)}
                                </span>
                                <MyButton
                                    buttonType="text"
                                    scale="small"
                                    className="shrink-0 !text-danger-600"
                                    disable={disabled}
                                    onClick={() => onToggleRole(role, false)}
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
                {addable.length > 0 && (
                    <div className="max-w-sm">
                        <MyDropdown
                            key={`add-role-${allowed.length}`}
                            dropdownList={addable.map((role) => ({
                                label: formatRoleName(role),
                                value: role,
                            }))}
                            placeholder={t('roles.addPlaceholder')}
                            disable={disabled}
                            handleChange={(role) => onToggleRole(role, true)}
                        />
                    </div>
                )}
                <p className="text-caption text-neutral-500">{t('roles.learnerNote')}</p>
            </CardContent>
        </Card>
    );
}

interface McpConnectCardProps {
    info: McpConnectionInfo | undefined;
    infoLoading: boolean;
    infoError: boolean;
}

/** Server URL, the institute's client ID, how to connect, and client IDs for other apps. */
export function McpConnectCard({ info, infoLoading, infoError }: McpConnectCardProps) {
    const { t } = useTranslation('settingsMcpServer');
    const queryClient = useQueryClient();
    const [copiedKey, setCopiedKey] = useState<string | null>(null);
    const [newClientName, setNewClientName] = useState('');
    const [newClientRedirects, setNewClientRedirects] = useState('');
    const [showClientForm, setShowClientForm] = useState(false);

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

    const handleCreateClient = () => {
        const client_name = newClientName.trim();
        const redirect_uris = newClientRedirects
            .split(',')
            .map((uri) => uri.trim())
            .filter(Boolean);
        if (!client_name || redirect_uris.length === 0) return;
        createClient({ client_name, redirect_uris });
    };

    return (
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
                                        copyToClipboard('server-url', info?.server_url ?? '')
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
                                                    {copiedKey === `client-${client.client_id}` ? (
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
                                        onChange={(e) => setNewClientRedirects(e.target.value)}
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
    );
}

interface McpConnectionsCardProps {
    info: McpConnectionInfo | undefined;
}

/** AI apps connected right now; revoking one takes effect on its next request. */
export function McpConnectionsCard({ info }: McpConnectionsCardProps) {
    const { t, i18n } = useTranslation('settingsMcpServer');
    const queryClient = useQueryClient();
    const { mutate: revokeConnection } = useMutation({
        mutationFn: revokeMcpConnection,
        onSuccess: () => {
            toast.success(t('connections.revoked'));
            queryClient.invalidateQueries({ queryKey: ['mcp-connection-info'] });
        },
        onError: () => toast.error(t('connections.revokeFailed')),
    });
    const connections = info?.connections ?? [];

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t('connections.title')}</CardTitle>
                <CardDescription>{t('connections.description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
                {connections.length === 0 ? (
                    <p className="text-body text-neutral-500">{t('connections.empty')}</p>
                ) : (
                    connections.map((conn) => (
                        <div
                            key={conn.pair_id}
                            className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3 sm:flex-row sm:items-center sm:justify-between"
                        >
                            <div className="min-w-0 space-y-0.5">
                                <p className="truncate text-body font-medium text-neutral-800">
                                    {conn.client_name || conn.client_id}
                                </p>
                                <p className="text-caption text-neutral-600">
                                    {t('connections.connectedBy')} {conn.username || conn.user_id}
                                </p>
                                <p className="text-caption text-neutral-500">
                                    {t('connections.lastUsed')}{' '}
                                    {conn.last_used_at
                                        ? new Date(conn.last_used_at).toLocaleString(i18n.language)
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
    );
}
