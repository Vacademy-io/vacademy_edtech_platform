import {
    LEARNER_CREDENTIALS_TEMPLATE_CONFIG,
    SEND_LEARNER_CREDENTIALS,
    UPDATE_USER_CREDENTIALS,
} from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';

export interface UpdateStudentCredentialsPayload {
    userId: string;
    /** Omit (or leave unchanged) to keep the current username. */
    username?: string;
    /** Omit to keep the current password. */
    password?: string;
}

/**
 * Admin-side credential change for a learner.
 *
 * auth_service validates the username against `uk_users_username`, commits it,
 * drops its auth cache, then asynchronously fans the rename out to
 * `student.username` and the four assessment-database copies — so the caller
 * only waits on the single-row auth write.
 *
 * A taken username comes back as HTTP 510 (VacademyException's default status)
 * carrying the platform's ErrorInfo envelope — the reason is in `ex`, NOT in
 * `message`, which this envelope never has. Callers should surface it rather
 * than a generic failure.
 */
export const updateStudentCredentials = async ({
    userId,
    username,
    password,
}: UpdateStudentCredentialsPayload) => {
    const response = await authenticatedAxiosInstance.post(UPDATE_USER_CREDENTIALS, {
        user_id: userId,
        // Send only what actually changed — the backend treats a blank field as
        // "leave alone", so an omitted password must not become an empty string.
        ...(username ? { username } : {}),
        ...(password ? { password } : {}),
    });
    return response.data;
};

export type CredentialChannel = 'EMAIL' | 'WHATSAPP';

export interface SendLearnerCredentialsResult {
    sent_channels: string[];
    skipped_channels: string[];
    message: string;
}

/**
 * Sends the learner their CURRENT credentials on the given channels.
 *
 * The password is not passed from here — admin_core reads it back from
 * auth_service, so this keeps plaintext out of the request and always sends
 * what is actually stored. The message body comes from whichever template the
 * institute has bound to LEARNER_CREDENTIALS_SHARED for that channel; a channel
 * with no template bound is reported in `skipped_channels` rather than falling
 * back to generic platform wording.
 */
export const sendLearnerCredentials = async ({
    instituteId,
    userId,
    channels,
}: {
    instituteId: string;
    userId: string;
    channels: CredentialChannel[];
}): Promise<SendLearnerCredentialsResult> => {
    const response = await authenticatedAxiosInstance.post(SEND_LEARNER_CREDENTIALS, null, {
        params: { instituteId, userId, channels: channels.join(',') },
    });
    return response.data;
};

export interface CredentialTemplateConfig {
    template_id?: string;
    template_name?: string;
    template_subject?: string;
}

export const getCredentialTemplateConfig = async (
    instituteId: string,
    channel: CredentialChannel
): Promise<CredentialTemplateConfig> => {
    const response = await authenticatedAxiosInstance.get(LEARNER_CREDENTIALS_TEMPLATE_CONFIG, {
        params: { instituteId, channel },
    });
    return response.data ?? {};
};

export const setCredentialTemplateConfig = async (
    instituteId: string,
    channel: CredentialChannel,
    templateId: string
) => {
    await authenticatedAxiosInstance.post(LEARNER_CREDENTIALS_TEMPLATE_CONFIG, null, {
        params: { instituteId, channel, templateId },
    });
};

export const clearCredentialTemplateConfig = async (
    instituteId: string,
    channel: CredentialChannel
) => {
    await authenticatedAxiosInstance.delete(LEARNER_CREDENTIALS_TEMPLATE_CONFIG, {
        params: { instituteId, channel },
    });
};
