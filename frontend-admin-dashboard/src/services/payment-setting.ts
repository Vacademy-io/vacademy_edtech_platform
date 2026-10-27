/**
 * The institute's PAYMENT_SETTING blob (institutes.setting_json → setting.PAYMENT_SETTING.data):
 * flat flags plus `defaultCurrency`. Several settings cards edit it, and the save endpoint
 * replaces the WHOLE data object, so every writer patches the latest copy rather than its own.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_INSITITUTE_SETTINGS } from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { getInstituteDefaultCurrency } from '@/utils/institute-currency';

export const PAYMENT_SETTING_KEY = 'PAYMENT_SETTING';
export const PAYMENT_SETTING_QUERY_KEY = ['payment-setting'];
/** ISO 4217 code used wherever a plan / payment / invoice carries no currency of its own. */
export const DEFAULT_CURRENCY_FIELD = 'defaultCurrency';

const SAVE_URL = GET_INSITITUTE_SETTINGS.replace('/get', '/save-setting');

export type PaymentSettingData = Record<string, unknown>;

export const fetchPaymentSetting = async (): Promise<PaymentSettingData> => {
    const instituteId = getCurrentInstituteId();
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: GET_INSITITUTE_SETTINGS,
        params: { instituteId, settingKey: PAYMENT_SETTING_KEY },
    });
    // GET returns the SettingDto ({key, name, data}); its content sits one
    // level down at response.data.data (same as OnboardingSettings.tsx).
    return (response.data?.data as PaymentSettingData) ?? {};
};

export const savePaymentSetting = async (data: PaymentSettingData): Promise<void> => {
    const instituteId = getCurrentInstituteId();
    await authenticatedAxiosInstance.post(
        SAVE_URL,
        { setting_name: 'Payment Setting', setting_data: data },
        { params: { instituteId, settingKey: PAYMENT_SETTING_KEY } }
    );
};

/**
 * Mirror a saved PAYMENT_SETTING into the loaded institute details, whose raw `setting` JSON is
 * what `getInstituteDefaultCurrency()` reads — otherwise a new default currency would only show
 * up across the app after the next full reload.
 */
const syncInstituteStore = (data: PaymentSettingData) => {
    const { instituteDetails, setInstituteDetails } = useInstituteDetailsStore.getState();
    if (!instituteDetails) return;
    try {
        const parsed = instituteDetails.setting ? JSON.parse(instituteDetails.setting) : {};
        const settings = parsed.setting ?? {};
        settings[PAYMENT_SETTING_KEY] = {
            ...(settings[PAYMENT_SETTING_KEY] ?? {}),
            key: PAYMENT_SETTING_KEY,
            data,
        };
        setInstituteDetails({
            ...instituteDetails,
            setting: JSON.stringify({ ...parsed, setting: settings }),
        });
    } catch {
        /* unparseable setting JSON — leave the store alone; the next reload picks it up */
    }
};

export const usePaymentSetting = () =>
    useQuery({
        queryKey: PAYMENT_SETTING_QUERY_KEY,
        queryFn: fetchPaymentSetting,
        staleTime: 5 * 60 * 1000,
    });

/** Saves the given WHOLE data object, then refreshes the query and the institute store. */
export const useSavePaymentSetting = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (data: PaymentSettingData) => {
            await savePaymentSetting(data);
            return data;
        },
        onSuccess: (data) => {
            syncInstituteStore(data);
            queryClient.invalidateQueries({ queryKey: PAYMENT_SETTING_QUERY_KEY });
        },
    });
};

/**
 * The institute's currency for money with none of its own: the saved PAYMENT_SETTING default
 * when loaded, else what the institute details give (`getInstituteDefaultCurrency`), else ''.
 */
export const useInstituteDefaultCurrency = (): string => {
    const { data } = usePaymentSetting();
    const saved = data?.[DEFAULT_CURRENCY_FIELD];
    if (typeof saved === 'string' && /^[A-Za-z]{3}$/.test(saved.trim())) {
        return saved.trim().toUpperCase();
    }
    return getInstituteDefaultCurrency();
};
