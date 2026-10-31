/**
 * MCP OAuth consent page.
 *
 * ai_service parks an /authorize request and sends the browser here with a
 * `txn` handle. This page shows which AI app is asking, lets the admin pick the
 * institute to grant, and — on approval — posts the admin's own Vacademy session
 * to ai_service, which mints the authorization code and hands back the URL to
 * bounce to.
 *
 * This is a PUBLIC route on purpose: the visitor may not be signed in yet, and
 * the root guard forwards only a pathname when it redirects to /login, so the
 * `txn` would be lost. We stash it ourselves before sending the user to log in,
 * and read it back when they return. The page reveals nothing without a txn, and
 * nothing can be granted without a verified session on the backend.
 */
import { useEffect, useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { PlugsConnected, Warning } from '@phosphor-icons/react';
import axios from 'axios';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { MyButton } from '@/components/design-system/button';
import { MyDropdown } from '@/components/design-system/dropdown';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { MCP_OAUTH_CONSENT, MCP_OAUTH_TXN } from '@/constants/urls';
import { TokenKey } from '@/constants/auth/tokens';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { isNullOrEmptyOrUndefined } from '@/lib/utils';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';

export const Route = createFileRoute('/mcp/authorize')({
    component: McpAuthorizePage,
});

/** Survives the round trip through /login, which drops query parameters. */
const TXN_STORAGE_KEY = 'vacademy-mcp-authorize-txn';

interface TxnInfo {
    txn: string;
    client_id: string;
    client_name?: string | null;
    redirect_host?: string | null;
    scopes: string[];
    expires_at?: string | null;
    /** Set when the app connected to an institute-scoped server URL: no picker,
     *  and only a member of this institute may approve (white-label flow). */
    institute_id?: string | null;
    institute_name?: string | null;
}

function readTxn(): string | null {
    const fromUrl = new URLSearchParams(window.location.search).get('txn');
    if (fromUrl) {
        try {
            window.sessionStorage.setItem(TXN_STORAGE_KEY, fromUrl);
        } catch {
            /* private mode — the URL copy still works for this page load */
        }
        return fromUrl;
    }
    try {
        return window.sessionStorage.getItem(TXN_STORAGE_KEY);
    } catch {
        return null;
    }
}

function clearTxn() {
    try {
        window.sessionStorage.removeItem(TXN_STORAGE_KEY);
    } catch {
        /* nothing to clean up */
    }
}

/** Institutes this token carries authorities for, so the user can pick one. */
function institutesFromToken(): string[] {
    const token = getTokenFromCookie(TokenKey.accessToken);
    const decoded = getTokenDecodedData(token);
    const authorities = decoded?.authorities;
    return authorities ? Object.keys(authorities) : [];
}

function McpAuthorizePage() {
    const { t } = useTranslation('mcpAuthorize');
    const [txn] = useState<string | null>(() => readTxn());
    const [institute, setInstitute] = useState<string>(() => getCurrentInstituteId() ?? '');
    const [submitting, setSubmitting] = useState<'approve' | 'deny' | null>(null);
    const [error, setError] = useState<string | null>(null);

    const accessToken = getTokenFromCookie(TokenKey.accessToken);
    const signedIn = !isNullOrEmptyOrUndefined(accessToken);
    const institutes = useMemo(() => (signedIn ? institutesFromToken() : []), [signedIn]);

    const { data, isLoading, isError } = useQuery({
        queryKey: ['mcp-authorize-txn', txn],
        // Unauthenticated on purpose: this runs before the user signs in.
        queryFn: async (): Promise<TxnInfo> => (await axios.get(MCP_OAUTH_TXN(txn as string))).data,
        enabled: Boolean(txn),
        retry: false,
    });

    // A scoped request names its institute; otherwise the user picks one.
    const pinnedInstitute = data?.institute_id || null;
    const instituteLabel = data?.institute_name || t('yourInstitute');
    const memberOfPinned = !pinnedInstitute || institutes.includes(pinnedInstitute);

    useEffect(() => {
        if (pinnedInstitute) {
            setInstitute(pinnedInstitute);
        } else if (signedIn && !institute && institutes.length > 0) {
            setInstitute(institutes[0] as string);
        }
    }, [signedIn, institute, institutes, pinnedInstitute]);

    const goToLogin = () => {
        window.location.assign(`/login?redirect=${encodeURIComponent('/mcp/authorize')}`);
    };

    const respond = async (approve: boolean) => {
        if (!txn) return;
        setSubmitting(approve ? 'approve' : 'deny');
        setError(null);
        try {
            const response = await authenticatedAxiosInstance.post(
                MCP_OAUTH_CONSENT,
                {
                    txn,
                    approve,
                    // Lets a long-lived connection refresh the Vacademy session
                    // instead of expiring with this access token.
                    refresh_token: getTokenFromCookie(TokenKey.refreshToken) ?? undefined,
                },
                { headers: { clientId: institute } }
            );
            clearTxn();
            window.location.assign(response.data.redirect_to);
        } catch (err) {
            const detail = axios.isAxiosError(err) ? err.response?.data?.detail : null;
            setError(
                (typeof detail === 'object' && detail?.message) ||
                    (typeof detail === 'string' ? detail : null) ||
                    t('errors.generic')
            );
            setSubmitting(null);
        }
    };

    const appName = data?.client_name || data?.client_id || t('unknownApp');

    return (
        <div className="flex min-h-screen items-center justify-center bg-neutral-50 p-4">
            <Card className="w-full max-w-lg">
                <CardHeader>
                    <div className="flex items-center gap-2">
                        <PlugsConnected size={20} weight="fill" className="text-primary-500" />
                        <CardTitle>{t('title')}</CardTitle>
                    </div>
                    <CardDescription>
                        {t('subtitle', { institute: instituteLabel })}
                    </CardDescription>
                </CardHeader>

                <CardContent className="space-y-4">
                    {!txn && <p className="text-body text-neutral-600">{t('errors.noTxn')}</p>}

                    {txn && isLoading && (
                        <p className="text-body text-neutral-500">{t('loading')}</p>
                    )}

                    {txn && isError && (
                        <p className="text-body text-neutral-600">{t('errors.expired')}</p>
                    )}

                    {txn && data && (
                        <>
                            <div className="rounded-lg border border-neutral-200 p-4">
                                <p className="text-body text-neutral-800">
                                    {t('request', { app: appName, institute: instituteLabel })}
                                </p>
                                {data.redirect_host && (
                                    <p className="mt-1 text-caption text-neutral-600">
                                        {t('willReturnTo', { host: data.redirect_host })}
                                    </p>
                                )}
                            </div>

                            <div className="rounded-lg bg-neutral-50 p-4">
                                <p className="text-caption font-medium text-neutral-700">
                                    {t('grants.title')}
                                </p>
                                <ul className="mt-2 list-disc space-y-1 ps-5 text-caption text-neutral-600">
                                    <li>{t('grants.readOnly')}</li>
                                    <li>{t('grants.sameAsYou')}</li>
                                    <li>{t('grants.revocable')}</li>
                                </ul>
                            </div>

                            {pinnedInstitute && (
                                <p className="text-caption text-neutral-700">
                                    {t('instituteLabel')}:{' '}
                                    <span className="font-medium text-neutral-800">
                                        {data.institute_name || pinnedInstitute}
                                    </span>
                                </p>
                            )}

                            {signedIn && pinnedInstitute && !memberOfPinned && (
                                <div className="flex items-start gap-2 rounded-lg bg-warning-50 p-3">
                                    <Warning size={16} className="mt-0.5 text-warning-600" />
                                    <p className="text-caption text-warning-700">
                                        {t('errors.wrongInstitute', {
                                            institute: data.institute_name || pinnedInstitute,
                                        })}
                                    </p>
                                </div>
                            )}

                            {signedIn && !pinnedInstitute && institutes.length > 1 && (
                                <div className="space-y-1">
                                    <Label className="text-caption text-neutral-700">
                                        {t('instituteLabel')}
                                    </Label>
                                    <MyDropdown
                                        currentValue={institute}
                                        dropdownList={institutes}
                                        handleChange={setInstitute}
                                        placeholder={t('instituteLabel')}
                                    />
                                </div>
                            )}

                            {error && (
                                <div className="flex items-start gap-2 rounded-lg bg-danger-50 p-3">
                                    <Warning size={16} className="mt-0.5 text-danger-600" />
                                    <p className="text-caption text-danger-700">{error}</p>
                                </div>
                            )}

                            {!signedIn ? (
                                <MyButton
                                    buttonType="primary"
                                    scale="medium"
                                    className="w-full"
                                    onClick={goToLogin}
                                >
                                    {t('signIn')}
                                </MyButton>
                            ) : (
                                <div className="flex gap-3">
                                    <MyButton
                                        buttonType="secondary"
                                        scale="medium"
                                        className="flex-1"
                                        onClick={() => respond(false)}
                                        disable={submitting !== null}
                                    >
                                        {submitting === 'deny' ? t('denying') : t('deny')}
                                    </MyButton>
                                    <MyButton
                                        buttonType="primary"
                                        scale="medium"
                                        className="flex-1"
                                        onClick={() => respond(true)}
                                        disable={
                                            submitting !== null || !institute || !memberOfPinned
                                        }
                                    >
                                        {submitting === 'approve' ? t('approving') : t('approve')}
                                    </MyButton>
                                </div>
                            )}
                        </>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
