import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import {
    CircleNotch,
    Copy,
    DownloadSimple,
    Key,
    Trash,
    WarningCircle,
} from '@phosphor-icons/react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormField } from '@/components/ui/form';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from '@/components/ui/accordion';
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
import { INSTITUTE_OAUTH_CLIENT } from '@/constants/urls';
import { getInstituteId } from '@/constants/helper';
import { copyTextToClipboard } from '@/lib/clipboard';

interface InstituteOAuthClientResponse {
    institute_id: string;
    provider: string;
    configured: boolean;
    client_id: string | null;
    enabled: boolean;
    has_secret: boolean;
    redirect_uri: string | null;
    updated_by: string | null;
    updated_at: string | null;
}

/**
 * Must be an Owner on the brand's Cloud project: the sign-in callback runs on vacademy.io, and
 * Google only verifies a brand when a project owner has verified every authorized domain.
 */
export const PLATFORM_VERIFICATION_ACCOUNT = 'developer@vidyayatan.com';
/**
 * On the public media CDN (bucket vacademy-media-storage-public, immutable cache). The CDN cannot
 * be invalidated, so a new version of the guide goes to a new dated key and this URL moves with it.
 */
export const GOOGLE_SIGN_IN_GUIDE_PDF =
    'https://d1om4dxj9e7kkd.cloudfront.net/guides/google-sign-in-branding-guide-2026-09-29.pdf';
const DEFAULT_REDIRECT_URI = 'https://backend-stage.vacademy.io/login/oauth2/code/google';
const GOOGLE_CLIENT_ID_SUFFIX = '.apps.googleusercontent.com';

// Keys only; the text is resolved at render time (googleSignIn.guide.* in settingsWhiteLabel).
const GUIDE_STEPS = [
    'project',
    'owner',
    'consent',
    'branding',
    'scopes',
    'client',
    'domain',
    'footer',
    'publish',
    'verify',
    'save',
] as const;

const STATUS_CHIP: Record<'notSet' | 'active' | 'paused', StatusType> = {
    notSet: 'INFO',
    active: 'SUCCESS',
    paused: 'WARNING',
};

const buildSchema = (t: (key: string) => string) =>
    z.object({
        clientId: z
            .string()
            .trim()
            .min(1, t('googleSignIn.validation.clientIdRequired'))
            .refine((v) => v.endsWith(GOOGLE_CLIENT_ID_SUFFIX), t('googleSignIn.clientIdInvalid')),
        // Required only while nothing is stored; checked in onSubmit, where that is known.
        clientSecret: z.string().trim(),
        enabled: z.boolean(),
    });

type FormValues = z.infer<ReturnType<typeof buildSchema>>;

const serverMessage = (err: unknown): string | null => {
    const data = (err as { response?: { data?: unknown } })?.response?.data;
    if (data && typeof data === 'object') {
        const message = (data as { message?: unknown }).message;
        if (typeof message === 'string' && message) return message;
    }
    return typeof data === 'string' && data ? data : null;
};

const privacyPolicyUrl = (learnerPortalUrl: string | null): string | null => {
    const url = learnerPortalUrl?.trim();
    if (!url) return null;
    const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    return `${withScheme.replace(/\/+$/, '')}/privacy-policy`;
};

/**
 * White Label → the institute's own Google OAuth client. With one saved, "Continue with Google"
 * starts with the brand's client, so Google's screen names the brand instead of vacademy.io.
 * The secret is write-only: the API never returns it, so an empty field means "keep".
 */
export default function GoogleSignInBrandingCard({
    learnerPortalUrl,
}: {
    learnerPortalUrl: string | null;
}) {
    const { t } = useTranslation('settingsWhiteLabel');
    const instituteId = getInstituteId();

    const [data, setData] = useState<InstituteOAuthClientResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [confirmRemove, setConfirmRemove] = useState(false);
    const [removing, setRemoving] = useState(false);

    const form = useForm<FormValues>({
        resolver: zodResolver(buildSchema(t)),
        defaultValues: { clientId: '', clientSecret: '', enabled: true },
    });

    const applyResponse = (res: InstituteOAuthClientResponse) => {
        setData(res);
        form.reset({
            clientId: res.client_id ?? '',
            clientSecret: '',
            enabled: res.configured ? res.enabled : true,
        });
    };

    useEffect(() => {
        if (!instituteId) return;
        let cancelled = false;
        setLoading(true);
        authenticatedAxiosInstance
            .get<InstituteOAuthClientResponse>(INSTITUTE_OAUTH_CLIENT(instituteId, 'google'))
            .then((res) => {
                if (cancelled) return;
                applyResponse(res.data);
                setLoadError(null);
            })
            .catch((err) => {
                // '' = no server message; the translated fallback is chosen at render time.
                if (!cancelled) setLoadError(serverMessage(err) ?? '');
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
        // applyResponse only touches state setters and the stable form instance.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [instituteId]);

    const redirectUri = data?.redirect_uri || DEFAULT_REDIRECT_URI;
    const privacyUrl = privacyPolicyUrl(learnerPortalUrl) ?? t('googleSignIn.privacyFallback');
    const status = !data?.configured ? 'notSet' : data.enabled ? 'active' : 'paused';

    const handleCopyRedirectUri = async () => {
        if (await copyTextToClipboard(redirectUri)) toast.success(t('googleSignIn.copied'));
        else toast.error(t('googleSignIn.copyFailed'));
    };

    const onSubmit = async (values: FormValues) => {
        if (!instituteId) return;
        if (!data?.has_secret && !values.clientSecret) {
            form.setError('clientSecret', {
                message: t('googleSignIn.validation.clientSecretRequired'),
            });
            return;
        }
        try {
            const res = await authenticatedAxiosInstance.put<InstituteOAuthClientResponse>(
                INSTITUTE_OAUTH_CLIENT(instituteId, 'google'),
                {
                    client_id: values.clientId,
                    client_secret: values.clientSecret || undefined,
                    enabled: values.enabled,
                }
            );
            applyResponse(res.data);
            toast.success(t('googleSignIn.saved'));
        } catch (err) {
            toast.error(serverMessage(err) ?? t('googleSignIn.saveFailed'));
        }
    };

    const handleRemove = async () => {
        if (!instituteId || !data?.configured) return;
        setRemoving(true);
        try {
            await authenticatedAxiosInstance.delete(INSTITUTE_OAUTH_CLIENT(instituteId, 'google'));
            applyResponse({
                ...data,
                configured: false,
                client_id: null,
                enabled: true,
                has_secret: false,
                updated_by: null,
                updated_at: null,
            });
            toast.success(t('googleSignIn.removed'));
        } catch (err) {
            toast.error(serverMessage(err) ?? t('googleSignIn.removeFailed'));
        } finally {
            setRemoving(false);
            setConfirmRemove(false);
        }
    };

    return (
        <Card>
            <CardHeader className="pb-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                        <CardTitle className="flex items-center gap-2 text-subtitle">
                            <Key className="size-4 text-neutral-500" />
                            {t('googleSignIn.title')}
                        </CardTitle>
                        <CardDescription>{t('googleSignIn.description')}</CardDescription>
                    </div>
                    {data && (
                        <StatusChip
                            text={t(`googleSignIn.status.${status}`)}
                            textSize="text-caption"
                            status={STATUS_CHIP[status]}
                        />
                    )}
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                {loading && (
                    <div className="flex items-center gap-2 text-body text-neutral-500">
                        <CircleNotch className="size-4 animate-spin" />
                        {t('googleSignIn.loading')}
                    </div>
                )}

                {!loading && loadError !== null && (
                    <Alert className="border-danger-100 bg-danger-50">
                        <WarningCircle className="size-4 text-danger-600" />
                        <AlertDescription className="text-body text-danger-700">
                            {loadError || t('googleSignIn.loadFailed')}
                        </AlertDescription>
                    </Alert>
                )}

                {!loading && loadError === null && data && (
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                            {!data.configured && (
                                <p className="text-body text-neutral-600">
                                    {t('googleSignIn.notSetHint')}
                                </p>
                            )}

                            <div className="rounded-lg border border-neutral-200 bg-muted/40 px-4 py-3">
                                <div className="mb-1 text-caption font-medium text-neutral-500">
                                    {t('googleSignIn.redirectUriLabel')}
                                </div>
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <span className="break-all font-mono text-body text-neutral-800">
                                        {redirectUri}
                                    </span>
                                    <MyButton
                                        type="button"
                                        buttonType="secondary"
                                        scale="small"
                                        layoutVariant="default"
                                        onClick={handleCopyRedirectUri}
                                    >
                                        <Copy className="mr-1 size-3" />
                                        {t('googleSignIn.copy')}
                                    </MyButton>
                                </div>
                            </div>

                            <div className="grid gap-4 sm:grid-cols-2">
                                <FormField
                                    control={form.control}
                                    name="clientId"
                                    render={({ field, fieldState }) => (
                                        <MyInput
                                            id="google-sign-in-client-id"
                                            label={t('googleSignIn.clientIdLabel')}
                                            required
                                            input={field.value}
                                            onChangeFunction={field.onChange}
                                            onBlur={field.onBlur}
                                            name={field.name}
                                            inputPlaceholder={t('googleSignIn.clientIdPlaceholder')}
                                            error={fieldState.error?.message}
                                            spellCheck={false}
                                            className="w-full sm:w-full"
                                        />
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="clientSecret"
                                    render={({ field, fieldState }) => (
                                        <div className="space-y-1">
                                            <MyInput
                                                id="google-sign-in-client-secret"
                                                label={t('googleSignIn.clientSecretLabel')}
                                                required={!data.has_secret}
                                                inputType="password"
                                                input={field.value}
                                                onChangeFunction={field.onChange}
                                                onBlur={field.onBlur}
                                                name={field.name}
                                                inputPlaceholder={
                                                    data.has_secret
                                                        ? t(
                                                              'googleSignIn.clientSecretKeepPlaceholder'
                                                          )
                                                        : t('googleSignIn.clientSecretPlaceholder')
                                                }
                                                error={fieldState.error?.message}
                                                spellCheck={false}
                                                className="w-full sm:w-full"
                                            />
                                            <p className="text-caption text-neutral-500">
                                                {t('googleSignIn.clientSecretHint')}
                                            </p>
                                        </div>
                                    )}
                                />
                            </div>

                            <FormField
                                control={form.control}
                                name="enabled"
                                render={({ field }) => (
                                    <div className="flex items-start justify-between gap-4 rounded-lg border border-neutral-200 px-4 py-3">
                                        <div className="space-y-0.5">
                                            <Label htmlFor="google-sign-in-enabled">
                                                {t('googleSignIn.enabledLabel')}
                                            </Label>
                                            <p className="text-caption text-neutral-500">
                                                {t('googleSignIn.enabledHint')}
                                            </p>
                                        </div>
                                        <Switch
                                            id="google-sign-in-enabled"
                                            checked={field.value}
                                            onCheckedChange={field.onChange}
                                        />
                                    </div>
                                )}
                            />

                            <Alert className="border-warning-100 bg-warning-50">
                                <WarningCircle className="size-4 text-warning-600" />
                                <AlertDescription className="text-body text-warning-700">
                                    {t('googleSignIn.beforeSaveWarning')}
                                </AlertDescription>
                            </Alert>

                            <div className="flex flex-wrap items-center gap-3">
                                <MyButton
                                    id="google-sign-in-save-btn"
                                    type="button"
                                    buttonType="primary"
                                    scale="medium"
                                    layoutVariant="default"
                                    disable={removing}
                                    onAsyncClick={form.handleSubmit(onSubmit)}
                                    loadingText={t('googleSignIn.saving')}
                                >
                                    {t('googleSignIn.save')}
                                </MyButton>
                                {data.configured && (
                                    <MyButton
                                        id="google-sign-in-remove-btn"
                                        type="button"
                                        buttonType="secondary"
                                        scale="medium"
                                        layoutVariant="default"
                                        disable={removing}
                                        onClick={() => setConfirmRemove(true)}
                                    >
                                        <Trash className="mr-2 size-4" />
                                        {t('googleSignIn.remove')}
                                    </MyButton>
                                )}
                                {data.configured && data.updated_at && (
                                    <span className="text-caption text-neutral-500">
                                        {t('googleSignIn.lastUpdated', {
                                            date: new Date(data.updated_at).toLocaleString(),
                                        })}
                                    </span>
                                )}
                            </div>
                        </form>
                    </Form>
                )}

                <Accordion
                    type="single"
                    collapsible
                    className="rounded-lg border border-neutral-200 px-4"
                >
                    <AccordionItem value="guide" className="border-b-0">
                        <AccordionTrigger className="text-body font-medium text-neutral-700">
                            {t('googleSignIn.guideTitle')}
                        </AccordionTrigger>
                        <AccordionContent className="space-y-4">
                            <p className="text-body text-neutral-600">
                                {t('googleSignIn.guideIntro')}
                            </p>
                            <a
                                href={GOOGLE_SIGN_IN_GUIDE_PDF}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-2 rounded-md border border-neutral-300 px-3 py-1.5 text-body font-medium text-primary-500 transition-colors hover:border-primary-500 hover:bg-primary-50"
                            >
                                <DownloadSimple className="size-4" />
                                {t('googleSignIn.downloadPdf')}
                            </a>
                            <ol className="space-y-3">
                                {GUIDE_STEPS.map((step, index) => (
                                    <li key={step} className="flex gap-3">
                                        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-50 text-caption font-semibold text-primary-500">
                                            {index + 1}
                                        </span>
                                        <div className="space-y-0.5">
                                            <div className="text-body font-medium text-neutral-800">
                                                {t(`googleSignIn.guide.${step}.title`)}
                                            </div>
                                            <p className="break-words text-body text-neutral-600">
                                                {t(`googleSignIn.guide.${step}.body`, {
                                                    account: PLATFORM_VERIFICATION_ACCOUNT,
                                                    redirectUri,
                                                    privacyUrl,
                                                    interpolation: { escapeValue: false },
                                                })}
                                            </p>
                                        </div>
                                    </li>
                                ))}
                            </ol>
                        </AccordionContent>
                    </AccordionItem>
                </Accordion>
            </CardContent>

            <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('googleSignIn.removeTitle')}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('googleSignIn.removeConfirm')}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={removing}>
                            {t('googleSignIn.cancel')}
                        </AlertDialogCancel>
                        <AlertDialogAction
                            disabled={removing}
                            onClick={(e) => {
                                e.preventDefault();
                                void handleRemove();
                            }}
                            className="bg-danger-600 hover:bg-danger-700"
                        >
                            {removing && <CircleNotch className="mr-2 size-4 animate-spin" />}
                            {t('googleSignIn.remove')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Card>
    );
}
