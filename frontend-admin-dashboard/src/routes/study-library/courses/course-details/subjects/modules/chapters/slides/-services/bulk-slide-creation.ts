// Plain-function slide creation for bulk flows.
//
// useSlidesMutations is bound to a single chapterId, so multi-chapter bulk flows
// (Bulk Content Uploading) can't use it. These functions post the exact payload
// shapes proven in -quick-add.tsx / the AI copilot's courseCreationService, with
// the chapter/module/subject context passed per call. Slide ids are returned so
// callers can build reorder payloads.

import i18next from 'i18next';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import {
    ADD_UPDATE_DOCUMENT_SLIDE,
    ADD_UPDATE_VIDEO_SLIDE,
    ADD_UPDATE_QUIZ_SLIDE,
    ADD_UPDATE_ASSESSMENT_SLIDE,
    UPDATE_SLIDE_ORDER,
    SCORM_UPLOAD,
    SCORM_ADD_OR_UPDATE,
} from '@/constants/urls';
import type {
    DocumentSlidePayload,
    VideoSlidePayload,
    QuizSlidePayload,
    QuizSlideQuestion,
    AssessmentSlidePayload,
    ScormSlidePayload,
} from '../-hooks/use-slides';

export interface BulkSlideContext {
    chapterId: string;
    moduleId: string;
    subjectId: string;
    packageSessionId: string;
    instituteId: string;
    status: 'PUBLISHED' | 'DRAFT';
    notify: boolean;
}

const documentSlideUrl = (ctx: BulkSlideContext) =>
    `${ADD_UPDATE_DOCUMENT_SLIDE}?chapterId=${ctx.chapterId}&moduleId=${ctx.moduleId}&subjectId=${ctx.subjectId}&packageSessionId=${ctx.packageSessionId}&instituteId=${ctx.instituteId}`;

const videoSlideUrl = (ctx: BulkSlideContext) =>
    `${ADD_UPDATE_VIDEO_SLIDE}?chapterId=${ctx.chapterId}&instituteId=${ctx.instituteId}&packageSessionId=${ctx.packageSessionId}&moduleId=${ctx.moduleId}&subjectId=${ctx.subjectId}`;

const postDocumentSlide = async (
    ctx: BulkSlideContext,
    payload: DocumentSlidePayload
): Promise<string> => {
    const response = await authenticatedAxiosInstance.post(documentSlideUrl(ctx), payload);
    return response.data || payload.id;
};

const postVideoSlide = async (
    ctx: BulkSlideContext,
    payload: VideoSlidePayload
): Promise<string> => {
    const response = await authenticatedAxiosInstance.post(videoSlideUrl(ctx), payload);
    return response.data || payload.id;
};

// Param order mirrors useSlidesMutations' SCORM call exactly.
const scormSlideUrl = (ctx: BulkSlideContext) =>
    `${SCORM_ADD_OR_UPDATE}?chapterId=${ctx.chapterId}&moduleId=${ctx.moduleId}&subjectId=${ctx.subjectId}&packageSessionId=${ctx.packageSessionId}&instituteId=${ctx.instituteId}`;

// This endpoint returns the slide object rather than a bare id string like the
// document/video ones, so unwrap either shape and fall back to the id we sent.
const postScormSlide = async (
    ctx: BulkSlideContext,
    payload: ScormSlidePayload & { id: string }
): Promise<string> => {
    const response = await authenticatedAxiosInstance.post(scormSlideUrl(ctx), payload);
    const data = response.data;
    const returnedId = typeof data === 'string' ? data : data?.id;
    return returnedId || payload.id;
};

// Query-param order mirrors the working useSlidesMutations hook exactly so the
// backend route binds identically (quiz puts instituteId second; assessment
// puts instituteId last).
const quizSlideUrl = (ctx: BulkSlideContext) =>
    `${ADD_UPDATE_QUIZ_SLIDE}?chapterId=${ctx.chapterId}&instituteId=${ctx.instituteId}&packageSessionId=${ctx.packageSessionId}&subjectId=${ctx.subjectId}&moduleId=${ctx.moduleId}`;

const assessmentSlideUrl = (ctx: BulkSlideContext) =>
    `${ADD_UPDATE_ASSESSMENT_SLIDE}?chapterId=${ctx.chapterId}&moduleId=${ctx.moduleId}&subjectId=${ctx.subjectId}&packageSessionId=${ctx.packageSessionId}&instituteId=${ctx.instituteId}`;

const postQuizSlide = async (
    ctx: BulkSlideContext,
    payload: QuizSlidePayload
): Promise<string> => {
    const response = await authenticatedAxiosInstance.post(quizSlideUrl(ctx), payload);
    return response.data || payload.id || '';
};

const postAssessmentSlide = async (
    ctx: BulkSlideContext,
    payload: AssessmentSlidePayload
): Promise<string> => {
    const response = await authenticatedAxiosInstance.post(assessmentSlideUrl(ctx), payload);
    return response.data || payload.id || '';
};

const escapeForSingleQuotedAttr = (val: string) =>
    String(val).replace(/&/g, '&amp;').replace(/'/g, '&#39;');

export const createPdfSlide = (
    ctx: BulkSlideContext,
    args: { title: string; fileId: string; totalPages: number; slideOrder: number }
): Promise<string> => {
    const published = ctx.status === 'PUBLISHED';
    return postDocumentSlide(ctx, {
        id: crypto.randomUUID(),
        title: args.title,
        image_file_id: '',
        description: null,
        slide_order: args.slideOrder,
        document_slide: {
            id: crypto.randomUUID(),
            type: 'PDF',
            data: args.fileId,
            title: args.title,
            cover_file_id: '',
            total_pages: args.totalPages,
            published_data: published ? args.fileId : null,
            published_document_total_pages: published ? args.totalPages : 0,
        },
        status: ctx.status,
        new_slide: true,
        notify: ctx.notify,
    });
};

export const createDocHtmlSlide = (
    ctx: BulkSlideContext,
    args: {
        title: string;
        html: string;
        totalPages: number;
        slideOrder: number;
        description?: string;
    }
): Promise<string> => {
    const published = ctx.status === 'PUBLISHED';
    return postDocumentSlide(ctx, {
        id: crypto.randomUUID(),
        title: args.title,
        image_file_id: '',
        description: args.description ?? null,
        slide_order: args.slideOrder,
        document_slide: {
            id: crypto.randomUUID(),
            type: 'DOC',
            data: args.html,
            title: args.title,
            cover_file_id: '',
            total_pages: args.totalPages,
            published_data: published ? args.html : null,
            published_document_total_pages: published ? args.totalPages : 0,
        },
        status: ctx.status,
        new_slide: true,
        notify: ctx.notify,
    });
};

/** Image becomes a DOC document slide wrapping an <img> (same as quick-add IMAGE kind). */
export const createImageSlide = (
    ctx: BulkSlideContext,
    args: { title: string; publicImageUrl: string; slideOrder: number }
): Promise<string> => {
    const html = `<!DOCTYPE html><html><head></head><body><div><div style='margin-left: 0px; display: flex; width: 100%; justify-content: center;'><img data-meta-align='center' data-meta-depth='0' src='${args.publicImageUrl}' alt='${escapeForSingleQuotedAttr(args.title)}' width='0' height='0' objectFit='contain'/></div></div></body></html>`;
    return createDocHtmlSlide(ctx, {
        title: args.title,
        html,
        totalPages: 1,
        slideOrder: args.slideOrder,
        description: 'Image',
    });
};

export const createExternalLinkSlide = (
    ctx: BulkSlideContext,
    args: { title: string; url: string; slideOrder: number }
): Promise<string> => {
    const html = `<html><head></head><body><p><a href='${args.url}' target='_blank' rel='noreferrer noopener'>${args.url}</a></p></body></html>`;
    return createDocHtmlSlide(ctx, {
        title: args.title,
        html,
        totalPages: 1,
        slideOrder: args.slideOrder,
        description: 'External link',
    });
};

/**
 * SCORM is a two-step flow: uploadScormPackage() posts the .zip to the SCORM
 * service, which unzips and parses it, then this attaches the resulting
 * ScormSlide id to a slide. Mirrors add-scorm-dialog.tsx.
 */
export const createScormSlide = (
    ctx: BulkSlideContext,
    args: { title: string; scormSlideId: string; slideOrder: number }
): Promise<string> => {
    return postScormSlide(ctx, {
        id: crypto.randomUUID(),
        title: args.title,
        description: null,
        status: ctx.status,
        slide_order: args.slideOrder,
        new_slide: true,
        // AddScormSlideDTO.notify is a primitive boolean — omitting it silently
        // means false, so a published SCORM slide would skip the learner
        // notification that every other slide type sends.
        notify: ctx.notify,
        scorm_slide: { id: args.scormSlideId },
    });
};

/**
 * Posts the SCORM .zip to the parser and returns the ScormSlide id.
 * Multipart, and the server unzips it — callers should serialize large ones.
 */
export const uploadScormPackage = async (file: File): Promise<string> => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await authenticatedAxiosInstance.post(SCORM_UPLOAD, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
    });
    const scormSlideId = response.data?.id;
    if (!scormSlideId) {
        throw new Error(
            i18next.t('studyLibraryBulkSlideCreation:errors.scormNoPackageId')
        );
    }
    return scormSlideId;
};

export const createVideoFileSlide = (
    ctx: BulkSlideContext,
    args: { title: string; fileId: string; slideOrder: number }
): Promise<string> => {
    const published = ctx.status === 'PUBLISHED';
    return postVideoSlide(ctx, {
        id: crypto.randomUUID(),
        title: args.title,
        description: null,
        image_file_id: null,
        slide_order: args.slideOrder,
        video_slide: {
            id: crypto.randomUUID(),
            description: '',
            url: args.fileId,
            title: args.title,
            video_length_in_millis: 0,
            published_url: published ? args.fileId : '',
            published_video_length_in_millis: 0,
            source_type: 'FILE_ID',
        },
        status: ctx.status,
        new_slide: true,
        notify: ctx.notify,
    });
};

/** YouTube link — quick-add uses source_type 'VIDEO' for YouTube URLs. */
export const createYoutubeSlide = (
    ctx: BulkSlideContext,
    args: { title: string; url: string; slideOrder: number }
): Promise<string> => {
    const published = ctx.status === 'PUBLISHED';
    return postVideoSlide(ctx, {
        id: crypto.randomUUID(),
        title: args.title,
        description: null,
        image_file_id: null,
        slide_order: args.slideOrder,
        video_slide: {
            id: crypto.randomUUID(),
            description: '',
            url: args.url,
            title: args.title,
            video_length_in_millis: 0,
            published_url: published ? args.url : '',
            published_video_length_in_millis: 0,
            source_type: 'VIDEO',
        },
        status: ctx.status,
        new_slide: true,
        notify: ctx.notify,
    });
};

/**
 * Create a self-contained QUIZ slide from already-transformed quiz questions.
 * Mirrors the payload AddQuizDialog.createSlide posts (new_slide:true,
 * source_type:'QUIZ'), but takes the chapter context per-call so it works for
 * an arbitrary destination chapter (not the one the slides route is mounted on).
 */
export const createQuizSlide = (
    ctx: BulkSlideContext,
    args: { title: string; questions: QuizSlideQuestion[]; slideOrder: number }
): Promise<string> => {
    const payload: QuizSlidePayload = {
        id: `quiz-${crypto.randomUUID()}`,
        source_id: '',
        source_type: 'QUIZ',
        title: args.title,
        image_file_id: '',
        description: 'Quiz',
        status: ctx.status,
        slide_order: args.slideOrder,
        video_slide: null,
        document_slide: null,
        question_slide: null,
        assignment_slide: null,
        quiz_slide: {
            id: crypto.randomUUID(),
            title: args.title,
            description: { id: '', content: '', type: 'TEXT' },
            questions: args.questions,
        },
        is_loaded: true,
        new_slide: true,
    };
    return postQuizSlide(ctx, payload);
};

/**
 * Create an ASSESSMENT slide that links an already-published assessment.
 * Payload shape matches add-assessment-slide-dialog's linkAssessmentAsSlide.
 */
export const createAssessmentLinkSlide = (
    ctx: BulkSlideContext,
    args: { title: string; assessmentId: string; slideOrder: number }
): Promise<string> => {
    const assessmentSlideId = crypto.randomUUID();
    const payload: AssessmentSlidePayload = {
        id: crypto.randomUUID(),
        source_id: assessmentSlideId,
        source_type: 'ASSESSMENT',
        title: args.title,
        description: '',
        image_file_id: '',
        slide_order: args.slideOrder,
        status: ctx.status,
        new_slide: true,
        notify: ctx.notify,
        assessment_slide: {
            id: assessmentSlideId,
            assessment_id: args.assessmentId,
            allow_reattempt: true,
            show_result: true,
        },
    };
    return postAssessmentSlide(ctx, payload);
};

export const updateChapterSlideOrder = async (
    chapterId: string,
    slideOrderPayload: { slide_id: string; slide_order: number }[]
): Promise<void> => {
    await authenticatedAxiosInstance.put(
        `${UPDATE_SLIDE_ORDER}?chapterId=${chapterId}`,
        slideOrderPayload
    );
};
