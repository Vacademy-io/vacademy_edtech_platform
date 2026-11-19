import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import {
    INSTITUTE_PAYMENT_GATEWAYS,
    INSTITUTE_PAYMENT_GATEWAY_ACTIVATE,
    INSTITUTE_PAYMENT_GATEWAY_BY_ID,
    INSTITUTE_PAYMENT_GATEWAY_USAGE,
} from '@/constants/urls';

export type PaymentVendor =
    | 'STRIPE'
    | 'RAZORPAY'
    | 'PHONEPE'
    | 'CASHFREE'
    | 'EWAY';

export interface PaymentGatewayMapping {
    id: string;
    vendor: PaymentVendor;
    institute_id: string;
    status: 'ACTIVE' | 'INACTIVE';
    created_at: string;
    updated_at: string;
    payment_gateway_specific_data: Record<string, unknown>;
}

export interface PaymentGatewayUpsertPayload {
    vendor?: PaymentVendor;
    status?: 'ACTIVE' | 'INACTIVE';
    payment_gateway_specific_data: Record<string, unknown>;
}

/**
 * The mask prefix the backend uses for secret fields. When this value is sent
 * back unchanged in an UPDATE request, the server preserves the stored secret.
 */
export const SECRET_MASK_PREFIX = '••••';

export const isMaskedSecret = (value: unknown): boolean =>
    typeof value === 'string' && value.startsWith(SECRET_MASK_PREFIX);

export const listPaymentGateways = async (
    instituteId: string
): Promise<PaymentGatewayMapping[]> => {
    const res = await authenticatedAxiosInstance.get<PaymentGatewayMapping[]>(
        INSTITUTE_PAYMENT_GATEWAYS(instituteId)
    );
    return res.data;
};

export const createPaymentGateway = async (
    instituteId: string,
    payload: PaymentGatewayUpsertPayload
): Promise<PaymentGatewayMapping> => {
    const res = await authenticatedAxiosInstance.post<PaymentGatewayMapping>(
        INSTITUTE_PAYMENT_GATEWAYS(instituteId),
        payload
    );
    return res.data;
};

export const updatePaymentGateway = async (
    instituteId: string,
    mappingId: string,
    payload: PaymentGatewayUpsertPayload
): Promise<PaymentGatewayMapping> => {
    const res = await authenticatedAxiosInstance.put<PaymentGatewayMapping>(
        INSTITUTE_PAYMENT_GATEWAY_BY_ID(instituteId, mappingId),
        payload
    );
    return res.data;
};

export const deactivatePaymentGateway = async (
    instituteId: string,
    mappingId: string
): Promise<void> => {
    await authenticatedAxiosInstance.delete(
        INSTITUTE_PAYMENT_GATEWAY_BY_ID(instituteId, mappingId)
    );
};

/** Switches a deactivated gateway back on with its stored keys (same mapping id). */
export const activatePaymentGateway = async (
    instituteId: string,
    mappingId: string
): Promise<PaymentGatewayMapping> => {
    const res = await authenticatedAxiosInstance.put<PaymentGatewayMapping>(
        INSTITUTE_PAYMENT_GATEWAY_ACTIVATE(instituteId, mappingId)
    );
    return res.data;
};

export interface PaymentGatewayUsage {
    vendor: PaymentVendor;
    /** Live invite links whose checkout goes through this gateway. */
    active_invites: number;
    /** Of those, links selling a non-free plan: payment stops on these if the gateway is off. */
    paid_active_invites: number;
}

export const getPaymentGatewayUsage = async (
    instituteId: string,
    mappingId: string
): Promise<PaymentGatewayUsage> => {
    const res = await authenticatedAxiosInstance.get<PaymentGatewayUsage>(
        INSTITUTE_PAYMENT_GATEWAY_USAGE(instituteId, mappingId)
    );
    return res.data;
};
