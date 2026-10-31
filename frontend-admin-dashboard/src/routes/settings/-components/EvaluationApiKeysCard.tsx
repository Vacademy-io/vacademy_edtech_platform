import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, CircleNotch, Copy, Key, LockSimple, Plus, Warning } from '@phosphor-icons/react';
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
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { copyTextToClipboard } from '@/lib/clipboard';
import { formatDate, formatRelative } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import {
    DEFAULT_EVALUATION_API_SCOPES,
    EVALUATION_API_KEYS_QUERY_KEY,
    EVALUATION_API_SCOPES,
    MAX_API_KEY_NAME_LENGTH,
    apiKeyCreatorLabel,
    apiKeyDisplayStatus,
    apiKeyErrorMessage,
    buildIssueKeyPayload,
    fetchEvaluationApiKeys,
    isProductNotEnabledError,
    issueEvaluationApiKey,
    revokeEvaluationApiKey,
    type EvaluationApiKey,
    type IssueEvaluationApiKeyInput,
    type IssuedEvaluationApiKey,
} from '../-services/evaluation-api-keys';

const EMPTY_FORM: IssueEvaluationApiKeyInput = {
    name: '',
    scopes: [...DEFAULT_EVALUATION_API_SCOPES],
    expiryDate: '',
    dailyCopyCap: '',
};

/** i18n key for a form validation failure thrown by buildIssueKeyPayload. */
const FORM_ERROR_KEYS: Record<string, string> = {
    name_required: 'apiKeys.form.errors.nameRequired',
    name_too_long: 'apiKeys.form.errors.nameTooLong',
    scopes_invalid: 'apiKeys.form.errors.scopesRequired',
    expiry_invalid: 'apiKeys.form.errors.expiryInvalid',
    expiry_in_past: 'apiKeys.form.errors.expiryInPast',
    cap_invalid: 'apiKeys.form.errors.capInvalid',
};

const scopeLabelKey = (scope: string) => `apiKeys.scopes.${scope.replace(':', '_')}`;

const STATUS_LABEL_KEYS = {
    ACTIVE: 'apiKeys.table.statusActive',
    EXPIRED: 'apiKeys.table.statusExpired',
    REVOKED: 'apiKeys.table.statusRevoked',
} as const;

/**
 * Institutes whose key issue was refused with "not enabled" in this tab. The
 * list GET may carry no access flag (a bare array), so without this the card
 * would forget the refusal on remount and offer "Create key" again. Cleared by
 * "Check again" or a reload.
 */
const refusedNotEnabled = new Set<string>();

/**
 * Settings → Integrations → "API keys" for the AI Evaluation API (spec §6.3).
 * Issue (name, scopes, optional expiry, optional per-key daily copy cap), the
 * key shown exactly once, list and revoke. Disabled until Vacademy switches
 * the Evaluation API on for the institute.
 */
export function EvaluationApiKeysCard() {
    const { t } = useTranslation('settingsIntegration');
    const queryClient = useQueryClient();
    const instituteId = getCurrentInstituteId() ?? '';

    const [createOpen, setCreateOpen] = useState(false);
    const [form, setForm] = useState<IssueEvaluationApiKeyInput>(EMPTY_FORM);
    const [formError, setFormError] = useState<string | null>(null);
    const [issuedKey, setIssuedKey] = useState<IssuedEvaluationApiKey | null>(null);
    const [copied, setCopied] = useState(false);
    // Set when the admin tries to close the shown-once dialog before copying the key:
    // the X / Escape / outside click then warns instead of discarding it.
    const [closeAttempted, setCloseAttempted] = useState(false);
    const [revokeTarget, setRevokeTarget] = useState<EvaluationApiKey | null>(null);
    // A POST can also report "not enabled" (the list may not say, or access was
    // switched off after it loaded). Remembered per institute for this tab.
    const [disabledByServer, setDisabledByServer] = useState(() =>
        refusedNotEnabled.has(instituteId)
    );
    const currentUserId = getTokenDecodedData(getTokenFromCookie(TokenKey.accessToken))?.user;

    const {
        data,
        isLoading,
        error: listError,
        refetch,
    } = useQuery({
        queryKey: [EVALUATION_API_KEYS_QUERY_KEY, instituteId],
        queryFn: () => fetchEvaluationApiKeys(instituteId),
        enabled: Boolean(instituteId),
        staleTime: 60_000,
        retry: false,
    });

    const notEnabled =
        disabledByServer || data?.enabled === false || isProductNotEnabledError(listError);

    const issueMutation = useMutation({
        mutationFn: (input: IssueEvaluationApiKeyInput) =>
            issueEvaluationApiKey(instituteId, input),
        onSuccess: (issued) => {
            setCreateOpen(false);
            setForm(EMPTY_FORM);
            setCopied(false);
            setIssuedKey(issued);
            queryClient.invalidateQueries({ queryKey: [EVALUATION_API_KEYS_QUERY_KEY] });
        },
        onError: (err: unknown) => {
            if (isProductNotEnabledError(err)) {
                refusedNotEnabled.add(instituteId);
                setDisabledByServer(true);
                setCreateOpen(false);
                return;
            }
            toast.error(apiKeyErrorMessage(err) ?? t('apiKeys.toasts.issueFailed'));
        },
    });

    const revokeMutation = useMutation({
        mutationFn: (keyId: string) => revokeEvaluationApiKey(instituteId, keyId),
        onSuccess: () => {
            toast.success(t('apiKeys.toasts.revoked'));
            setRevokeTarget(null);
            queryClient.invalidateQueries({ queryKey: [EVALUATION_API_KEYS_QUERY_KEY] });
        },
        onError: (err: unknown) => {
            toast.error(apiKeyErrorMessage(err) ?? t('apiKeys.toasts.revokeFailed'));
        },
    });

    const submitForm = () => {
        try {
            buildIssueKeyPayload(instituteId, form);
        } catch (e) {
            const code = e instanceof Error ? e.message : '';
            setFormError(t(FORM_ERROR_KEYS[code] ?? 'apiKeys.form.errors.generic'));
            return;
        }
        setFormError(null);
        issueMutation.mutate(form);
    };

    const toggleScope = (scope: string, checked: boolean) => {
        setForm((prev) => ({
            ...prev,
            scopes: checked
                ? [...new Set([...prev.scopes, scope])]
                : prev.scopes.filter((s) => s !== scope),
        }));
    };

    const closeIssuedDialog = () => {
        // The plaintext lives only here (and in the mutation's result); drop both
        // as soon as the dialog closes.
        setIssuedKey(null);
        setCopied(false);
        setCloseAttempted(false);
        issueMutation.reset();
    };

    const checkAccessAgain = () => {
        refusedNotEnabled.delete(instituteId);
        setDisabledByServer(false);
        void refetch();
    };

    const copyIssuedKey = async () => {
        if (!issuedKey) return;
        const ok = await copyTextToClipboard(issuedKey.key);
        if (ok) {
            setCopied(true);
            toast.success(t('apiKeys.issued.copied'));
        } else {
            toast.error(t('apiKeys.issued.copyFailed'));
        }
    };

    const keys = data?.keys ?? [];
    const now = new Date();
    const activeKeys = keys.filter((k) => apiKeyDisplayStatus(k, now) === 'ACTIVE');

    return (
        <Card>
            <CardHeader className="pb-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                        <CardTitle className="flex items-center gap-2 text-base">
                            <Key className="size-4 text-primary-500" />
                            {t('apiKeys.title')}
                        </CardTitle>
                        <CardDescription>{t('apiKeys.description')}</CardDescription>
                    </div>
                    {!notEnabled && !isLoading && !listError && (
                        <MyButton
                            type="button"
                            buttonType="primary"
                            scale="medium"
                            onClick={() => {
                                setForm(EMPTY_FORM);
                                setFormError(null);
                                setCreateOpen(true);
                            }}
                        >
                            <Plus className="size-4" />
                            {t('apiKeys.createButton')}
                        </MyButton>
                    )}
                </div>
            </CardHeader>
            <CardContent>
                {isLoading ? (
                    <div className="flex items-center gap-2 py-4 text-sm text-neutral-500">
                        <CircleNotch className="size-4 animate-spin text-primary-500" />
                        {t('apiKeys.loading')}
                    </div>
                ) : notEnabled ? (
                    <div className="flex items-start gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
                        <LockSimple className="mt-0.5 size-5 shrink-0 text-neutral-500" />
                        <div className="min-w-0">
                            <p className="text-sm font-medium text-neutral-800">
                                {t('apiKeys.disabled.title')}
                            </p>
                            <p className="text-xs text-neutral-500">
                                {t('apiKeys.disabled.description')}
                            </p>
                            {disabledByServer && (
                                <MyButton
                                    type="button"
                                    buttonType="text"
                                    scale="small"
                                    className="mt-1 px-0"
                                    onClick={checkAccessAgain}
                                >
                                    {t('apiKeys.disabled.checkAgain')}
                                </MyButton>
                            )}
                        </div>
                    </div>
                ) : listError ? (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning-100 bg-warning-50 p-3 text-sm text-warning-700">
                        <span>{apiKeyErrorMessage(listError) ?? t('apiKeys.loadError')}</span>
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="small"
                            onClick={() => void refetch()}
                        >
                            {t('apiKeys.retry')}
                        </MyButton>
                    </div>
                ) : keys.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-neutral-200 bg-neutral-50/50 py-8 text-center">
                        <p className="text-sm font-medium text-neutral-500">
                            {t('apiKeys.empty.title')}
                        </p>
                        <p className="text-xs text-neutral-400">{t('apiKeys.empty.description')}</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto rounded-lg border">
                        <table className="w-full text-start text-sm">
                            <thead className="border-b bg-neutral-50 text-caption text-neutral-500">
                                <tr>
                                    <th className="px-4 py-2">{t('apiKeys.table.name')}</th>
                                    <th className="px-4 py-2">{t('apiKeys.table.prefix')}</th>
                                    <th className="px-4 py-2">{t('apiKeys.table.scopes')}</th>
                                    <th className="px-4 py-2">{t('apiKeys.table.createdBy')}</th>
                                    <th className="px-4 py-2">{t('apiKeys.table.lastUsed')}</th>
                                    <th className="px-4 py-2">{t('apiKeys.table.status')}</th>
                                    <th className="px-4 py-2" />
                                </tr>
                            </thead>
                            <tbody>
                                {keys.map((k) => {
                                    const status = apiKeyDisplayStatus(k, now);
                                    const isActive = status === 'ACTIVE';
                                    const creator = apiKeyCreatorLabel(
                                        k,
                                        currentUserId,
                                        t('apiKeys.table.createdByYou')
                                    );
                                    return (
                                        <tr key={k.id} className="border-b last:border-0">
                                            <td className="max-w-xs px-4 py-2.5">
                                                <div
                                                    className="truncate font-medium"
                                                    title={k.name}
                                                >
                                                    {k.name}
                                                </div>
                                                {(k.expiresAt || k.dailyCopyCap) && (
                                                    <div className="text-caption text-neutral-400">
                                                        {[
                                                            k.expiresAt &&
                                                                t('apiKeys.table.expires', {
                                                                    date: formatDate(k.expiresAt),
                                                                }),
                                                            k.dailyCopyCap &&
                                                                t('apiKeys.table.dailyCap', {
                                                                    cap: k.dailyCopyCap,
                                                                }),
                                                        ]
                                                            .filter(Boolean)
                                                            .join(' · ')}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="whitespace-nowrap px-4 py-2.5 font-mono text-caption text-neutral-600">
                                                {k.prefix ? `${k.prefix}…` : '-'}
                                            </td>
                                            <td className="px-4 py-2.5">
                                                <div className="flex flex-wrap gap-1">
                                                    {k.scopes.map((s) => (
                                                        <span
                                                            key={s}
                                                            className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-caption text-neutral-600"
                                                        >
                                                            {s}
                                                        </span>
                                                    ))}
                                                </div>
                                            </td>
                                            <td className="px-4 py-2.5 text-xs text-neutral-500">
                                                <div title={k.createdById ?? undefined}>
                                                    {creator ?? '-'}
                                                </div>
                                                {k.createdAt && (
                                                    <div className="text-caption text-neutral-400">
                                                        {formatDate(k.createdAt)}
                                                    </div>
                                                )}
                                            </td>
                                            <td
                                                className="whitespace-nowrap px-4 py-2.5 text-xs text-neutral-500"
                                                title={k.lastUsedAt ?? undefined}
                                            >
                                                {k.lastUsedAt
                                                    ? formatRelative(k.lastUsedAt)
                                                    : t('apiKeys.table.neverUsed')}
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
                                                        {t('apiKeys.table.revoke')}
                                                    </MyButton>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                        <p className="border-t px-4 py-2 text-caption text-neutral-400">
                            {t('apiKeys.table.activeCount', { active: activeKeys.length })}
                        </p>
                    </div>
                )}
            </CardContent>

            {/* ── Create ── */}
            <MyDialog
                heading={t('apiKeys.form.heading')}
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
                            {t('apiKeys.form.cancel')}
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
                            {t('apiKeys.form.submit')}
                        </MyButton>
                    </div>
                }
            >
                <div className="flex flex-col gap-5">
                    <MyInput
                        label={t('apiKeys.form.nameLabel')}
                        inputPlaceholder={t('apiKeys.form.namePlaceholder')}
                        input={form.name}
                        required
                        maxLength={MAX_API_KEY_NAME_LENGTH}
                        className="sm:w-full"
                        onChangeFunction={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                    />
                    <fieldset className="flex flex-col gap-2">
                        <legend className="mb-1 text-sm font-medium text-neutral-700">
                            {t('apiKeys.form.scopesLabel')}
                        </legend>
                        {EVALUATION_API_SCOPES.map((scope) => {
                            const id = `eval-api-scope-${scope.replace(':', '-')}`;
                            return (
                                <div key={scope} className="flex items-start gap-2">
                                    <Checkbox
                                        id={id}
                                        checked={form.scopes.includes(scope)}
                                        onCheckedChange={(c) => toggleScope(scope, c === true)}
                                        className="mt-0.5"
                                    />
                                    <Label htmlFor={id} className="flex flex-col gap-0.5">
                                        <span className="font-mono text-xs text-neutral-800">
                                            {scope}
                                        </span>
                                        <span className="text-xs font-normal text-neutral-500">
                                            {t(scopeLabelKey(scope))}
                                        </span>
                                    </Label>
                                </div>
                            );
                        })}
                    </fieldset>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <MyInput
                            inputType="date"
                            label={t('apiKeys.form.expiryLabel')}
                            input={form.expiryDate}
                            className="sm:w-full"
                            onChangeFunction={(e) =>
                                setForm((p) => ({ ...p, expiryDate: e.target.value }))
                            }
                        />
                        <MyInput
                            inputType="number"
                            label={t('apiKeys.form.capLabel')}
                            inputPlaceholder={t('apiKeys.form.capPlaceholder')}
                            input={form.dailyCopyCap}
                            min={1}
                            step={1}
                            className="sm:w-full"
                            onChangeFunction={(e) =>
                                setForm((p) => ({ ...p, dailyCopyCap: e.target.value }))
                            }
                        />
                    </div>
                    <p className="text-caption text-neutral-500">{t('apiKeys.form.hint')}</p>
                    {formError && (
                        <p role="alert" className="text-sm text-danger-600">
                            {formError}
                        </p>
                    )}
                </div>
            </MyDialog>

            {/* ── Shown once ── */}
            <MyDialog
                heading={t('apiKeys.issued.heading')}
                open={Boolean(issuedKey)}
                onOpenChange={(open) => {
                    if (open) return;
                    // A stray outside click or Escape must not destroy a key that was
                    // never copied: warn once; "I have stored the key" always closes.
                    if (copied || closeAttempted) closeIssuedDialog();
                    else setCloseAttempted(true);
                }}
                dialogWidth="max-w-lg"
                footer={
                    <div className="flex justify-end">
                        <MyButton
                            type="button"
                            buttonType="primary"
                            scale="medium"
                            onClick={closeIssuedDialog}
                        >
                            {t('apiKeys.issued.done')}
                        </MyButton>
                    </div>
                }
            >
                {issuedKey && (
                    <div className="flex flex-col gap-4">
                        <div className="flex items-start gap-2 rounded-md border border-warning-200 bg-warning-50 p-3 text-sm text-warning-700">
                            <Warning className="mt-0.5 size-4 shrink-0" weight="fill" />
                            <span>{t('apiKeys.issued.warning')}</span>
                        </div>
                        <div>
                            <p className="mb-1 text-xs font-medium text-neutral-600">
                                {issuedKey.name}
                            </p>
                            <div className="flex items-center gap-2 rounded-md border border-neutral-200 bg-neutral-50 p-2">
                                <code className="min-w-0 flex-1 break-all font-mono text-xs text-neutral-800">
                                    {issuedKey.key}
                                </code>
                                <MyButton
                                    type="button"
                                    buttonType="secondary"
                                    scale="small"
                                    onClick={() => void copyIssuedKey()}
                                    aria-label={t('apiKeys.issued.copy')}
                                >
                                    {copied ? (
                                        <Check className="size-3.5" />
                                    ) : (
                                        <Copy className="size-3.5" />
                                    )}
                                    {copied
                                        ? t('apiKeys.issued.copiedShort')
                                        : t('apiKeys.issued.copy')}
                                </MyButton>
                            </div>
                        </div>
                        <p className="text-caption text-neutral-500">{t('apiKeys.issued.usage')}</p>
                        {closeAttempted && !copied && (
                            <p role="alert" className="text-sm font-medium text-danger-600">
                                {t('apiKeys.issued.notCopiedWarning')}
                            </p>
                        )}
                    </div>
                )}
            </MyDialog>

            {/* ── Revoke ── */}
            <AlertDialog
                open={Boolean(revokeTarget)}
                onOpenChange={(open) => {
                    if (!open && !revokeMutation.isPending) setRevokeTarget(null);
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('apiKeys.revoke.title')}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('apiKeys.revoke.description', {
                                name: revokeTarget?.name ?? '',
                            })}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={revokeMutation.isPending}>
                            {t('apiKeys.revoke.cancel')}
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
                            {t('apiKeys.revoke.confirm')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Card>
    );
}
