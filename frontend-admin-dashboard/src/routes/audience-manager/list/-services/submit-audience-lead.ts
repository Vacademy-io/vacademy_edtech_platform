import { SUBMIT_AUDIENCE_LEAD_ADMIN_URL, SUBMIT_AUDIENCE_LEAD_URL } from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import type { TFunction } from 'i18next';

export interface SubmitLeadUserDto {
    id?: string;
    username: string;
    email: string;
    full_name: string;
    address_line?: string;
    city?: string;
    region?: string;
    pin_code?: string;
    mobile_number?: string;
    date_of_birth?: string | null;
    gender?: string;
    password?: string;
    profile_pic_file_id?: string;
    roles?: string[];
    last_login_time?: string | null;
    root_user?: boolean;
}

export interface SubmitLeadRequest {
    audience_id: string;
    source_type: string;
    source_id: string;
    custom_field_values: Record<string, string>;
    user_dto: SubmitLeadUserDto;
    /** Optional lead owner (counsellor) user id — written to the lead's assigned counsellor. */
    counsellor_id?: string;
    /** Optional lead owner display name (so the Counsellor column renders without a lookup). */
    counsellor_name?: string;
    /** Optional pipeline status key (e.g. "NEW") — sets the lead's status chip. */
    lead_status_key?: string;
}

export interface SubmitLeadResponse {
    success?: boolean;
    message?: string;
    response_id?: string;
}

/**
 * Submit a lead/response to an audience campaign using the open endpoint.
 * This can be used by admins to submit on behalf of respondents.
 */
export const submitAudienceLead = async (
    payload: SubmitLeadRequest
): Promise<SubmitLeadResponse> => {
    const response = await fetch(SUBMIT_AUDIENCE_LEAD_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `HTTP error! status: ${response.status}`);
    }

    // Handle empty response body (204 No Content or empty 200)
    const text = await response.text();
    if (!text) {
        return { success: true };
    }

    try {
        return JSON.parse(text);
    } catch {
        return { success: true, message: text };
    }
};

/**
 * Re-throw an axios failure carrying the server's own message.
 *
 * The open endpoints used `fetch` and threw `new Error(await res.text())`, so
 * callers surface the backend's wording ("Audience campaign is not active", a
 * duplicate-lead reason) via `error.message`. Axios replaces all of that with
 * "Request failed with status code 511", so unwrap the body first.
 *
 * `ex` is the field that matters: GlobalExceptionHandler serialises every
 * VacademyException as ErrorInfo {url, ex, responseCode, date}, and a bare
 * `new VacademyException(msg)` maps to 511 — which the axios response
 * interceptor deliberately does NOT treat as a dead session precisely because
 * `ex`/`responseCode` are present. `message` / `error` are covered too for
 * whatever else may sit behind these endpoints.
 */
interface ServerErrorBody {
    ex?: string;
    message?: string;
    error?: string;
}

/** The server's own message plus the HTTP status, so a caller can treat e.g. 409 specially. */
export class ServerMessageError extends Error {
    readonly status?: number;

    constructor(message: string, status?: number) {
        super(message);
        this.name = 'ServerMessageError';
        this.status = status;
    }
}

export const throwWithServerMessage = (error: unknown, fallback: string): never => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = (error as any)?.response;
    const data = response?.data;
    const status: number | undefined =
        typeof response?.status === 'number' ? response.status : undefined;
    if (typeof data === 'string' && data.trim()) throw new ServerMessageError(data, status);
    if (data && typeof data === 'object') {
        const body = data as ServerErrorBody;
        const message = body.ex ?? body.message ?? body.error;
        if (message) throw new ServerMessageError(message, status);
    }
    if (error instanceof Error && error.message) throw error;
    throw new ServerMessageError(fallback, status);
};

/** A saved lead's response id (UUID) — the only success body of the admin submit. */
const RESPONSE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Submit a lead the signed-in admin/counsellor is adding by hand.
 *
 * Same payload and same backend pipeline as {@link submitAudienceLead}, but sent
 * with the session token. That is what lets the backend know who created the
 * lead, so the "only leads assigned to <ROLE>" audience-access option can stamp
 * them as its counsellor — otherwise the creator would save a lead into a list
 * they can see and immediately lose sight of it.
 *
 * Use {@link submitAudienceLead} for anything that isn't an authenticated
 * dashboard user (embedded forms, the cURL integration snippet).
 *
 * `t` must be bound to the `audienceManagerSubmitAudienceLead` namespace — it only
 * supplies the fallback wording used when the server response carries no message
 * of its own (see {@link throwWithServerMessage}).
 */
export const submitAudienceLeadAsAdmin = async (
    payload: SubmitLeadRequest,
    t: TFunction
): Promise<SubmitLeadResponse> => {
    let response;
    try {
        response = await authenticatedAxiosInstance({
            method: 'POST',
            url: SUBMIT_AUDIENCE_LEAD_ADMIN_URL,
            data: payload,
        });
    } catch (error) {
        return throwWithServerMessage(error, t('errors.submitFailed'));
    }

    const body = response.data;
    if (!body) return { success: true };
    // A saved lead answers with its response id. Any other text is the backend
    // explaining why nothing was saved ("already submitted", a dedup rejection),
    // which used to be shown as a success.
    if (typeof body === 'string') {
        if (!RESPONSE_ID_PATTERN.test(body.trim())) throw new Error(body);
        return { success: true, response_id: body.trim() };
    }
    return body as SubmitLeadResponse;
};

/**
 * Generate a cURL command for API integration
 */
export const generateCurlCommand = (
    audienceId: string,
    customFields: Array<{ id: string; fieldName: string; fieldKey: string; isMandatory?: boolean }>
): string => {
    const samplePayload: SubmitLeadRequest = {
        audience_id: audienceId,
        source_type: 'AUDIENCE_CAMPAIGN',
        source_id: audienceId,
        custom_field_values: customFields.reduce(
            (acc, field) => {
                acc[field.id] = `<${field.fieldName || field.fieldKey}>`;
                return acc;
            },
            {} as Record<string, string>
        ),
        user_dto: {
            id: '',
            username: '<email>',
            email: '<email>',
            full_name: '<full_name>',
            address_line: '',
            city: '',
            region: '',
            pin_code: '',
            mobile_number: '<phone_number>',
            date_of_birth: null,
            gender: '',
            password: '',
            profile_pic_file_id: '',
            roles: [],
            last_login_time: null,
            root_user: false,
        },
    };

    const curlCommand = `curl '${SUBMIT_AUDIENCE_LEAD_URL}' \\
  -H 'Accept: application/json, text/plain, */*' \\
  -H 'Content-Type: application/json' \\
  --data-raw '${JSON.stringify(samplePayload, null, 2)}'`;

    return curlCommand;
};
