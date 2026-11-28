import { describe, expect, it } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';
import type { ScanSession } from '../-services/scan-station-services';
import { isScanNotFound, retryUnlessNotFound } from './api-error';
import { sessionPollInterval } from './session-poll';

const failed = (status: number) =>
    new AxiosError('failed', String(status), undefined, undefined, {
        status,
        statusText: '',
        headers: {},
        config: { headers: new AxiosHeaders() },
        data: { ex: 'Not found' },
    });

const busy = { status: 'OPEN', verdict: 'ANALYSING', loads: [] } as unknown as ScanSession;
const idle = { status: 'OPEN', verdict: 'READY', loads: [] } as unknown as ScanSession;

describe('sessionPollInterval', () => {
    it('polls while the server is working and stops when it is done', () => {
        expect(sessionPollInterval({ data: busy, error: null }, 4000)).toBe(4000);
        expect(sessionPollInterval({ data: idle, error: null }, 4000)).toBe(false);
        expect(sessionPollInterval({ data: undefined, error: null }, 4000)).toBe(false);
    });

    it('stops on a 404 even though the last session it saw was still busy', () => {
        // Switched off mid-session: the failed refetch keeps the busy data.
        expect(sessionPollInterval({ data: busy, error: failed(404) }, 4000)).toBe(false);
    });

    it('keeps polling through a passing server error', () => {
        expect(sessionPollInterval({ data: busy, error: failed(502) }, 4000)).toBe(4000);
    });
});

describe('404 helpers', () => {
    it('knows a 404 from any other failure', () => {
        expect(isScanNotFound(failed(404))).toBe(true);
        expect(isScanNotFound(failed(409))).toBe(false);
        expect(isScanNotFound(new Error('network'))).toBe(false);
    });

    it('never retries a 404, retries anything else up to 3 times', () => {
        expect(retryUnlessNotFound(0, failed(404))).toBe(false);
        expect(retryUnlessNotFound(0, failed(500))).toBe(true);
        expect(retryUnlessNotFound(2, failed(500))).toBe(true);
        expect(retryUnlessNotFound(3, failed(500))).toBe(false);
    });
});
