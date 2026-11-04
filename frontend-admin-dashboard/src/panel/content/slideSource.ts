/**
 * Decides how the panel plays a slide. Pure functions, no React.
 *
 * Selection rule (copied, not imported, from slide-material.tsx:2438-2548 and
 * video-slide-preview.tsx:40-44 / 462-490): play the PUBLISHED payload
 * (document_slide.published_data, video_slide.published_url) like the learner
 * view does. The panel is a teacher device, so a never-published draft falls
 * back to its draft payload (data / url) instead of showing nothing — the same
 * fallback the admin view uses for UNSYNC slides.
 *
 * Phase 0 plays: PPT_ANIM (deck-player), PDF, Excalidraw PRESENTATION, FILE_ID
 * video (file-video-player), YouTube / Vimeo embeds and AI video (HTML_VIDEO)
 * when an MP4 render exists. Everything else is an "open on a computer" card.
 */
import { resolveVideoSourceType, extractVimeoId } from '@/utils/video-source-type';
import type { Slide } from './lessonApi';

export type SlideTypeKey =
    | 'video'
    | 'youtube'
    | 'vimeo'
    | 'aiVideo'
    | 'pdf'
    | 'deck'
    | 'presentation'
    | 'doc'
    | 'html'
    | 'code'
    | 'jupyter'
    | 'scratch'
    | 'quiz'
    | 'question'
    | 'assignment'
    | 'audio'
    | 'scorm'
    | 'assessment'
    | 'other';

export type PlayableSource =
    | { kind: 'deck'; type: SlideTypeKey; baseUrl: string }
    | { kind: 'pdf'; type: SlideTypeKey; fileId: string }
    | { kind: 'scene'; type: SlideTypeKey; fileId: string }
    | { kind: 'file-video'; type: SlideTypeKey; fileId: string }
    | { kind: 'youtube'; type: SlideTypeKey; videoId: string }
    | { kind: 'vimeo'; type: SlideTypeKey; videoId: string }
    | { kind: 'ai-video'; type: SlideTypeKey; videoId: string }
    | { kind: 'missing'; type: SlideTypeKey }
    | { kind: 'unsupported'; type: SlideTypeKey };

/** youtube.com/watch?v=, youtu.be/, /embed/, /shorts/, /live/, /v/ and youtube-nocookie. */
const YOUTUBE_URL =
    /(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;
const YOUTUBE_BARE_ID = /^[A-Za-z0-9_-]{11}$/;

export function extractYouTubeId(url: string): string {
    const trimmed = url.trim();
    const match = YOUTUBE_URL.exec(trimmed);
    if (match && match[1]) return match[1];
    return YOUTUBE_BARE_ID.test(trimmed) ? trimmed : '';
}

function firstText(...values: Array<string | null | undefined>): string {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
}

/** A usable AI video id ("pending" is what an unfinished generation stores). */
function aiVideoIdOf(slide: Slide): string {
    const id = firstText(slide.html_video_slide?.ai_gen_video_id, slide.html_video_slide?.url);
    return id && id.toLowerCase() !== 'pending' ? id : '';
}

const DOCUMENT_TYPES: Record<string, SlideTypeKey> = {
    PDF: 'pdf',
    PPT_ANIM: 'deck',
    PRESENTATION: 'presentation',
    DOC: 'doc',
    HTML: 'html',
    CODE: 'code',
    JUPYTER: 'jupyter',
    SCRATCH: 'scratch',
};

const SOURCE_TYPES: Record<string, SlideTypeKey> = {
    QUIZ: 'quiz',
    QUESTION: 'question',
    ASSIGNMENT: 'assignment',
    AUDIO: 'audio',
    SCORM: 'scorm',
    ASSESSMENT: 'assessment',
};

/** The type used for the list icon / label (no network). */
export function slideTypeKey(slide: Slide): SlideTypeKey {
    return resolveSlideSource(slide).type;
}

export function resolveSlideSource(slide: Slide): PlayableSource {
    const sourceType = (slide.source_type || '').toUpperCase();
    const videoSourceType = (slide.video_slide?.source_type || '').toUpperCase();

    if (sourceType === 'HTML_VIDEO' || videoSourceType === 'HTML_VIDEO') {
        const videoId = aiVideoIdOf(slide);
        return videoId
            ? { kind: 'ai-video', type: 'aiVideo', videoId }
            : { kind: 'missing', type: 'aiVideo' };
    }

    if (sourceType === 'VIDEO') {
        const video = slide.video_slide;
        const value = firstText(video?.published_url, video?.url);
        const resolved = resolveVideoSourceType(video);
        if (resolved === 'FILE_ID') {
            return value
                ? { kind: 'file-video', type: 'video', fileId: value }
                : { kind: 'missing', type: 'video' };
        }
        if (resolved === 'VIMEO') {
            const videoId = extractVimeoId(value);
            return videoId
                ? { kind: 'vimeo', type: 'vimeo', videoId }
                : { kind: 'missing', type: 'vimeo' };
        }
        const embedded = firstText(video?.embedded_data);
        const videoId = extractYouTubeId(value) || extractYouTubeId(embedded);
        if (videoId) return { kind: 'youtube', type: 'youtube', videoId };
        // A direct .mp4 link stored as a "YouTube" video still plays as a file.
        if (/^https?:\/\/\S+\.(mp4|webm)(\?|#|$)/i.test(value)) {
            return { kind: 'file-video', type: 'video', fileId: value };
        }
        return value ? { kind: 'unsupported', type: 'video' } : { kind: 'missing', type: 'video' };
    }

    if (sourceType === 'DOCUMENT') {
        const doc = slide.document_slide;
        const docType = (doc?.type || '').toUpperCase();
        const type = DOCUMENT_TYPES[docType] ?? 'other';
        const payload = firstText(doc?.published_data, doc?.data);
        if (type === 'pdf') {
            return payload ? { kind: 'pdf', type, fileId: payload } : { kind: 'missing', type };
        }
        if (type === 'deck') {
            return payload ? { kind: 'deck', type, baseUrl: payload } : { kind: 'missing', type };
        }
        if (type === 'presentation') {
            return payload ? { kind: 'scene', type, fileId: payload } : { kind: 'missing', type };
        }
        return { kind: 'unsupported', type };
    }

    return { kind: 'unsupported', type: SOURCE_TYPES[sourceType] ?? 'other' };
}

/** Slides a teacher has not published yet (DRAFT, or published-then-edited UNSYNC is fine). */
export function isDraftSlide(slide: Slide): boolean {
    return (slide.status || '').toUpperCase() === 'DRAFT';
}
