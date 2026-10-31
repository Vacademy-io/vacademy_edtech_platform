import axios from 'axios';
import {
    GET_PRODUCT_PAGE_BY_CODE,
    VALIDATE_PRODUCT_PAGE_COUPON,
    PRODUCT_PAGE_FORM_SUBMIT,
    PRODUCT_PAGE_ENROLL,
    PRODUCT_PAGE_CPO_ENROLL,
    PRODUCT_PAGE_LOGIN_CODE_EXCHANGE,
} from '@/constants/urls';
import type {
    ProductPageData,
    ProductPageFormSubmitResponse,
    ProductPageEnrollResponse,
    ProductPageLoginCodeExchangeResponse,
    CouponValidateResponse,
    FieldValue,
} from '../-types/product-page-types';
import { resolveLearnerIdentity } from '../-utils/learner-identity';
import { withOrderedMappings } from '../-utils/mapping-order';

export const getProductPageByCode = async (
    code: string,
    instituteId: string
): Promise<ProductPageData> => {
    const response = await axios.get<ProductPageData>(GET_PRODUCT_PAGE_BY_CODE(code, instituteId));
    return response.data;
};

export const handleGetProductPage = (code: string, instituteId: string) => ({
    queryKey: ['PRODUCT_PAGE_BY_CODE', code, instituteId],
    queryFn: () => getProductPageByCode(code, instituteId),
    // Every consumer gets the mappings in the admin's display order (see
    // mapping-order). A module-level function, so the result stays memoised.
    select: withOrderedMappings,
    staleTime: 5 * 60 * 1000,
    enabled: !!code && !!instituteId,
});

export const validateCoupon = async (
    coursePageCode: string,
    couponCode: string,
    totalAmount: number,
    /** Basket size, for coupons carrying a minimum ("₹99 off on 2 or more"). */
    itemCount?: number,
    /**
     * The same cart at base prices, sent only when it is regionally priced: the server
     * checks the coupon on this and scales the discount to the regional total.
     */
    baseTotalAmount?: number
): Promise<CouponValidateResponse> => {
    const response = await axios.post<CouponValidateResponse>(
        VALIDATE_PRODUCT_PAGE_COUPON,
        null,
        {
            params: {
                coursePageCode,
                couponCode,
                totalAmount,
                ...(typeof itemCount === 'number' ? { itemCount } : {}),
                ...(typeof baseTotalAmount === 'number' ? { baseTotalAmount } : {}),
            },
        }
    );
    return response.data;
};

interface FormSubmitPayload {
    coursePageCode: string;
    instituteId: string;
    selectedPsInvitePaymentOptionIds: string[];
    registrationData: Record<string, FieldValue>;
    utmParams?: Record<string, string>;
}

export const submitProductPageForm = async (
    payload: FormSubmitPayload
): Promise<ProductPageFormSubmitResponse> => {
    const { coursePageCode, instituteId, selectedPsInvitePaymentOptionIds, registrationData } = payload;

    const values = Object.values(registrationData);
    const { email, phone, name } = resolveLearnerIdentity(values);

    const customFieldValues = values.map((f) => ({
        custom_field_id: f.id,
        value: f.value,
        enroll_invite_ids: f.enroll_invite_ids ?? [],
    }));

    const response = await axios.post<ProductPageFormSubmitResponse>(PRODUCT_PAGE_FORM_SUBMIT, {
        product_page_code: coursePageCode,
        institute_id: instituteId,
        selected_ps_invite_payment_option_ids: selectedPsInvitePaymentOptionIds,
        user_details: {
            email,
            username: email,
            mobile_number: phone,
            full_name: name,
            address_line: '',
            region: '',
            city: '',
            pin_code: '',
            date_of_birth: new Date().toISOString().split('T')[0],
            gender: '',
        },
        learner_extra_details: {},
        custom_field_values: customFieldValues,
        utm_params: payload.utmParams ?? {},
    });
    return response.data;
};

interface EnrollPayload {
    coursePageCode: string;
    instituteId: string;
    userId: string;
    selectedMappings: Array<{
        ps_invite_payment_option_id: string;
        payment_plan_id: string;
        amount: number;
    }>;
    couponCode?: string;
    registrationData: Record<string, FieldValue>;
    paymentInitiationRequest: Record<string, unknown>;
    utmParams?: Record<string, string>;
}

interface CpoEnrollPayload {
    coursePageCode: string;
    instituteId: string;
    psInvitePaymentOptionId: string;
    paymentPlanId: string;
    registrationData: Record<string, FieldValue>;
}

export const enrollCpoForProductPage = async (
    payload: CpoEnrollPayload
): Promise<{ user_id: string; user_plan_id: string }> => {
    const { registrationData } = payload;
    const values = Object.values(registrationData);
    const { email, phone, name } = resolveLearnerIdentity(values);

    const customFieldValues = values.map((f) => ({
        custom_field_id: f.id,
        value: f.value,
        enroll_invite_ids: f.enroll_invite_ids ?? [],
    }));

    const response = await axios.post<{ user_id: string; user_plan_id: string }>(PRODUCT_PAGE_CPO_ENROLL, {
        product_page_code: payload.coursePageCode,
        institute_id: payload.instituteId,
        ps_invite_payment_option_id: payload.psInvitePaymentOptionId,
        payment_plan_id: payload.paymentPlanId,
        user_details: {
            email,
            username: email,
            mobile_number: phone,
            full_name: name,
            address_line: '',
            region: '',
            city: '',
            pin_code: '',
            date_of_birth: new Date().toISOString().split('T')[0],
            gender: '',
        },
        learner_extra_details: {},
        custom_field_values: customFieldValues,
    });
    return response.data;
};

export const enrollForProductPage = async (
    payload: EnrollPayload
): Promise<ProductPageEnrollResponse> => {
    const { registrationData } = payload;
    const values = Object.values(registrationData);
    const { email, phone, name } = resolveLearnerIdentity(values);

    const customFieldValues = values.map((f) => ({
        custom_field_id: f.id,
        value: f.value,
        enroll_invite_ids: f.enroll_invite_ids ?? [],
    }));

    const response = await axios.post<ProductPageEnrollResponse>(PRODUCT_PAGE_ENROLL, {
        product_page_code: payload.coursePageCode,
        institute_id: payload.instituteId,
        user_id: payload.userId,
        selected_mappings: payload.selectedMappings.map((m) => ({
            ps_invite_payment_option_id: m.ps_invite_payment_option_id,
            payment_plan_id: m.payment_plan_id,
            amount: m.amount,
        })),
        coupon_code: payload.couponCode || null,
        user: {
            email,
            username: email,
            mobile_number: phone,
            full_name: name,
        },
        learner_extra_details: {},
        refer_request: null,
        custom_field_values: customFieldValues,
        payment_initiation_request: payload.paymentInitiationRequest,
        utm_params: payload.utmParams ?? {},
    });
    return response.data;
};

/** Swaps the one-time login_code from a paid enroll for the buyer's tokens. */
export const exchangeProductPageLoginCode = async (
    loginCode: string,
    instituteId: string
): Promise<ProductPageLoginCodeExchangeResponse> => {
    const response = await axios.post<ProductPageLoginCodeExchangeResponse>(
        PRODUCT_PAGE_LOGIN_CODE_EXCHANGE,
        { login_code: loginCode, institute_id: instituteId }
    );
    return response.data;
};
