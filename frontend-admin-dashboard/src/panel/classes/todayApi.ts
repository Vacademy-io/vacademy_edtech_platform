import axios from 'axios';
import { BASE_URL } from '@/constants/urls';
import {
    CLASSROOM_TODAY_PATH,
    type TodayResponse,
    type TodayScope,
} from '@/classroom-shared/apiTypes';
import { panelApi } from '../lib/api';

const TODAY_TIMEOUT_MS = 15000;

export async function fetchToday(instituteId: string, scope: TodayScope): Promise<TodayResponse> {
    const response = await panelApi.get<TodayResponse>(`${BASE_URL}${CLASSROOM_TODAY_PATH}`, {
        params: { instituteId, scope },
        timeout: TODAY_TIMEOUT_MS,
    });
    return response.data;
}

/** No answer at all. An answer with an error status is a different state on screen. */
export function isNetworkFailure(error: unknown): boolean {
    if (axios.isAxiosError(error)) return !error.response;
    return error instanceof Error && /^Offline/.test(error.message);
}
