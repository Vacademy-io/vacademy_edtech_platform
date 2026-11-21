import { afterEach, describe, expect, it } from 'vitest';
import axios, { type InternalAxiosRequestConfig } from 'axios';
import Cookies from 'js-cookie';
import { TokenKey } from '@/constants/auth/tokens';
import { refreshTokens } from '@/lib/auth/sessionUtility';

const originalAdapter = axios.defaults.adapter;

describe('refreshTokens', () => {
    afterEach(() => {
        axios.defaults.adapter = originalAdapter;
        Cookies.remove(TokenKey.accessToken);
        Cookies.remove(TokenKey.refreshToken);
    });

    it('POSTs the refresh token as JSON and keeps it when the response omits it', async () => {
        const sent: InternalAxiosRequestConfig[] = [];
        axios.defaults.adapter = async (config) => {
            sent.push(config);
            return { data: { accessToken: 'new-access' }, status: 200, statusText: 'OK', headers: {}, config };
        };

        const result = await refreshTokens('refresh-1');

        expect(sent).toHaveLength(1);
        expect(sent[0]!.method).toBe('post');
        expect(sent[0]!.params).toBeUndefined();
        expect(JSON.parse(String(sent[0]!.data))).toEqual({ token: 'refresh-1' });
        expect(Cookies.get(TokenKey.accessToken)).toBe('new-access');
        expect(Cookies.get(TokenKey.refreshToken)).toBe('refresh-1');
        expect(result).toMatchObject({ accessToken: 'new-access', refreshToken: 'refresh-1' });
    });

    it('stores a new refresh token when the response carries one', async () => {
        axios.defaults.adapter = async (config) => ({
            data: { accessToken: 'new-access', refreshToken: 'refresh-2' },
            status: 200,
            statusText: 'OK',
            headers: {},
            config,
        });

        await refreshTokens('refresh-1');

        expect(Cookies.get(TokenKey.refreshToken)).toBe('refresh-2');
    });
});
