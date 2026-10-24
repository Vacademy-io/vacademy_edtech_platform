import { getActiveRoleDisplaySettingsKey } from '@/lib/auth/instituteUtils';
('use client');

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRouter } from '@tanstack/react-router';
import { MyButton } from '@/components/design-system/button';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { useSlidesMutations } from './-hooks/use-slides';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { useGetPackageSessionIdFromCourseInit } from '@/utils/helpers/study-library-helpers.ts/get-list-from-stores/getPackageSessionIdFromCourseInit';
import { useContentStore } from './-stores/chapter-sidebar-store';
import { UploadFileInS3, getPublicUrl } from '@/services/upload_file';
import * as pdfjs from 'pdfjs-dist';
import { toast } from 'sonner';
import { convertDocToHtml } from './-components/slides-sidebar/utils/doc-to-html';
import { convertPptToPdf } from './-components/slides-sidebar/add-ppt-dialog';
import { useReplaceBase64ImagesWithNetworkUrls } from '@/utils/helpers/study-library-helpers.ts/slides/replaceBase64ToNetworkUrl';
import { convertHtmlToPdf } from './-helper/helper';
import { formatHTMLString } from './-components/slide-operations/formatHtmlString';
import { EMPTY_LEXICAL_INNER } from './-components/lexical-editor/lexical-doc-marker';
import { docHtmlToLexicalIfSafe } from './-components/lexical-editor/convert-yoopta';
import { HTML_DOC_TYPE } from './-components/html-doc/html-doc-utils';
import {
    Plus,
    YoutubeLogo,
    LinkSimple,
    FilePdf,
    FileDoc,
    Code,
    PresentationChart,
    MusicNotes,
    Image as ImageIcon,
    FileHtml,
    PencilSimple,
    Check,
    X,
    CheckCircle,
    XCircle,
    CircleNotch,
    DotsSixVertical,
} from '@phosphor-icons/react';
import { type DisplaySettingsData } from '@/types/display-settings';
import { getDisplaySettings, getDisplaySettingsFromCache } from '@/services/display-settings';
import { getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

type StagedKind =
    | 'PDF'
    | 'DOC'
    | 'PPT'
    | 'VIDEO_FILE'
    | 'YOUTUBE'
    | 'IMAGE'
    | 'AUDIO'
    | 'HTML'
    | 'EXTERNAL_LINK'
    | 'EMBED'
    | 'EMPTY_DOC'
    | 'CODE'
    | 'JUPYTER'
    | 'PRESENTATION';

type StagedItem = {
    id: string;
    kind: StagedKind;
    title: string;
    file?: File | null;
    url?: string | null;
    mime?: string | null;
    status?: 'idle' | 'loading' | 'done' | 'failed';
    error?: string;
};

export interface ChapterSearchParamsForQuickAdd {
    courseId: string;
    levelId: string;
    subjectId: string;
    moduleId: string;
    chapterId: string;
    slideId?: string;
    sessionId: string;
}

export function QuickAddView({ search }: { search: ChapterSearchParamsForQuickAdd }) {
    const { t } = useTranslation('quickAdd');
    const router = useRouter();
    const { getPackageSessionId } = useInstituteDetailsStore();

    // Try to get packageSessionId from course-init API first (new approach)
    const packageSessionIdFromCourseInit = useGetPackageSessionIdFromCourseInit(
        search.courseId || '',
        search.sessionId || '',
        search.levelId || ''
    );
    // Fallback to institute details if course-init doesn't have it
    const packageSessionIdFromInstitute =
        getPackageSessionId({
            courseId: search.courseId || '',
            levelId: search.levelId || '',
            sessionId: search.sessionId || '',
        }) || '';
    // Prefer course-init data, fallback to institute details
    const packageSessionId = packageSessionIdFromCourseInit || packageSessionIdFromInstitute;

    const {
        addUpdateDocumentSlide,
        addUpdateVideoSlide,
        addUpdateExcalidrawSlide,
        addUpdateAudioSlide,
        updateSlideOrder,
    } = useSlidesMutations(
        search.chapterId || '',
        search.moduleId || '',
        search.subjectId || '',
        packageSessionId
    );

    const { items } = useContentStore();

    const [roleDisplay, setRoleDisplay] = useState<DisplaySettingsData | null>(null);
    useEffect(() => {
        const roleKey = getActiveRoleDisplaySettingsKey();
        const cached = getDisplaySettingsFromCache(roleKey);
        if (cached) {
            setRoleDisplay(cached);
        } else {
            getDisplaySettings(roleKey)
                .then(setRoleDisplay)
                .catch(() => setRoleDisplay(null));
        }
    }, []);

    const [staged, setStaged] = useState<StagedItem[]>([]);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingTitle, setEditingTitle] = useState<string>('');
    const [dragIndex, setDragIndex] = useState<number | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const replaceBase64ImagesWithNetworkUrls = useReplaceBase64ImagesWithNetworkUrls();
    const normalizeHtmlQuotes = (html: string) => html.replace(/\\"/g, '"');
    const escapeForSingleQuotedAttr = (val: string) =>
        String(val).replace(/&/g, '&amp;').replace(/'/g, '&#39;');

    const addFilesToStage = (files: FileList | null) => {
        if (!files || files.length === 0) return;
        const next: StagedItem[] = [];
        Array.from(files).forEach((file) => {
            const ext = file.name.split('.').pop()?.toLowerCase();
            const mime = file.type || '';
            if (mime.includes('pdf') || ext === 'pdf') {
                next.push({
                    id: crypto.randomUUID(),
                    kind: 'PDF',
                    title: file.name.replace(/\.[^/.]+$/, ''),
                    file,
                    mime,
                });
            } else if (
                mime.includes('powerpoint') ||
                mime.includes('presentationml') ||
                ext === 'ppt' ||
                ext === 'pptx'
            ) {
                next.push({
                    id: crypto.randomUUID(),
                    kind: 'PPT',
                    title: file.name.replace(/\.[^/.]+$/, ''),
                    file,
                    mime,
                });
            } else if (mime.includes('word') || ext === 'doc' || ext === 'docx') {
                next.push({
                    id: crypto.randomUUID(),
                    kind: 'DOC',
                    title: file.name.replace(/\.[^/.]+$/, ''),
                    file,
                    mime,
                });
            } else if (
                mime.startsWith('video/') ||
                ext === 'mp4' ||
                ext === 'mov' ||
                ext === 'mkv' ||
                ext === 'webm'
            ) {
                next.push({
                    id: crypto.randomUUID(),
                    kind: 'VIDEO_FILE',
                    title: file.name.replace(/\.[^/.]+$/, ''),
                    file,
                    mime,
                });
            } else if (
                mime.startsWith('image/') ||
                ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext || '')
            ) {
                next.push({
                    id: crypto.randomUUID(),
                    kind: 'IMAGE',
                    title: file.name.replace(/\.[^/.]+$/, ''),
                    file,
                    mime,
                });
            } else if (mime.startsWith('audio/') || ['mp3', 'wav', 'ogg'].includes(ext || '')) {
                next.push({
                    id: crypto.randomUUID(),
                    kind: 'AUDIO',
                    title: file.name.replace(/\.[^/.]+$/, ''),
                    file,
                    mime,
                });
            } else if (mime.includes('html') || ext === 'html' || ext === 'htm') {
                next.push({
                    id: crypto.randomUUID(),
                    kind: 'HTML',
                    title: file.name.replace(/\.[^/.]+$/, ''),
                    file,
                    mime,
                });
            } else {
                // Fallback: treat unknown as DOC via HTML wrapper
                next.push({
                    id: crypto.randomUUID(),
                    kind: 'DOC',
                    title: file.name.replace(/\.[^/.]+$/, ''),
                    file,
                    mime,
                });
            }
        });
        setStaged((prev) => [...prev, ...next]);
        toast.success(t('filesStaged', { count: next.length }));
    };

    const removeStaged = (id: string) => setStaged((prev) => prev.filter((s) => s.id !== id));
    // removed unused keyboard reordering handler (drag is primary)

    const addYouTubeToStage = async () => {
        const url = prompt(t('prompts.youtubeUrl'));
        if (!url) return;
        setStaged((prev) => [
            ...prev,
            {
                id: crypto.randomUUID(),
                kind: 'YOUTUBE',
                title: t('defaultTitles.youtubeVideo'),
                url,
                file: null,
                mime: null,
            },
        ]);
    };

    const addExternalLinkToStage = async () => {
        const url = prompt(t('prompts.externalLinkUrl'));
        if (!url) return;
        setStaged((prev) => [
            ...prev,
            {
                id: crypto.randomUUID(),
                kind: 'EXTERNAL_LINK',
                title: t('defaultTitles.link'),
                url,
                file: null,
                mime: null,
            },
        ]);
    };

    const addCodeToStage = () => {
        setStaged((prev) => [
            ...prev,
            {
                id: crypto.randomUUID(),
                kind: 'CODE',
                title: t('defaultTitles.codeEditor'),
                file: null,
                url: null,
                mime: null,
            },
        ]);
    };

    const addJupyterToStage = () => {
        setStaged((prev) => [
            ...prev,
            {
                id: crypto.randomUUID(),
                kind: 'JUPYTER',
                title: t('defaultTitles.jupyterNotebook'),
                file: null,
                url: null,
                mime: null,
            },
        ]);
    };

    const addPresentationToStage = () => {
        setStaged((prev) => [
            ...prev,
            {
                id: crypto.randomUUID(),
                kind: 'PRESENTATION',
                title: t('defaultTitles.presentation'),
                file: null,
                url: null,
                mime: null,
            },
        ]);
    };

    const addEmptyDocToStage = () => {
        setStaged((prev) => [
            ...prev,
            {
                id: crypto.randomUUID(),
                kind: 'EMPTY_DOC',
                title: t('defaultTitles.untitledDocument'),
                file: null,
                url: null,
                mime: null,
            },
        ]);
    };

    const addEmbedUrlToStage = async () => {
        const url = prompt(t('prompts.embedUrl'));
        if (!url) return;
        setStaged((prev) => [
            ...prev,
            {
                id: crypto.randomUUID(),
                kind: 'EMBED',
                title: t('defaultTitles.embeddedUrl'),
                file: null,
                url,
                mime: null,
            },
        ]);
    };

    const bubbles = useMemo(() => {
        const ct = roleDisplay?.contentTypes;
        const allow = (val: string): boolean => {
            if (!ct) return true;
            switch (val) {
                case 'bulk':
                case 'pdf':
                    return ct.pdf !== false;
                case 'doc':
                    return ct.document !== false;
                case 'video':
                case 'youtube':
                    return ct.video?.enabled !== false;
                case 'code':
                    return ct.codeEditor !== false;
                case 'jupyter':
                    return ct.jupyterNotebook !== false;
                case 'presentation':
                    return ct.document !== false;
                default:
                    return true;
            }
        };
        return [
            allow('bulk') && {
                key: 'bulk',
                label: t('bubbles.uploadFiles'),
                icon: <Plus className="size-4" />,
                onClick: () => fileInputRef.current?.click(),
            },
            {
                key: 'empty-doc',
                label: t('bubbles.emptyDoc'),
                icon: <FileDoc className="size-4" />,
                onClick: addEmptyDocToStage,
            },
            allow('youtube') && {
                key: 'youtube',
                label: t('bubbles.youtube'),
                icon: <YoutubeLogo className="size-4" />,
                onClick: addYouTubeToStage,
            },
            {
                key: 'link',
                label: t('bubbles.externalLink'),
                icon: <LinkSimple className="size-4" />,
                onClick: addExternalLinkToStage,
            },
            {
                key: 'embed-url',
                label: t('bubbles.embedUrl'),
                icon: <LinkSimple className="size-4" />,
                onClick: addEmbedUrlToStage,
            },
            allow('pdf') && {
                key: 'pdf',
                label: t('bubbles.pdf'),
                icon: <FilePdf className="size-4" />,
                onClick: () => fileInputRef.current?.click(),
            },
            allow('doc') && {
                key: 'doc',
                label: t('bubbles.doc'),
                icon: <FileDoc className="size-4" />,
                onClick: () => fileInputRef.current?.click(),
            },
            allow('pdf') && {
                key: 'ppt',
                label: t('bubbles.ppt'),
                icon: <PresentationChart className="size-4" />,
                onClick: () => fileInputRef.current?.click(),
            },
            allow('presentation') && {
                key: 'presentation',
                label: t('bubbles.presentation'),
                icon: <PresentationChart className="size-4" />,
                onClick: addPresentationToStage,
            },
            allow('code') && {
                key: 'code',
                label: t('bubbles.code'),
                icon: <Code className="size-4" />,
                onClick: addCodeToStage,
            },
            allow('jupyter') && {
                key: 'jupyter',
                label: t('bubbles.jupyter'),
                icon: <PresentationChart className="size-4" />,
                onClick: addJupyterToStage,
            },
            {
                key: 'image',
                label: t('bubbles.image'),
                icon: <ImageIcon className="size-4" />,
                onClick: () => fileInputRef.current?.click(),
            },
            {
                key: 'audio',
                label: t('bubbles.audio'),
                icon: <MusicNotes className="size-4" />,
                onClick: () => fileInputRef.current?.click(),
            },
            {
                key: 'html',
                label: t('bubbles.html'),
                icon: <FileHtml className="size-4" />,
                onClick: () => fileInputRef.current?.click(),
            },
        ].filter(Boolean) as {
            key: string;
            label: string;
            icon: JSX.Element;
            onClick: () => void;
        }[];
    }, [roleDisplay?.contentTypes, t]);

    const onAddAll = async () => {
        if (staged.length === 0) {
            toast.error(t('noItemsToAdd'));
            return;
        }
        try {
            const accessToken = getTokenFromCookie(TokenKey.accessToken);
            const decoded = getTokenDecodedData(accessToken);
            const INSTITUTE_ID = decoded && Object.keys(decoded.authorities)[0];

            const createdIds: string[] = [];

            for (const item of staged) {
                // mark loading
                setStaged((prev) =>
                    prev.map((it) =>
                        it.id === item.id ? { ...it, status: 'loading', error: undefined } : it
                    )
                );
                // All bulk-add slides are published
                const status = 'PUBLISHED';

                if (item.kind === 'PPT' && item.file) {
                    // Convert PPT to PDF first, then process as PDF
                    const pdfFile = await convertPptToPdf(item.file);
                    const fileId = await UploadFileInS3(
                        pdfFile,
                        () => {},
                        'bulk-user',
                        INSTITUTE_ID,
                        'PDF_DOCUMENTS',
                        true
                    );
                    const ab = await pdfFile.arrayBuffer();
                    const pdf = await pdfjs.getDocument({ data: ab }).promise;
                    const totalPages = pdf.numPages;
                    const id = crypto.randomUUID();
                    const resp: string = await addUpdateDocumentSlide({
                        id,
                        title: item.title,
                        image_file_id: '',
                        description: null,
                        slide_order: 0,
                        document_slide: {
                            id: crypto.randomUUID(),
                            type: 'PDF',
                            data: fileId || '',
                            title: item.title,
                            cover_file_id: '',
                            total_pages: totalPages,
                            published_data: fileId || '',
                            published_document_total_pages: totalPages,
                        },
                        status,
                        new_slide: true,
                        notify: false,
                    });
                    createdIds.push(resp || id);
                    setStaged((prev) =>
                        prev.map((it) => (it.id === item.id ? { ...it, status: 'done' } : it))
                    );
                } else if (item.kind === 'PDF' && item.file) {
                    const fileId = await UploadFileInS3(
                        item.file,
                        () => {},
                        'bulk-user',
                        INSTITUTE_ID,
                        'PDF_DOCUMENTS',
                        true
                    );
                    const ab = await item.file.arrayBuffer();
                    const pdf = await pdfjs.getDocument({ data: ab }).promise;
                    const totalPages = pdf.numPages;
                    const id = crypto.randomUUID();
                    const resp: string = await addUpdateDocumentSlide({
                        id,
                        title: item.title,
                        image_file_id: '',
                        description: null,
                        slide_order: 0,
                        document_slide: {
                            id: crypto.randomUUID(),
                            type: 'PDF',
                            data: fileId || '',
                            title: item.title,
                            cover_file_id: '',
                            total_pages: totalPages,
                            published_data: fileId || '',
                            published_document_total_pages: totalPages,
                        },
                        status,
                        new_slide: true,
                        notify: false,
                    });
                    createdIds.push(resp || id);
                    setStaged((prev) =>
                        prev.map((it) => (it.id === item.id ? { ...it, status: 'done' } : it))
                    );
                } else if (item.kind === 'DOC' && item.file) {
                    const html = await convertDocToHtml(item.file);
                    const processedHtml = await replaceBase64ImagesWithNetworkUrls(html);
                    const normalized = normalizeHtmlQuotes(processedHtml);
                    const { totalPages } = await convertHtmlToPdf(processedHtml);
                    // Open uploads in the new (Lexical) editor when lossless;
                    // else keep the legacy editor (no silent content loss).
                    const finalHtml = docHtmlToLexicalIfSafe(normalized) ?? normalized;
                    const id = crypto.randomUUID();
                    const resp: string = await addUpdateDocumentSlide({
                        id,
                        title: item.title,
                        image_file_id: '',
                        description: null,
                        slide_order: 0,
                        document_slide: {
                            id: crypto.randomUUID(),
                            type: 'DOC',
                            data: finalHtml,
                            title: item.title,
                            cover_file_id: '',
                            total_pages: totalPages,
                            published_data: finalHtml,
                            published_document_total_pages: totalPages,
                        },
                        status,
                        new_slide: true,
                        notify: false,
                    });
                    createdIds.push(resp || id);
                    setStaged((prev) =>
                        prev.map((it) => (it.id === item.id ? { ...it, status: 'done' } : it))
                    );
                } else if (item.kind === 'VIDEO_FILE' && item.file) {
                    const fileId = await UploadFileInS3(
                        item.file,
                        () => {},
                        'bulk-user',
                        INSTITUTE_ID,
                        'ADMIN',
                        true
                    );
                    const id = crypto.randomUUID();
                    const resp: string = await addUpdateVideoSlide({
                        id,
                        title: item.title,
                        description: null,
                        image_file_id: null,
                        slide_order: 0,
                        video_slide: {
                            id: crypto.randomUUID(),
                            description: '',
                            url: String(fileId || ''),
                            title: item.title,
                            video_length_in_millis: 0,
                            published_url: String(fileId || ''),
                            published_video_length_in_millis: 0,
                            source_type: 'FILE_ID',
                        },
                        status,
                        new_slide: true,
                        notify: false,
                    });
                    createdIds.push(resp || id);
                    setStaged((prev) =>
                        prev.map((it) => (it.id === item.id ? { ...it, status: 'done' } : it))
                    );
                } else if (item.kind === 'YOUTUBE' && item.url) {
                    const id = crypto.randomUUID();
                    const resp: string = await addUpdateVideoSlide({
                        id,
                        title: item.title,
                        description: null,
                        image_file_id: null,
                        slide_order: 0,
                        video_slide: {
                            id: crypto.randomUUID(),
                            description: '',
                            url: String(item.url || ''),
                            title: item.title,
                            video_length_in_millis: 0,
                            published_url: String(item.url || ''),
                            published_video_length_in_millis: 0,
                            source_type: 'VIDEO',
                        },
                        status,
                        new_slide: true,
                        notify: false,
                    });
                    createdIds.push(resp || id);
                    setStaged((prev) =>
                        prev.map((it) => (it.id === item.id ? { ...it, status: 'done' } : it))
                    );
                } else if (item.kind === 'IMAGE' && item.file) {
                    const fileId = await UploadFileInS3(
                        item.file,
                        () => {},
                        'bulk-user',
                        INSTITUTE_ID,
                        'IMAGES',
                        true
                    );
                    const url = await getPublicUrl(fileId as string);
                    const html = `<!DOCTYPE html><html><head></head><body><div><div style='margin-left: 0px; display: flex; width: 100%; justify-content: center;'><img data-meta-align='center' data-meta-depth='0' src='${url}' alt='${escapeForSingleQuotedAttr(
                        item.title
                    )}' width='0' height='0' objectFit='contain'/></div></div></body></html>`;
                    const normalized = normalizeHtmlQuotes(html);
                    const id = crypto.randomUUID();
                    const resp: string = await addUpdateDocumentSlide({
                        id,
                        title: item.title,
                        image_file_id: '',
                        description: 'Image',
                        slide_order: 0,
                        document_slide: {
                            id: crypto.randomUUID(),
                            type: 'DOC',
                            data: normalized,
                            title: item.title,
                            cover_file_id: '',
                            total_pages: 1,
                            published_data: normalized,
                            published_document_total_pages: 1,
                        },
                        status,
                        new_slide: true,
                        notify: false,
                    });
                    createdIds.push(resp || id);
                    setStaged((prev) =>
                        prev.map((it) => (it.id === item.id ? { ...it, status: 'done' } : it))
                    );
                } else if (item.kind === 'AUDIO' && item.file) {
                    // Upload audio file
                    const fileId = await UploadFileInS3(
                        item.file,
                        () => {},
                        'bulk-user',
                        INSTITUTE_ID,
                        'AUDIO',
                        true
                    );

                    // Get audio duration
                    let audioDuration = 0;
                    try {
                        const audio = new Audio();
                        audio.src = URL.createObjectURL(item.file);
                        await new Promise<void>((resolve) => {
                            audio.onloadedmetadata = () => {
                                audioDuration = Math.floor(audio.duration * 1000);
                                URL.revokeObjectURL(audio.src);
                                resolve();
                            };
                            audio.onerror = () => resolve();
                        });
                    } catch {
                        // Fallback to 0 duration if we can't get it
                    }

                    const id = crypto.randomUUID();
                    const resp = await addUpdateAudioSlide({
                        id,
                        title: item.title,
                        description: null,
                        image_file_id: null,
                        status: status as 'DRAFT' | 'PUBLISHED',
                        slide_order: 0,
                        notify: false,
                        new_slide: true,
                        audio_slide: {
                            id: crypto.randomUUID(),
                            audio_file_id: fileId ?? '',
                            thumbnail_file_id: null,
                            audio_length_in_millis: audioDuration,
                            source_type: 'FILE',
                            external_url: null,
                            transcript: null,
                        },
                    });
                    createdIds.push(resp || id);
                    setStaged((prev) =>
                        prev.map((it) => (it.id === item.id ? { ...it, status: 'done' } : it))
                    );
                } else if (item.kind === 'HTML' && item.file) {
                    const html = await item.file.text();
                    const wrapped = /<html[\s>]/i.test(html)
                        ? html
                        : `<html><head></head><body><div>${html}</div></body></html>`;
                    const normalized = normalizeHtmlQuotes(wrapped);
                    const id = crypto.randomUUID();
                    const resp: string = await addUpdateDocumentSlide({
                        id,
                        title: item.title,
                        image_file_id: '',
                        description: 'HTML Document',
                        slide_order: 0,
                        document_slide: {
                            id: crypto.randomUUID(),
                            // 'HTML', not 'DOC': a self-contained HTML file keeps its
                            // own <style>/<script>, so it must land on the creative
                            // HTML path (sandboxed iframe in both admin and learner).
                            // 'DOC' routes it into the rich-text editors, which parse
                            // the markup into blocks — scripts never run and inline
                            // <br/> is dropped, so interactive docs render as dead text.
                            type: HTML_DOC_TYPE,
                            data: normalized,
                            title: item.title,
                            cover_file_id: '',
                            total_pages: 1,
                            published_data: normalized,
                            published_document_total_pages: 1,
                        },
                        status,
                        new_slide: true,
                        notify: false,
                    });
                    createdIds.push(resp || id);
                    setStaged((prev) =>
                        prev.map((it) => (it.id === item.id ? { ...it, status: 'done' } : it))
                    );
                } else if (item.kind === 'EXTERNAL_LINK' && item.url) {
                    const html = `<html><head></head><body><p><a href='${item.url}' target='_blank' rel='noreferrer noopener'>${item.url}</a></p></body></html>`;
                    const normalized = normalizeHtmlQuotes(html);
                    const id = crypto.randomUUID();
                    const resp: string = await addUpdateDocumentSlide({
                        id,
                        title: item.title || t('defaultTitles.link'),
                        image_file_id: '',
                        description: 'External link',
                        slide_order: 0,
                        document_slide: {
                            id: crypto.randomUUID(),
                            type: 'DOC',
                            data: normalized,
                            title: item.title || t('defaultTitles.link'),
                            cover_file_id: '',
                            total_pages: 1,
                            published_data: normalized,
                            published_document_total_pages: 1,
                        },
                        status,
                        new_slide: true,
                        notify: false,
                    });
                    createdIds.push(resp || id);
                } else if (item.kind === 'EMBED' && item.url) {
                    const html = `<html><head></head><body><div><div style='margin-left: 0px; display: flex; width: 100%; justify-content: center'><iframe data-meta-align='center' data-meta-depth='0' src='${item.url}' width='798' height='614'></iframe></div></div></body></html>`;
                    const normalized = normalizeHtmlQuotes(html);
                    const id = crypto.randomUUID();
                    const resp: string = await addUpdateDocumentSlide({
                        id,
                        title: item.title || t('defaultTitles.embeddedUrl'),
                        image_file_id: '',
                        description: 'Embedded URL',
                        slide_order: 0,
                        document_slide: {
                            id: crypto.randomUUID(),
                            type: 'DOC',
                            data: normalized,
                            title: item.title || t('defaultTitles.embeddedUrl'),
                            cover_file_id: '',
                            total_pages: 1,
                            published_data: normalized,
                            published_document_total_pages: 1,
                        },
                        status,
                        new_slide: true,
                        notify: false,
                    });
                    createdIds.push(resp || id);
                } else if (item.kind === 'EMPTY_DOC') {
                    // Blank docs are created for the Lexical editor (marker-routed);
                    // uploaded/converted docs below stay marker-less → legacy editor.
                    const yooptaHtml = formatHTMLString(EMPTY_LEXICAL_INNER);
                    const normalized = normalizeHtmlQuotes(yooptaHtml);
                    const { totalPages } = await convertHtmlToPdf(normalized);
                    const id = crypto.randomUUID();
                    const resp: string = await addUpdateDocumentSlide({
                        id,
                        title: item.title || t('defaultTitles.untitledDocument'),
                        image_file_id: '',
                        description: null,
                        slide_order: 0,
                        document_slide: {
                            id: crypto.randomUUID(),
                            type: 'DOC',
                            data: normalized,
                            title: item.title || t('defaultTitles.untitledDocument'),
                            cover_file_id: '',
                            total_pages: totalPages || 1,
                            published_data: normalized,
                            published_document_total_pages: totalPages || 1,
                        },
                        status,
                        new_slide: true,
                        notify: false,
                    });
                    createdIds.push(resp || id);
                    setStaged((prev) =>
                        prev.map((it) => (it.id === item.id ? { ...it, status: 'done' } : it))
                    );
                } else if (item.kind === 'CODE') {
                    const codeData = JSON.stringify({
                        language: 'python',
                        theme: 'dark',
                        code: '# Welcome to Python Code Editor\nprint("Hello, World!")',
                        readOnly: false,
                        showLineNumbers: true,
                        fontSize: 14,
                        editorType: 'codeEditor',
                        timestamp: Date.now(),
                    });
                    const id = crypto.randomUUID();
                    const resp: string = await addUpdateDocumentSlide({
                        id,
                        title: item.title,
                        image_file_id: '',
                        description: 'Interactive code editing environment',
                        slide_order: 0,
                        document_slide: {
                            id: crypto.randomUUID(),
                            type: 'CODE',
                            data: codeData,
                            title: item.title,
                            cover_file_id: '',
                            total_pages: 1,
                            published_data: codeData,
                            published_document_total_pages: 1,
                        },
                        status,
                        new_slide: true,
                        notify: false,
                    });
                    createdIds.push(resp || id);
                    setStaged((prev) =>
                        prev.map((it) => (it.id === item.id ? { ...it, status: 'done' } : it))
                    );
                } else if (item.kind === 'JUPYTER') {
                    const jupyterData = JSON.stringify({
                        projectName: '',
                        contentUrl: '',
                        contentBranch: 'main',
                        notebookLocation: 'root',
                        activeTab: 'settings',
                        editorType: 'jupyterEditor',
                        timestamp: Date.now(),
                    });
                    const id = crypto.randomUUID();
                    const resp: string = await addUpdateDocumentSlide({
                        id,
                        title: item.title,
                        image_file_id: '',
                        description: 'Interactive Jupyter notebook environment',
                        slide_order: 0,
                        document_slide: {
                            id: crypto.randomUUID(),
                            type: 'JUPYTER',
                            data: jupyterData,
                            title: item.title,
                            cover_file_id: '',
                            total_pages: 1,
                            published_data: jupyterData,
                            published_document_total_pages: 1,
                        },
                        status,
                        new_slide: true,
                        notify: false,
                    });
                    createdIds.push(resp || id);
                    setStaged((prev) =>
                        prev.map((it) => (it.id === item.id ? { ...it, status: 'done' } : it))
                    );
                } else if (item.kind === 'PRESENTATION') {
                    const id = crypto.randomUUID();
                    const resp = await addUpdateExcalidrawSlide({
                        id,
                        title: item.title,
                        image_file_id: '',
                        description: 'Presentation',
                        slide_order: 0,
                        excalidraw_slide: { elements: [], files: {}, appState: {} },
                        status,
                        new_slide: true,
                        notify: false,
                    });
                    const returnedId = (resp as unknown as { data?: string })?.data ?? id;
                    createdIds.push(returnedId);
                    setStaged((prev) =>
                        prev.map((it) => (it.id === item.id ? { ...it, status: 'done' } : it))
                    );
                }
            }

            // Reorder: existing slides first, new slides appended at the bottom (preserving staged order)
            const currentSlides = items || [];
            const existing = currentSlides
                .filter((s) => !createdIds.includes(s.id))
                .slice()
                .sort((a, b) => (a.slide_order ?? 0) - (b.slide_order ?? 0));
            const reordered = [
                ...existing.map((s, idx) => ({ slide_id: s.id, slide_order: idx })),
                ...createdIds.map((sid, i) => ({
                    slide_id: sid,
                    slide_order: existing.length + i,
                })),
            ];

            await updateSlideOrder({
                chapterId: search.chapterId || '',
                slideOrderPayload: reordered,
            });

            toast.success(t('addedSlides', { count: createdIds.length }));

            // Navigate back to slides main view (remove quickAdd param) and replace history
            router.navigate({
                to: '/study-library/courses/course-details/subjects/modules/chapters/slides',
                search: {
                    courseId: search.courseId,
                    levelId: search.levelId,
                    subjectId: search.subjectId,
                    moduleId: search.moduleId,
                    chapterId: search.chapterId,
                    slideId: search.slideId || '',
                    sessionId: search.sessionId,
                    quickAdd: false,
                },
                replace: true,
            });
        } catch (err) {
            console.error(err);
            toast.error(t('addFailed'));
            // mark current item as failed if we can’t granularly identify which
            setStaged((prev) =>
                prev.map((it) =>
                    it.status === 'loading'
                        ? { ...it, status: 'failed', error: (err as Error)?.message }
                        : it
                )
            );
        }
    };

    return (
        <div className="flex size-full flex-col gap-4 p-4">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">{t('heading')}</h2>
                <div className="flex items-center gap-2">
                    <button
                        aria-label={t('close')}
                        className="rounded p-1 text-neutral-500 hover:bg-neutral-100"
                        onClick={() => {
                            router.navigate({
                                to: '/study-library/courses/course-details/subjects/modules/chapters/slides',
                                search: {
                                    courseId: search.courseId,
                                    levelId: search.levelId,
                                    subjectId: search.subjectId,
                                    moduleId: search.moduleId,
                                    chapterId: search.chapterId,
                                    slideId: search.slideId || '',
                                    sessionId: search.sessionId,
                                    quickAdd: false,
                                },
                                replace: true,
                            });
                        }}
                    >
                        <X className="size-5" />
                    </button>
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        onClick={onAddAll}
                        disabled={staged.length === 0}
                    >
                        {t('publishAll', { term: getTerminologyPlural(ContentTerms.Slide, SystemTerms.Slide) })}
                    </MyButton>
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-white p-2">
                {bubbles.map((b) => (
                    <button
                        key={b.key}
                        onClick={b.onClick}
                        className="flex items-center gap-1 rounded-full border px-3 py-1 text-sm hover:bg-neutral-50"
                    >
                        {b.icon}
                        <span>{b.label}</span>
                    </button>
                ))}
                <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    multiple
                    onChange={(e) => addFilesToStage(e.target.files)}
                    accept={[
                        'application/pdf',
                        'application/msword',
                        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                        'application/vnd.ms-powerpoint',
                        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                        '.ppt,.pptx',
                        'video/*',
                        'image/*',
                        'audio/*',
                        '.html,.htm',
                    ].join(',')}
                />
            </div>

            <div className="rounded-lg border bg-white">
                <div className="border-b p-3 text-sm text-neutral-600">
                    {t('stagedItems', { count: staged.length })}
                </div>
                {staged.length === 0 ? (
                    <div className="p-6 text-sm text-neutral-500">
                        {t('emptyState')}
                    </div>
                ) : (
                    <ul className="divide-y">
                        {staged.map((s, idx) => (
                            <li
                                key={s.id}
                                className="flex items-center justify-between p-3"
                                draggable
                                onDragStart={() => setDragIndex(idx)}
                                onDragOver={(e) => e.preventDefault()}
                                onDrop={() => {
                                    if (dragIndex === null || dragIndex === idx) return;
                                    setStaged((prev) => {
                                        const copy = [...prev];
                                        const dragged = copy[dragIndex] as StagedItem;
                                        copy.splice(dragIndex, 1);
                                        copy.splice(idx, 0, dragged);
                                        return copy;
                                    });
                                    setDragIndex(null);
                                }}
                            >
                                <div className="flex min-w-0 items-center gap-2">
                                    <DotsSixVertical className="size-4 cursor-grab text-neutral-400" />
                                    {renderKindIcon(s.kind)}
                                    <div className="truncate">
                                        {editingId === s.id ? (
                                            <div className="flex items-center gap-2">
                                                <input
                                                    autoFocus
                                                    value={editingTitle}
                                                    onChange={(e) =>
                                                        setEditingTitle(e.target.value)
                                                    }
                                                    className="w-56 rounded border px-2 py-1 text-sm"
                                                />
                                                <button
                                                    className="rounded p-1 text-green-600 hover:bg-green-50"
                                                    onClick={() => {
                                                        setStaged((prev) =>
                                                            prev.map((it) =>
                                                                it.id === s.id
                                                                    ? {
                                                                          ...it,
                                                                          title:
                                                                              editingTitle ||
                                                                              it.title,
                                                                      }
                                                                    : it
                                                            )
                                                        );
                                                        setEditingId(null);
                                                        setEditingTitle('');
                                                    }}
                                                >
                                                    <Check className="size-4" />
                                                </button>
                                                <button
                                                    className="rounded p-1 text-neutral-500 hover:bg-neutral-100"
                                                    onClick={() => {
                                                        setEditingId(null);
                                                        setEditingTitle('');
                                                    }}
                                                >
                                                    <X className="size-4" />
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="flex items-center gap-2">
                                                <div className="truncate text-sm font-medium">
                                                    {s.title}
                                                </div>
                                                <button
                                                    className="rounded p-1 text-neutral-500 hover:bg-neutral-100"
                                                    onClick={() => {
                                                        setEditingId(s.id);
                                                        setEditingTitle(s.title);
                                                    }}
                                                    aria-label={t('editTitle')}
                                                >
                                                    <PencilSimple className="size-4" />
                                                </button>
                                            </div>
                                        )}
                                        <div className="flex items-center gap-2 text-xs text-neutral-500">
                                            <span>
                                                {s.kind}
                                                {s.url ? ` • ${s.url}` : ''}
                                            </span>
                                            {s.status === 'loading' && (
                                                <span className="flex items-center gap-1 text-primary-600">
                                                    <CircleNotch className="size-3 animate-spin" />
                                                    {t('adding')}
                                                </span>
                                            )}
                                            {s.status === 'done' && (
                                                <span className="flex items-center gap-1 text-green-600">
                                                    <CheckCircle className="size-3" />
                                                    {t('done')}
                                                </span>
                                            )}
                                            {s.status === 'failed' && (
                                                <span className="flex items-center gap-1 text-red-600">
                                                    <XCircle className="size-3" />
                                                    {s.error ? t('failedWithReason', { reason: s.error }) : t('failed')}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        className="rounded border px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                                        onClick={() => removeStaged(s.id)}
                                    >
                                        {t('remove')}
                                    </button>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}

function renderKindIcon(kind: StagedKind) {
    const cls = 'size-4 text-neutral-500';
    switch (kind) {
        case 'PDF':
            return <FilePdf className={cls} />;
        case 'DOC':
            return <FileDoc className={cls} />;
        case 'VIDEO_FILE':
            return <PresentationChart className={cls} />;
        case 'YOUTUBE':
            return <YoutubeLogo className={cls} />;
        case 'IMAGE':
            return <ImageIcon className={cls} />;
        case 'AUDIO':
            return <MusicNotes className={cls} />;
        case 'HTML':
            return <FileHtml className={cls} />;
        case 'EXTERNAL_LINK':
            return <LinkSimple className={cls} />;
        case 'CODE':
            return <Code className={cls} />;
        case 'PRESENTATION':
            return <PresentationChart className={cls} />;
        case 'JUPYTER':
            return <PresentationChart className={cls} />;
        case 'PPT':
            return <PresentationChart className={cls} />;
        default:
            return null;
    }
}
