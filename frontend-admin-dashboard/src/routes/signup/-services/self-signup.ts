import axios from 'axios';
import { BASE_URL } from '@/constants/urls';

const API = `${BASE_URL}/auth-service/v1/self-signup`;

export interface SignupContext {
    product: string;
    plan?: string;
    source?: string;
    campaign?: string;
}

/** A product's sign-up screen, as set in the super-admin portal. */
export interface SignupProductConfig {
    product: string;
    display_name: string;
    trial_days: number;
    logo_url?: string | null;
    app_path: string;
    /** The visitor proves a phone number with a WhatsApp code before the account exists. */
    phone_verification_required?: boolean;
    /** The form does not ask how many teachers there are. */
    hide_teachers?: boolean;
    /** "What kind of business" choices; absent = the institute types. */
    institute_types?: string[] | null;
}

export const fetchSignupConfig = async (product: string): Promise<SignupProductConfig> => {
    const { data } = await axios.get<SignupProductConfig>(`${API}/config`, { params: { product } });
    return data;
};

/** The trial offer set on the health dashboard (public, no login). */
export interface ProductOffer {
    trial_days: number;
    /** AI credits a new sign-up opens with; null = the platform's default. */
    demo_credits: number | null;
}

export const fetchProductOffer = async (product: string): Promise<ProductOffer> => {
    const { data } = await axios.get<ProductOffer>(
        `${BASE_URL}/admin-core-service/public/product/v1/${encodeURIComponent(product)}/offer`
    );
    return data;
};

export interface SelfSignupDetails {
    signup_token: string;
    full_name: string;
    phone: string;
    username?: string;
    password?: string;
    institute_name: string;
    institute_type: string;
    city: string;
    state: string;
    teachers?: number;
}

/** Sends a WhatsApp code to the phone; needs the email proof from the step before. */
export const requestPhoneOtp = async (
    product: string,
    signupToken: string,
    phone: string
): Promise<void> => {
    await axios.post(`${API}/request-phone-otp`, { product, signup_token: signupToken, phone });
};

/** Checks the WhatsApp code; the new token carries the email and the phone. */
export const verifyPhoneOtp = async (
    product: string,
    signupToken: string,
    phone: string,
    otp: string
): Promise<string> => {
    const { data } = await axios.post<{ signup_token: string }>(`${API}/verify-phone-otp`, {
        product,
        signup_token: signupToken,
        phone,
        otp,
    });
    return data.signup_token;
};

export interface SignupTokens {
    accessToken: string;
    refreshToken: string;
}

/** The backend's sentence when it gave one: these are written for the person signing up. */
export const signupErrorMessage = (error: unknown): string | undefined => {
    const data = (error as { response?: { data?: { ex?: string; message?: string } } })?.response
        ?.data;
    return data?.ex || data?.message;
};

export const requestSignupOtp = async (product: string, email: string): Promise<void> => {
    await axios.post(`${API}/request-otp`, { product, email });
};

export const verifySignupOtp = async (
    product: string,
    email: string,
    otp: string
): Promise<string> => {
    const { data } = await axios.post<{ signup_token: string }>(`${API}/verify-otp`, {
        product,
        email,
        otp,
    });
    return data.signup_token;
};

export const completeSignup = async (
    context: SignupContext,
    details: SelfSignupDetails
): Promise<SignupTokens> => {
    const { data } = await axios.post<SignupTokens>(`${API}/signup`, { ...context, ...details });
    return data;
};

/** Google comes back to this same page, carrying the proof of the email or the login tokens. */
export const startGoogleSignup = (context: SignupContext) => {
    const back = new URL(`${window.location.origin}/signup/start`);
    Object.entries(context).forEach(([key, value]) => {
        if (value) back.searchParams.set(key, value);
    });
    const state = btoa(
        JSON.stringify({
            from: back.toString(),
            account_type: 'signup',
            user_type: 'admin',
            product: context.product,
        })
    );
    window.location.href = `${BASE_URL}/auth-service/oauth2/authorization/google?state=${encodeURIComponent(state)}`;
};

export interface GoogleReturn {
    tokens?: SignupTokens;
    signupToken?: string;
    name?: string;
    email?: string;
    failed?: boolean;
}

let consumed: GoogleReturn | null | undefined;

/**
 * Reads what Google left in the URL and clears it, so a token never stays in the address bar.
 * Once per page load: clearing means a second read (React's double render) would find nothing.
 */
export const consumeGoogleReturn = (): GoogleReturn | null => {
    if (consumed === undefined) consumed = readGoogleReturn();
    return consumed;
};

const readGoogleReturn = (): GoogleReturn | null => {
    const params = new URLSearchParams(window.location.search);
    const accessToken = params.get('accessToken');
    const refreshToken = params.get('refreshToken');
    const signupToken = params.get('signupToken');
    const signupData = params.get('signupData');
    const failed = params.get('error') === 'true' || !!params.get('oauth_error');
    if (!accessToken && !signupData && !failed) return null;

    ['accessToken', 'refreshToken', 'signupToken', 'signupData', 'state', 'emailVerified', 'error', 'oauth_error'].forEach(
        (key) => params.delete(key)
    );
    const rest = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${rest ? `?${rest}` : ''}`);

    if (accessToken && refreshToken) return { tokens: { accessToken, refreshToken } };
    if (failed || !signupToken) return { failed: true };

    let profile: { name?: string; email?: string } = {};
    try {
        const padded = (signupData ?? '').replace(/-/g, '+').replace(/_/g, '/');
        profile = JSON.parse(decodeURIComponent(escape(atob(padded))));
    } catch {
        /* the form asks for the name instead */
    }
    return { signupToken, name: profile.name, email: profile.email };
};
