import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, CircleNotch, Copy, LinkSimple, Plus, Warning } from '@phosphor-icons/react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
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
    LOGIN_LINK_KEYS_QUERY_KEY,
    LOGIN_LINK_POLICY_QUERY_KEY,
    buildIssueLoginLinkKeyPayload,
    fetchLoginLinkKeys,
    fetchLoginLinkPolicy,
    issueLoginLinkKey,
    loginCodeCurlExample,
    saveLoginLinkCodeFreeRoutes,
    saveLoginLinkPolicy,
    type IssueLoginLinkKeyInput,
    type IssuedLoginLinkKey,
    type LoginLinkKey,
} from '../-services/login-links';

const EMPTY_FORM: IssueLoginLinkKeyInput = { name: '', expiryDate: '' };

const FORM_ERROR_KEYS: Record<string, string> = {
    name_required: 'apiKeys.form.errors.nameRequired',
    name_too_long: 'apiKeys.form.errors.nameTooLong',
    expiry_invalid: 'apiKeys.form.errors.expiryInvalid',
    expiry_in_past: 'apiKeys.form.errors.expiryInPast',
};

const STATUS_LABEL_KEYS = {
    ACTIVE: 'apiKeys.table.statusActive',
    EXPIRED: 'apiKeys.table.statusExpired',
    REVOKED: 'apiKeys.table.statusRevoked',
} as const;

/**
 * Settings → Security → "Login links". The "require a login code" switch for the
 * learner portal's passwordless links, and the keys an institute's own server uses to
 * mint codes. Keys reuse the Evaluation API key table (product login_links) and its
 * shown-once / revoke behaviour.
 */
export function LoginLinksCard() {
    const { t } = useTranslation('settingsIntegration');
    const queryClient = useQueryClient();
    const instituteId = getCurrentInstituteId() ?? '';

    const [confirmEnable, setConfirmEnable] = useState(false);
    const [createOpen, setCreateOpen] = useState(false);
    const [form, setForm] = useState<IssueLoginLinkKeyInput>(EMPTY_FORM);
    const [formError, setFormError] = useState<string | null>(null);
    const [issuedKey, setIssuedKey] = useState<IssuedLoginLinkKey | null>(null);
    const [copied, setCopied] = useState(false);
    const [closeAttempted, setCloseAttempted] = useState(false);
    const [revokeTarget, setRevokeTarget] = useState<LoginLinkKey | null>(null);

    const policyQuery = useQuery({
        queryKey: [LOGIN_LINK_POLICY_QUERY_KEY, instituteId],
        queryFn: () => fetchLoginLinkPolicy(instituteId),
        enabled: Boolean(instituteId),
        retry: false,
    });

    const keysQuery = useQuery({
        queryKey: [LOGIN_LINK_KEYS_QUERY_KEY, instituteId],
        queryFn: () => fetchLoginLinkKeys(instituteId),
        enabled: Boolean(instituteId),
        staleTime: 60_000,
        retry: false,
    });

    const policyMutation = useMutation({
        mutationFn: (require: boolean) => saveLoginLinkPolicy(instituteId, require),
        onSuccess: (policy) => {
            setConfirmEnable(false);
            queryClient.setQueryData([LOGIN_LINK_POLICY_QUERY_KEY, instituteId], policy);
            toast.success(
                t(
                    policy.requireLoginCode
                        ? 'loginLinks.requireOnToast'
                        : 'loginLinks.requireOffToast'
                )
            );
        },
        onError: (err: unknown) => {
            toast.error(apiKeyErrorMessage(err) ?? t('loginLinks.policySaveFailed'));
        },
    });

    const routesMutation = useMutation({
        mutationFn: (routes: string[]) => saveLoginLinkCodeFreeRoutes(instituteId, routes),
        onSuccess: (policy) => {
            queryClient.setQueryData([LOGIN_LINK_POLICY_QUERY_KEY, instituteId], policy);
            toast.success(t('loginLinks.routes.savedToast'));
        },
        onError: (err: unknown) => {
            toast.error(apiKeyErrorMessage(err) ?? t('loginLinks.policySaveFailed'));
        },
    });

    const codeFreeRoutes = policyQuery.data?.codeFreeRoutes ?? [];
    const availableRoutes = policyQuery.data?.availableRoutes ?? [];
    const toggleRoute = (route: string, codeFree: boolean) => {
        const next = codeFree
            ? Array.from(new Set([...codeFreeRoutes, route]))
            : codeFreeRoutes.filter((r) => r !== route);
        routesMutation.mutate(next);
    };

    const issueMutation = useMutation({
        mutationFn: (input: IssueLoginLinkKeyInput) => issueLoginLinkKey(instituteId, input),
        onSuccess: (issued) => {
            setCreateOpen(false);
            setForm(EMPTY_FORM);
            setCopied(false);
            setIssuedKey(issued);
            queryClient.invalidateQueries({ queryKey: [LOGIN_LINK_KEYS_QUERY_KEY] });
        },
        onError: (err: unknown) => {
            toast.error(apiKeyErrorMessage(err) ?? t('apiKeys.toasts.issueFailed'));
        },
    });

    const revokeMutation = useMutation({
        mutationFn: (keyId: string) => revokeEvaluationApiKey(instituteId, keyId),
        onSuccess: () => {
            toast.success(t('apiKeys.toasts.revoked'));
            setRevokeTarget(null);
            queryClient.invalidateQueries({ queryKey: [LOGIN_LINK_KEYS_QUERY_KEY] });
        },
        onError: (err: unknown) => {
            toast.error(apiKeyErrorMessage(err) ?? t('apiKeys.toasts.revokeFailed'));
        },
    });

    const submitForm = () => {
        try {
            buildIssueLoginLinkKeyPayload(instituteId, form);
        } catch (e) {
            const code = e instanceof Error ? e.message : '';
            setFormError(t(FORM_ERROR_KEYS[code] ?? 'apiKeys.form.errors.generic'));
            return;
        }
        setFormError(null);
        issueMutation.mutate(form);
    };

    const closeIssuedDialog = () => {
        setIssuedKey(null);
        setCopied(false);
        setCloseAttempted(false);
        issueMutation.reset();
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

    const onToggle = (next: boolean) => {
        // Turning it on breaks links already sent, so it needs a confirmation.
        if (next) setConfirmEnable(true);
        else policyMutation.mutate(false);
    };

    const requireLoginCode = policyQuery.data?.requireLoginCode ?? false;
    const keys = keysQuery.data ?? [];
    const now = new Date();

    return (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                    <LinkSimple className="size-4 text-primary-500" />
                    {t('loginLinks.title')}
                </CardTitle>
                <CardDescription>{t('loginLinks.description')}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
                {/* ── Switch ── */}
                <div className="flex items-start justify-between gap-4 rounded-lg border border-neutral-200 p-4">
                    <div className="min-w-0">
                        <label
                            htmlFor="login-links-require-code"
                            className="text-sm font-medium text-neutral-800"
                        >
                            {t('loginLinks.requireLabel')}
                        </label>
                        <p className="text-caption text-neutral-500">
                            {t('loginLinks.requireHint')}
                        </p>
                        {policyQuery.error && (
                            <p className="mt-1 text-caption text-warning-700">
                                {t('loginLinks.policyLoadError')}
                            </p>
                        )}
                    </div>
                    {policyQuery.isLoading || policyMutation.isPending ? (
                        <CircleNotch className="size-5 shrink-0 animate-spin text-primary-500" />
                    ) : (
                        <Switch
                            id="login-links-require-code"
                            checked={requireLoginCode}
                            disabled={Boolean(policyQuery.error)}
                            onCheckedChange={onToggle}
                        />
                    )}
                </div>

                {/* ── Routes that keep working without a code ── */}
                {requireLoginCode && availableRoutes.length > 0 && (
                    <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-4">
                        <div>
                            <p className="text-sm font-medium text-neutral-800">
                                {t('loginLinks.routes.title')}
                            </p>
                            <p className="text-caption text-neutral-500">
                                {t('loginLinks.routes.hint')}
                            </p>
                        </div>
                        <div className="flex flex-col gap-2">
                            {availableRoutes.map((route) => {
                                const id = `login-links-route-${route}`;
                                return (
                                    <label
                                        key={route}
                                        htmlFor={id}
                                        className="flex items-start gap-2 text-sm text-neutral-700"
                                    >
                                        <Checkbox
                                            id={id}
                                            className="mt-0.5"
                                            checked={codeFreeRoutes.includes(route)}
                                            disabled={routesMutation.isPending}
                                            onCheckedChange={(v) => toggleRoute(route, v === true)}
                                        />
                                        <span>
                                            <span className="font-medium">
                                                {t(`loginLinks.routes.names.${route}`, {
                                                    defaultValue: route,
                                                })}
                                            </span>
                                            <span className="block text-caption text-neutral-500">
                                                {t(`loginLinks.routes.paths.${route}`, {
                                                    defaultValue: '',
                                                })}
                                            </span>
                                        </span>
                                    </label>
                                );
                            })}
                        </div>
                        {codeFreeRoutes.length > 0 && (
                            <div className="flex items-start gap-2 rounded-md bg-warning-50 p-3 text-caption text-warning-700">
                                <Warning className="mt-0.5 size-4 shrink-0" />
                                <span>{t('loginLinks.routes.warning')}</span>
                            </div>
                        )}
                    </div>
                )}

                {/* ── Keys ── */}
                <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                            <p className="text-sm font-medium text-neutral-800">
                                {t('loginLinks.keysTitle')}
                            </p>
                            <p className="text-caption text-neutral-500">
                                {t('loginLinks.keysDescription')}
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
                                {t('loginLinks.createButton')}
                            </MyButton>
                        )}
                    </div>

                    {keysQuery.isLoading ? (
                        <div className="flex items-center gap-2 py-2 text-sm text-neutral-500">
                            <CircleNotch className="size-4 animate-spin text-primary-500" />
                            {t('apiKeys.loading')}
                        </div>
                    ) : keysQuery.error ? (
                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning-100 bg-warning-50 p-3 text-sm text-warning-700">
                            <span>
                                {apiKeyErrorMessage(keysQuery.error) ?? t('apiKeys.loadError')}
                            </span>
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="small"
                                onClick={() => void keysQuery.refetch()}
                            >
                                {t('apiKeys.retry')}
                            </MyButton>
                        </div>
                    ) : keys.length === 0 ? (
                        <p className="rounded-lg border-2 border-dashed border-neutral-200 bg-neutral-50/50 py-5 text-center text-xs text-neutral-500">
                            {t('loginLinks.empty')}
                        </p>
                    ) : (
                        <div className="overflow-x-auto rounded-lg border">
                            <table className="w-full text-start text-sm">
                                <thead className="border-b bg-neutral-50 text-caption text-neutral-500">
                                    <tr>
                                        <th className="px-4 py-2">{t('apiKeys.table.name')}</th>
                                        <th className="px-4 py-2">{t('apiKeys.table.prefix')}</th>
                                        <th className="px-4 py-2">{t('apiKeys.table.lastUsed')}</th>
                                        <th className="px-4 py-2">{t('apiKeys.table.status')}</th>
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
                                                            {t('apiKeys.table.expires', {
                                                                date: formatDate(k.expiresAt),
                                                            })}
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
                        </div>
                    )}
                </div>
            </CardContent>

            {/* ── Confirm "require a code" ── */}
            <AlertDialog
                open={confirmEnable}
                onOpenChange={(open) => {
                    if (!open && !policyMutation.isPending) setConfirmEnable(false);
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('loginLinks.confirmTitle')}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('loginLinks.confirmDescription')}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={policyMutation.isPending}>
                            {t('loginLinks.confirmCancel')}
                        </AlertDialogCancel>
                        <AlertDialogAction
                            disabled={policyMutation.isPending}
                            onClick={(e) => {
                                e.preventDefault();
                                policyMutation.mutate(true);
                            }}
                        >
                            {policyMutation.isPending && (
                                <CircleNotch className="me-2 size-4 animate-spin" />
                            )}
                            {t('loginLinks.confirmAction')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* ── Create key ── */}
            <MyDialog
                heading={t('loginLinks.formHeading')}
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
                        inputPlaceholder={t('loginLinks.namePlaceholder')}
                        input={form.name}
                        required
                        maxLength={MAX_API_KEY_NAME_LENGTH}
                        className="sm:w-full"
                        onChangeFunction={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                    />
                    <MyInput
                        inputType="date"
                        label={t('apiKeys.form.expiryLabel')}
                        input={form.expiryDate}
                        className="sm:w-full"
                        onChangeFunction={(e) =>
                            setForm((p) => ({ ...p, expiryDate: e.target.value }))
                        }
                    />
                    <p className="text-caption text-neutral-500">{t('loginLinks.formHint')}</p>
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
                        <div>
                            <p className="mb-1 text-caption text-neutral-500">
                                {t('loginLinks.issuedUsage')}
                            </p>
                            <pre className="overflow-x-auto rounded-md bg-neutral-900 p-3 font-mono text-caption text-neutral-100">
                                {loginCodeCurlExample('<your key>')}
                            </pre>
                            <p className="mt-1 text-caption text-neutral-500">
                                {t('loginLinks.issuedThen')}
                            </p>
                        </div>
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
                            {t('apiKeys.revoke.description', { name: revokeTarget?.name ?? '' })}
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
