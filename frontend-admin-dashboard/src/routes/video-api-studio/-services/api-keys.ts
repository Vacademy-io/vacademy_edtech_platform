import { AI_SERVICE_BASE_URL } from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';

export interface ApiKey {
    id: string;
    name: string;
    key: string;
    created_at: string;
    status: 'active' | 'revoked';
}

export interface GenerateKeyRequest {
    institute_id: string;
    name: string;
}

export interface GenerateKeyResponse {
    id: string;
    name: string;
    key: string;
    created_at: string;
    status: string;
}

export interface RevokeKeyResponse {
    status: string;
    message: string;
}

// Key management goes through the authenticated client so ai_service receives the
// admin's JWT and clientId (it is about to require them on /institute/api-keys/*).
//
// The full key is still kept in localStorage below: the console and Input Videos
// page call /external/video/v1/* with it as X-Institute-Key, and the API only
// returns it once, at generate time. It can go once those console calls
// authenticate with the JWT instead.
const STORED_KEY_PREFIX = 'vacademy_video_api_key_';

export function storeFullApiKey(keyId: string, fullKey: string): void {
    localStorage.setItem(`${STORED_KEY_PREFIX}${keyId}`, fullKey);
}

export function getStoredFullApiKey(keyId: string): string | null {
    return localStorage.getItem(`${STORED_KEY_PREFIX}${keyId}`);
}

export function removeStoredApiKey(keyId: string): void {
    localStorage.removeItem(`${STORED_KEY_PREFIX}${keyId}`);
}

export function getFirstAvailableFullKey(keys: ApiKey[]): string | null {
    for (const key of keys) {
        if (key.status === 'active') {
            const fullKey = getStoredFullApiKey(key.id);
            if (fullKey) {
                return fullKey;
            }
        }
    }
    return null;
}

export const generateApiKey = async (
    instituteId: string,
    name: string
): Promise<GenerateKeyResponse> => {
    const response = await authenticatedAxiosInstance.post<GenerateKeyResponse>(
        `${AI_SERVICE_BASE_URL}/institute/api-keys/generate`,
        {
            institute_id: instituteId,
            name,
        }
    );
    return response.data;
};

export const listApiKeys = async (instituteId: string): Promise<ApiKey[]> => {
    const response = await authenticatedAxiosInstance.get<ApiKey[]>(
        `${AI_SERVICE_BASE_URL}/institute/api-keys/${instituteId}`
    );
    return response.data;
};

export const revokeApiKey = async (
    instituteId: string,
    keyId: string
): Promise<RevokeKeyResponse> => {
    const response = await authenticatedAxiosInstance.delete<RevokeKeyResponse>(
        `${AI_SERVICE_BASE_URL}/institute/api-keys/${instituteId}/${keyId}`
    );
    return response.data;
};
