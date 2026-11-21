import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CircleNotch, Info, Plus, Warning } from '@phosphor-icons/react';
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
import { StatusChip, type StatusType } from '@/components/design-system/status-chips';
import { formatDate, formatRelative } from '@/lib/formatters';
import {
    MAX_API_KEY_NAME_LENGTH,
    apiKeyDisplayStatus,
    apiKeyErrorMessage,
    revokeEvaluationApiKey,
    type ApiKeyDisplayStatus,
} from '../../-services/evaluation-api-keys';
import {
    CATALOG_KEYS_QUERY_KEY,
    CATALOG_WEBSITES_QUERY_KEY,
    buildIssueCatalogKeyPayload,
    fetchCatalogKeys,
    fetchWebsites,
    issueCatalogKey,
    type CatalogKey,
    type IssuedCatalogKey,
} from '../../-services/catalog-api';
import { CopyField } from './CopyField';

const FORM_ERROR_KEYS: Record<string, string> = {
    name_required: 'catalogApi.keys.form.errors.nameRequired',
    name_too_long: 'catalogApi.keys.form.errors.nameTooLong',
};

const STATUS_LABEL_KEYS: Record<ApiKeyDisplayStatus, string> = {
    ACTIVE: 'catalogApi.keys.statusActive',
    EXPIRED: 'catalogApi.keys.statusExpired',
    REVOKED: 'catalogApi.keys.statusRevoked',
};

const STATUS_CHIP: Record<ApiKeyDisplayStatus, StatusType> = {
    ACTIVE: 'SUCCESS',
    EXPIRED: 'INFO',
    REVOKED: 'INFO',
};

/**
 * "Publishable API keys" (vak_pub_…, product `catalog`): issue by name, the key shown
 * once, list and revoke. Same shared key table and shown-once rules as the other cards.
 */
export function PublishableKeysSection({ instituteId }: { instituteId: string }) {
    const { t } = useTranslation('settingsIntegration');
    const queryClient = useQueryClient();

    const [createOpen, setCreateOpen] = useState(false);
    const [name, setName] = useState('');
    const [formError, setFormError] = useState<string | null>(null);
    const [issuedKey, setIssuedKey] = useState<IssuedCatalogKey | null>(null);
    const [copied, setCopied] = useState(false);
    // A stray Escape / outside click before copying warns instead of discarding the key.
    const [closeAttempted, setCloseAttempted] = useState(false);
    const [revokeTarget, setRevokeTarget] = useState<CatalogKey | null>(null);

    const keysQuery = useQuery({
        queryKey: [CATALOG_KEYS_QUERY_KEY, instituteId],
        queryFn: () => fetchCatalogKeys(instituteId),
        enabled: Boolean(instituteId),
        staleTime: 60_000,
        retry: false,
    });
    // Same query as the websites section (deduplicated): only used for the hint below.
    const websitesQuery = useQuery({
        queryKey: [CATALOG_WEBSITES_QUERY_KEY, instituteId],
        queryFn: () => fetchWebsites(instituteId),
        enabled: Boolean(instituteId),
        staleTime: 60_000,
        retry: false,
    });
    const noVerifiedWebsite =
        websitesQuery.isSuccess && !websitesQuery.data.some((w) => w.status === 'VERIFIED');

    const issueMutation = useMutation({
        mutationFn: (keyName: string) => issueCatalogKey(instituteId, keyName),
        onSuccess: (issued) => {
            setCreateOpen(false);
            setName('');
            setCopied(false);
            setCloseAttempted(false);
            setIssuedKey(issued);
            void queryClient.invalidateQueries({ queryKey: [CATALOG_KEYS_QUERY_KEY] });
        },
        onError: (err: unknown) => {
            toast.error(apiKeyErrorMessage(err) ?? t('catalogApi.keys.toasts.issueFailed'));
        },
    });

    const revokeMutation = useMutation({
        mutationFn: (keyId: string) => revokeEvaluationApiKey(instituteId, keyId),
        onSuccess: () => {
            toast.success(t('catalogApi.keys.toasts.revoked'));
            setRevokeTarget(null);
            void queryClient.invalidateQueries({ queryKey: [CATALOG_KEYS_QUERY_KEY] });
        },
        onError: (err: unknown) => {
            toast.error(apiKeyErrorMessage(err) ?? t('catalogApi.keys.toasts.revokeFailed'));
        },
    });

    const submitForm = () => {
        try {
            buildIssueCatalogKeyPayload(instituteId, name);
        } catch (e) {
            const code = e instanceof Error ? e.message : '';
            setFormError(t(FORM_ERROR_KEYS[code] ?? 'catalogApi.keys.form.errors.generic'));
            return;
        }
        setFormError(null);
        issueMutation.mutate(name);
    };

    const closeIssuedDialog = () => {
        // The plaintext lives only here and in the mutation result; drop both.
        setIssuedKey(null);
        setCopied(false);
        setCloseAttempted(false);
        issueMutation.reset();
    };

    const keys = keysQuery.data ?? [];
    const now = new Date();

    return (
        <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-sm font-medium text-neutral-800">
                        {t('catalogApi.keys.title')}
                    </p>
                    <p className="text-caption text-neutral-500">
                        {t('catalogApi.keys.description')}
                    </p>
                </div>
                {!keysQuery.isLoading && !keysQuery.error && (
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => {
                            setName('');
                            setFormError(null);
                            setCreateOpen(true);
                        }}
                    >
                        <Plus className="size-4" />
                        {t('catalogApi.keys.create')}
                    </MyButton>
                )}
            </div>

            {noVerifiedWebsite && (
                <div className="flex items-start gap-2 rounded-md border border-info-200 bg-info-50 p-3 text-caption text-info-700">
                    <Info className="mt-0.5 size-4 shrink-0" />
                    <span>{t('catalogApi.keys.needsWebsite')}</span>
                </div>
            )}

            {keysQuery.isLoading ? (
                <div className="flex items-center gap-2 py-2 text-sm text-neutral-500">
                    <CircleNotch className="size-4 animate-spin text-primary-500" />
                    {t('catalogApi.loading')}
                </div>
            ) : keysQuery.error ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning-100 bg-warning-50 p-3 text-sm text-warning-700">
                    <span>
                        {apiKeyErrorMessage(keysQuery.error) ?? t('catalogApi.keys.loadError')}
                    </span>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="small"
                        onClick={() => void keysQuery.refetch()}
                    >
                        {t('catalogApi.retry')}
                    </MyButton>
                </div>
            ) : keys.length === 0 ? (
                <p className="rounded-lg border-2 border-dashed border-neutral-200 bg-neutral-50/50 px-4 py-5 text-center text-caption text-neutral-500">
                    {t('catalogApi.keys.empty')}
                </p>
            ) : (
                <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full text-start text-sm">
                        <thead className="border-b bg-neutral-50 text-caption text-neutral-500">
                            <tr>
                                <th className="px-4 py-2">{t('catalogApi.keys.name')}</th>
                                <th className="px-4 py-2">{t('catalogApi.keys.prefix')}</th>
                                <th className="px-4 py-2">{t('catalogApi.keys.created')}</th>
                                <th className="px-4 py-2">{t('catalogApi.keys.lastUsed')}</th>
                                <th className="px-4 py-2">{t('catalogApi.keys.status')}</th>
                                <th className="px-4 py-2" />
                            </tr>
                        </thead>
                        <tbody>
                            {keys.map((k) => {
                                const status = apiKeyDisplayStatus(k, now);
                                return (
                                    <tr key={k.id} className="border-b last:border-0">
                                        <td className="max-w-xs px-4 py-2.5">
                                            <div className="truncate font-medium" title={k.name}>
                                                {k.name}
                                            </div>
                                        </td>
                                        <td className="whitespace-nowrap px-4 py-2.5 font-mono text-caption text-neutral-600">
                                            {k.prefix ? `${k.prefix}…` : '-'}
                                        </td>
                                        <td className="whitespace-nowrap px-4 py-2.5 text-xs text-neutral-500">
                                            {k.createdAt ? formatDate(k.createdAt) : '-'}
                                        </td>
                                        <td
                                            className="whitespace-nowrap px-4 py-2.5 text-xs text-neutral-500"
                                            title={k.lastUsedAt ?? undefined}
                                        >
                                            {k.lastUsedAt
                                                ? formatRelative(k.lastUsedAt)
                                                : t('catalogApi.keys.neverUsed')}
                                        </td>
                                        <td className="px-4 py-2.5">
                                            <StatusChip
                                                text={t(STATUS_LABEL_KEYS[status])}
                                                textSize="text-caption"
                                                status={STATUS_CHIP[status]}
                                                showIcon={false}
                                            />
                                        </td>
                                        <td className="px-4 py-2.5 text-end">
                                            {status === 'ACTIVE' && (
                                                <MyButton
                                                    type="button"
                                                    buttonType="text"
                                                    scale="small"
                                                    className="text-danger-600"
                                                    onClick={() => setRevokeTarget(k)}
                                                >
                                                    {t('catalogApi.keys.revoke')}
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

            {/* ── Create ── */}
            <MyDialog
                heading={t('catalogApi.keys.form.heading')}
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
                            {t('catalogApi.keys.form.cancel')}
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
                            {t('catalogApi.keys.form.submit')}
                        </MyButton>
                    </div>
                }
            >
                <form
                    className="flex flex-col gap-3"
                    onSubmit={(e) => {
                        e.preventDefault();
                        if (!issueMutation.isPending) submitForm();
                    }}
                >
                    <MyInput
                        label={t('catalogApi.keys.form.nameLabel')}
                        inputPlaceholder={t('catalogApi.keys.form.namePlaceholder')}
                        input={name}
                        required
                        maxLength={MAX_API_KEY_NAME_LENGTH}
                        className="sm:w-full"
                        error={formError}
                        onChangeFunction={(e) => {
                            setName(e.target.value);
                            setFormError(null);
                        }}
                    />
                    <p className="text-caption text-neutral-500">
                        {t('catalogApi.keys.form.hint')}
                    </p>
                </form>
            </MyDialog>

            {/* ── Shown once ── */}
            <MyDialog
                heading={t('catalogApi.keys.issued.heading')}
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
                            {t('catalogApi.keys.issued.done')}
                        </MyButton>
                    </div>
                }
            >
                {issuedKey && (
                    <div className="flex flex-col gap-4">
                        <div className="flex items-start gap-2 rounded-md border border-warning-200 bg-warning-50 p-3 text-sm text-warning-700">
                            <Warning className="mt-0.5 size-4 shrink-0" weight="fill" />
                            <span>{t('catalogApi.keys.issued.warning')}</span>
                        </div>
                        <CopyField
                            label={issuedKey.name}
                            value={issuedKey.key}
                            onCopied={() => setCopied(true)}
                        />
                        <p className="text-caption text-neutral-600">
                            {t('catalogApi.keys.issued.note')}
                        </p>
                        {closeAttempted && !copied && (
                            <p role="alert" className="text-sm font-medium text-danger-600">
                                {t('catalogApi.keys.issued.notCopiedWarning')}
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
                        <AlertDialogTitle>
                            {t('catalogApi.keys.revokeConfirm.title')}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('catalogApi.keys.revokeConfirm.description', {
                                name: revokeTarget?.name ?? '',
                            })}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={revokeMutation.isPending}>
                            {t('catalogApi.keys.revokeConfirm.cancel')}
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
                            {t('catalogApi.keys.revokeConfirm.confirm')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </section>
    );
}
