import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL } from '@/constants/urls';

const API = `${BASE_URL}/admin-core-service/v1/telleo/onboarding`;

export type OnboardingStatus = 'NEW' | 'RUNNING' | 'READY' | 'FAILED';
export type StepStatus = 'PENDING' | 'DONE' | 'FAILED';

export interface TelleoAnswers {
    business_description: string;
    website?: string;
    goal: 'QUALIFY_LEADS' | 'BOOK_APPOINTMENTS' | 'PAYMENT_REMINDERS' | 'FEEDBACK' | 'OTHER';
    goal_detail?: string;
    audience: string;
    success_outcome: 'BOOKED' | 'INTERESTED' | 'TRANSFER' | 'DETAILS_COLLECTED';
    pricing?: string;
    language: 'english' | 'hindi' | 'hinglish';
    voice_gender: 'female' | 'male';
    agent_name?: string;
}

export interface TelleoOnboardingStatus {
    institute_id: string;
    status: OnboardingStatus;
    line_status: StepStatus;
    settings_status: StepStatus;
    agent_status: StepStatus;
    agent_id?: string | null;
    agent_source?: 'AI' | 'TEMPLATE' | null;
    error?: string | null;
    answers?: TelleoAnswers | null;
    verified_phone?: string | null;
    trial_ends_at?: string | null;
}

export interface CallMeResult {
    dispatched: boolean;
    status?: string;
    provider_message?: string;
    providerMessage?: string;
}

export const fetchOnboarding = async (instituteId: string): Promise<TelleoOnboardingStatus> => {
    const { data } = await authenticatedAxiosInstance.get<TelleoOnboardingStatus>(
        `${API}/${encodeURIComponent(instituteId)}`
    );
    return data;
};

export const submitAnswers = async (
    instituteId: string,
    answers: TelleoAnswers
): Promise<TelleoOnboardingStatus> => {
    const { data } = await authenticatedAxiosInstance.post<TelleoOnboardingStatus>(
        `${API}/${encodeURIComponent(instituteId)}/answers`,
        answers
    );
    return data;
};

export const retryOnboarding = async (instituteId: string): Promise<TelleoOnboardingStatus> => {
    const { data } = await authenticatedAxiosInstance.post<TelleoOnboardingStatus>(
        `${API}/${encodeURIComponent(instituteId)}/retry`
    );
    return data;
};

export const callMeNow = async (instituteId: string, name?: string): Promise<CallMeResult> => {
    const { data } = await authenticatedAxiosInstance.post<CallMeResult>(
        `${API}/${encodeURIComponent(instituteId)}/call-me`,
        name ? { name } : {}
    );
    return data;
};

/** The backend's sentence when it gave one. */
export const onboardingErrorMessage = (error: unknown): string | undefined => {
    const data = (error as { response?: { data?: { ex?: string; message?: string } } })?.response
        ?.data;
    return data?.ex || data?.message;
};
