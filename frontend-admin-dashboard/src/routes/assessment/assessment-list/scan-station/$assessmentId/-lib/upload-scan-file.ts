import axios from 'axios';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { ACKNOWLEDGE, GET_SIGNED_URL } from '@/constants/urls';
import { SCAN_UPLOAD_SOURCE_ID } from '../-services/scan-station-services';
import { classify } from './folder-intake';

/**
 * Strict upload of raw pass files. Unlike UploadFileInS3 (which hands back the
 * file id even when the storage PUT failed) a scan page that did not land must
 * never be counted: the server pairs pages by position, so a hole would shift
 * every later sheet. Each file gets one retry with a fresh signed URL.
 */

export interface ScanUploadOptions {
    userId: string;
    instituteId: string;
    /** Wait before the retry; tests pass 0. */
    retryDelayMs?: number;
}

export class ScanUploadError extends Error {
    readonly fileName: string;

    constructor(fileName: string, cause: unknown) {
        super(
            `Upload failed for ${fileName}: ${cause instanceof Error ? cause.message : String(cause)}`
        );
        this.name = 'ScanUploadError';
        this.fileName = fileName;
    }
}

const UPLOAD_CONCURRENCY = 3;
const DEFAULT_RETRY_DELAY_MS = 1000;

const contentTypeOf = (file: File) => {
    if (file.type) return file.type;
    const kind = classify(file);
    if (kind === 'PDF') return 'application/pdf';
    if (kind === 'IMAGE') return /\.png$/i.test(file.name) ? 'image/png' : 'image/jpeg';
    return 'application/octet-stream';
};

const uploadOnce = async (file: File, opts: ScanUploadOptions): Promise<string> => {
    const contentType = contentTypeOf(file);
    const signed = await authenticatedAxiosInstance.post(GET_SIGNED_URL, {
        file_name: file.name.toLowerCase().replace(/\s+/g, '_'),
        file_type: contentType,
        source: opts.instituteId,
        source_id: SCAN_UPLOAD_SOURCE_ID,
    });
    const { id, url } = (signed.data ?? {}) as { id?: string; url?: string };
    if (!id || !url) throw new Error('no signed URL');
    const put = await axios({
        method: 'PUT',
        url,
        data: file,
        headers: { 'Content-Type': contentType },
        validateStatus: () => true,
    });
    if (put.status < 200 || put.status >= 300) {
        throw new Error(`storage answered ${put.status}`);
    }
    await authenticatedAxiosInstance.post(ACKNOWLEDGE, { file_id: id, user_id: opts.userId });
    return id;
};

const wait = (ms: number) =>
    ms > 0 ? new Promise<void>((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

/** The file's media id; throws ScanUploadError after one failed retry. */
export const uploadScanFile = async (file: File, opts: ScanUploadOptions): Promise<string> => {
    try {
        return await uploadOnce(file, opts);
    } catch {
        await wait(opts.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
        try {
            return await uploadOnce(file, opts);
        } catch (e) {
            throw new ScanUploadError(file.name, e);
        }
    }
};

/**
 * Upload every file, three at a time; ids come back in the order given.
 * Rejects when any file still fails after its retry, and stops starting new
 * uploads once one has failed (the load cannot be sent with a hole in it).
 */
export const uploadScanFiles = async (
    files: File[],
    opts: ScanUploadOptions,
    onProgress?: (done: number, total: number) => void
): Promise<string[]> => {
    const ids: string[] = new Array<string>(files.length);
    let next = 0;
    let done = 0;
    let failure: unknown = null;
    const worker = async () => {
        while (failure === null && next < files.length) {
            const i = next;
            next += 1;
            try {
                ids[i] = await uploadScanFile(files[i]!, opts);
                done += 1;
                onProgress?.(done, files.length);
            } catch (e) {
                if (failure === null) failure = e;
            }
        }
    };
    await Promise.all(
        Array.from({ length: Math.min(UPLOAD_CONCURRENCY, files.length) }, () => worker())
    );
    if (failure !== null) throw failure;
    return ids;
};
