import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import {
    CheckCircle,
    CircleNotch,
    Copy,
    Flask,
    Plus,
    Trash,
    WarningCircle,
} from '@phosphor-icons/react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormField } from '@/components/ui/form';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { StatusChip, type StatusType } from '@/components/design-system/status-chips';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { INSTITUTE_SSO_CONNECTION } from '@/constants/urls';
import { getInstituteId } from '@/constants/helper';
import { copyTextToClipboard } from '@/lib/clipboard';
import { ScopePicker } from './ReportPickers';

interface GroupRule {
    group: string;
    package_session_ids: string[];
}

interface SsoConnectionResponse {
    configured: boolean;
    id?: string;
    display_name?: string;
    issuer?: string;
    client_id?: string;
    client_secret_set?: boolean;
    email_domains?: string[];
    claim_user_id?: string;
    claim_groups?: string | null;
    access_mode?: 'ALL' | 'GROUPS';
    allowed_groups?: string[];
    default_package_session_ids?: string[];
    group_rules?: GroupRule[];
    remove_access_on_group_loss?: boolean;
    trust_provider_email?: boolean;
    auto_redirect?: boolean;
    enabled?: boolean;
    linked_users?: number;
    redirect_uri: string;
    initiate_login_uri?: string;
}

interface CheckResponse {
    ok: boolean;
    error?: string;
    authorization_endpoint?: string;
}

const STATUS_CHIP: Record<'notSet' | 'active' | 'paused', StatusType> = {
    notSet: 'INFO',
    active: 'SUCCESS',
    paused: 'WARNING',
};

const splitList = (value: string) =>
    value
        .split(/[,;\n]+/)
        .map((part) => part.trim())
        .filter(Boolean);

const buildSchema = (t: (key: string) => string) =>
    z.object({
        displayName: z.string().trim().min(1, t('sso.validation.displayNameRequired')),
        issuer: z
            .string()
            .trim()
            .min(1, t('sso.validation.issuerRequired'))
            .refine((v) => /^https:\/\//i.test(v), t('sso.validation.issuerHttps')),
        clientId: z.string().trim().min(1, t('sso.validation.clientIdRequired')),
        clientSecret: z.string().trim(),
        emailDomains: z.string().trim().min(1, t('sso.validation.domainsRequired')),
        claimUserId: z.string().trim(),
        claimGroups: z.string().trim(),
        groupsOnly: z.boolean(),
        allowedGroups: z.string().trim(),
        removeOnGroupLoss: z.boolean(),
        trustProviderEmail: z.boolean(),
        autoRedirect: z.boolean(),
        enabled: z.boolean(),
    });

type FormValues = z.infer<ReturnType<typeof buildSchema>>;

const EMPTY: FormValues = {
    displayName: '',
    issuer: '',
    clientId: '',
    clientSecret: '',
    emailDomains: '',
    claimUserId: 'sub',
    claimGroups: '',
    groupsOnly: false,
    allowedGroups: '',
    removeOnGroupLoss: true,
    trustProviderEmail: false,
    autoRedirect: false,
    enabled: false,
};

const serverMessage = (err: unknown): string | null => {
    const data = (err as { response?: { data?: unknown } })?.response?.data;
    if (data && typeof data === 'object') {
        const message = (data as { message?: unknown }).message;
        if (typeof message === 'string' && message) return message;
    }
    return typeof data === 'string' && data ? data : null;
};

/**
 * Settings → Security → Single sign-on. The institute's own identity provider (OIDC): learners
 * sign in with their work or school account, accounts are created at first sign-in, and batches
 * follow the provider's groups. The client secret is write-only.
 */
export default function SingleSignOnCard() {
    const { t } = useTranslation('settingsIntegration');
    const instituteId = getInstituteId();

    const [data, setData] = useState<SsoConnectionResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [defaultBatches, setDefaultBatches] = useState<string[]>([]);
    const [rules, setRules] = useState<GroupRule[]>([]);
    const [checking, setChecking] = useState(false);
    const [check, setCheck] = useState<CheckResponse | null>(null);
    const [testing, setTesting] = useState(false);
    const [confirmRemove, setConfirmRemove] = useState(false);
    const [removing, setRemoving] = useState(false);

    const form = useForm<FormValues>({ resolver: zodResolver(buildSchema(t)), defaultValues: EMPTY });

    const apply = (res: SsoConnectionResponse) => {
        setData(res);
        setDefaultBatches(res.default_package_session_ids ?? []);
        setRules(res.group_rules ?? []);
        if (!res.configured) {
            form.reset(EMPTY);
            return;
        }
        form.reset({
            displayName: res.display_name ?? '',
            issuer: res.issuer ?? '',
            clientId: res.client_id ?? '',
            clientSecret: '',
            emailDomains: (res.email_domains ?? []).join(', '),
            claimUserId: res.claim_user_id ?? 'sub',
            claimGroups: res.claim_groups ?? '',
            groupsOnly: res.access_mode === 'GROUPS',
            allowedGroups: (res.allowed_groups ?? []).join(', '),
            removeOnGroupLoss: res.remove_access_on_group_loss ?? true,
            trustProviderEmail: res.trust_provider_email ?? false,
            autoRedirect: res.auto_redirect ?? false,
            enabled: res.enabled ?? false,
        });
    };

    useEffect(() => {
        if (!instituteId) return;
        let cancelled = false;
        setLoading(true);
        authenticatedAxiosInstance
            .get<SsoConnectionResponse>(INSTITUTE_SSO_CONNECTION(instituteId))
            .then((res) => {
                if (cancelled) return;
                apply(res.data);
                setLoadError(null);
            })
            .catch((err) => {
                if (!cancelled) setLoadError(serverMessage(err) ?? '');
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
        // apply only touches state setters and the stable form instance.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [instituteId]);

    const status = !data?.configured ? 'notSet' : data.enabled ? 'active' : 'paused';

    const copy = async (value: string | undefined) => {
        if (!value) return;
        if (await copyTextToClipboard(value)) toast.success(t('sso.copied'));
        else toast.error(t('sso.copyFailed'));
    };

    const runCheck = async () => {
        const issuer = form.getValues('issuer').trim();
        if (!instituteId || !issuer) return;
        setChecking(true);
        setCheck(null);
        try {
            const res = await authenticatedAxiosInstance.post<CheckResponse>(
                `${INSTITUTE_SSO_CONNECTION(instituteId)}/check`,
                { issuer }
            );
            setCheck(res.data);
        } catch (err) {
            setCheck({ ok: false, error: serverMessage(err) ?? t('sso.checkFailed') });
        } finally {
            setChecking(false);
        }
    };

    const runTest = async () => {
        if (!instituteId) return;
        setTesting(true);
        try {
            const res = await authenticatedAxiosInstance.get<{ url: string }>(
                `${INSTITUTE_SSO_CONNECTION(instituteId)}/test-url`
            );
            window.open(res.data.url, '_blank', 'noopener');
        } catch (err) {
            toast.error(serverMessage(err) ?? t('sso.testFailed'));
        } finally {
            setTesting(false);
        }
    };

    const onSubmit = async (values: FormValues) => {
        if (!instituteId) return;
        if (!data?.client_secret_set && !values.clientSecret) {
            form.setError('clientSecret', { message: t('sso.validation.secretRequired') });
            return;
        }
        const usesGroups = values.groupsOnly || rules.some((rule) => rule.group.trim());
        if (usesGroups && !values.claimGroups) {
            form.setError('claimGroups', { message: t('sso.validation.groupsClaimRequired') });
            return;
        }
        if (values.groupsOnly && splitList(values.allowedGroups).length === 0) {
            form.setError('allowedGroups', { message: t('sso.validation.allowedGroupsRequired') });
            return;
        }
        try {
            const res = await authenticatedAxiosInstance.put<SsoConnectionResponse>(
                INSTITUTE_SSO_CONNECTION(instituteId),
                {
                    display_name: values.displayName,
                    issuer: values.issuer,
                    client_id: values.clientId,
                    client_secret: values.clientSecret || null,
                    email_domains: splitList(values.emailDomains),
                    claim_user_id: values.claimUserId || 'sub',
                    claim_groups: values.claimGroups,
                    access_mode: values.groupsOnly ? 'GROUPS' : 'ALL',
                    allowed_groups: splitList(values.allowedGroups),
                    default_package_session_ids: defaultBatches,
                    group_rules: rules.filter((rule) => rule.group.trim()),
                    remove_access_on_group_loss: values.removeOnGroupLoss,
                    trust_provider_email: values.trustProviderEmail,
                    auto_redirect: values.autoRedirect,
                    enabled: values.enabled,
                }
            );
            apply(res.data);
            toast.success(t('sso.saved'));
        } catch (err) {
            toast.error(serverMessage(err) ?? t('sso.saveFailed'));
        }
    };

    const onRemove = async () => {
        if (!instituteId) return;
        setRemoving(true);
        try {
            await authenticatedAxiosInstance.delete(INSTITUTE_SSO_CONNECTION(instituteId));
            apply({ configured: false, redirect_uri: data?.redirect_uri ?? '' });
            toast.success(t('sso.removed'));
        } catch (err) {
            toast.error(serverMessage(err) ?? t('sso.removeFailed'));
        } finally {
            setRemoving(false);
            setConfirmRemove(false);
        }
    };

    const switchRow = (
        name: 'groupsOnly' | 'removeOnGroupLoss' | 'trustProviderEmail' | 'autoRedirect' | 'enabled',
        label: string,
        hint: string
    ) => (
        <FormField
            control={form.control}
            name={name}
            render={({ field }) => (
                <div className="flex items-start justify-between gap-4 rounded-md border border-neutral-200 p-3">
                    <div className="space-y-1">
                        <Label htmlFor={`sso-${name}`}>{label}</Label>
                        <p className="text-caption text-neutral-500">{hint}</p>
                    </div>
                    <Switch
                        id={`sso-${name}`}
                        checked={field.value}
                        onCheckedChange={field.onChange}
                    />
                </div>
            )}
        />
    );

    const textField = (
        name: 'displayName' | 'issuer' | 'clientId' | 'emailDomains' | 'claimUserId' | 'claimGroups' | 'allowedGroups',
        label: string,
        placeholder: string,
        hint?: string,
        required = false
    ) => (
        <FormField
            control={form.control}
            name={name}
            render={({ field, fieldState }) => (
                <div className="space-y-1">
                    <MyInput
                        id={`sso-${name}`}
                        label={label}
                        required={required}
                        input={field.value}
                        onChangeFunction={field.onChange}
                        onBlur={field.onBlur}
                        name={field.name}
                        inputPlaceholder={placeholder}
                        error={fieldState.error?.message}
                        spellCheck={false}
                        className="w-full sm:w-full"
                    />
                    {hint && <p className="text-caption text-neutral-500">{hint}</p>}
                </div>
            )}
        />
    );

    return (
        <Card>
            <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle>{t('sso.title')}</CardTitle>
                    {data && (
                        <StatusChip
                            text={t(`sso.status.${status}`)}
                            textSize="text-caption"
                            status={STATUS_CHIP[status]}
                        />
                    )}
                </div>
                <CardDescription>{t('sso.description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                {loading && (
                    <div className="flex items-center gap-2 text-body text-neutral-500">
                        <CircleNotch className="size-4 animate-spin" />
                        {t('sso.loading')}
                    </div>
                )}
                {!loading && loadError !== null && (
                    <Alert variant="destructive">
                        <WarningCircle className="size-4" />
                        <AlertDescription>{loadError || t('sso.loadFailed')}</AlertDescription>
                    </Alert>
                )}

                {!loading && loadError === null && data && (
                    <>
                        <section className="space-y-3 rounded-md bg-neutral-50 p-4">
                            <h4 className="text-subtitle font-semibold">{t('sso.registerTitle')}</h4>
                            <p className="text-caption text-neutral-600">{t('sso.registerHint')}</p>
                            <div className="flex flex-wrap items-center gap-2">
                                <code className="break-all rounded-sm bg-white px-2 py-1 text-caption">
                                    {data.redirect_uri}
                                </code>
                                <MyButton
                                    type="button"
                                    buttonType="secondary"
                                    scale="small"
                                    onClick={() => copy(data.redirect_uri)}
                                >
                                    <Copy className="size-4" /> {t('sso.copyRedirect')}
                                </MyButton>
                            </div>
                            {data.initiate_login_uri && (
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-caption text-neutral-600">
                                        {t('sso.initiateLoginLabel')}
                                    </span>
                                    <code className="break-all rounded-sm bg-white px-2 py-1 text-caption">
                                        {data.initiate_login_uri}
                                    </code>
                                    <MyButton
                                        type="button"
                                        buttonType="secondary"
                                        scale="small"
                                        onClick={() => copy(data.initiate_login_uri)}
                                    >
                                        <Copy className="size-4" />
                                    </MyButton>
                                </div>
                            )}
                        </section>

                        <Form {...form}>
                            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                                <section className="space-y-4">
                                    <h4 className="text-subtitle font-semibold">{t('sso.providerTitle')}</h4>
                                    {textField('displayName', t('sso.displayNameLabel'), t('sso.displayNamePlaceholder'), t('sso.displayNameHint'), true)}
                                    <div className="space-y-2">
                                        {textField('issuer', t('sso.issuerLabel'), 'https://login.microsoftonline.com/<tenant-id>/v2.0', t('sso.issuerHint'), true)}
                                        <div className="flex flex-wrap items-center gap-3">
                                            <MyButton
                                                type="button"
                                                buttonType="secondary"
                                                scale="small"
                                                disable={checking}
                                                onClick={runCheck}
                                            >
                                                {checking && <CircleNotch className="size-4 animate-spin" />}
                                                {t('sso.checkIssuer')}
                                            </MyButton>
                                            {check?.ok && (
                                                <span className="flex items-center gap-1 text-caption text-success-600">
                                                    <CheckCircle className="size-4" /> {t('sso.checkOk')}
                                                </span>
                                            )}
                                            {check && !check.ok && (
                                                <span className="flex items-center gap-1 text-caption text-danger-600">
                                                    <WarningCircle className="size-4" /> {check.error}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    {textField('clientId', t('sso.clientIdLabel'), t('sso.clientIdPlaceholder'), undefined, true)}
                                    <FormField
                                        control={form.control}
                                        name="clientSecret"
                                        render={({ field, fieldState }) => (
                                            <MyInput
                                                id="sso-client-secret"
                                                label={t('sso.clientSecretLabel')}
                                                required={!data.client_secret_set}
                                                inputType="password"
                                                input={field.value}
                                                onChangeFunction={field.onChange}
                                                onBlur={field.onBlur}
                                                name={field.name}
                                                inputPlaceholder={
                                                    data.client_secret_set
                                                        ? t('sso.clientSecretKeep')
                                                        : t('sso.clientSecretPlaceholder')
                                                }
                                                error={fieldState.error?.message}
                                                autoComplete="new-password"
                                                className="w-full sm:w-full"
                                            />
                                        )}
                                    />
                                    {textField('emailDomains', t('sso.domainsLabel'), 'acme.com, acme.co.in', t('sso.domainsHint'), true)}
                                </section>

                                <section className="space-y-4">
                                    <h4 className="text-subtitle font-semibold">{t('sso.claimsTitle')}</h4>
                                    {textField('claimUserId', t('sso.claimUserIdLabel'), 'sub', t('sso.claimUserIdHint'))}
                                    {textField('claimGroups', t('sso.claimGroupsLabel'), 'groups', t('sso.claimGroupsHint'))}
                                </section>

                                <section className="space-y-4">
                                    <h4 className="text-subtitle font-semibold">{t('sso.accessTitle')}</h4>
                                    {switchRow('groupsOnly', t('sso.groupsOnlyLabel'), t('sso.groupsOnlyHint'))}
                                    {form.watch('groupsOnly') &&
                                        textField('allowedGroups', t('sso.allowedGroupsLabel'), 'LMS-Learners, LMS-Sales', t('sso.allowedGroupsHint'))}

                                    <div className="space-y-2">
                                        <Label>{t('sso.defaultBatchesLabel')}</Label>
                                        <p className="text-caption text-neutral-500">{t('sso.defaultBatchesHint')}</p>
                                        <ScopePicker
                                            scopeType="BATCH"
                                            selected={defaultBatches}
                                            onChange={setDefaultBatches}
                                        />
                                    </div>

                                    <div className="space-y-3">
                                        <Label>{t('sso.rulesLabel')}</Label>
                                        <p className="text-caption text-neutral-500">{t('sso.rulesHint')}</p>
                                        {rules.length === 0 && (
                                            <p className="text-caption text-neutral-500">{t('sso.rulesEmpty')}</p>
                                        )}
                                        {rules.map((rule, index) => (
                                            <div
                                                key={index}
                                                className="space-y-2 rounded-md border border-neutral-200 p-3"
                                            >
                                                <div className="flex items-end gap-2">
                                                    <MyInput
                                                        id={`sso-rule-${index}`}
                                                        label={t('sso.ruleGroupLabel')}
                                                        input={rule.group}
                                                        onChangeFunction={(e) =>
                                                            setRules((prev) =>
                                                                prev.map((r, i) =>
                                                                    i === index ? { ...r, group: e.target.value } : r
                                                                )
                                                            )
                                                        }
                                                        inputPlaceholder="LMS-Sales"
                                                        spellCheck={false}
                                                        className="w-full sm:w-full"
                                                    />
                                                    <MyButton
                                                        type="button"
                                                        buttonType="secondary"
                                                        scale="small"
                                                        aria-label={t('sso.ruleRemove')}
                                                        onClick={() =>
                                                            setRules((prev) => prev.filter((_, i) => i !== index))
                                                        }
                                                    >
                                                        <Trash className="size-4" />
                                                    </MyButton>
                                                </div>
                                                <ScopePicker
                                                    scopeType="BATCH"
                                                    selected={rule.package_session_ids}
                                                    onChange={(ids) =>
                                                        setRules((prev) =>
                                                            prev.map((r, i) =>
                                                                i === index ? { ...r, package_session_ids: ids } : r
                                                            )
                                                        )
                                                    }
                                                />
                                            </div>
                                        ))}
                                        <MyButton
                                            type="button"
                                            buttonType="secondary"
                                            scale="small"
                                            onClick={() =>
                                                setRules((prev) => [...prev, { group: '', package_session_ids: [] }])
                                            }
                                        >
                                            <Plus className="size-4" /> {t('sso.ruleAdd')}
                                        </MyButton>
                                    </div>
                                    {switchRow('removeOnGroupLoss', t('sso.removeOnLossLabel'), t('sso.removeOnLossHint'))}
                                </section>

                                <section className="space-y-4">
                                    <h4 className="text-subtitle font-semibold">{t('sso.behaviourTitle')}</h4>
                                    {switchRow('trustProviderEmail', t('sso.trustEmailLabel'), t('sso.trustEmailHint'))}
                                    {switchRow('autoRedirect', t('sso.autoRedirectLabel'), t('sso.autoRedirectHint'))}
                                    {switchRow('enabled', t('sso.enabledLabel'), t('sso.enabledHint'))}
                                </section>

                                {data.configured && (
                                    <p className="text-caption text-neutral-500">
                                        {t('sso.linkedUsers', { count: data.linked_users ?? 0 })}
                                    </p>
                                )}

                                <div className="flex flex-wrap items-center gap-3">
                                    <MyButton
                                        type="submit"
                                        buttonType="primary"
                                        scale="medium"
                                        disable={form.formState.isSubmitting}
                                    >
                                        {form.formState.isSubmitting && <CircleNotch className="size-4 animate-spin" />}
                                        {t('sso.save')}
                                    </MyButton>
                                    {data.configured && (
                                        <MyButton
                                            type="button"
                                            buttonType="secondary"
                                            scale="medium"
                                            disable={testing}
                                            onClick={runTest}
                                        >
                                            <Flask className="size-4" /> {t('sso.test')}
                                        </MyButton>
                                    )}
                                    {data.configured && (
                                        <MyButton
                                            type="button"
                                            buttonType="text"
                                            scale="medium"
                                            onClick={() => setConfirmRemove(true)}
                                        >
                                            <Trash className="size-4" /> {t('sso.remove')}
                                        </MyButton>
                                    )}
                                </div>
                                {data.configured && (
                                    <p className="text-caption text-neutral-500">{t('sso.testHint')}</p>
                                )}
                            </form>
                        </Form>
                    </>
                )}
            </CardContent>

            <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('sso.removeConfirmTitle')}</AlertDialogTitle>
                        <AlertDialogDescription>{t('sso.removeConfirmBody')}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={removing}>{t('sso.cancel')}</AlertDialogCancel>
                        <AlertDialogAction disabled={removing} onClick={onRemove}>
                            {t('sso.remove')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Card>
    );
}
