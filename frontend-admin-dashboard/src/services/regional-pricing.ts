import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import {
    REGIONAL_PRICE_ITEM,
    REGIONAL_PRICE_UPSERT,
    REGIONAL_PRICING_CONFIG,
    REGIONAL_PRICING_REFRESH,
    REGIONAL_PRICING_SETTINGS,
} from '@/constants/urls';
import type {
    RegionalPriceApi,
    RegionalPriceUpsertRequest,
    RegionalPricingConfigApi,
} from '@/types/payment';

/**
 * Regional (country-based) pricing of one payment option. The server keeps AUTO prices in
 * step with the base price and the daily exchange rate; MANUAL prices are what the admin set.
 */

export const regionalPricingQueryKey = (paymentOptionId: string) => [
    'regional-pricing',
    paymentOptionId,
];

export const fetchRegionalPricing = async (
    paymentOptionId: string
): Promise<RegionalPricingConfigApi> => {
    const res = await authenticatedAxiosInstance.get<RegionalPricingConfigApi>(
        REGIONAL_PRICING_CONFIG(paymentOptionId)
    );
    return res.data;
};

export const updateRegionalPricingSettings = async (
    paymentOptionId: string,
    body: { enabled?: boolean; currencies?: string[] }
): Promise<RegionalPricingConfigApi> => {
    const res = await authenticatedAxiosInstance.put<RegionalPricingConfigApi>(
        REGIONAL_PRICING_SETTINGS(paymentOptionId),
        body
    );
    return res.data;
};

export const refreshRegionalPricing = async (
    paymentOptionId: string
): Promise<RegionalPricingConfigApi> => {
    const res = await authenticatedAxiosInstance.post<RegionalPricingConfigApi>(
        REGIONAL_PRICING_REFRESH(paymentOptionId)
    );
    return res.data;
};

export const upsertRegionalPrice = async (
    body: RegionalPriceUpsertRequest
): Promise<RegionalPriceApi> => {
    const res = await authenticatedAxiosInstance.put<RegionalPriceApi>(REGIONAL_PRICE_UPSERT, body);
    return res.data;
};

export const resetRegionalPriceToAuto = async (
    regionalPriceId: string
): Promise<RegionalPriceApi> => {
    const res = await authenticatedAxiosInstance.post<RegionalPriceApi>(
        `${REGIONAL_PRICE_ITEM(regionalPriceId)}/reset-to-auto`
    );
    return res.data;
};

export const markRegionalPriceReviewed = async (
    regionalPriceId: string
): Promise<RegionalPriceApi> => {
    const res = await authenticatedAxiosInstance.post<RegionalPriceApi>(
        `${REGIONAL_PRICE_ITEM(regionalPriceId)}/mark-reviewed`
    );
    return res.data;
};

export const deleteRegionalPrice = async (regionalPriceId: string): Promise<void> => {
    await authenticatedAxiosInstance.delete(REGIONAL_PRICE_ITEM(regionalPriceId));
};

export const useRegionalPricing = (paymentOptionId: string | undefined, enabled = true) =>
    useQuery({
        queryKey: regionalPricingQueryKey(paymentOptionId ?? ''),
        queryFn: () => fetchRegionalPricing(paymentOptionId!),
        enabled: !!paymentOptionId && enabled,
        staleTime: 0,
    });

/**
 * Every write reloads the option's config afterwards: one change can move several rows
 * (turning a currency on creates a row per plan, a base-price edit reprices AUTO rows).
 */
export const useRegionalPricingMutations = (paymentOptionId: string) => {
    const queryClient = useQueryClient();
    const key = regionalPricingQueryKey(paymentOptionId);
    const setConfig = (config: RegionalPricingConfigApi) => queryClient.setQueryData(key, config);
    const reload = () => queryClient.invalidateQueries({ queryKey: key });

    return {
        updateSettings: useMutation({
            mutationFn: (body: { enabled?: boolean; currencies?: string[] }) =>
                updateRegionalPricingSettings(paymentOptionId, body),
            onSuccess: setConfig,
        }),
        refresh: useMutation({
            mutationFn: () => refreshRegionalPricing(paymentOptionId),
            onSuccess: setConfig,
        }),
        upsert: useMutation({ mutationFn: upsertRegionalPrice, onSuccess: reload }),
        resetToAuto: useMutation({ mutationFn: resetRegionalPriceToAuto, onSuccess: reload }),
        markReviewed: useMutation({ mutationFn: markRegionalPriceReviewed, onSuccess: reload }),
        remove: useMutation({ mutationFn: deleteRegionalPrice, onSuccess: reload }),
    };
};
