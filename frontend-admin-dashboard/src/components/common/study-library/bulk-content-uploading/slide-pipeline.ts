// Bulk Content Uploading — shared slide-preparation pipeline.
//
// Extracted from commit-engine.ts so BOTH the folder-mode commit (commitScope)
// and the CSV-manifest commit (runCsvCommit) reuse the exact same extract →
// convert → upload-with-retry → create-slide choreography, concurrency pool,
// and ppt/big-file mutexes. The store/zip/manifest dependencies the helpers
// close over are passed explicitly via PipelineCtx.

import * as pdfjs from 'pdfjs-dist';
import { UploadFileInS3, getPublicUrl } from '@/services/upload_file';
import { convertDocToHtml } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-components/slides-sidebar/utils/doc-to-html';
import { convertPptToPdf } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-components/slides-sidebar/add-ppt-dialog';
import { convertHtmlToPdf } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-helper/helper';
import {
    createDocHtmlSlide,
    createExternalLinkSlide,
    createImageSlide,
    createPdfSlide,
    createScormSlide,
    createVideoFileSlide,
    createYoutubeSlide,
    updateChapterSlideOrder,
    uploadScormPackage,
    type BulkSlideContext,
} from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-services/bulk-slide-creation';
import type { SessionManifest } from './session-manifest';
import type { BulkItem, ItemStatus } from './types';

pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

export const UPLOAD_POOL_SIZE = 3;
export const BIG_FILE_BYTES = 100 * 1024 * 1024; // >100MB uploads run one at a time
const UPLOAD_ATTEMPTS = 3;

export type Mutex = <T>(task: () => Promise<T>) => Promise<T>;

/** Shared across all scopes in one run: one conversion service, one uplink. */
export interface SharedRunResources {
    pptMutex: Mutex;
    bigFileMutex: Mutex;
}

const normalizeHtmlQuotes = (html: string) => html.replace(/\\"/g, '"');

/** Serializes calls through a single-flight chain (ppt conversion, big uploads). */
export const createMutex = (): Mutex => {
    let chain: Promise<unknown> = Promise.resolve();
    return <T>(task: () => Promise<T>): Promise<T> => {
        const run = chain.then(task, task);
        chain = run.catch(() => undefined);
        return run;
    };
};

/** Bounded-concurrency worker pool. */
export const pool = async <T>(
    inputs: T[],
    limit: number,
    task: (input: T, index: number) => Promise<void>
): Promise<void> => {
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, inputs.length) }, async () => {
        while (next < inputs.length) {
            const index = next++;
            await task(inputs[index]!, index);
        }
    });
    await Promise.all(workers);
};

const uploadWithRetry = async (
    file: File,
    instituteId: string,
    sourceId: string
): Promise<string> => {
    let lastError: unknown;
    for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt++) {
        try {
            // UploadFileInS3 requests a fresh presigned URL on every call, so
            // retries never reuse an expired/consumed URL.
            const fileId = await UploadFileInS3(
                file,
                () => {},
                'bulk-content-upload',
                instituteId,
                sourceId,
                true
            );
            if (!fileId) throw new Error('Upload did not return a file id');
            return fileId;
        } catch (error) {
            lastError = error;
            if (attempt < UPLOAD_ATTEMPTS) {
                await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** (attempt - 1)));
            }
        }
    }
    throw lastError instanceof Error ? lastError : new Error('Upload failed');
};

const countPdfPages = async (file: File): Promise<number> => {
    try {
        const buffer = await file.arrayBuffer();
        const pdf = await pdfjs.getDocument({ data: buffer }).promise;
        return pdf.numPages;
    } catch {
        return 1; // encrypted/corrupt PDFs still become slides
    }
};

export interface PreparedContent {
    fileId?: string;
    totalPages?: number;
    html?: string;
    publicImageUrl?: string;
}

/** Everything prepareItem closes over — supplied by the caller (commit-engine / csv-commit). */
export interface PipelineCtx {
    /** Returns the file for an item — from a zip entry or an in-memory selection. */
    extractFile: (entryPath: string, fileName: string) => Promise<File>;
    instituteId: string;
    manifest: SessionManifest;
    shared: SharedRunResources;
    replaceBase64ImagesWithNetworkUrls: (html: string) => Promise<string>;
    markItem: (itemId: string, status: ItemStatus, patch?: Partial<BulkItem>) => void;
    patchItem: (itemId: string, patch: Partial<BulkItem>) => void;
}

/**
 * Extract + convert + upload one item, caching its fileId in the store + manifest.
 * Link items (YOUTUBE / EXTERNAL_LINK) need no extraction.
 */
export const prepareItem = async (item: BulkItem, ctx: PipelineCtx): Promise<PreparedContent> => {
    if (item.kind === 'YOUTUBE' || item.kind === 'EXTERNAL_LINK') return {};

    ctx.markItem(item.id, 'preparing');

    if (item.kind === 'DOC') {
        const file = await ctx.extractFile(item.entryPath, item.fileName);
        const html = await convertDocToHtml(file);
        const processed = await ctx.replaceBase64ImagesWithNetworkUrls(html);
        const normalized = normalizeHtmlQuotes(processed);
        let totalPages = 1;
        try {
            const result = await convertHtmlToPdf(processed);
            totalPages = result.totalPages || 1;
        } catch {
            totalPages = 1;
        }
        return { html: normalized, totalPages };
    }

    if (item.kind === 'PDF' || item.kind === 'PPT') {
        let pdfFile: File;
        if (item.kind === 'PPT') {
            const source = await ctx.extractFile(item.entryPath, item.fileName);
            // The conversion service is a shared multipart endpoint — one at a time.
            pdfFile = await ctx.shared.pptMutex(() => convertPptToPdf(source));
        } else {
            pdfFile = await ctx.extractFile(item.entryPath, item.fileName);
        }
        const totalPages = await countPdfPages(pdfFile);
        if (item.fileId) return { fileId: item.fileId, totalPages };
        ctx.markItem(item.id, 'uploading');
        const fileId = await uploadWithRetry(pdfFile, ctx.instituteId, 'PDF_DOCUMENTS');
        ctx.patchItem(item.id, { fileId });
        ctx.manifest.set(item.key, { fileId });
        return { fileId, totalPages };
    }

    if (item.kind === 'IMAGE') {
        let fileId = item.fileId;
        if (!fileId) {
            const file = await ctx.extractFile(item.entryPath, item.fileName);
            ctx.markItem(item.id, 'uploading');
            fileId = await uploadWithRetry(file, ctx.instituteId, 'IMAGES');
            ctx.patchItem(item.id, { fileId });
            ctx.manifest.set(item.key, { fileId });
        }
        const publicImageUrl = await getPublicUrl(fileId);
        if (!publicImageUrl) throw new Error('Could not resolve the uploaded image URL');
        return { fileId, publicImageUrl };
    }

    if (item.kind === 'SCORM') {
        // fileId doubles as the ScormSlide id cache here, so a retry never
        // re-uploads a package that already made it through the parser.
        if (item.fileId) return { fileId: item.fileId };
        const file = await ctx.extractFile(item.entryPath, item.fileName);
        ctx.markItem(item.id, 'uploading');
        // Multipart upload that the server then unzips and parses — heavy on
        // both ends. Share the big-file lane so only one heavy upload of any
        // kind is ever in flight, regardless of package size.
        //
        // Deliberately NOT wrapped in uploadWithRetry: the common failures here
        // are deterministic (not a SCORM package, no launch file), so retrying
        // would re-send the whole package twice more and re-run the server-side
        // unzip for nothing. "Retry failed only" covers the transient case.
        const scormSlideId = await ctx.shared.bigFileMutex(() => uploadScormPackage(file));
        ctx.patchItem(item.id, { fileId: scormSlideId });
        ctx.manifest.set(item.key, { fileId: scormSlideId });
        return { fileId: scormSlideId };
    }

    // VIDEO_FILE
    if (item.fileId) return { fileId: item.fileId };
    const file = await ctx.extractFile(item.entryPath, item.fileName);
    ctx.markItem(item.id, 'uploading');
    const upload = () => uploadWithRetry(file, ctx.instituteId, 'ADMIN');
    const fileId =
        item.sizeBytes > BIG_FILE_BYTES ? await ctx.shared.bigFileMutex(upload) : await upload();
    ctx.patchItem(item.id, { fileId });
    ctx.manifest.set(item.key, { fileId });
    return { fileId };
};

/** Create the slide for a prepared item against a resolved chapter context. */
export const createSlideForItem = async (
    slideCtx: BulkSlideContext,
    item: BulkItem,
    prepared: PreparedContent,
    slideOrder: number
): Promise<string> => {
    switch (item.kind) {
        case 'PDF':
        case 'PPT':
            return createPdfSlide(slideCtx, {
                title: item.title,
                fileId: prepared.fileId!,
                totalPages: prepared.totalPages ?? 1,
                slideOrder,
            });
        case 'DOC':
            return createDocHtmlSlide(slideCtx, {
                title: item.title,
                html: prepared.html!,
                totalPages: prepared.totalPages ?? 1,
                slideOrder,
            });
        case 'IMAGE':
            return createImageSlide(slideCtx, {
                title: item.title,
                publicImageUrl: prepared.publicImageUrl!,
                slideOrder,
            });
        case 'VIDEO_FILE':
            return createVideoFileSlide(slideCtx, {
                title: item.title,
                fileId: prepared.fileId!,
                slideOrder,
            });
        case 'SCORM':
            return createScormSlide(slideCtx, {
                title: item.title,
                scormSlideId: prepared.fileId!,
                slideOrder,
            });
        case 'YOUTUBE':
            return createYoutubeSlide(slideCtx, {
                title: item.title,
                url: item.url!,
                slideOrder,
            });
        case 'EXTERNAL_LINK':
            return createExternalLinkSlide(slideCtx, {
                title: item.title,
                url: item.url!,
                slideOrder,
            });
    }
};

/**
 * Per-chapter Phase-2 choreography shared by both commit paths: prepare pending
 * items through the pool, create slides sequentially in precomputed order.
 * Returns nothing — item statuses (+ manifest) are updated in place.
 *
 * `slide_order` is `existingSlideCount + index` over the non-skipped list, so
 * new slides append after existing ones and ordering is retry-stable.
 */
export const commitChapterItems = async (args: {
    chapterItems: BulkItem[];
    slideCtx: BulkSlideContext;
    existingSlideCount: number;
    pipeline: PipelineCtx;
    getItem: (id: string) => BulkItem | undefined;
}): Promise<void> => {
    const { chapterItems, slideCtx, existingSlideCount, pipeline, getItem } = args;

    const orderedItems = chapterItems.filter((i) => getItem(i.id)?.status !== 'skipped');
    const orderOf = new Map(
        orderedItems.map((item, index) => [item.id, existingSlideCount + index])
    );
    const pendingItems = orderedItems.filter((i) => getItem(i.id)?.status === 'pending');
    if (pendingItems.length === 0) return;

    // Prepare through a pool, but expose each as a promise the sequential
    // creator can await in item order.
    const preparedById = new Map<string, Promise<PreparedContent>>();
    const prepareStarted = new Map<string, () => void>();
    const preparePromises = pendingItems.map(
        (item) =>
            new Promise<PreparedContent>((resolve, reject) => {
                prepareStarted.set(item.id, () => {
                    prepareItem(item, pipeline).then(resolve, reject);
                });
            })
    );
    pendingItems.forEach((item, index) => preparedById.set(item.id, preparePromises[index]!));
    preparedById.forEach((p) => p.catch(() => undefined)); // avoid unhandled rejections
    void pool(pendingItems, UPLOAD_POOL_SIZE, async (item) => {
        prepareStarted.get(item.id)?.();
        await preparedById.get(item.id)!.catch(() => undefined);
    });

    for (const item of pendingItems) {
        const current = getItem(item.id);
        if (!current || current.status === 'skipped' || current.status === 'done') continue;
        try {
            const prepared = await preparedById.get(item.id)!;
            pipeline.markItem(item.id, 'creating');
            const slideOrder = orderOf.get(item.id) ?? existingSlideCount;
            const slideId = await createSlideForItem(slideCtx, current, prepared, slideOrder);
            pipeline.markItem(item.id, 'done', { slideId });
            pipeline.manifest.set(item.key, { slideId, fileId: getItem(item.id)?.fileId });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to create slide';
            pipeline.markItem(item.id, 'failed', { error: message });
        }
    }
};

/**
 * For a chapter that already had slides, lock in "existing first (renumbered),
 * newly created appended" so parallel uploads can't scramble learner order.
 * Non-fatal on failure (slides exist; only relative order may differ).
 */
export const reorderAppendedSlides = async (
    chapterId: string,
    existingSlides: { id: string; slideOrder: number }[],
    createdSlideIds: string[]
): Promise<void> => {
    if (existingSlides.length === 0 || createdSlideIds.length === 0) return;
    const sortedExisting = [...existingSlides].sort((a, b) => a.slideOrder - b.slideOrder);
    await reorderChapterSlidesExplicit(chapterId, [
        ...sortedExisting.map((s) => s.id),
        ...createdSlideIds,
    ]);
};

/** Set the chapter's slide order to exactly this id sequence (0..n-1). Non-fatal. */
export const reorderChapterSlidesExplicit = async (
    chapterId: string,
    orderedSlideIds: string[]
): Promise<void> => {
    if (orderedSlideIds.length === 0) return;
    const payload = orderedSlideIds.map((id, index) => ({ slide_id: id, slide_order: index }));
    try {
        await updateChapterSlideOrder(chapterId, payload);
    } catch {
        // non-fatal
    }
};
