import { beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.fn();
const put = vi.fn();
vi.mock('@/lib/auth/axiosInstance', () => ({ default: { post: (...a: unknown[]) => post(...a) } }));
vi.mock('axios', () => ({ default: (...a: unknown[]) => put(...a) }));

import { GET_SIGNED_URL, ACKNOWLEDGE } from '@/constants/urls';
import { ScanUploadError, uploadScanFile, uploadScanFiles } from './upload-scan-file';

const opts = { userId: 'u1', instituteId: 'inst-1', retryDelayMs: 0 };
const jpeg = (name: string) => new File(['x'], name, { type: 'image/jpeg' });

beforeEach(() => {
    post.mockReset();
    put.mockReset();
    let n = 0;
    post.mockImplementation((url: string, body: { file_name?: string }) => {
        if (url === GET_SIGNED_URL) {
            n += 1;
            return Promise.resolve({
                data: { id: `file-${n}`, url: `https://s3/${body.file_name}/${n}` },
            });
        }
        return Promise.resolve({ data: true });
    });
});

describe('uploadScanFile', () => {
    it('asks for a signed URL under the institute and ASSESSMENT_SCAN_STATION', async () => {
        put.mockResolvedValue({ status: 200 });
        const id = await uploadScanFile(jpeg('Scan 3.jpeg'), opts);
        expect(id).toBe('file-1');
        expect(post).toHaveBeenCalledWith(GET_SIGNED_URL, {
            file_name: 'scan_3.jpeg',
            file_type: 'image/jpeg',
            source: 'inst-1',
            source_id: 'ASSESSMENT_SCAN_STATION',
        });
        expect(post).toHaveBeenCalledWith(ACKNOWLEDGE, { file_id: 'file-1', user_id: 'u1' });
    });

    it('throws after one retry when storage answers 403, and never acknowledges', async () => {
        put.mockResolvedValue({ status: 403 });
        await expect(uploadScanFile(jpeg('Scan.jpeg'), opts)).rejects.toBeInstanceOf(
            ScanUploadError
        );
        expect(put).toHaveBeenCalledTimes(2);
        expect(post.mock.calls.filter(([url]) => url === GET_SIGNED_URL)).toHaveLength(2);
        expect(post.mock.calls.filter(([url]) => url === ACKNOWLEDGE)).toHaveLength(0);
    });

    it('succeeds on the retry', async () => {
        put.mockResolvedValueOnce({ status: 500 }).mockResolvedValueOnce({ status: 200 });
        await expect(uploadScanFile(jpeg('Scan.jpeg'), opts)).resolves.toBe('file-2');
    });
});

describe('uploadScanFiles', () => {
    it('returns ids in the order given and reports progress', async () => {
        put.mockResolvedValue({ status: 200 });
        const progress: number[] = [];
        const files = ['a', 'b', 'c', 'd', 'e'].map((n) => jpeg(`${n}.jpeg`));
        const ids = await uploadScanFiles(files, opts, (done) => progress.push(done));
        expect(ids).toHaveLength(5);
        expect(new Set(ids).size).toBe(5);
        expect(progress).toEqual([1, 2, 3, 4, 5]);
    });

    it('rejects when any file still fails after its retry', async () => {
        // b.jpeg is refused on both tries; the others land.
        put.mockImplementation((req: { url: string }) =>
            Promise.resolve({ status: req.url.includes('/b.jpeg/') ? 403 : 200 })
        );
        const files = ['a', 'b', 'c'].map((n) => jpeg(`${n}.jpeg`));
        await expect(uploadScanFiles(files, opts)).rejects.toMatchObject({
            name: 'ScanUploadError',
            fileName: 'b.jpeg',
        });
    });
});
