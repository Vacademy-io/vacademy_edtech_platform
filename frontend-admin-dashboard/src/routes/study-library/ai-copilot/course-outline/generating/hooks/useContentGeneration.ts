import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { getInstituteId } from '@/constants/helper';
import type { SlideGeneration, SlideType } from '../../../shared/types';
import { markdownToHtml } from '../../../shared/utils/markdownToHtml';
import { generateContent } from '../services/contentGenerationService';
import { convertAssessmentToJSON } from '../utils/assessmentToHtml';

/**
 * Custom hook for handling content generation from outline
 * Extracts the massive handleConfirmGenerateCourseAssets logic
 */
export const useContentGeneration = (
    outlineTodos: any[],
    slides: SlideGeneration[],
    setSlides: React.Dispatch<React.SetStateAction<SlideGeneration[]>>,
    setIsGeneratingContent: React.Dispatch<React.SetStateAction<boolean>>,
    setIsContentGenerated: React.Dispatch<React.SetStateAction<boolean>>,
    setContentGenerationProgress: React.Dispatch<React.SetStateAction<string>>,
    setAbortController: React.Dispatch<React.SetStateAction<AbortController | null>>
) => {
    const navigate = useNavigate();
    const { t } = useTranslation('studyLibraryGenerating');

    const handleConfirmGenerateCourseAssets = async () => {
        // Check if we have todos to generate content for
        if (!outlineTodos || outlineTodos.length === 0) {
            toast.error(t('contentGeneration.toast.noTodosFound'));
            return;
        }

        const instituteId = getInstituteId();
        if (!instituteId) {
            toast.error(t('toast.instituteIdMissing'));
            return;
        }

        // Read language that was stored during outline generation
        const language = sessionStorage.getItem('courseLanguage') || 'English';

        // Read course-level AI-video settings (model/voice/duration/tier)
        // stored during outline generation; applied server-side to every
        // AI Video / AI Slides / AI Storybook todo.
        let videoSettings: Record<string, string> | undefined;
        try {
            const storedVideoSettings = sessionStorage.getItem('courseVideoSettings');
            if (storedVideoSettings) {
                const parsed = JSON.parse(storedVideoSettings);
                videoSettings = {
                    voice_gender: parsed.voiceGender || 'female',
                    tts_provider: parsed.ttsProvider || 'standard',
                    quality_tier: parsed.qualityTier || 'ultra',
                    target_duration: parsed.targetDuration || '2-3 minutes',
                };
                if (parsed.language) videoSettings.language = parsed.language;
                if (parsed.model && parsed.model !== 'auto') videoSettings.model = parsed.model;
                if (parsed.voiceId) videoSettings.voice_id = parsed.voiceId;
            }
        } catch (e) {
            console.warn('Failed to parse courseVideoSettings, using defaults:', e);
        }

        // Reference-PDF fileIds (for figure embedding in DOCUMENT slides),
        // persisted during outline generation.
        let referenceDocumentFileIds: string[] | undefined;
        try {
            const stored = sessionStorage.getItem('courseReferenceDocIds');
            if (stored) {
                const parsed = JSON.parse(stored);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    referenceDocumentFileIds = parsed;
                }
            }
        } catch (e) {
            console.warn('Failed to parse courseReferenceDocIds:', e);
        }

        // Knowledge base this course is grounded in, persisted at outline time.
        // Without it the content pass falls back to model knowledge and the
        // slides quietly stop matching the institute's material.
        // fidelity/coverage ride along too (how closely the course must mirror
        // the source, and whether every section must be covered).
        let kbGrounding:
            | {
                  knowledge_base_id: string;
                  node_ids: string[];
                  mode: string;
                  fidelity?: string;
                  coverage?: string;
              }
            | undefined;
        try {
            const stored = sessionStorage.getItem('courseKbGrounding');
            if (stored) {
                const parsed = JSON.parse(stored);
                if (parsed?.knowledge_base_id) kbGrounding = parsed;
            }
        } catch (e) {
            console.warn('Failed to parse courseKbGrounding:', e);
        }

        // Course-wide document content-type enrichments (notes/flashcards/quiz/…)
        // chosen in the wizard, persisted at outline time. Applied to every
        // generated DOCUMENT (HTML) slide.
        let documentContentTypes: string[] | undefined;
        try {
            const stored = sessionStorage.getItem('courseDocumentContentTypes');
            if (stored) {
                const parsed = JSON.parse(stored);
                if (Array.isArray(parsed) && parsed.length > 0) documentContentTypes = parsed;
            }
        } catch (e) {
            console.warn('Failed to parse courseDocumentContentTypes:', e);
        }

        // The model chosen in course creation — applied to DOCUMENT slides too
        // (persisted at outline time; 'auto' is stored as absent → server default).
        let documentModel: string | undefined;
        try {
            const m = sessionStorage.getItem('courseSelectedModel');
            if (m) documentModel = m;
        } catch (e) {
            console.warn('Failed to read courseSelectedModel:', e);
        }

        // Source-figure policy chosen in the wizard (REQUIRE/PREFER/GENERATED_ONLY).
        let figuresPolicy: string | undefined;
        try {
            const fp = sessionStorage.getItem('courseFiguresPolicy');
            if (fp) figuresPolicy = fp;
        } catch (e) {
            console.warn('Failed to read courseFiguresPolicy:', e);
        }

        // Repetition-dedupe second pass (server-side, opt-in from the wizard).
        let dedupeRepetition = false;
        try {
            dedupeRepetition = sessionStorage.getItem('courseDedupeRepetition') === '1';
        } catch (e) {
            console.warn('Failed to read courseDedupeRepetition:', e);
        }

        setIsGeneratingContent(true);
        setContentGenerationProgress(t('contentGeneration.startingContentGeneration'));

        // Create abort controller for this request
        const controller = new AbortController();
        setAbortController(controller);

        try {
            // Filter todos to only include supported content types
            const contentTodos = outlineTodos.filter(
                (todo: any) =>
                    todo.type === 'DOCUMENT' ||
                    todo.type === 'ASSESSMENT' ||
                    todo.type === 'VIDEO' ||
                    todo.type === 'AI_VIDEO' ||
                    todo.type === 'AI_SLIDES' ||
                    todo.type === 'AI_STORYBOOK' ||
                    todo.type === 'VIDEO_CODE' ||
                    todo.type === 'AI_VIDEO_CODE'
            );

            if (contentTodos.length === 0) {
                toast.error(t('contentGeneration.toast.noContentTodosFound'));
                setIsGeneratingContent(false);
                return;
            }

            console.log('Generating content for todos:', contentTodos.length);
            console.log('Current slides:', slides.length);
            console.log(
                'Content todos:',
                contentTodos.map((t: any) => ({
                    path: t.path,
                    type: t.type,
                    title: t.title,
                    name: t.name,
                    chapter_name: t.chapter_name,
                }))
            );

            // Check payload size to prevent 500 errors
            const payload = {
                course_tree: { todos: contentTodos },
                institute_id: instituteId,
            };
            const payloadSize = JSON.stringify(payload).length;
            console.log('Payload size:', payloadSize, 'bytes');

            if (payloadSize > 1024 * 1024) {
                // 1MB
                console.warn('⚠️ Large payload detected:', payloadSize, 'bytes');
                if (!confirm(t('contentGeneration.toast.largePayloadConfirm'))) {
                    setIsGeneratingContent(false);
                    return;
                }
            }

            // Create a map of todos by their path for quick lookup
            const todoPathMap = new Map<string, any>();
            contentTodos.forEach((todo: any) => {
                todoPathMap.set(todo.path, todo);
            });

            // Create a map of path -> slide by matching todos to slides using multiple strategies
            const pathToSlideMap = new Map<string, SlideGeneration>();

            // First, try exact matches
            slides.forEach((slide) => {
                const matchingTodo = contentTodos.find((todo: any) => {
                    const sessionExact = slide.sessionTitle === todo.chapter_name;
                    const titleExact =
                        slide.slideTitle === todo.title || slide.slideTitle === todo.name;
                    const typeMatch =
                        (todo.type === 'DOCUMENT' && slide.slideType === 'doc') ||
                        (todo.type === 'ASSESSMENT' && slide.slideType === 'quiz') ||
                        (todo.type === 'VIDEO' && slide.slideType === 'video') ||
                        (todo.type === 'AI_VIDEO' && slide.slideType === 'ai-video') ||
                        (todo.type === 'AI_SLIDES' && slide.slideType === 'ai-slides') ||
                        (todo.type === 'AI_STORYBOOK' && slide.slideType === 'ai-storybook') ||
                        (todo.type === 'VIDEO_CODE' && slide.slideType === 'video-code') ||
                        (todo.type === 'AI_VIDEO_CODE' && slide.slideType === 'ai-video-code');

                    return sessionExact && titleExact && typeMatch;
                });

                if (matchingTodo && matchingTodo.path) {
                    pathToSlideMap.set(matchingTodo.path, slide);
                    console.log(
                        `[Exact] Mapped path "${matchingTodo.path}" to slide "${slide.id}" (${slide.sessionTitle} - ${slide.slideTitle})`
                    );
                }
            });

            // Then, try case-insensitive matches for slides that weren't matched
            slides.forEach((slide) => {
                const alreadyMapped = Array.from(pathToSlideMap.values()).some(
                    (mappedSlide) => mappedSlide.id === slide.id
                );
                if (alreadyMapped) return;

                const matchingTodo = contentTodos.find((todo: any) => {
                    const sessionMatch =
                        slide.sessionTitle.toLowerCase().trim() ===
                        (todo.chapter_name || '').toLowerCase().trim();
                    const titleMatch =
                        slide.slideTitle.toLowerCase().trim() ===
                            (todo.title || '').toLowerCase().trim() ||
                        slide.slideTitle.toLowerCase().trim() ===
                            (todo.name || '').toLowerCase().trim();
                    const typeMatch =
                        (todo.type === 'DOCUMENT' && slide.slideType === 'doc') ||
                        (todo.type === 'ASSESSMENT' && slide.slideType === 'quiz') ||
                        (todo.type === 'VIDEO' && slide.slideType === 'video') ||
                        (todo.type === 'AI_VIDEO' && slide.slideType === 'ai-video') ||
                        (todo.type === 'AI_SLIDES' && slide.slideType === 'ai-slides') ||
                        (todo.type === 'AI_STORYBOOK' && slide.slideType === 'ai-storybook') ||
                        (todo.type === 'VIDEO_CODE' && slide.slideType === 'video-code') ||
                        (todo.type === 'AI_VIDEO_CODE' && slide.slideType === 'ai-video-code');

                    return sessionMatch && titleMatch && typeMatch;
                });

                if (matchingTodo && matchingTodo.path) {
                    pathToSlideMap.set(matchingTodo.path, slide);
                    console.log(
                        `[Case-insensitive] Mapped path "${matchingTodo.path}" to slide "${slide.id}" (${slide.sessionTitle} - ${slide.slideTitle})`
                    );
                }
            });

            // Finally, try fuzzy matches (partial title match) for remaining slides
            slides.forEach((slide) => {
                const alreadyMapped = Array.from(pathToSlideMap.values()).some(
                    (mappedSlide) => mappedSlide.id === slide.id
                );
                if (alreadyMapped) return;

                const matchingTodo = contentTodos.find((todo: any) => {
                    const sessionMatch =
                        slide.sessionTitle.toLowerCase().trim() ===
                            (todo.chapter_name || '').toLowerCase().trim() ||
                        (todo.chapter_name || '')
                            .toLowerCase()
                            .trim()
                            .includes(slide.sessionTitle.toLowerCase().trim()) ||
                        slide.sessionTitle
                            .toLowerCase()
                            .trim()
                            .includes((todo.chapter_name || '').toLowerCase().trim());
                    const titleMatch =
                        slide.slideTitle.toLowerCase().trim() ===
                            (todo.title || '').toLowerCase().trim() ||
                        slide.slideTitle.toLowerCase().trim() ===
                            (todo.name || '').toLowerCase().trim() ||
                        (todo.title || '')
                            .toLowerCase()
                            .trim()
                            .includes(slide.slideTitle.toLowerCase().trim()) ||
                        slide.slideTitle
                            .toLowerCase()
                            .trim()
                            .includes((todo.title || '').toLowerCase().trim()) ||
                        (todo.name || '')
                            .toLowerCase()
                            .trim()
                            .includes(slide.slideTitle.toLowerCase().trim()) ||
                        slide.slideTitle
                            .toLowerCase()
                            .trim()
                            .includes((todo.name || '').toLowerCase().trim());
                    const typeMatch =
                        (todo.type === 'DOCUMENT' && slide.slideType === 'doc') ||
                        (todo.type === 'ASSESSMENT' && slide.slideType === 'quiz') ||
                        (todo.type === 'VIDEO' && slide.slideType === 'video') ||
                        (todo.type === 'AI_VIDEO' && slide.slideType === 'ai-video') ||
                        (todo.type === 'AI_SLIDES' && slide.slideType === 'ai-slides') ||
                        (todo.type === 'AI_STORYBOOK' && slide.slideType === 'ai-storybook') ||
                        (todo.type === 'VIDEO_CODE' && slide.slideType === 'video-code') ||
                        (todo.type === 'AI_VIDEO_CODE' && slide.slideType === 'ai-video-code');

                    return sessionMatch && titleMatch && typeMatch;
                });

                if (matchingTodo && matchingTodo.path) {
                    pathToSlideMap.set(matchingTodo.path, slide);
                    console.log(
                        `[Fuzzy] Mapped path "${matchingTodo.path}" to slide "${slide.id}" (${slide.sessionTitle} - ${slide.slideTitle})`
                    );
                }
            });

            console.log(
                `Total path mappings created: ${pathToSlideMap.size} out of ${contentTodos.length} todos`
            );
            console.log(
                'Path to slide mappings:',
                Array.from(pathToSlideMap.entries()).map(([path, slide]) => ({
                    path,
                    slideId: slide.id,
                    sessionTitle: slide.sessionTitle,
                    slideTitle: slide.slideTitle,
                }))
            );

            // Only send todos that have a matching live slide (user may have removed some)
            const activeTodos = contentTodos.filter(
                (todo: any) => todo.path && pathToSlideMap.has(todo.path)
            );
            if (activeTodos.length < contentTodos.length) {
                console.log(
                    `[Content Gen] Skipping ${contentTodos.length - activeTodos.length} todos for removed slides/chapters`
                );
            }

            // Mark all content slides as "generating" initially
            setSlides((prevSlides) => {
                const updatedSlides = prevSlides.map((slide) => {
                    const matchingTodo = activeTodos.find((todo: any) => {
                        const sessionTitle = todo.chapter_name || '';
                        const slideTitle = todo.title || todo.name || '';
                        return (
                            slide.sessionTitle === sessionTitle &&
                            slide.slideTitle === slideTitle &&
                            ((todo.type === 'DOCUMENT' && slide.slideType === 'doc') ||
                                (todo.type === 'ASSESSMENT' && slide.slideType === 'quiz') ||
                                (todo.type === 'VIDEO' && slide.slideType === 'video') ||
                                (todo.type === 'AI_VIDEO' && slide.slideType === 'ai-video') ||
                                (todo.type === 'AI_SLIDES' && slide.slideType === 'ai-slides') ||
                                (todo.type === 'AI_STORYBOOK' &&
                                    slide.slideType === 'ai-storybook') ||
                                (todo.type === 'VIDEO_CODE' && slide.slideType === 'video-code') ||
                                (todo.type === 'AI_VIDEO_CODE' &&
                                    slide.slideType === 'ai-video-code'))
                        );
                    });

                    if (matchingTodo) {
                        return {
                            ...slide,
                            status: 'generating' as const,
                            progress: 0,
                        };
                    }
                    return slide;
                });

                localStorage.setItem('generatedSlides', JSON.stringify(updatedSlides));
                localStorage.setItem('isGeneratingContent', 'true');

                return updatedSlides;
            });

            // Track if we've navigated to viewer (disabled - stay on outline page)
            // let hasNavigatedToViewer = false;

            // Store path map in a variable that persists across updates
            const persistentPathMap = new Map(pathToSlideMap);

            // Call content generation API with detailed onUpdate callback
            await generateContent(
                activeTodos,
                instituteId,
                (update) => {
                    console.log('🔵 Content update received:', {
                        type: update.type,
                        path: update.path,
                        slideType: update.slideType,
                        status: update.status,
                        hasContentData: !!update.contentData,
                        contentDataKeys: update.contentData ? Object.keys(update.contentData) : [],
                    });

                    // Server-side repetition-dedupe pass. By the time it starts,
                    // every slide has completed and the UI reads "done" — flip
                    // the paths being rewritten back to 'generating' so the
                    // course can't be persisted with pre-rewrite content. Each
                    // rewrite (or the original re-emit on failure) completes
                    // them again through the normal SLIDE_CONTENT_UPDATE path.
                    if (update.type === 'CONTENT_POSTPASS') {
                        if (update.status === 'STARTED' && Array.isArray(update.paths)) {
                            const regenIds = new Set(
                                update.paths
                                    .map((p) => persistentPathMap.get(p)?.id)
                                    .filter(Boolean)
                            );
                            if (regenIds.size > 0) {
                                setIsGeneratingContent(true);
                                setIsContentGenerated(false);
                                localStorage.setItem('isGeneratingContent', 'true');
                                setContentGenerationProgress(
                                    t('contentGeneration.toast.reducingRepetition', {
                                        count: regenIds.size,
                                    })
                                );
                                try {
                                    const stored = localStorage.getItem('generatedSlides');
                                    if (stored) {
                                        const parsed = JSON.parse(stored);
                                        for (const s of parsed) {
                                            if (regenIds.has(s.id)) {
                                                s.status = 'generating';
                                                s.progress = 50;
                                            }
                                        }
                                        localStorage.setItem(
                                            'generatedSlides',
                                            JSON.stringify(parsed)
                                        );
                                    }
                                } catch (e) {
                                    console.error('Failed to mark postpass slides:', e);
                                }
                                setSlides((prev) =>
                                    prev.map((s) =>
                                        regenIds.has(s.id)
                                            ? { ...s, status: 'generating' as const, progress: 50 }
                                            : s
                                    )
                                );
                            }
                        } else if (update.status === 'DONE') {
                            // Safety net: each rewrite re-completed its slide
                            // already; force-close anything still marked.
                            try {
                                const stored = localStorage.getItem('generatedSlides');
                                if (stored) {
                                    const parsed = JSON.parse(stored);
                                    for (const s of parsed) {
                                        if (s.status === 'generating' && s.slideType === 'doc') {
                                            s.status = 'completed';
                                            s.progress = 100;
                                        }
                                    }
                                    localStorage.setItem('generatedSlides', JSON.stringify(parsed));
                                }
                            } catch (e) {
                                console.error('Failed to close postpass slides:', e);
                            }
                            setSlides((prev) =>
                                prev.map((s) =>
                                    s.slideType === 'doc' && s.status === 'generating'
                                        ? { ...s, status: 'completed' as const, progress: 100 }
                                        : s
                                )
                            );
                            setIsGeneratingContent(false);
                            setIsContentGenerated(true);
                            localStorage.setItem('isGeneratingContent', 'false');
                        }
                        return;
                    }

                    if (update.type === 'SLIDE_CONTENT_UPDATE') {
                        console.log('🔵 Processing content update for path:', update.path);

                        let mappedSlide = persistentPathMap.get(update.path);
                        console.log(
                            '🔵 Mapped slide from path map:',
                            mappedSlide
                                ? {
                                      id: mappedSlide.id,
                                      sessionTitle: mappedSlide.sessionTitle,
                                      slideTitle: mappedSlide.slideTitle,
                                  }
                                : '❌ NOT FOUND IN MAP'
                        );

                        // Fallback: Try to find slide by matching chapter_name and title from the todo
                        if (!mappedSlide) {
                            console.log(`⚠️ [${update.path}] Trying fallback matching...`);
                            const todoChapter = update.path?.split('/')[0] || '';
                            const todoTitle = update.path?.split('/')[1] || '';

                            try {
                                const stored = localStorage.getItem('generatedSlides');
                                if (stored) {
                                    const parsedSlides = JSON.parse(stored);
                                    const fallbackSlide = parsedSlides.find((slide: any) => {
                                        const sessionMatch =
                                            slide.sessionTitle.toLowerCase().trim() ===
                                                todoChapter.toLowerCase().trim() ||
                                            todoChapter
                                                .toLowerCase()
                                                .includes(
                                                    slide.sessionTitle.toLowerCase().trim()
                                                ) ||
                                            slide.sessionTitle
                                                .toLowerCase()
                                                .includes(todoChapter.toLowerCase().trim());
                                        const titleMatch =
                                            slide.slideTitle.toLowerCase().trim() ===
                                                todoTitle.toLowerCase().trim() ||
                                            todoTitle
                                                .toLowerCase()
                                                .includes(slide.slideTitle.toLowerCase().trim()) ||
                                            slide.slideTitle
                                                .toLowerCase()
                                                .includes(todoTitle.toLowerCase().trim());
                                        const typeMatch =
                                            (update.slideType === 'DOCUMENT' &&
                                                slide.slideType === 'doc') ||
                                            (update.slideType === 'ASSESSMENT' &&
                                                slide.slideType === 'assessment') ||
                                            (update.slideType === 'VIDEO' &&
                                                slide.slideType === 'video') ||
                                            (update.slideType === 'AI_VIDEO' &&
                                                slide.slideType === 'ai-video') ||
                                            ((update.slideType as string) === 'VIDEO_CODE' &&
                                                slide.slideType === 'video-code') ||
                                            ((update.slideType as string) === 'AI_VIDEO_CODE' &&
                                                slide.slideType === 'ai-video-code');
                                        return sessionMatch && titleMatch && typeMatch;
                                    });

                                    if (fallbackSlide) {
                                        mappedSlide = fallbackSlide;
                                        console.log(
                                            `✅ [${update.path}] Found slide via fallback matching:`,
                                            {
                                                id: fallbackSlide.id,
                                                sessionTitle: fallbackSlide.sessionTitle,
                                                slideTitle: fallbackSlide.slideTitle,
                                            }
                                        );
                                    }
                                }
                            } catch (e) {
                                console.error(`❌ [${update.path}] Fallback matching failed:`, e);
                            }
                        }

                        if (!mappedSlide) {
                            console.error(
                                `❌ [${update.path}] No mapped slide found even with fallback, skipping update`
                            );
                            return;
                        }

                        // Prepare content based on type
                        let content = '';
                        if (update.slideType === 'DOCUMENT') {
                            // Ensure rawContent is a string — backend may send an object
                            const rawContent =
                                typeof update.contentData === 'string'
                                    ? update.contentData
                                    : update.contentData?.html ??
                                      update.contentData?.content ??
                                      update.contentData?.text ??
                                      (update.contentData
                                          ? JSON.stringify(update.contentData)
                                          : '');

                            // Check if the ENTIRE content is wrapped in ```html...```
                            const trimmed = rawContent.trim();
                            if (trimmed.startsWith('```html') && trimmed.endsWith('```')) {
                                const htmlMatch = trimmed.match(/^```html\s*\n?([\s\S]*?)\n?```$/);
                                if (htmlMatch && htmlMatch[1]) {
                                    content = htmlMatch[1].trim();
                                } else {
                                    content = rawContent;
                                }
                            } else {
                                // Content is markdown - convert to HTML
                                // This handles markdown with mermaid code blocks
                                content = markdownToHtml(rawContent);
                            }
                        } else if (update.slideType === 'ASSESSMENT') {
                            try {
                                console.log(`🔍 [${update.path}] Processing assessment data`);
                                content = convertAssessmentToJSON(update.contentData);
                                const parsed = JSON.parse(content);
                                console.log(
                                    `✅ [${update.path}] Assessment JSON validated successfully`
                                );
                            } catch (e) {
                                console.error(
                                    `❌ [${update.path}] Failed to convert assessment to JSON:`,
                                    e
                                );
                                content = JSON.stringify({
                                    questions: [],
                                    title: 'Assessment',
                                    error: 'Failed to parse assessment data',
                                    originalError: e instanceof Error ? e.message : 'Unknown error',
                                });
                            }
                        } else if (update.slideType === 'VIDEO') {
                            console.log(`🔵 [${update.path}] Processing video data`);
                            const videoUrl =
                                update.contentData.url || update.contentData.embedUrl || '';
                            const description = update.contentData.description || '';
                            const title =
                                update.contentData.title || t('contentGeneration.defaultVideoTitle');

                            if (videoUrl) {
                                content = `<div>
                                    <p><strong>${title}</strong></p>
                                    <p>${description}</p>
                                    <p>${t('contentGeneration.youtubeUrlLabel')} <a href="${videoUrl}" target="_blank">${videoUrl}</a></p>
                                </div>`;
                                console.log(
                                    `✅ [${update.path}] Video content created with URL: ${videoUrl}`
                                );
                            } else {
                                content = `<div><p><strong>${title}</strong></p><p>${description}</p><p>${t('contentGeneration.noVideoUrlProvided')}</p></div>`;
                                console.log(`⚠️ [${update.path}] No video URL found`);
                            }
                        } else if (update.slideType === 'AI_VIDEO') {
                            console.log(
                                `🔵 [${update.path}] Processing AI video data, status: ${update.status}`
                            );
                            console.log(`🔵 [${update.path}] Content data:`, update.contentData);

                            // For AI_VIDEO, process ALL events (not just COMPLETED)
                            // Store contentData if available, otherwise store progress info
                            if (update.contentData) {
                                // Store the full contentData (includes timelineUrl, audioUrl, progress, etc.)
                                content = JSON.stringify(update.contentData);
                                console.log(`✅ [${update.path}] AI video data stored:`, {
                                    videoId: update.contentData.videoId,
                                    timelineUrl: update.contentData.timelineUrl,
                                    audioUrl: update.contentData.audioUrl,
                                    status: update.contentData.status || update.status,
                                    progress: update.contentData.progress,
                                });
                            } else {
                                // No contentData yet, just store status/progress
                                content = JSON.stringify({
                                    status: update.status || 'GENERATING',
                                    progress: 0,
                                });
                                console.log(
                                    `⚠️ [${update.path}] AI video event received but no contentData yet, status: ${update.status}`
                                );
                            }
                        } else if (update.slideType === 'VIDEO_CODE') {
                            console.log(`🔵 [${update.path}] Processing VIDEO_CODE data`);
                            // contentData has { video: {...}, code: {...}, layout: "split-left" }
                            if (update.contentData && typeof update.contentData === 'object') {
                                // Store the full contentData structure
                                content = JSON.stringify(update.contentData);
                                console.log(`✅ [${update.path}] VIDEO_CODE data stored:`, {
                                    hasVideo: !!update.contentData.video,
                                    hasCode: !!update.contentData.code,
                                    layout: update.contentData.layout,
                                });
                            } else {
                                content = JSON.stringify({
                                    video: null,
                                    code: null,
                                    layout: 'split-left',
                                });
                                console.log(
                                    `⚠️ [${update.path}] VIDEO_CODE event received but no contentData`
                                );
                            }
                        } else if (update.slideType === 'AI_VIDEO_CODE') {
                            console.log(
                                `🔵 [${update.path}] Processing AI_VIDEO_CODE data, status: ${update.status}`
                            );
                            // contentData has { video: {...}, code: {...}, layout: "split-left" }
                            // video contains AI video data similar to AI_VIDEO
                            if (update.contentData && typeof update.contentData === 'object') {
                                // Store the full contentData structure
                                content = JSON.stringify(update.contentData);
                                console.log(`✅ [${update.path}] AI_VIDEO_CODE data stored:`, {
                                    hasVideo: !!update.contentData.video,
                                    videoStatus: update.contentData.video?.status,
                                    hasCode: !!update.contentData.code,
                                    layout: update.contentData.layout,
                                });
                            } else {
                                content = JSON.stringify({
                                    video: { status: 'GENERATING', progress: 0 },
                                    code: null,
                                    layout: 'split-left',
                                });
                                console.log(
                                    `⚠️ [${update.path}] AI_VIDEO_CODE event received but no contentData yet`
                                );
                            }
                        } else if (
                            update.slideType === 'AI_SLIDES' ||
                            update.slideType === 'AI_STORYBOOK'
                        ) {
                            console.log(
                                `🔵 [${update.path}] Processing ${update.slideType} data, status: ${update.status}`
                            );
                            // AI_SLIDES and AI_STORYBOOK use the same pipeline as AI_VIDEO
                            if (update.contentData) {
                                content = JSON.stringify(update.contentData);
                                console.log(
                                    `✅ [${update.path}] ${update.slideType} data stored:`,
                                    {
                                        videoId: update.contentData.videoId,
                                        timelineUrl: update.contentData.timelineUrl,
                                        status: update.contentData.status || update.status,
                                        progress: update.contentData.progress,
                                    }
                                );
                            } else {
                                content = JSON.stringify({
                                    status: update.status || 'GENERATING',
                                    progress: 0,
                                });
                            }
                        }

                        // Update localStorage first
                        try {
                            const stored = localStorage.getItem('generatedSlides');
                            if (stored) {
                                const parsed = JSON.parse(stored);
                                const slideIndex = parsed.findIndex(
                                    (s: any) => s.id === mappedSlide!.id
                                );
                                if (slideIndex >= 0) {
                                    // Determine status and progress based on update type and content
                                    let newStatus: 'pending' | 'generating' | 'completed' =
                                        'pending';
                                    let newProgress = 0;
                                    let aiVideoData = parsed[slideIndex].aiVideoData;

                                    if (
                                        (update.slideType === 'AI_VIDEO' ||
                                            update.slideType === 'AI_SLIDES' ||
                                            update.slideType === 'AI_STORYBOOK') &&
                                        update.contentData
                                    ) {
                                        // AI_VIDEO, AI_SLIDES, AI_STORYBOOK all use the same video pipeline
                                        const videoStatus =
                                            update.contentData.status || update.status;
                                        if (videoStatus === 'COMPLETED') {
                                            newStatus = 'completed';
                                            newProgress = 100;
                                            aiVideoData = update.contentData;
                                        } else if (
                                            videoStatus === 'GENERATING' ||
                                            update.status === 'GENERATING'
                                        ) {
                                            newStatus = 'generating';
                                            newProgress = update.contentData.progress || 0;
                                            if (update.contentData) {
                                                aiVideoData = update.contentData;
                                            }
                                        } else {
                                            newStatus = 'generating';
                                            newProgress = update.contentData.progress || 0;
                                        }
                                    } else if (
                                        (update.slideType as string) === 'VIDEO_CODE' &&
                                        update.contentData
                                    ) {
                                        // For VIDEO_CODE, mark as completed when we have both video and code
                                        if (update.contentData.video && update.contentData.code) {
                                            newStatus = 'completed';
                                            newProgress = 100;
                                        } else {
                                            newStatus = 'generating';
                                            newProgress = 50;
                                        }
                                    } else if (
                                        (update.slideType as string) === 'AI_VIDEO_CODE' &&
                                        update.contentData
                                    ) {
                                        // For AI_VIDEO_CODE, handle similar to AI_VIDEO - check video status
                                        const videoData = update.contentData.video;
                                        const videoStatus = videoData?.status || update.status;

                                        // If video is completed and we have code, mark as completed
                                        if (
                                            videoStatus === 'COMPLETED' &&
                                            update.contentData.code
                                        ) {
                                            newStatus = 'completed';
                                            newProgress = 100;
                                        } else if (
                                            videoStatus === 'GENERATING' ||
                                            update.status === 'GENERATING'
                                        ) {
                                            newStatus = 'generating';
                                            newProgress = videoData?.progress || 0;
                                        } else {
                                            newStatus = 'generating';
                                            newProgress = videoData?.progress || 0;
                                        }
                                    } else if (update.slideType === 'ASSESSMENT') {
                                        // For ASSESSMENT, validate that we have valid quiz questions
                                        try {
                                            const assessmentData = JSON.parse(content);
                                            if (
                                                assessmentData &&
                                                assessmentData.questions &&
                                                Array.isArray(assessmentData.questions) &&
                                                assessmentData.questions.length > 0
                                            ) {
                                                newStatus = 'completed';
                                                newProgress = 100;
                                            } else {
                                                newStatus = 'generating';
                                                newProgress = 50;
                                                console.log(
                                                    `⚠️ [${update.path}] Assessment has no valid questions, keeping as generating`
                                                );
                                            }
                                        } catch (e) {
                                            newStatus = 'generating';
                                            newProgress = 50;
                                            console.log(
                                                `⚠️ [${update.path}] Assessment content is invalid, keeping as generating`
                                            );
                                        }
                                    } else {
                                        // For other types, mark as completed when we have content
                                        newStatus = 'completed';
                                        newProgress = 100;
                                    }

                                    parsed[slideIndex] = {
                                        ...parsed[slideIndex],
                                        content,
                                        status: newStatus,
                                        progress: newProgress,
                                        aiVideoData: aiVideoData ?? parsed[slideIndex].aiVideoData,
                                    };

                                    localStorage.setItem('generatedSlides', JSON.stringify(parsed));
                                    console.log(
                                        `✅ [${update.path}] Updated localStorage for slide: ${mappedSlide!.id}`
                                    );

                                    // Check if all content slides are now completed
                                    const allCompleted = parsed.every(
                                        (s: any) =>
                                            s.status === 'completed' ||
                                            (s.slideType !== 'doc' &&
                                                s.slideType !== 'quiz' &&
                                                s.slideType !== 'assessment' &&
                                                s.slideType !== 'video' &&
                                                s.slideType !== 'ai-video' &&
                                                s.slideType !== 'ai-slides' &&
                                                s.slideType !== 'ai-storybook' &&
                                                s.slideType !== 'video-code' &&
                                                s.slideType !== 'ai-video-code')
                                    );

                                    if (allCompleted) {
                                        localStorage.setItem('isGeneratingContent', 'false');
                                        setIsGeneratingContent(false);
                                        setIsContentGenerated(true);
                                        setAbortController(null);
                                        console.log(
                                            '✅ [FINAL] All slides completed, marked content generation as complete'
                                        );
                                    } else {
                                        const completedCount = parsed.filter(
                                            (s: any) => s.status === 'completed'
                                        ).length;
                                        const totalContent = parsed.filter(
                                            (s: any) =>
                                                s.slideType === 'doc' ||
                                                s.slideType === 'quiz' ||
                                                s.slideType === 'assessment' ||
                                                s.slideType === 'video' ||
                                                s.slideType === 'ai-video' ||
                                                s.slideType === 'ai-slides' ||
                                                s.slideType === 'ai-storybook' ||
                                                s.slideType === 'video-code' ||
                                                s.slideType === 'ai-video-code'
                                        ).length;
                                        console.log(
                                            `📊 Progress: ${completedCount}/${totalContent} slides completed`
                                        );
                                    }
                                }
                            }
                        } catch (e) {
                            console.error(`❌ [${update.path}] Failed to update localStorage:`, e);
                        }

                        // Also update React state
                        setSlides((prevSlides) => {
                            const slideToUpdate = prevSlides.find(
                                (slide) => slide.id === mappedSlide!.id
                            );

                            if (!slideToUpdate) {
                                console.error(
                                    `❌ [${update.path}] Slide ${mappedSlide!.id} not found in prevSlides`
                                );
                                return prevSlides;
                            }

                            const updatedSlides = prevSlides.map((slide) => {
                                if (slide.id === slideToUpdate.id) {
                                    let aiVideoData = slide.aiVideoData;
                                    let newStatus: 'pending' | 'generating' | 'completed' =
                                        slide.status;
                                    let newProgress = slide.progress;

                                    // For AI_VIDEO, AI_SLIDES, AI_STORYBOOK: process all events and update status/progress
                                    if (
                                        update.slideType === 'AI_VIDEO' ||
                                        update.slideType === 'AI_SLIDES' ||
                                        update.slideType === 'AI_STORYBOOK'
                                    ) {
                                        if (update.contentData) {
                                            // Store the contentData (includes videoId, timelineUrl, etc.)
                                            aiVideoData = update.contentData;

                                            // Determine status from contentData or update.status
                                            const videoStatus =
                                                update.contentData.status || update.status;
                                            if (videoStatus === 'COMPLETED') {
                                                newStatus = 'completed';
                                                newProgress = 100;
                                            } else if (
                                                videoStatus === 'GENERATING' ||
                                                update.status === 'GENERATING'
                                            ) {
                                                newStatus = 'generating';
                                                newProgress =
                                                    update.contentData.progress ||
                                                    slide.progress ||
                                                    0;
                                            } else {
                                                newStatus = 'generating';
                                                newProgress =
                                                    update.contentData.progress ||
                                                    slide.progress ||
                                                    0;
                                            }

                                            console.log(
                                                `🔄 [${update.path}] Updated ${update.slideType} slide:`,
                                                {
                                                    status: newStatus,
                                                    progress: newProgress,
                                                    videoId: aiVideoData?.videoId,
                                                    hasTimelineUrl: !!aiVideoData?.timelineUrl,
                                                    hasAudioUrl: !!aiVideoData?.audioUrl,
                                                }
                                            );
                                        } else {
                                            // No contentData yet, but update status if provided
                                            if (update.status === 'GENERATING') {
                                                newStatus = 'generating';
                                            }
                                            console.log(
                                                `🔄 [${update.path}] ${update.slideType} event without contentData, status: ${update.status}`
                                            );
                                        }
                                    } else if ((update.slideType as string) === 'VIDEO_CODE') {
                                        // For VIDEO_CODE, mark as completed when we have both video and code
                                        if (
                                            update.contentData &&
                                            update.contentData.video &&
                                            update.contentData.code
                                        ) {
                                            newStatus = 'completed';
                                            newProgress = 100;
                                        } else {
                                            newStatus = 'generating';
                                            newProgress = 50;
                                        }
                                    } else if ((update.slideType as string) === 'AI_VIDEO_CODE') {
                                        // For AI_VIDEO_CODE, handle similar to AI_VIDEO - check video status
                                        if (update.contentData) {
                                            const videoData = update.contentData.video;
                                            const videoStatus = videoData?.status || update.status;

                                            // If video is completed and we have code, mark as completed
                                            if (
                                                videoStatus === 'COMPLETED' &&
                                                update.contentData.code
                                            ) {
                                                newStatus = 'completed';
                                                newProgress = 100;
                                            } else if (
                                                videoStatus === 'GENERATING' ||
                                                update.status === 'GENERATING'
                                            ) {
                                                newStatus = 'generating';
                                                newProgress =
                                                    videoData?.progress || slide.progress || 0;
                                            } else {
                                                newStatus = 'generating';
                                                newProgress =
                                                    videoData?.progress || slide.progress || 0;
                                            }
                                        } else {
                                            // No contentData yet, but update status if provided
                                            if (update.status === 'GENERATING') {
                                                newStatus = 'generating';
                                            }
                                        }
                                    } else {
                                        // For other types, mark as completed
                                        newStatus = 'completed';
                                        newProgress = 100;
                                    }

                                    const resolvedSlideType =
                                        update.slideType === 'ASSESSMENT'
                                            ? 'assessment'
                                            : update.slideType === 'AI_VIDEO'
                                              ? 'ai-video'
                                              : update.slideType === 'AI_SLIDES'
                                                ? 'ai-slides'
                                                : update.slideType === 'AI_STORYBOOK'
                                                  ? 'ai-storybook'
                                                  : slide.slideType;
                                    return {
                                        ...slide,
                                        content,
                                        slideType: resolvedSlideType as SlideType,
                                        status: newStatus,
                                        progress: newProgress,
                                        aiVideoData,
                                    };
                                }
                                return slide;
                            });

                            localStorage.setItem('generatedSlides', JSON.stringify(updatedSlides));
                            console.log(
                                `✅ [${update.path}] Updated React state for slide: ${slideToUpdate.id}`
                            );

                            // Navigate to viewer on first content update (DISABLED - stay on outline page)
                            // if (!hasNavigatedToViewer) {
                            //     hasNavigatedToViewer = true;
                            //     setTimeout(() => {
                            //         navigate({ to: '/study-library/ai-copilot/course-outline/generating/viewer' });
                            //     }, 100);
                            // }

                            return updatedSlides;
                        });
                    } else if (update.type === 'SLIDE_CONTENT_ERROR') {
                        console.error('Content generation error:', update.errorMessage);
                        setContentGenerationProgress(
                            `Error generating ${update.slideType} for ${update.path}: ${update.errorMessage}`
                        );

                        const mappedSlide = pathToSlideMap.get(update.path);

                        setSlides((prevSlides) => {
                            let slideToUpdate = mappedSlide
                                ? prevSlides.find((slide) => slide.id === mappedSlide.id)
                                : null;

                            if (!slideToUpdate) {
                                const todo = todoPathMap.get(update.path);
                                if (todo) {
                                    const sessionTitle = todo.chapter_name || '';
                                    const slideTitle = todo.title || todo.name || '';

                                    slideToUpdate = prevSlides.find((slide) => {
                                        const sessionMatch =
                                            slide.sessionTitle === sessionTitle ||
                                            slide.sessionTitle.toLowerCase().trim() ===
                                                sessionTitle.toLowerCase().trim();
                                        const titleMatch =
                                            slide.slideTitle === slideTitle ||
                                            slide.slideTitle.toLowerCase().trim() ===
                                                slideTitle.toLowerCase().trim();
                                        const typeMatch =
                                            (todo.type === 'DOCUMENT' &&
                                                slide.slideType === 'doc') ||
                                            (todo.type === 'ASSESSMENT' &&
                                                slide.slideType === 'quiz') ||
                                            (todo.type === 'VIDEO' &&
                                                slide.slideType === 'video') ||
                                            (todo.type === 'AI_VIDEO' &&
                                                slide.slideType === 'ai-video') ||
                                            (todo.type === 'AI_SLIDES' &&
                                                slide.slideType === 'ai-slides') ||
                                            (todo.type === 'AI_STORYBOOK' &&
                                                slide.slideType === 'ai-storybook') ||
                                            (todo.type === 'VIDEO_CODE' &&
                                                slide.slideType === 'video-code') ||
                                            (todo.type === 'AI_VIDEO_CODE' &&
                                                slide.slideType === 'ai-video-code');

                                        return sessionMatch && titleMatch && typeMatch;
                                    });
                                }
                            }

                            if (!slideToUpdate) {
                                console.warn('Could not find slide to mark as failed:', {
                                    path: update.path,
                                });
                                return prevSlides;
                            }

                            return prevSlides.map((slide) => {
                                if (slide.id === slideToUpdate!.id) {
                                    return {
                                        ...slide,
                                        status: 'pending' as const,
                                        progress: 0,
                                    };
                                }
                                return slide;
                            });
                        });
                    }
                },
                (error) => {
                    console.error('Content generation failed:', error);

                    let userFriendlyMessage = t('contentGeneration.errors.prefix', {
                        message: error,
                    });

                    // Special handling for different error types
                    if (typeof error === 'string') {
                        const lowerError = error.toLowerCase();

                        if (
                            lowerError.includes('openrouter') ||
                            lowerError.includes('api key') ||
                            lowerError.includes('credits') ||
                            lowerError.includes('quota')
                        ) {
                            // Backend SSE error messages - show as-is
                            userFriendlyMessage = error;
                        } else if (lowerError.includes('402')) {
                            userFriendlyMessage = error;
                        } else if (lowerError.includes('500')) {
                            console.error('🔴 500 error detected');
                            userFriendlyMessage = t('contentGeneration.errors.serverError500');
                        } else if (lowerError.includes('aborted') || lowerError.includes('abort')) {
                            console.error('🔴 Stream aborted');
                            userFriendlyMessage = t('contentGeneration.errors.interrupted');
                        } else if (lowerError.includes('buffer')) {
                            console.error('🔴 Stream buffer issue');
                            userFriendlyMessage = t('contentGeneration.errors.bufferIssue');
                        } else if (lowerError.includes('timeout')) {
                            console.error('🔴 Stream timeout');
                            userFriendlyMessage = t('contentGeneration.errors.timeout');
                        } else if (
                            lowerError.includes('network') ||
                            lowerError.includes('fetch') ||
                            lowerError.includes('failed to fetch')
                        ) {
                            console.error('🔴 Network error');
                            userFriendlyMessage = t('contentGeneration.errors.networkError');
                        }
                    }

                    toast.error(userFriendlyMessage, { duration: 8000 });

                    setIsGeneratingContent(false);
                    setAbortController(null);
                    localStorage.setItem('isGeneratingContent', 'false');
                },
                (progress) => {
                    setContentGenerationProgress(progress);
                },
                0, // retryCount
                language,
                undefined, // generationRunId — minted inside generateContent
                videoSettings,
                referenceDocumentFileIds,
                kbGrounding,
                documentContentTypes,
                documentModel,
                figuresPolicy,
                dedupeRepetition
            );

            // Mark content generation as complete (fallback)
            setTimeout(() => {
                if (localStorage.getItem('isGeneratingContent') !== 'false') {
                    localStorage.setItem('isGeneratingContent', 'false');
                    setIsGeneratingContent(false);
                    setIsContentGenerated(true);
                    setAbortController(null);
                    console.log('✅ Generation marked complete (fallback)');
                }
            }, 2000);
        } catch (error) {
            console.error('Error generating content:', error);
            toast.error(
                t('contentGeneration.errors.failedToGenerate', {
                    message:
                        error instanceof Error
                            ? error.message
                            : t('contentGeneration.errors.unknownError'),
                }),
                { duration: 8000 }
            );
            setIsGeneratingContent(false);
        }
    };

    return {
        handleConfirmGenerateCourseAssets,
    };
};
