import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
    ArrowSquareOut,
    Check,
    CircleNotch,
    Code,
    Copy,
    Plus,
    Warning,
} from '@phosphor-icons/react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { MyDialog } from '@/components/design-system/dialog';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { copyTextToClipboard } from '@/lib/clipboard';
import { formatDate, formatRelative } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import {
    MAX_API_KEY_NAME_LENGTH,
    apiKeyDisplayStatus,
    apiKeyErrorMessage,
    revokeEvaluationApiKey,
} from '../-services/evaluation-api-keys';
import {
    AI_CALLING_AGENTS_QUERY_KEY,
    AI_CALLING_API_BASE,
    AI_CALLING_DOCS_URL,
    AI_CALLING_KEYS_QUERY_KEY,
    AI_CALLING_WEBHOOK_QUERY_KEY,
    buildIssueAiCallingKeyPayload,
    canManageAgents,
    canManageCounsellors,
    canPlaceHumanCalls,
    deleteAiCallingWebhook,
    fetchAgentsForApi,
    fetchAiCallingKeys,
    fetchAiCallingWebhook,
    issueAiCallingKey,
    rotateAiCallingWebhookSecret,
    saveAiCallingWebhook,
    startCallCurlExample,
    testAiCallingWebhook,
    webhookUrlError,
    type AiCallingKey,
    type IssueAiCallingKeyInput,
    type IssuedAiCallingKey,
} from '../-services/ai-calling-api';

const EMPTY_FORM: IssueAiCallingKeyInput = {
    name: '',
    expiryDate: '',
    humanCalls: false,
    manageCounsellors: false,
    manageAgents: false,
};

/** The opt-in scope checkboxes of the create-key dialog, in display order. */
const OPTIONAL_SCOPES = [
    { field: 'humanCalls', id: 'ai-calling-key-human-calls', i18n: 'humanCalls' },
    {
        field: 'manageCounsellors',
        id: 'ai-calling-key-manage-counsellors',
        i18n: 'manageCounsellors',
    },
    { field: 'manageAgents', id: 'ai-calling-key-manage-agents', i18n: 'manageAgents' },
] as const;

const FORM_ERROR_KEYS: Record<string, string> = {
    name_required: 'apiCard.keys.errors.nameRequired',
    name_too_long: 'apiCard.keys.errors.nameTooLong',
    expiry_invalid: 'apiCard.keys.errors.expiryInvalid',
    expiry_in_past: 'apiCard.keys.errors.expiryInPast',
};

const STATUS_LABEL_KEYS = {
    ACTIVE: 'apiCard.keys.statusActive',
    EXPIRED: 'apiCard.keys.statusExpired',
    REVOKED: 'apiCard.keys.statusRevoked',
} as const;

/** A secret or key shown once, with a copy button. */
function ShownOnce({
    value,
    label,
    onCopied,
}: {
    value: string;
    label: string;
    onCopied: () => void;
}) {
    const { t } = useTranslation('settingsAiCalling');
    const [copied, setCopied] = useState(false);
    const copy = async () => {
        if (await copyTextToClipboard(value)) {
            setCopied(true);
            onCopied();
            toast.success(t('apiCard.copied'));
        } else {
            toast.error(t('apiCard.copyFailed'));
        }
    };
    return (
        <div>
            <p className="mb-1 text-xs font-medium text-neutral-600">{label}</p>
            <div className="flex items-center gap-2 rounded-md border border-neutral-200 bg-neutral-50 p-2">
                <code className="min-w-0 flex-1 break-all font-mono text-xs text-neutral-800">
                    {value}
                </code>
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="small"
                    onClick={() => void copy()}
                >
                    {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                    {copied ? t('apiCard.copiedShort') : t('apiCard.copy')}
                </MyButton>
            </div>
        </div>
    );
}

/**
 * Settings → AI calling → "API & webhooks". The keys a client's CRM or website uses to
 * start AI calls through the public API (api.telleo.ai/v1), the agent ids it names, and
 * the one webhook that receives each call's outcome. Keys reuse the shared key table
 * (product ai_calling) and its shown-once / revoke behaviour.
 */
export function AiCallingApiCard() {
    const { t } = useTranslation('settingsAiCalling');
    const queryClient = useQueryClient();
    const instituteId = getCurrentInstituteId() ?? '';

    const [createOpen, setCreateOpen] = useState(false);
    const [form, setForm] = useState<IssueAiCallingKeyInput>(EMPTY_FORM);
    const [formError, setFormError] = useState<string | null>(null);
    const [issuedKey, setIssuedKey] = useState<IssuedAiCallingKey | null>(null);
    const [revokeTarget, setRevokeTarget] = useState<AiCallingKey | null>(null);
    const [webhookUrl, setWebhookUrl] = useState('');
    const [webhookError, setWebhookError] = useState<string | null>(null);
    const [shownSecret, setShownSecret] = useState<string | null>(null);
    const [secretCopied, setSecretCopied] = useState(false);
    const [confirmRemove, setConfirmRemove] = useState(false);
    const [confirmRotate, setConfirmRotate] = useState(false);
    const [keyCopied, setKeyCopied] = useState(false);
    const [keyCloseAttempted, setKeyCloseAttempted] = useState(false);

    const keysQuery = useQuery({
        queryKey: [AI_CALLING_KEYS_QUERY_KEY, instituteId],
        queryFn: () => fetchAiCallingKeys(instituteId),
        enabled: Boolean(instituteId),
        staleTime: 60_000,
        retry: false,
    });

    const agentsQuery = useQuery({
        queryKey: [AI_CALLING_AGENTS_QUERY_KEY, instituteId],
        queryFn: () => fetchAgentsForApi(instituteId),
        enabled: Boolean(instituteId),
        // Agents are created and turned off on the card above; always show the current list.
        staleTime: 0,
        refetchOnWindowFocus: true,
        retry: false,
    });

    const webhookQuery = useQuery({
        queryKey: [AI_CALLING_WEBHOOK_QUERY_KEY, instituteId],
        queryFn: () => fetchAiCallingWebhook(instituteId),
        enabled: Boolean(instituteId),
        retry: false,
    });
    const webhook = webhookQuery.data ?? null;

    useEffect(() => {
        setWebhookUrl(webhook?.url ?? '');
    }, [webhook?.url]);

    const issueMutation = useMutation({
        mutationFn: (input: IssueAiCallingKeyInput) => issueAiCallingKey(instituteId, input),
        onSuccess: (issued) => {
            setCreateOpen(false);
            setForm(EMPTY_FORM);
            setIssuedKey(issued);
            queryClient.invalidateQueries({ queryKey: [AI_CALLING_KEYS_QUERY_KEY] });
        },
        onError: (err: unknown) =>
            toast.error(apiKeyErrorMessage(err) ?? t('apiCard.keys.issueFailed')),
    });

    const revokeMutation = useMutation({
        mutationFn: (keyId: string) => revokeEvaluationApiKey(instituteId, keyId),
        onSuccess: () => {
            toast.success(t('apiCard.keys.revoked'));
            setRevokeTarget(null);
            queryClient.invalidateQueries({ queryKey: [AI_CALLING_KEYS_QUERY_KEY] });
        },
        onError: (err: unknown) =>
            toast.error(apiKeyErrorMessage(err) ?? t('apiCard.keys.revokeFailed')),
    });

    const onWebhookSaved = (hook: Awaited<ReturnType<typeof saveAiCallingWebhook>>) => {
        queryClient.setQueryData([AI_CALLING_WEBHOOK_QUERY_KEY, instituteId], {
            ...hook,
            secret: null,
            secretHint: hook.secret
                ? `${hook.secret.slice(0, 6)}…${hook.secret.slice(-4)}`
                : hook.secretHint,
        });
        if (hook.secret) {
            setSecretCopied(false);
            setShownSecret(hook.secret);
        }
    };

    const saveWebhookMutation = useMutation({
        mutationFn: (url: string) => saveAiCallingWebhook(instituteId, url),
        onSuccess: (hook) => {
            onWebhookSaved(hook);
            toast.success(t('apiCard.webhook.saved'));
        },
        onError: (err: unknown) =>
            toast.error(apiKeyErrorMessage(err) ?? t('apiCard.webhook.saveFailed')),
    });

    const rotateMutation = useMutation({
        mutationFn: () => rotateAiCallingWebhookSecret(instituteId),
        onSuccess: onWebhookSaved,
        onError: (err: unknown) =>
            toast.error(apiKeyErrorMessage(err) ?? t('apiCard.webhook.rotateFailed')),
    });

    const testMutation = useMutation({
        mutationFn: () => testAiCallingWebhook(instituteId),
        onSuccess: (r) => {
            if (r.delivered)
                toast.success(t('apiCard.webhook.testOk', { code: r.statusCode ?? '' }));
            else
                toast.error(
                    t('apiCard.webhook.testFailed', {
                        reason: r.error ?? (r.statusCode ? `HTTP ${r.statusCode}` : '-'),
                    })
                );
        },
        onError: (err: unknown) =>
            toast.error(apiKeyErrorMessage(err) ?? t('apiCard.webhook.testError')),
    });

    const removeMutation = useMutation({
        mutationFn: () => deleteAiCallingWebhook(instituteId),
        onSuccess: () => {
            setConfirmRemove(false);
            queryClient.setQueryData([AI_CALLING_WEBHOOK_QUERY_KEY, instituteId], null);
            toast.success(t('apiCard.webhook.removed'));
        },
        onError: (err: unknown) =>
            toast.error(apiKeyErrorMessage(err) ?? t('apiCard.webhook.removeFailed')),
    });

    const submitForm = () => {
        try {
            buildIssueAiCallingKeyPayload(instituteId, form);
        } catch (e) {
            const code = e instanceof Error ? e.message : '';
            setFormError(t(FORM_ERROR_KEYS[code] ?? 'apiCard.keys.errors.generic'));
            return;
        }
        setFormError(null);
        issueMutation.mutate(form);
    };

    const submitWebhook = () => {
        const err = webhookUrlError(webhookUrl);
        if (err) {
            setWebhookError(
                t(
                    err === 'url_required'
                        ? 'apiCard.webhook.urlRequired'
                        : 'apiCard.webhook.urlHttps'
                )
            );
            return;
        }
        setWebhookError(null);
        saveWebhookMutation.mutate(webhookUrl);
    };

    const copyText = async (value: string) => {
        if (await copyTextToClipboard(value)) toast.success(t('apiCard.copied'));
        else toast.error(t('apiCard.copyFailed'));
    };

    const keys = keysQuery.data ?? [];
    const agents = agentsQuery.data ?? [];
    const now = new Date();
    const webhookBusy =
        saveWebhookMutation.isPending ||
        rotateMutation.isPending ||
        testMutation.isPending ||
        removeMutation.isPending;
    const urlChanged = webhookUrl.trim() !== (webhook?.url ?? '');

    return (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                    <Code className="size-4 text-primary-500" />
                    {t('apiCard.title')}
                </CardTitle>
                <CardDescription>{t('apiCard.description')}</CardDescription>
                <div className="flex flex-wrap items-center gap-3 pt-1 text-caption">
                    <button
                        type="button"
                        className="flex items-center gap-1 rounded bg-neutral-100 px-2 py-0.5 font-mono text-neutral-700"
                        onClick={() => void copyText(AI_CALLING_API_BASE)}
                        title={t('apiCard.copy')}
                    >
                        {AI_CALLING_API_BASE}
                        <Copy className="size-3" />
                    </button>
                    <a
                        href={AI_CALLING_DOCS_URL}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1 text-primary-500 underline"
                    >
                        {t('apiCard.docs')}
                        <ArrowSquareOut className="size-3" />
                    </a>
                </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
                {/* ── Keys ── */}
                <section className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                            <p className="text-sm font-medium text-neutral-800">
                                {t('apiCard.keys.title')}
                            </p>
                            <p className="text-caption text-neutral-500">
                                {t('apiCard.keys.description')}
                            </p>
                        </div>
                        {!keysQuery.isLoading && !keysQuery.error && (
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="medium"
                                onClick={() => {
                                    setForm(EMPTY_FORM);
                                    setFormError(null);
                                    setCreateOpen(true);
                                }}
                            >
                                <Plus className="size-4" />
                                {t('apiCard.keys.create')}
                            </MyButton>
                        )}
                    </div>

                    {keysQuery.isLoading ? (
                        <div className="flex items-center gap-2 py-2 text-sm text-neutral-500">
                            <CircleNotch className="size-4 animate-spin text-primary-500" />
                            {t('apiCard.loading')}
                        </div>
                    ) : keysQuery.error ? (
                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning-100 bg-warning-50 p-3 text-sm text-warning-700">
                            <span>
                                {apiKeyErrorMessage(keysQuery.error) ?? t('apiCard.keys.loadError')}
                            </span>
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="small"
                                onClick={() => void keysQuery.refetch()}
                            >
                                {t('apiCard.retry')}
                            </MyButton>
                        </div>
                    ) : keys.length === 0 ? (
                        <p className="rounded-lg border-2 border-dashed border-neutral-200 bg-neutral-50/50 py-5 text-center text-xs text-neutral-500">
                            {t('apiCard.keys.empty')}
                        </p>
                    ) : (
                        <div className="overflow-x-auto rounded-lg border">
                            <table className="w-full text-start text-sm">
                                <thead className="border-b bg-neutral-50 text-caption text-neutral-500">
                                    <tr>
                                        <th className="px-4 py-2">{t('apiCard.keys.name')}</th>
                                        <th className="px-4 py-2">{t('apiCard.keys.prefix')}</th>
                                        <th className="px-4 py-2">{t('apiCard.keys.lastUsed')}</th>
                                        <th className="px-4 py-2">{t('apiCard.keys.status')}</th>
                                        <th className="px-4 py-2" />
                                    </tr>
                                </thead>
                                <tbody>
                                    {keys.map((k) => {
                                        const status = apiKeyDisplayStatus(k, now);
                                        const isActive = status === 'ACTIVE';
                                        return (
                                            <tr key={k.id} className="border-b last:border-0">
                                                <td className="max-w-xs px-4 py-2.5">
                                                    <div
                                                        className="truncate font-medium"
                                                        title={k.name}
                                                    >
                                                        {k.name}
                                                    </div>
                                                    {k.expiresAt && (
                                                        <div className="text-caption text-neutral-400">
                                                            {t('apiCard.keys.expires', {
                                                                date: formatDate(k.expiresAt),
                                                            })}
                                                        </div>
                                                    )}
                                                    {canPlaceHumanCalls(k) && (
                                                        <div className="text-caption text-neutral-500">
                                                            {t('apiCard.keys.humanCallsBadge')}
                                                        </div>
                                                    )}
                                                    {canManageCounsellors(k) && (
                                                        <div className="text-caption text-neutral-500">
                                                            {t(
                                                                'apiCard.keys.manageCounsellorsBadge'
                                                            )}
                                                        </div>
                                                    )}
                                                    {canManageAgents(k) && (
                                                        <div className="text-caption text-neutral-500">
                                                            {t('apiCard.keys.manageAgentsBadge')}
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="whitespace-nowrap px-4 py-2.5 font-mono text-caption text-neutral-600">
                                                    {k.prefix ? `${k.prefix}…` : '-'}
                                                </td>
                                                <td
                                                    className="whitespace-nowrap px-4 py-2.5 text-xs text-neutral-500"
                                                    title={k.lastUsedAt ?? undefined}
                                                >
                                                    {k.lastUsedAt
                                                        ? formatRelative(k.lastUsedAt)
                                                        : t('apiCard.keys.neverUsed')}
                                                </td>
                                                <td className="px-4 py-2.5">
                                                    <span
                                                        className={cn(
                                                            'text-xs font-medium',
                                                            isActive
                                                                ? 'text-success-600'
                                                                : 'text-neutral-500'
                                                        )}
                                                    >
                                                        {t(STATUS_LABEL_KEYS[status])}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-2.5 text-end">
                                                    {isActive && (
                                                        <MyButton
                                                            type="button"
                                                            buttonType="text"
                                                            scale="small"
                                                            className="text-danger-600"
                                                            onClick={() => setRevokeTarget(k)}
                                                        >
                                                            {t('apiCard.keys.revoke')}
                                                        </MyButton>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </section>

                {/* ── Agent ids ── */}
                <section className="flex flex-col gap-2">
                    <div>
                        <p className="text-sm font-medium text-neutral-800">
                            {t('apiCard.agents.title')}
                        </p>
                        <p className="text-caption text-neutral-500">
                            {t('apiCard.agents.description')}
                        </p>
                    </div>
                    {agentsQuery.isLoading ? (
                        <CircleNotch className="size-4 animate-spin text-primary-500" />
                    ) : agents.length === 0 ? (
                        <p className="text-caption text-neutral-500">{t('apiCard.agents.empty')}</p>
                    ) : (
                        <ul className="flex flex-col divide-y rounded-lg border">
                            {agents.map((a) => (
                                <li
                                    key={a.id}
                                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-2"
                                >
                                    <span className="min-w-0 truncate text-sm text-neutral-800">
                                        {a.name}
                                        {!a.enabled && (
                                            <span className="ms-2 text-caption text-neutral-400">
                                                {t('apiCard.agents.disabled')}
                                            </span>
                                        )}
                                    </span>
                                    <button
                                        type="button"
                                        className="flex items-center gap-1 font-mono text-caption text-neutral-600 hover:text-primary-500"
                                        onClick={() => void copyText(a.id)}
                                        title={t('apiCard.copy')}
                                    >
                                        {a.id}
                                        <Copy className="size-3" />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>

                {/* ── Webhook ── */}
                <section className="flex flex-col gap-3">
                    <div>
                        <p className="text-sm font-medium text-neutral-800">
                            {t('apiCard.webhook.title')}
                        </p>
                        <p className="text-caption text-neutral-500">
                            {t('apiCard.webhook.description')}
                        </p>
                    </div>
                    {webhookQuery.isLoading ? (
                        <CircleNotch className="size-4 animate-spin text-primary-500" />
                    ) : webhookQuery.error ? (
                        <p className="text-caption text-warning-700">
                            {apiKeyErrorMessage(webhookQuery.error) ??
                                t('apiCard.webhook.loadError')}
                        </p>
                    ) : (
                        <>
                            <div className="flex flex-wrap items-end gap-2">
                                <div className="min-w-0 flex-1">
                                    <MyInput
                                        label={t('apiCard.webhook.urlLabel')}
                                        inputPlaceholder="https://crm.example.com/telleo/webhook"
                                        input={webhookUrl}
                                        className="sm:w-full"
                                        onChangeFunction={(e) => setWebhookUrl(e.target.value)}
                                    />
                                </div>
                                <MyButton
                                    type="button"
                                    buttonType="primary"
                                    scale="medium"
                                    disable={webhookBusy || !urlChanged}
                                    onClick={submitWebhook}
                                >
                                    {saveWebhookMutation.isPending && (
                                        <CircleNotch className="size-4 animate-spin" />
                                    )}
                                    {t('apiCard.webhook.save')}
                                </MyButton>
                            </div>
                            {webhookError && (
                                <p role="alert" className="text-sm text-danger-600">
                                    {webhookError}
                                </p>
                            )}
                            {webhook && (
                                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-neutral-200 p-3">
                                    <div className="min-w-0 text-caption text-neutral-500">
                                        <p>
                                            {t('apiCard.webhook.secretHint')}{' '}
                                            <span className="font-mono text-neutral-700">
                                                {webhook.secretHint ?? '-'}
                                            </span>
                                        </p>
                                        <p>
                                            {t('apiCard.webhook.events', {
                                                events: webhook.events.join(', '),
                                            })}
                                        </p>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        <MyButton
                                            type="button"
                                            buttonType="secondary"
                                            scale="small"
                                            disable={webhookBusy}
                                            onClick={() => testMutation.mutate()}
                                        >
                                            {testMutation.isPending && (
                                                <CircleNotch className="size-3.5 animate-spin" />
                                            )}
                                            {t('apiCard.webhook.test')}
                                        </MyButton>
                                        <MyButton
                                            type="button"
                                            buttonType="secondary"
                                            scale="small"
                                            disable={webhookBusy}
                                            onClick={() => setConfirmRotate(true)}
                                        >
                                            {t('apiCard.webhook.rotate')}
                                        </MyButton>
                                        <MyButton
                                            type="button"
                                            buttonType="text"
                                            scale="small"
                                            className="text-danger-600"
                                            disable={webhookBusy}
                                            onClick={() => setConfirmRemove(true)}
                                        >
                                            {t('apiCard.webhook.remove')}
                                        </MyButton>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </section>
            </CardContent>

            {/* ── Create key ── */}
            <MyDialog
                heading={t('apiCard.keys.formHeading')}
                open={createOpen}
                onOpenChange={(open) => {
                    if (!issueMutation.isPending) setCreateOpen(open);
                }}
                dialogWidth="max-w-lg"
                footer={
                    <div className="flex justify-end gap-2">
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="medium"
                            disable={issueMutation.isPending}
                            onClick={() => setCreateOpen(false)}
                        >
                            {t('apiCard.cancel')}
                        </MyButton>
                        <MyButton
                            type="button"
                            buttonType="primary"
                            scale="medium"
                            disable={issueMutation.isPending}
                            onClick={submitForm}
                        >
                            {issueMutation.isPending && (
                                <CircleNotch className="size-4 animate-spin" />
                            )}
                            {t('apiCard.keys.submit')}
                        </MyButton>
                    </div>
                }
            >
                <div className="flex flex-col gap-5">
                    <MyInput
                        label={t('apiCard.keys.nameLabel')}
                        inputPlaceholder={t('apiCard.keys.namePlaceholder')}
                        input={form.name}
                        required
                        maxLength={MAX_API_KEY_NAME_LENGTH}
                        className="sm:w-full"
                        onChangeFunction={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                    />
                    <MyInput
                        inputType="date"
                        label={t('apiCard.keys.expiryLabel')}
                        input={form.expiryDate}
                        className="sm:w-full"
                        onChangeFunction={(e) =>
                            setForm((p) => ({ ...p, expiryDate: e.target.value }))
                        }
                    />
                    {OPTIONAL_SCOPES.map((scope) => (
                        <div key={scope.id} className="flex items-start gap-2">
                            <Checkbox
                                id={scope.id}
                                checked={Boolean(form[scope.field])}
                                onCheckedChange={(c) =>
                                    setForm((p) => ({ ...p, [scope.field]: c === true }))
                                }
                                className="mt-0.5"
                            />
                            <Label htmlFor={scope.id} className="flex flex-col gap-0.5">
                                <span className="text-sm text-neutral-800">
                                    {t(`apiCard.keys.${scope.i18n}Label`)}
                                </span>
                                <span className="text-xs font-normal text-neutral-500">
                                    {t(`apiCard.keys.${scope.i18n}Hint`)}
                                </span>
                            </Label>
                        </div>
                    ))}
                    <p className="text-caption text-neutral-500">{t('apiCard.keys.formHint')}</p>
                    {formError && (
                        <p role="alert" className="text-sm text-danger-600">
                            {formError}
                        </p>
                    )}
                </div>
            </MyDialog>

            {/* ── Key shown once ── */}
            <MyDialog
                heading={t('apiCard.keys.issuedHeading')}
                open={Boolean(issuedKey)}
                onOpenChange={(open) => {
                    if (open) return;
                    // The key is shown once: a stray Escape or outside click must not lose it.
                    if (keyCopied || keyCloseAttempted) {
                        setIssuedKey(null);
                        setKeyCopied(false);
                        setKeyCloseAttempted(false);
                        issueMutation.reset();
                    } else {
                        setKeyCloseAttempted(true);
                    }
                }}
                dialogWidth="max-w-lg"
                footer={
                    <div className="flex justify-end">
                        <MyButton
                            type="button"
                            buttonType="primary"
                            scale="medium"
                            onClick={() => {
                                setIssuedKey(null);
                                setKeyCopied(false);
                                setKeyCloseAttempted(false);
                                issueMutation.reset();
                            }}
                        >
                            {t('apiCard.done')}
                        </MyButton>
                    </div>
                }
            >
                {issuedKey && (
                    <div className="flex flex-col gap-4">
                        <div className="flex items-start gap-2 rounded-md border border-warning-200 bg-warning-50 p-3 text-sm text-warning-700">
                            <Warning className="mt-0.5 size-4 shrink-0" weight="fill" />
                            <span>{t('apiCard.keys.issuedWarning')}</span>
                        </div>
                        <ShownOnce
                            value={issuedKey.key}
                            label={issuedKey.name}
                            onCopied={() => setKeyCopied(true)}
                        />
                        {keyCloseAttempted && !keyCopied && (
                            <p role="alert" className="text-sm font-medium text-danger-600">
                                {t('apiCard.keys.notCopiedWarning')}
                            </p>
                        )}
                        <div>
                            <p className="mb-1 text-caption text-neutral-500">
                                {t('apiCard.keys.issuedUsage')}
                            </p>
                            <pre className="overflow-x-auto rounded-md bg-neutral-900 p-3 font-mono text-caption text-neutral-100">
                                {startCallCurlExample('<your key>')}
                            </pre>
                        </div>
                    </div>
                )}
            </MyDialog>

            {/* ── Webhook secret shown once ── */}
            <MyDialog
                heading={t('apiCard.webhook.secretHeading')}
                open={Boolean(shownSecret)}
                onOpenChange={(open) => {
                    if (!open && secretCopied) setShownSecret(null);
                }}
                dialogWidth="max-w-lg"
                footer={
                    <div className="flex justify-end">
                        <MyButton
                            type="button"
                            buttonType="primary"
                            scale="medium"
                            onClick={() => setShownSecret(null)}
                        >
                            {t('apiCard.done')}
                        </MyButton>
                    </div>
                }
            >
                {shownSecret && (
                    <div className="flex flex-col gap-4">
                        <div className="flex items-start gap-2 rounded-md border border-warning-200 bg-warning-50 p-3 text-sm text-warning-700">
                            <Warning className="mt-0.5 size-4 shrink-0" weight="fill" />
                            <span>{t('apiCard.webhook.secretWarning')}</span>
                        </div>
                        <ShownOnce
                            value={shownSecret}
                            label={t('apiCard.webhook.secretLabel')}
                            onCopied={() => setSecretCopied(true)}
                        />
                    </div>
                )}
            </MyDialog>

            {/* ── Revoke key ── */}
            <AlertDialog
                open={Boolean(revokeTarget)}
                onOpenChange={(open) => {
                    if (!open && !revokeMutation.isPending) setRevokeTarget(null);
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('apiCard.keys.revokeTitle')}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('apiCard.keys.revokeDescription', {
                                name: revokeTarget?.name ?? '',
                            })}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={revokeMutation.isPending}>
                            {t('apiCard.cancel')}
                        </AlertDialogCancel>
                        <AlertDialogAction
                            disabled={revokeMutation.isPending}
                            onClick={(e) => {
                                e.preventDefault();
                                if (revokeTarget) revokeMutation.mutate(revokeTarget.id);
                            }}
                            className="bg-danger-600 hover:bg-danger-700"
                        >
                            {revokeMutation.isPending && (
                                <CircleNotch className="me-2 size-4 animate-spin" />
                            )}
                            {t('apiCard.keys.revoke')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* ── Rotate secret ── */}
            <AlertDialog
                open={confirmRotate}
                onOpenChange={(open) => {
                    if (!open && !rotateMutation.isPending) setConfirmRotate(false);
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('apiCard.webhook.rotateTitle')}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('apiCard.webhook.rotateDescription')}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={rotateMutation.isPending}>
                            {t('apiCard.cancel')}
                        </AlertDialogCancel>
                        <AlertDialogAction
                            disabled={rotateMutation.isPending}
                            onClick={(e) => {
                                e.preventDefault();
                                rotateMutation.mutate(undefined, {
                                    onSettled: () => setConfirmRotate(false),
                                });
                            }}
                        >
                            {rotateMutation.isPending && (
                                <CircleNotch className="me-2 size-4 animate-spin" />
                            )}
                            {t('apiCard.webhook.rotate')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* ── Remove webhook ── */}
            <AlertDialog
                open={confirmRemove}
                onOpenChange={(open) => {
                    if (!open && !removeMutation.isPending) setConfirmRemove(false);
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('apiCard.webhook.removeTitle')}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('apiCard.webhook.removeDescription')}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={removeMutation.isPending}>
                            {t('apiCard.cancel')}
                        </AlertDialogCancel>
                        <AlertDialogAction
                            disabled={removeMutation.isPending}
                            onClick={(e) => {
                                e.preventDefault();
                                removeMutation.mutate();
                            }}
                            className="bg-danger-600 hover:bg-danger-700"
                        >
                            {removeMutation.isPending && (
                                <CircleNotch className="me-2 size-4 animate-spin" />
                            )}
                            {t('apiCard.webhook.remove')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Card>
    );
}
