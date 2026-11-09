/**
 * react-query hooks for the marketing screens. Every mutation toasts its own success /
 * failure (failures carry the backend's message verbatim) and refreshes the queries it
 * can change. Keys are scoped by institute so switching institutes never shows the
 * previous institute's accounts.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import {
    aiDraftSocialPost,
    approveSocialPost,
    cancelSocialPost,
    createSocialPost,
    deleteSocialPost,
    disconnectAdAccount,
    disconnectSocialAccount,
    getAdPerformance,
    getConnectOptions,
    initiateMarketingOAuth,
    listAdAccounts,
    listSocialAccounts,
    listSocialPosts,
    marketingErrorMessage,
    postSocialPostNow,
    retrySocialPost,
    selectConnectOptions,
    syncAdAccount,
    syncAllAdAccounts,
    updateSocialPost,
} from './marketing-api';
import type {
    AiDraftRequest,
    ListSocialPostsParams,
    MarketingProvider,
    SocialPost,
    SocialPostAction,
    SocialPostRequest,
} from './types';

export const MARKETING_KEY = 'marketing';

const inst = () => getCurrentInstituteId() ?? '';

export const marketingKeys = {
    /** Everything marketing for the current institute. */
    all: () => [MARKETING_KEY, inst()] as const,
    connectOptions: (sessionKey: string) =>
        [MARKETING_KEY, inst(), 'connect-options', sessionKey] as const,
    adAccounts: () => [MARKETING_KEY, inst(), 'ad-accounts'] as const,
    /** Prefix of every performance window. */
    adPerformanceAll: () => [MARKETING_KEY, inst(), 'ad-performance'] as const,
    adPerformance: (from: string, to: string) =>
        [MARKETING_KEY, inst(), 'ad-performance', from, to] as const,
    socialAccounts: () => [MARKETING_KEY, inst(), 'social-accounts'] as const,
    /** Prefix of every post list. */
    socialPostsAll: () => [MARKETING_KEY, inst(), 'social-posts'] as const,
    socialPosts: (params: ListSocialPostsParams) =>
        [
            MARKETING_KEY,
            inst(),
            'social-posts',
            params.from ?? '',
            params.to ?? '',
            params.status ?? '',
        ] as const,
};

/** Post statuses the server is still working on; lists poll while any is present. */
const IN_FLIGHT: ReadonlySet<SocialPost['status']> = new Set(['PUBLISHING']);
const POLL_MS = 15_000;

// ── OAuth + account selection ───────────────────────────────────────────────

/**
 * Starts OAuth for a provider and sends the whole tab to the provider's consent screen.
 * The backend brings the browser back with ?mkt_session=… (see use-oauth-return).
 */
export function useStartMarketingOAuth() {
    const { t } = useTranslation('marketing');
    return useMutation({
        mutationFn: (provider: MarketingProvider) => initiateMarketingOAuth(provider),
        onSuccess: (data) => {
            if (data?.oauth_url) {
                window.location.href = data.oauth_url;
            } else {
                toast.error(t('connect.startFailed'));
            }
        },
        onError: (error) => toast.error(marketingErrorMessage(error, t('connect.startFailed'))),
    });
}

/** Options for an authorised session. Never retried: the error text is shown verbatim. */
export const useConnectOptions = (sessionKey: string | null, enabled = true) =>
    useQuery({
        queryKey: marketingKeys.connectOptions(sessionKey ?? ''),
        queryFn: () => getConnectOptions(sessionKey ?? ''),
        enabled: enabled && !!sessionKey,
        retry: false,
        staleTime: Infinity,
        refetchOnWindowFocus: false,
    });

export function useSelectConnectOptions() {
    const { t } = useTranslation('marketing');
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ sessionKey, externalIds }: { sessionKey: string; externalIds: string[] }) =>
            selectConnectOptions(sessionKey, externalIds),
        onSuccess: (data, { sessionKey }) => {
            const created = data?.created ?? 0;
            if (created > 0) toast.success(t('connect.connectedToast', { count: created }));
            else toast.success(t('connect.upToDateToast'));
            queryClient.removeQueries({ queryKey: marketingKeys.connectOptions(sessionKey) });
            queryClient.invalidateQueries({ queryKey: marketingKeys.adAccounts() });
            queryClient.invalidateQueries({ queryKey: marketingKeys.adPerformanceAll() });
            queryClient.invalidateQueries({ queryKey: marketingKeys.socialAccounts() });
        },
        onError: (error) => toast.error(marketingErrorMessage(error, t('connect.selectFailed'))),
    });
}

// ── Ads ─────────────────────────────────────────────────────────────────────

export const useAdAccounts = (enabled = true) =>
    useQuery({
        queryKey: marketingKeys.adAccounts(),
        queryFn: listAdAccounts,
        enabled,
        staleTime: 30_000,
    });

/** Report for an inclusive yyyy-MM-dd window; keeps the previous window on screen while loading. */
export const useAdPerformance = (from: string, to: string, enabled = true) =>
    useQuery({
        queryKey: marketingKeys.adPerformance(from, to),
        queryFn: () => getAdPerformance(from, to),
        enabled: enabled && !!from && !!to,
        placeholderData: keepPreviousData,
        staleTime: 60_000,
    });

export function useDisconnectAdAccount() {
    const { t } = useTranslation('marketing');
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => disconnectAdAccount(id),
        onSuccess: () => {
            toast.success(t('common.toasts.adAccountDisconnected'));
            queryClient.invalidateQueries({ queryKey: marketingKeys.adAccounts() });
            queryClient.invalidateQueries({ queryKey: marketingKeys.adPerformanceAll() });
        },
        onError: (error) => toast.error(marketingErrorMessage(error, t('common.toasts.failed'))),
    });
}

export function useSyncAdAccount() {
    const { t } = useTranslation('marketing');
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => syncAdAccount(id),
        onSuccess: (account) => {
            if (account?.last_sync_status === 'FAILED') {
                toast.error(account.status_detail || t('common.toasts.syncFailed'));
            } else {
                toast.success(t('common.toasts.adAccountSynced'));
            }
            queryClient.invalidateQueries({ queryKey: marketingKeys.adAccounts() });
            queryClient.invalidateQueries({ queryKey: marketingKeys.adPerformanceAll() });
        },
        onError: (error) =>
            toast.error(marketingErrorMessage(error, t('common.toasts.syncFailed'))),
    });
}

export function useSyncAllAdAccounts() {
    const { t } = useTranslation('marketing');
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: () => syncAllAdAccounts(),
        onSuccess: (data) => {
            const queued = data?.queued ?? 0;
            if (queued > 0) toast.success(t('common.toasts.syncQueued', { count: queued }));
            else toast.info(t('common.toasts.nothingToSync'));
            queryClient.invalidateQueries({ queryKey: marketingKeys.adAccounts() });
        },
        onError: (error) =>
            toast.error(marketingErrorMessage(error, t('common.toasts.syncFailed'))),
    });
}

// ── Social ──────────────────────────────────────────────────────────────────

export const useSocialAccounts = (enabled = true) =>
    useQuery({
        queryKey: marketingKeys.socialAccounts(),
        queryFn: listSocialAccounts,
        enabled,
        staleTime: 30_000,
    });

export function useDisconnectSocialAccount() {
    const { t } = useTranslation('marketing');
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => disconnectSocialAccount(id),
        onSuccess: () => {
            toast.success(t('common.toasts.socialAccountDisconnected'));
            queryClient.invalidateQueries({ queryKey: marketingKeys.socialAccounts() });
        },
        onError: (error) => toast.error(marketingErrorMessage(error, t('common.toasts.failed'))),
    });
}

/** Post list for a window; polls while a post is being published. */
export const useSocialPosts = (params: ListSocialPostsParams, enabled = true) =>
    useQuery({
        queryKey: marketingKeys.socialPosts(params),
        queryFn: () => listSocialPosts(params),
        enabled,
        placeholderData: keepPreviousData,
        staleTime: 15_000,
        refetchInterval: (query) =>
            query.state.data?.some((post) => IN_FLIGHT.has(post.status)) ? POLL_MS : false,
    });

const SAVED_TOAST: Record<SocialPostAction, string> = {
    DRAFT: 'common.toasts.postDraftSaved',
    SUBMIT: 'common.toasts.postSubmitted',
    SCHEDULE: 'common.toasts.postScheduled',
    POST_NOW: 'common.toasts.postPublishing',
};

/** Create (no id) or update (id) a post; the toast follows the post's resulting status. */
export function useSaveSocialPost() {
    const { t } = useTranslation('marketing');
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, req }: { id?: string | null; req: SocialPostRequest }) =>
            id ? updateSocialPost(id, req) : createSocialPost(req),
        onSuccess: (post, { req }) => {
            // A non-admin's SCHEDULE lands in NEEDS_APPROVAL; say so rather than "scheduled".
            const key =
                post?.status === 'NEEDS_APPROVAL'
                    ? SAVED_TOAST.SUBMIT
                    : SAVED_TOAST[req.action] ?? SAVED_TOAST.DRAFT;
            toast.success(t(key));
            queryClient.invalidateQueries({ queryKey: marketingKeys.socialPostsAll() });
        },
        onError: (error) =>
            toast.error(marketingErrorMessage(error, t('common.toasts.postSaveFailed'))),
    });
}

type PostActionName = 'approve' | 'postNow' | 'cancel' | 'retry' | 'delete';

const POST_ACTIONS: Record<PostActionName, (id: string) => Promise<unknown>> = {
    approve: approveSocialPost,
    postNow: postSocialPostNow,
    cancel: cancelSocialPost,
    retry: retrySocialPost,
    delete: deleteSocialPost,
};

const POST_ACTION_TOAST: Record<PostActionName, string> = {
    approve: 'common.toasts.postApproved',
    postNow: 'common.toasts.postPublishing',
    cancel: 'common.toasts.postCancelled',
    retry: 'common.toasts.postRetried',
    delete: 'common.toasts.postDeleted',
};

function useSocialPostAction(action: PostActionName) {
    const { t } = useTranslation('marketing');
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => POST_ACTIONS[action](id),
        onSuccess: () => {
            toast.success(t(POST_ACTION_TOAST[action]));
            queryClient.invalidateQueries({ queryKey: marketingKeys.socialPostsAll() });
        },
        onError: (error) => toast.error(marketingErrorMessage(error, t('common.toasts.failed'))),
    });
}

export const useApproveSocialPost = () => useSocialPostAction('approve');
export const usePostSocialPostNow = () => useSocialPostAction('postNow');
export const useCancelSocialPost = () => useSocialPostAction('cancel');
export const useRetrySocialPost = () => useSocialPostAction('retry');
export const useDeleteSocialPost = () => useSocialPostAction('delete');

/** AI copy for the composer. Saves nothing, so only failures toast. */
export function useAiDraftSocialPost() {
    const { t } = useTranslation('marketing');
    return useMutation({
        mutationFn: (req: AiDraftRequest) => aiDraftSocialPost(req),
        onError: (error) =>
            toast.error(marketingErrorMessage(error, t('common.toasts.aiDraftFailed'))),
    });
}
