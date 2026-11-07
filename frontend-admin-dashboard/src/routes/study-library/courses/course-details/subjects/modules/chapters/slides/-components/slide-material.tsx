import { getActiveRoleDisplaySettingsKey } from '@/lib/auth/instituteUtils';
import { getInstituteId } from '@/constants/helper';
import { hasFacultyAssignedPermission } from '@/lib/auth/facultyAccessUtils';
/* eslint-disable */
import { createYooptaEditor } from '@yoopta/editor';
import React, { useEffect, useMemo, useRef, useCallback, type ChangeEvent, Suspense } from 'react';
const YooptaEditorWrapper = React.lazy(() =>
    import('./YooptaEditorWrapper').then((module) => ({ default: module.YooptaEditorWrapper }))
);
const LexicalDocumentEditor = React.lazy(() => import('./lexical-editor/LexicalDocumentEditor'));
import '../excalidraw-z-index-fix.css';
import { MyButton } from '@/components/design-system/button';
const PDFViewer = React.lazy(() =>
    import('./pdf-viewer').then((module) => ({ default: module.default }))
);
import { ActivityStatsSidebar } from './stats-dialog/activity-sidebar';
import { useContentStore } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-stores/chapter-sidebar-store';
import { EmptySlideMaterial } from '@/assets/svgs';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { html } from '@yoopta/exports';
import { SlidesMenuOption } from './slides-menu-options/slides-menu-option';
import { plugins, TOOLS, MARKS } from '@/constants/study-library/yoopta-editor-plugins-tools';
import { useRouter, useBlocker } from '@tanstack/react-router';
import { getPublicUrl } from '@/services/upload_file';
import DeckPlayer from './deck-player';
import { PlanComposerDialog } from '@/routes/engagement/-components/PlanComposerDialog';
import { PublishDialog } from './publish-slide-dialog';
import { UnpublishDialog } from './unpublish-slide-dialog';
import {
    Slide,
    useSlidesMutations,
} from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-hooks/use-slides';
import { toast } from 'sonner';
import { Check, PencilSimpleLine, Trash, FloppyDisk, LinkSimple, Warning } from '@phosphor-icons/react';
import { AlertCircle } from 'lucide-react';
import {
    converDataToAssignmentFormat,
    converDataToVideoFormat,
    convertToQuestionBackendSlideFormat,
} from '../-helper/helper';
import { StudyLibraryQuestionsPreview } from './questions-preview';
import StudyLibraryAssignmentPreview from './assignment-preview';
import VideoSlidePreview from './video-slide-preview';
import { TeachingDescriptionCard } from './teaching-description-card';
import { MyDialog } from '@/components/design-system/dialog';
import { AddVimeoDialog } from './slides-sidebar/add-vimeo-dialog';
import { AddVideoDialog } from './slides-sidebar/add-video-dialog';
import AudioSlidePreview from './audio-slide-preview';
import { handlePublishSlide } from './slide-operations/handlePublishSlide';
import { handleUnpublishSlide } from './slide-operations/handleUnpublishSlide';
import { updateHeading } from './slide-operations/updateSlideHeading';
import { formatHTMLString, stripAwsQueryParamsFromUrls } from './slide-operations/formatHtmlString';
import { isLexicalDocSlide, EMPTY_LEXICAL_INNER } from './lexical-editor/lexical-doc-marker';
import { ConvertToLexicalDialog } from './lexical-editor/ConvertToLexicalDialog';
import {
    flattenSemanticWrappers,
    detectDeserializeLoss,
    countSerializedBlocks,
    normalizeHtmlForDirtyCompare,
} from './slide-operations/doc-slide-integrity/reload';
import { handleConvertAndUpload } from './slide-operations/handleConvertUpload';
import { HtmlDocAiAuthor } from './html-doc/html-doc-ai-author';
import { HTML_DOC_TYPE, isHtmlDocEmpty } from './html-doc/html-doc-utils';
const SlideEditor = React.lazy(() =>
    import('./SlideEditor').then((module) => ({ default: module.default }))
);
import type { JSX } from 'react/jsx-runtime';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import DoubtResolutionSidebar from './doubt-resolution/doubtResolutionSidebar';
import { ChatCircleDots } from '@phosphor-icons/react';
import { useSidebar } from '@/components/ui/sidebar';
import { JupyterNotebookSlide } from './jupyter-notebook-slide';
import { ScratchProjectSlide } from './scratch-project-slide';
import { CodeEditorSlide } from './code-editor-slide';
import { SplitScreenSlide } from './split-screen-slide';
import { getTokenFromCookie, getTokenDecodedData, getUserRoles } from '@/lib/auth/sessionUtility';
import { UploadFileInS3 } from '@/services/upload_file';
import { TokenKey } from '@/constants/auth/tokens';
import {
    saveDraft as saveLocalDraft,
    loadDraft as loadLocalDraft,
    removeDraft as removeLocalDraft,
    dirtySlideIds as getDirtySlideIds,
    pruneOldDrafts,
    hasDraft as hasLocalDraft,
    SLIDE_DRAFTS_CHANGED_EVENT,
    type SlideDraftContext,
} from '../-utils/slide-draft-store';
import { UnsavedDraftsDialog } from './unsaved-drafts-dialog';
import { UnsavedCompareDialog } from './unsaved-compare-dialog';
import { useSlideDrafts } from '../-hooks/use-slide-drafts';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import type { DropdownItem } from '@/components/design-system/utils/types/dropdown-types';
import { useModulesWithChaptersStore } from '@/stores/study-library/use-modules-with-chapters-store';
import { useStudyLibraryStore } from '@/stores/study-library/use-study-library-store';
import QuizPreview from './QuizPreview';
import { createQuizSlidePayload } from './quiz/utils/api-helpers';
import { getDisplaySettings, getDisplaySettingsFromCache } from '@/services/display-settings';
import {
    ADMIN_DISPLAY_SETTINGS_KEY,
    TEACHER_DISPLAY_SETTINGS_KEY,
    CUSTOM_ROLE_DISPLAY_SETTINGS_KEY,
    type DisplaySettingsData,
} from '@/types/display-settings';
import {
    processHtmlImages,
    containsBase64Images,
    getBase64ImagesSize,
} from '@/utils/image-processing';

/** Check if HTML content is effectively empty (shared across editor components).
 *
 *  Guard philosophy: this check exists to prevent an accidentally-empty
 *  serialization from clobbering a slide's saved content on the backend.
 *  It MUST be permissive about what counts as content — false positives
 *  here surface to the user as "Could not read editor content" and
 *  block their save. Only flag as empty when we're extremely confident
 *  the document is truly blank.
 */
function checkIsHtmlEmpty(data: string | null): boolean {
    if (!data) return true;

    const trimmed = data.trim();
    if (!trimmed) return true;

    // First: the very specific known empty wrappers the editor produces
    // when there's nothing at all. These are the ONLY shapes we flag
    // with confidence.
    if (
        trimmed === '<html><head></head><body><div></div></body></html>' ||
        trimmed === '<html><head></head><body></body></html>' ||
        trimmed === '<div></div>' ||
        trimmed === '<p></p>' ||
        trimmed === '<br>' ||
        trimmed === '<br/>' ||
        /^<p><br\s*\/?><\/p>$/.test(trimmed) ||
        /^<div><br\s*\/?><\/div>$/.test(trimmed)
    ) {
        return true;
    }

    // Media + Yoopta custom blocks + semantic elements (details/summary
    // from the accordion serializer, figures, tables, lists, code, etc.)
    // always count as content, even without visible text.
    if (
        /<(img|video|iframe|audio|source|embed|object|svg|canvas|details|summary|figure|table|ul|ol|pre|code|blockquote|hr)\b/i.test(
            data
        ) ||
        /\b(data-yoopta-type|data-meta-align|data-meta-depth|data-tabs|data-front|data-back)\s*=/i.test(
            data
        ) ||
        // A Mermaid diagram block (<div class="mermaid">…</div>) is real,
        // intentional content even before code is typed — never let an
        // empty-but-present mermaid make the whole document read as blank
        // (which would block Save/Publish for every other block too).
        /class\s*=\s*"[^"]*\bmermaid\b/i.test(data)
    ) {
        return false;
    }

    // Fallback: strip tags/entities/whitespace and check for any text.
    const textContent = data
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();
    return textContent.length === 0;
}

/** Lightweight page count estimation from HTML (replaces expensive jspdf+html2canvas render). */
function estimatePageCount(htmlString: string): number {
    try {
        const tmp = document.createElement('div');
        tmp.innerHTML = htmlString;
        tmp.style.cssText =
            'position:absolute;top:-9999px;left:-9999px;width:210mm;padding:10mm;visibility:hidden;';
        document.body.appendChild(tmp);
        const h = tmp.scrollHeight;
        document.body.removeChild(tmp);
        // A4 at ~96dpi ≈ 1123px; use 1050 to account for margins
        return Math.max(1, Math.ceil(h / 1050));
    } catch {
        return 1;
    }
}

/**
 * Repair a Slate element's `children` so it satisfies Slate's structural
 * invariants. This heals the production white-screen where a heading/paragraph
 * began with an EMPTY inline <link> (url:"" , text:"") — such a node makes
 * toDOMNode / Editor.start / focus throw ("Cannot resolve a DOM node from Slate
 * node" / "...has no start text node"), crashing the whole slide on open. 250+
 * stored slides carry this artifact, so we heal it on load instead of chasing
 * async suppressors that can't catch the setTimeout-scheduled focus throw.
 *
 * Rules: drop empty broken links (type 'link', no url AND no text); guarantee a
 * text node immediately before and after every inline element; never leave an
 * element with empty children. Valid links (real url or text) pass untouched.
 */
const isInlineSlateElement = (n: any): boolean =>
    !!n &&
    typeof n === 'object' &&
    Array.isArray(n.children) &&
    (n?.props?.nodeType === 'inline' || n?.type === 'link' || n?.type === 'Link');
const isSlateTextNode = (n: any): boolean =>
    !!n && typeof n === 'object' && typeof n.text === 'string';
const collectSlateText = (n: any): string => {
    if (!n) return '';
    if (typeof n.text === 'string') return n.text;
    if (Array.isArray(n.children)) return n.children.map(collectSlateText).join('');
    return '';
};
function repairSlateChildren(children: any): any {
    if (!Array.isArray(children)) return children;
    const out: any[] = [];
    for (const child of children) {
        if (!child) continue;
        if (isInlineSlateElement(child)) {
            const inner = repairSlateChildren(child.children);
            const text = inner.map(collectSlateText).join('');
            const url = child?.props?.url;
            // Drop empty broken links — the artifact that crashes Slate.
            if ((child.type === 'link' || child.type === 'Link') && !text.trim() && !url) {
                continue;
            }
            // Slate invariant: a text node must precede an inline.
            if (out.length === 0 || !isSlateTextNode(out[out.length - 1])) {
                out.push({ text: '' });
            }
            out.push({ ...child, children: inner.length ? inner : [{ text: '' }] });
        } else if (Array.isArray(child.children) && typeof child.type === 'string') {
            out.push({ ...child, children: repairSlateChildren(child.children) });
        } else {
            out.push(child);
        }
    }
    // Slate invariant: a text node must follow a trailing inline.
    if (out.length && isInlineSlateElement(out[out.length - 1])) {
        out.push({ text: '' });
    }
    return out.length ? out : [{ text: '' }];
}
import ScormSlidePreview from './scorm-slide-preview';
import AssessmentSlidePreview from './assessment-slide-preview';
import AssessmentCreateForm from './assessment-create-form';
import { SlideHistoryDialog } from './slide-history-dialog';
import { SlideContentErrorBoundary } from './slide-content-error-boundary';

export const SlideMaterial = ({
    setGetCurrentEditorHTMLContent,
    setSaveDraft,
    isLearnerView = false,
    hidePublishButtons = false,
    customSaveFunction,
}: {
    setGetCurrentEditorHTMLContent: (fn: () => string) => void;
    setSaveDraft: (fn: (activeItem: Slide) => Promise<void>) => void;
    isLearnerView?: boolean;
    hidePublishButtons?: boolean;
    customSaveFunction?: (slide: Slide) => Promise<void>;
}) => {
    const { t } = useTranslation('slideEditor');
    const { t: tPublish } = useTranslation('studyLibraryHandlePublishSlide');
    // Role display settings for toggles like Manage Doubts visibility
    const [roleDisplay, setRoleDisplay] = useState<DisplaySettingsData | null>(null);
    useEffect(() => {
        const accessToken = getTokenFromCookie(TokenKey.accessToken);
        const roles = getUserRoles(accessToken);
        const isAdmin = roles.includes('ADMIN');
        const hasFaculty = hasFacultyAssignedPermission(getInstituteId());
        const roleKey = getActiveRoleDisplaySettingsKey();
        const cached = getDisplaySettingsFromCache(roleKey);
        if (cached) {
            setRoleDisplay(cached);
            return;
        }
        getDisplaySettings(roleKey)
            .then(setRoleDisplay)
            .catch(() => setRoleDisplay(null));
    }, []);

    const showManageDoubts = useMemo(() => {
        const tab = roleDisplay?.sidebar.find((t) => t.id === 'study-library');
        const sub = tab?.subTabs?.find((s) => s.id === 'doubt-management');
        return sub?.visible !== false;
    }, [roleDisplay]);
    const { items, activeItem, setActiveItem, assessmentCreateMode } = useContentStore();
    const editor = useMemo(() => {
        const ed = createYooptaEditor();
        // Monkey-patch: wrap Slate's focus to suppress "Cannot resolve a DOM
        // node/point" errors that happen when Yoopta internally calls
        // focus/toDOMNode/toDOMPoint during paste or block-type transforms,
        // before React has committed the new DOM (or while editor.selection
        // still references the pre-transform tree).
        const isStaleSlateDomError = (msg: unknown): boolean =>
            typeof msg === 'string' &&
            (msg.includes('Cannot resolve a DOM node from Slate node') ||
                msg.includes('Cannot resolve a DOM point from Slate point'));
        const origFocus = ed.focus?.bind(ed);
        if (origFocus) {
            ed.focus = () => {
                try {
                    return origFocus();
                } catch (e: any) {
                    if (isStaleSlateDomError(e?.message)) {
                        // Stale selection — drop it and retry once so the next
                        // render of the editor isn't stuck pointing at a path
                        // that no longer exists in the document.
                        try {
                            (ed as any).selection = null;
                        } catch {
                            /* noop */
                        }
                        console.warn(
                            '[Yoopta] Suppressed DOM resolve error during focus:',
                            e.message
                        );
                        return;
                    }
                    throw e;
                }
            };
        }
        return ed;
    }, []);
    // Suppress "Cannot resolve a DOM node/point from Slate node/point" errors
    // that bubble up from the Yoopta vendor bundle during paste or block-type
    // conversion.  This is a known Slate race condition: editor.selection still
    // points at the pre-transform tree (e.g. path:[0,1] offset:129) and Slate's
    // selection-sync effect tries to project it onto a freshly rebuilt DOM.
    // The error is non-fatal — the editor remains functional — so we swallow
    // it to prevent Sentry noise and React error-boundary crashes, and reset
    // editor.selection so the next render starts clean.
    useEffect(() => {
        const isStaleSlateDomError = (msg: unknown): boolean =>
            typeof msg === 'string' &&
            (msg.includes('Cannot resolve a DOM node from Slate node') ||
                msg.includes('Cannot resolve a DOM point from Slate point'));
        const handler = (event: ErrorEvent): void => {
            if (isStaleSlateDomError(event.error?.message)) {
                event.preventDefault();
                try {
                    (editor as any).selection = null;
                } catch {
                    /* noop */
                }
                console.warn('[Yoopta] Suppressed vendor DOM resolve error during paste/transform');
            }
        };
        window.addEventListener('error', handler);
        return () => window.removeEventListener('error', handler);
    }, [editor]);

    // Shift+Enter (soft line break) was scrolling the editor to the top. Yoopta's
    // soft-break insert can momentarily drop the editor selection; combined with
    // the selection-reset above, the editor/keyboard-sensor then refocuses the
    // first block and yanks the viewport up. We can't cleanly intercept Yoopta's
    // internal key handling, so we pin the scroll instead: snapshot the
    // scrollable ancestors of the caret BEFORE the keypress is processed (capture
    // phase) and restore them right after — queueMicrotask runs before the browser
    // paints (so no flicker) and the rAF catches any async follow-up scroll.
    useEffect(() => {
        const onKeyDownCapture = (e: KeyboardEvent) => {
            if (e.key !== 'Enter' || !e.shiftKey) return;
            const target = e.target as HTMLElement | null;
            if (!target?.closest?.('[contenteditable="true"]')) return;

            const snaps: Array<{ el: HTMLElement; top: number }> = [];
            let node: HTMLElement | null = target;
            while (node) {
                if (node.scrollHeight > node.clientHeight) {
                    const oy = getComputedStyle(node).overflowY;
                    if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') {
                        snaps.push({ el: node, top: node.scrollTop });
                    }
                }
                node = node.parentElement;
            }
            const winX = window.scrollX;
            const winY = window.scrollY;

            const restore = () => {
                snaps.forEach(({ el, top }) => {
                    if (Math.abs(el.scrollTop - top) > 1) el.scrollTop = top;
                });
                if (Math.abs(window.scrollY - winY) > 1) window.scrollTo(winX, winY);
            };
            queueMicrotask(restore);
            requestAnimationFrame(restore);
        };
        document.addEventListener('keydown', onKeyDownCapture, true);
        return () => document.removeEventListener('keydown', onKeyDownCapture, true);
    }, []);

    const selectionRef = useRef<HTMLDivElement | null>(null);
    const [isEditing, setIsEditing] = useState(false);
    const [slideTitle, setSlideTitle] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    const [heading, setHeading] = useState(slideTitle);
    const router = useRouter();
    const [content, setContent] = useState<JSX.Element | null>(null);
    const isAutoSavingRef = useRef(false);
    const getCurrentExcalidrawStateRef = useRef<
        (() => { elements: any[]; appState: any; files: any }) | null
    >(null);
    const isExcalidrawBusyRef = useRef(false); // Track if Excalidraw is performing intensive operations
    const pendingStateUpdateRef = useRef<any>(null); // Store pending state updates
    const stableKeyRef = useRef<string>(''); // Stable key during operations
    // Track previous DOC slide and its initial HTML for change detection
    const prevDocSlideRef = useRef<Slide | null>(null);
    const initialDocHtmlRef = useRef<{ slideId: string | null; html: string }>({
        slideId: null,
        html: '',
    });
    // Whether the DOC slide's editor was loaded from a restored LOCAL draft
    // (vs. server content). Decides if "content returned to the load-time
    // baseline" may auto-clear the draft: only when the baseline IS the server
    // state — clearing on draft-baseline equality would delete real unsaved work.
    // One blank-load re-apply attempt per slide (see captureInitialDocSnapshot).
    const blankLoadRetrySlideIdRef = useRef<string | null>(null);
    // Whether the last explicit SaveDraft run actually persisted to the DB.
    // SaveDraft swallows most failures without throwing, so this ref is the
    // ONLY reliable success signal (see the note at SaveDraft's entry).
    const lastSaveDraftOutcomeRef = useRef<'success' | 'failure'>('failure');
    // Last successfully-serialized DOC editor HTML, TAGGED with the slide it came
    // from. It's the fallback when html.serialize throws (a degenerate custom-block
    // Slate state). Without the slideId, that fallback could hand back a DIFFERENT
    // slide's HTML during a switch — the "data comes from other slides" bug. The
    // tag lets every reader verify the cache belongs to the slide in the editor.
    const currentDocHtmlRef = useRef<{ slideId: string | null; html: string }>({
        slideId: null,
        html: '',
    });
    // The pending captureInitialDocSnapshot() timeout, tracked so a slide switch
    // can cancel it — otherwise it fires 300ms later against the NOW-current editor
    // and writes that content into the PREVIOUS slide's baseline ref.
    const snapshotTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // True when the last getCurrentEditorHTMLContent() had to fall back to
    // per-block serialization (a block's serializer threw) OR blew up entirely.
    // In that state the serialized HTML may be MISSING the offending block, so
    // persisting it — especially via the silent auto-save-on-switch — would
    // permanently drop that block's content and flip the slide to UNSYNC. The
    // auto-save reads this to refuse a destructive overwrite. Reset on every
    // serialize; only the LAST serialize before a save matters.
    const lastSerializeDegradedRef = useRef(false);
    // Timestamp of the last real user input inside the editor (keystroke, paste, cut,
    // drag). Used to tell an intentional deletion from a programmatic collapse: only a
    // deletion is preceded by input, so only a deletion may lower the content baseline.
    const lastUserInputAtRef = useRef(0);
    // Layer-2 load integrity: set when the last DOC deserialize dropped blocks vs the
    // stored HTML (a lossy round-trip for some block type). Tagged with the slide it
    // was computed for. While set for the active slide, the DOC save path REFUSES to
    // overwrite `data` — otherwise the reduced editor state would be persisted and the
    // dropped content lost permanently. Recomputed on every content-apply.
    const docLoadIntegrityRef = useRef<{
        slideId: string | null;
        lossy: boolean;
        lost: string[];
        imagesInsideTables: number;
    }>({
        slideId: null,
        lossy: false,
        lost: [],
        imagesInsideTables: 0,
    });
    // ---- Lexical editor delegation (marker-routed DOC slides) ----
    // True while the active DOC slide is a Lexical one (data-editor="lexical"
    // marker in its stored HTML). getCurrentEditorHTMLContent delegates to the
    // registered getter instead of Yoopta's html.serialize; everything
    // downstream (SaveDraft, publish, 409 retry, stash) is shared unchanged.
    const activeDocIsLexicalRef = useRef(false);
    const lexicalGetHtmlRef = useRef<(() => string) | null>(null);

    /**
     * The message shown when a slide loaded incompletely and we are refusing to save it.
     *
     * Two very different situations reach here, and telling them apart matters:
     *  - Images inside a table cell: Yoopta has no representation for one, so it is
     *    dropped on EVERY load. This is permanent — "reload and try again" loops the
     *    author forever, because the loss happens DURING the load. Say what's wrong and
     *    what would make the slide editable again.
     *  - Anything else: treat as transient; a reload may genuinely fix it.
     */
    const describeLoadIntegrityFailure = (
        integrity: { lost: string[]; imagesInsideTables: number },
        action: 'saved' | 'published'
    ): string => {
        const actionLabel =
            action === 'saved' ? t('integrity.actionSaved') : t('integrity.actionPublished');
        if (integrity.imagesInsideTables > 0) {
            return t('integrity.imagesInTable', {
                count: integrity.imagesInsideTables,
                action: actionLabel,
            });
        }
        return t('integrity.incomplete', {
            missing: integrity.lost.join(', '),
            action: actionLabel,
        });
    };

    // Dedup guard to prevent double-save on add + switch happening together
    const lastHandledPrevSlideIdRef = useRef<string | null>(null);
    // activeItem.id from the previous loadContent() run. Lets the DOC branch tell
    // a same-slide re-run (status flip PUBLISHED → UNSYNC on Save Draft, a
    // loadContent dep) apart from a real navigation (id changed). On a same-slide
    // re-run we must NOT re-deserialize, or we'd overwrite the editor's live
    // bold/colour edits and revert the formatting right after the user saves.
    const lastLoadContentSlideIdRef = useRef<string | null>(null);
    // True when the last DOC content-apply had to fall back to manually
    // reconstructing editor.plugins/blocks because the real <YooptaEditor>
    // hadn't mounted yet. That manual reconstruction is incomplete (no
    // formats/blockEditorsMap), so html.deserialize can silently drop blocks
    // → blank on first open. When the real editor mounts (onMount below) we
    // re-deserialize once with the proper maps. Reset to false on the warm
    // path so the re-apply is a no-op there.
    const usedManualPluginInitRef = useRef(false);
    // Latest HTML for the ACTIVE 'HTML' (Tiptap) document slide. Unlike the
    // Yoopta DOC path there is no serialize step — the editor hands us final
    // HTML on every change; Save Draft / Publish read from here.
    const htmlDocRef = useRef<{ slideId: string | null; html: string | null }>({
        slideId: null,
        html: null,
    });
    const htmlDocAutosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const searchParams = router.state.location.search;
    const { courseId, levelId, chapterId, slideId, moduleId, subjectId, sessionId, openDoubt } =
        searchParams;

    const [isPublishDialogOpen, setIsPublishDialogOpen] = useState(false);
    // "Assign as task": opens the engagement composer preloaded with this slide.
    const [isAssignTaskOpen, setIsAssignTaskOpen] = useState(false);
    // Memoised on the slide and its route ids: an inline object was a new value on
    // every render, and each one re-seeded the composer over the teacher's edits.
    const assignTaskSlideId = activeItem?.id;
    const assignTaskSlideTitle = activeItem?.title;
    const assignTaskSlideType = activeItem?.source_type;
    const presetSlide = useMemo(
        () =>
            assignTaskSlideId
                ? {
                      slideId: assignTaskSlideId,
                      slideTitle: assignTaskSlideTitle ?? 'Lesson',
                      slideType: assignTaskSlideType ?? undefined,
                      courseId: courseId ?? undefined,
                      sessionId: sessionId ?? undefined,
                      levelId: levelId ?? undefined,
                      subjectId: subjectId ?? '',
                      moduleId: moduleId ?? '',
                      chapterId: chapterId ?? '',
                  }
                : null,
        [
            assignTaskSlideId,
            assignTaskSlideTitle,
            assignTaskSlideType,
            courseId,
            sessionId,
            levelId,
            subjectId,
            moduleId,
            chapterId,
        ]
    );
    // Bumped after a version-history restore to force loadContent to re-run (and
    // re-deserialize) even when the slide's id/status didn't change — the effect's
    // deps intentionally exclude document_slide.data for DOC slides.
    const [historyRestoreNonce, setHistoryRestoreNonce] = useState(0);

    // ---- Explicit-save lifecycle: local (unsaved) draft persistence ----
    // Autosave to the DB is gone. Unsaved editor edits are stashed in localStorage
    // (per user+slide) so they survive slide-switch / refresh, are restored when the
    // slide reopens, and are cleared on an explicit Save draft / Publish or Discard.
    const [currentUserId] = useState<string>(() => {
        try {
            const t = getTokenFromCookie(TokenKey.accessToken);
            return (t ? getTokenDecodedData(t)?.sub : null) || 'anonymous';
        } catch {
            return 'anonymous';
        }
    });
    const [dirtySlideIdSet, setDirtySlideIdSet] = useState<Set<string>>(() =>
        getDirtySlideIds(currentUserId)
    );
    const refreshDirtySlides = useCallback(() => {
        setDirtySlideIdSet((prev) => {
            const next = getDirtySlideIds(currentUserId);
            // Return the SAME reference when membership is unchanged so React skips a
            // re-render — the continuous 500ms stash calls this on every edit tick.
            if (prev.size === next.size && [...next].every((id) => prev.has(id))) {
                return prev;
            }
            return next;
        });
    }, [currentUserId]);
    useEffect(() => {
        pruneOldDrafts(currentUserId);
        refreshDirtySlides();
    }, [currentUserId, refreshDirtySlides]);
    // Hierarchy metadata stamped onto every stashed draft so the course-scoped
    // unsaved-changes dialog can name, group (subject → module → chapter) and
    // deep-link the slide — even when it's opened from a different chapter.
    const { modulesWithChaptersData } = useModulesWithChaptersStore();
    const { studyLibraryData } = useStudyLibraryStore();
    const buildDraftContext = useCallback(
        (slideId: string): SlideDraftContext => {
            const contentState = useContentStore.getState();
            const slide =
                (contentState.items as Slide[] | undefined)?.find((s) => s.id === slideId) ??
                (contentState.activeItem?.id === slideId ? contentState.activeItem : null);
            const slideTitle =
                slide?.document_slide?.title || slide?.video_slide?.title || slide?.title || null;

            // Both stash paths only ever write slides of the currently-open
            // chapter, so the module/chapter names come from the loaded subject.
            let chapterName: string | null = null;
            let moduleName: string | null = null;
            for (const m of modulesWithChaptersData ?? []) {
                const match = m.chapters.find((c) => c.chapter.id === chapterId);
                if (match) {
                    chapterName = match.chapter.chapter_name;
                    moduleName = m.module.module_name;
                    break;
                }
            }

            const courseEntry = studyLibraryData?.find((c) => c.course.id === courseId);
            let subjectName: string | null = null;
            for (const session of courseEntry?.sessions ?? []) {
                for (const level of session.level_with_details) {
                    const subject = level.subjects.find((s) => s.id === subjectId);
                    if (subject) {
                        subjectName = subject.subject_name;
                        break;
                    }
                }
                if (subjectName) break;
            }

            return {
                slideTitle,
                chapterId: chapterId || null,
                chapterName,
                moduleId: moduleId || null,
                moduleName,
                subjectId: subjectId || null,
                subjectName,
                courseId: courseId || null,
                courseName: courseEntry?.course.package_name ?? null,
                levelId: levelId || null,
                sessionId: sessionId || null,
            };
        },
        [
            modulesWithChaptersData,
            studyLibraryData,
            chapterId,
            moduleId,
            subjectId,
            courseId,
            levelId,
            sessionId,
        ]
    );
    // BACKFILL: drafts written before the metadata upgrade have no context, so
    // the course banner/dialog can't name or place them. Whenever this chapter's
    // slides are loaded we know the full location of any such draft belonging
    // to them — stamp it in, and they surface in the course-scoped UI with real
    // names. Drafts from not-yet-visited chapters stay unplaced until visited.
    useEffect(() => {
        const slidesNow = items as Slide[] | undefined;
        if (!slidesNow?.length) return;
        for (const slide of slidesNow) {
            const draft = loadLocalDraft<string>(currentUserId, slide.id);
            if (draft && !draft.context && typeof draft.content === 'string') {
                saveLocalDraft(
                    currentUserId,
                    slide.id,
                    draft.content,
                    draft.baselineUpdatedAt,
                    buildDraftContext(slide.id)
                );
            }
        }
        refreshDirtySlides();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [items, currentUserId, buildDraftContext]);

    const stashDocDraftLocally = useCallback(
        (slideId: string, htmlString: string, guardShrink = true) => {
            if (!slideId) return;
            // Anti-clobber (switch-time only): a truncated/degraded switch-time
            // serialization must not overwrite a larger draft already saved by the
            // continuous onChange stash. The continuous stash passes guardShrink=false
            // because it reflects the user's real current edits (incl. intentional
            // deletions), which must always win.
            if (guardShrink) {
                const existing = loadLocalDraft<string>(currentUserId, slideId);
                if (
                    existing &&
                    typeof existing.content === 'string' &&
                    htmlString.trim().length < existing.content.trim().length * 0.6
                ) {
                    return;
                }
            }
            saveLocalDraft(currentUserId, slideId, htmlString, undefined, buildDraftContext(slideId));
            refreshDirtySlides();
        },
        [currentUserId, refreshDirtySlides, buildDraftContext]
    );
    const clearLocalDraft = useCallback(
        (slideId?: string | null) => {
            if (!slideId) return;
            removeLocalDraft(currentUserId, slideId);
            refreshDirtySlides();
        },
        [currentUserId, refreshDirtySlides]
    );
    // Course-scoped view of the local drafts — the ONLY scope the leave guard
    // and the unsaved-changes dialog operate on. Drafts from other courses
    // never block navigation here and are never discarded from here.
    const { drafts: courseDrafts } = useSlideDrafts(currentUserId, courseId || '');
    const [isDiscardConfirmOpen, setIsDiscardConfirmOpen] = useState(false);
    const [isCompareOpen, setIsCompareOpen] = useState(false);
    // Content hash of the ACTIVE slide's draft, kept live via draft-change
    // events. dirtySlideIdSet deliberately keeps the same reference when
    // membership is unchanged (render optimisation), so content-only stash
    // rewrites would otherwise never recompute the memos below — the pill /
    // Compare / Discard would freeze on a stale verdict for the whole session.
    const [activeDraftHash, setActiveDraftHash] = useState<string | null>(null);
    useEffect(() => {
        const update = () => {
            const draft = activeItem?.id
                ? loadLocalDraft<string>(currentUserId, activeItem.id)
                : null;
            setActiveDraftHash(draft?.contentHash ?? null);
        };
        update();
        window.addEventListener(SLIDE_DRAFTS_CHANGED_EVENT, update);
        window.addEventListener('storage', update);
        return () => {
            window.removeEventListener(SLIDE_DRAFTS_CHANGED_EVENT, update);
            window.removeEventListener('storage', update);
        };
    }, [activeItem?.id, currentUserId]);
    // Occasional-use header actions relocated into the ⋯ menu — dialogs are
    // controlled from here, triggers hidden.
    const [isStatsOpen, setIsStatsOpen] = useState(false);
    const [isHistoryOpen, setIsHistoryOpen] = useState(false);
    // "Convert to new editor" (Yoopta DOC → Lexical). Holds the current HTML to
    // pre-flight; the dialog runs the loss check and calls back on confirm.
    const [isConvertOpen, setIsConvertOpen] = useState(false);
    const [convertSourceHtml, setConvertSourceHtml] = useState<string | null>(null);
    const [isConverting, setIsConverting] = useState(false);
    // Saved-vs-current panes for the compare dialog. Saved side uses the same
    // baseline rule as dirty detection (what the editor loaded from); current
    // side is the localStorage draft. Recomputed only while the dialog is open.
    const compareContents = useMemo(() => {
        if (!isCompareOpen || !activeItem?.id) return { saved: '', current: '' };
        const saved =
            (activeItem.status === 'PUBLISHED'
                ? activeItem.document_slide?.published_data
                : activeItem.document_slide?.data ||
                  activeItem.document_slide?.published_data) || '';
        const draft = loadLocalDraft<string>(currentUserId, activeItem.id);
        const current = typeof draft?.content === 'string' ? draft.content : '';
        return { saved, current };
    }, [
        isCompareOpen,
        activeItem?.id,
        activeItem?.status,
        activeItem?.document_slide?.data,
        activeItem?.document_slide?.published_data,
        activeDraftHash,
        currentUserId,
    ]);
    // Show "Discard changes" only when the ACTIVE slide's local draft actually
    // DIFFERS from the saved version — a draft that matches what's in the DB
    // has nothing to discard. Normalized compare on both sides so serializer
    // round-trip noise (empty blocks, wrapper divs) doesn't fake a difference.
    const activeSlideHasRealChanges = useMemo(() => {
        if (!activeItem?.id || !activeDraftHash) return false;
        const draft = loadLocalDraft<string>(currentUserId, activeItem.id);
        if (!draft || typeof draft.content !== 'string') return false;
        const savedHtml =
            (activeItem.status === 'PUBLISHED'
                ? activeItem.document_slide?.published_data
                : activeItem.document_slide?.data ||
                  activeItem.document_slide?.published_data) || '';
        return (
            normalizeHtmlForDirtyCompare(draft.content) !== normalizeHtmlForDirtyCompare(savedHtml)
        );
    }, [
        activeItem?.id,
        activeItem?.status,
        activeItem?.document_slide?.data,
        activeItem?.document_slide?.published_data,
        activeDraftHash,
        currentUserId,
    ]);
    const clearCourseDrafts = useCallback(() => {
        courseDrafts.forEach((draft) => removeLocalDraft(currentUserId, draft.slideId));
        refreshDirtySlides();
    }, [courseDrafts, currentUserId, refreshDirtySlides]);
    const getRestorableLocalDraftHtml = useCallback(
        (slide?: Slide | null): string | null => {
            if (!slide?.id) return null;
            const d = loadLocalDraft<string>(currentUserId, slide.id);
            if (
                d &&
                typeof d.content === 'string' &&
                d.content.trim().length > 0 &&
                !checkIsHtmlEmpty(d.content)
            ) {
                return d.content;
            }
            return null;
        },
        [currentUserId]
    );
    // NOTE: no beforeunload warning here (removed deliberately). Refresh/close
    // loses nothing — unsaved edits are stashed in localStorage and restored on
    // reopen, and the in-app surfaces (course banner, bottom pill, amber rows)
    // carry the unsaved state. The browser-native "may not be saved" prompt was
    // both redundant and factually wrong under this model.
    // In-app navigation guard: when leaving the slides editor (a real pathname
    // change — NOT a slide/chapter switch, which only mutates search params)
    // while a slide of THIS COURSE has an unsaved local draft, block and show the
    // course-scoped drafts dialog. Drafts from other courses never block here —
    // they're findable via the same dialog from their own course's editor.
    // Slide/chapter switching stays intentionally unblocked (see beforeunload note).
    const leaveBlocker = useBlocker({
        withResolver: true,
        disabled: courseDrafts.length === 0,
        shouldBlockFn: ({ current, next }) => current.pathname !== next.pathname,
        // TanStack defaults this to TRUE, silently re-adding the browser-native
        // refresh/close prompt we deliberately removed (drafts persist in
        // localStorage and restore on reopen — the prompt's warning is false).
        enableBeforeUnload: false,
    });
    const [isUnpublishDialogOpen, setIsUnpublishDialogOpen] = useState(false);
    const [isEditLinkDialogOpen, setIsEditLinkDialogOpen] = useState(false);
    const { getPackageSessionId } = useInstituteDetailsStore();
    const { setOpen: setSidebarOpen } = useSidebar();

    // When the caller navigates here with ?openDoubt=true (e.g. from Doubt Management), open the
    // Doubt Resolution sidebar automatically so the user doesn't have to click the icon.
    const openDoubtHandledRef = useRef(false);
    useEffect(() => {
        if (openDoubt && !openDoubtHandledRef.current) {
            openDoubtHandledRef.current = true;
            setSidebarOpen(true);
        }
    }, [openDoubt, setSidebarOpen]);
    const {
        addUpdateDocumentSlide,
        addUpdateQuizSlide,
        addUpdateAudioSlide,
        addUpdateScormSlide,
        addUpdateAssessmentSlide,
        addUpdateHtmlVideoSlide,
    } = useSlidesMutations(
            chapterId || '',
            moduleId || '',
            subjectId || '',
            getPackageSessionId({
                courseId: courseId || '',
                levelId: levelId || '',
                sessionId: sessionId || '',
            }) || ''
        );
    const { addUpdateVideoSlide } = useSlidesMutations(
        chapterId || '',
        moduleId || '',
        subjectId || '',
        getPackageSessionId({
            courseId: courseId || '',
            levelId: levelId || '',
            sessionId: sessionId || '',
        }) || ''
    );
    const { updateQuestionOrder } = useSlidesMutations(
        chapterId || '',
        moduleId || '',
        subjectId || '',
        getPackageSessionId({
            courseId: courseId || '',
            levelId: levelId || '',
            sessionId: sessionId || '',
        }) || ''
    );
    const { updateAssignmentOrder } = useSlidesMutations(
        chapterId || '',
        moduleId || '',
        subjectId || '',
        getPackageSessionId({
            courseId: courseId || '',
            levelId: levelId || '',
            sessionId: sessionId || '',
        }) || ''
    );

    const handleHeadingChange = (e: ChangeEvent<HTMLInputElement>) => {
        setHeading(e.target.value);
    };

    // Component to manage editor with placeholder
    const EditorWithPlaceholder = ({ initialIsEmpty }: { initialIsEmpty: boolean }) => {
        const [showPlaceholder, setShowPlaceholder] = useState(initialIsEmpty);
        const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

        useEffect(() => {
            setShowPlaceholder(initialIsEmpty);
        }, [initialIsEmpty]);

        // Clear the pending unsaved-change debounce when this editor unmounts
        // (a slide switch, now that we remount per slide) so a stale timer can't
        // serialize the NEXT slide's editor into the previous slide's refs.
        useEffect(() => {
            return () => {
                if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
            };
        }, []);

        // Check emptiness from Yoopta JSON structure (no serialization needed)
        const checkIsEmptyFromEditor = (): boolean => {
            try {
                const children = editor.children;
                if (!children || typeof children !== 'object') return true;
                const blocks = Object.values(children);
                if (blocks.length === 0) return true;
                // A single paragraph block with only empty text is "empty"
                if (blocks.length === 1) {
                    const block = blocks[0] as any;
                    const vals = block?.value;
                    if (Array.isArray(vals) && vals.length === 1) {
                        const child = vals[0];
                        const textChildren = child?.children;
                        if (Array.isArray(textChildren) && textChildren.length === 1) {
                            const text = textChildren[0]?.text;
                            return !text || text.trim() === '';
                        }
                    }
                }
                return false;
            } catch {
                return false;
            }
        };

        // Fires once the real <YooptaEditor> has mounted (and thus built the
        // proper plugin/block/format maps on the shared editor instance). If
        // the initial content-apply had to fall back to the incomplete manual
        // reconstruction (cold path — first DOC opened since mount), the
        // deserialize may have silently dropped blocks → blank. Re-deserialize
        // once now with the correct maps so the content actually renders.
        const handleEditorMount = () => {
            if (!usedManualPluginInitRef.current) return;
            usedManualPluginInitRef.current = false;
            applyDocContentToEditor();
            setShowPlaceholder(checkIsEmptyFromEditor());
            // Re-baseline the unsaved-change snapshot against the corrected content.
            captureInitialDocSnapshot();
        };

        return (
            // Capture real user input so we can tell an intentional deletion from a
            // programmatic collapse. Both look identical in the editor value; the only
            // honest difference is that a deletion follows a keystroke/paste and a
            // load-time reset does not. Capture phase so we see it even when a nested
            // custom-block field stops propagation.
            <div
                className="relative w-full"
                onKeyDownCapture={() => (lastUserInputAtRef.current = Date.now())}
                onBeforeInputCapture={() => (lastUserInputAtRef.current = Date.now())}
                onPasteCapture={() => (lastUserInputAtRef.current = Date.now())}
                onCutCapture={() => (lastUserInputAtRef.current = Date.now())}
                onDragEndCapture={() => (lastUserInputAtRef.current = Date.now())}
            >
                {showPlaceholder && (
                    <div
                        className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center text-gray-400"
                        style={{ top: '20px' }}
                    >
                        <span className="text-lg">Click to start writing here...</span>
                    </div>
                )}
                <Suspense
                    fallback={
                        <div className="flex items-center justify-center p-8">
                            <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
                        </div>
                    }
                >
                    <YooptaEditorWrapper
                        editor={editor}
                        plugins={plugins}
                        tools={TOOLS}
                        marks={MARKS}
                        value={editor.children}
                        selectionBoxRoot={selectionRef}
                        autoFocus={true}
                        readOnly={isLearnerView}
                        onMount={handleEditorMount}
                        onChange={() => {
                            // Check emptiness from JSON structure (instant, no serialization)
                            setShowPlaceholder(checkIsEmptyFromEditor());

                            // Debounce the expensive html.serialize for unsaved-change tracking
                            if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
                            debounceTimerRef.current = setTimeout(() => {
                                try {
                                    const currentContent = html.serialize(editor, editor.children);
                                    const serializedHtml = formatHTMLString(currentContent || '');
                                    const targetSlideId =
                                        prevDocSlideRef.current?.id ?? activeItem?.id ?? null;
                                    // Guard the BASELINE. setEditorValue also fires onChange,
                                    // so a load-time reset / mid-reload collapse would other-
                                    // wise overwrite currentDocHtmlRef with the collapsed HTML
                                    // within 500ms — destroying the very reference the save
                                    // path needs to notice the collapse (and re-poisoning the
                                    // serialize-failure fallback). Only let the baseline drop
                                    // sharply when a real keystroke/paste preceded it: an
                                    // intentional deletion always follows user input, a
                                    // programmatic collapse never does.
                                    const prevBaseline =
                                        currentDocHtmlRef.current.slideId === targetSlideId
                                            ? currentDocHtmlRef.current.html
                                            : null;
                                    const prevBaselineBlocks = prevBaseline
                                        ? countSerializedBlocks(prevBaseline)
                                        : 0;
                                    const nowBlocks = countSerializedBlocks(serializedHtml);
                                    const userTypedRecently =
                                        Date.now() - lastUserInputAtRef.current < 3000;
                                    const unexplainedCollapse =
                                        prevBaselineBlocks >= 3 &&
                                        nowBlocks < prevBaselineBlocks * 0.5 &&
                                        !userTypedRecently;
                                    if (unexplainedCollapse) {
                                        console.error(
                                            `[Editor] value collapsed ${prevBaselineBlocks} -> ${nowBlocks} block(s) ` +
                                                'with no user input — keeping the previous baseline and not stashing.'
                                        );
                                        return;
                                    }
                                    currentDocHtmlRef.current = {
                                        slideId: targetSlideId,
                                        html: serializedHtml,
                                    };
                                    // Continuously persist the unsaved edit to localStorage as the
                                    // user types/pastes, so it survives a slide switch / refresh.
                                    // Only stash a REAL edit: Yoopta's setEditorValue on load also
                                    // fires onChange, so without the changed-vs-initial check merely
                                    // opening a slide would mark it dirty.
                                    const initialForThisSlide =
                                        initialDocHtmlRef.current.slideId === targetSlideId
                                            ? initialDocHtmlRef.current.html
                                            : null;
                                    // NORMALIZED compare: Yoopta appends an empty paragraph
                                    // when the author merely clicks below the content, so a
                                    // raw string compare marks a no-op click as an edit.
                                    // Only meaningful content differences count.
                                    const isRealEdit =
                                        initialForThisSlide !== null &&
                                        normalizeHtmlForDirtyCompare(serializedHtml) !==
                                            normalizeHtmlForDirtyCompare(initialForThisSlide);
                                    // Auto-clear the draft the moment the editor's content
                                    // matches what's actually SAVED in the DB — there is then
                                    // nothing to persist, regardless of whether the slide was
                                    // loaded from a restored draft. Comparing against the DB
                                    // (not the load-time baseline) is what keeps this in
                                    // agreement with the bottom pill: when the slide loaded
                                    // FROM a draft, the load baseline IS that draft, so the old
                                    // baseline+fromDraft guard left the draft — and hence the
                                    // course banner + amber dot — alive even after a full revert
                                    // to the saved version. Guard on slide identity so we never
                                    // compare slide A's editor against slide B's DB data.
                                    if (
                                        targetSlideId &&
                                        targetSlideId === activeItem?.id &&
                                        hasLocalDraft(currentUserId, targetSlideId)
                                    ) {
                                        const savedDbHtml =
                                            (activeItem?.status === 'PUBLISHED'
                                                ? activeItem?.document_slide?.published_data
                                                : activeItem?.document_slide?.data ||
                                                  activeItem?.document_slide?.published_data) || '';
                                        if (
                                            normalizeHtmlForDirtyCompare(serializedHtml) ===
                                            normalizeHtmlForDirtyCompare(savedDbHtml)
                                        ) {
                                            clearLocalDraft(targetSlideId);
                                        }
                                    }
                                    // Never stash a serialization that lost blocks relative to
                                    // the editor value. The stashed draft OUTRANKS server
                                    // content on reopen, so laundering a collapsed serialize
                                    // through localStorage makes the loss authoritative — and
                                    // the load-integrity gate can't see it, because it then
                                    // compares that partial draft against itself.
                                    const editorBlocks = Object.keys(editor.children || {}).length;
                                    const stashBlocks = countSerializedBlocks(serializedHtml);
                                    const stashLostBlocks =
                                        editorBlocks >= 3 &&
                                        stashBlocks > 0 &&
                                        stashBlocks < editorBlocks * 0.5;
                                    if (
                                        targetSlideId &&
                                        serializedHtml &&
                                        !checkIsHtmlEmpty(serializedHtml) &&
                                        isRealEdit &&
                                        !stashLostBlocks
                                    ) {
                                        // guardShrink=false: continuous stash reflects the user's real
                                        // current content and must always win over an older draft.
                                        stashDocDraftLocally(targetSlideId, serializedHtml, false);
                                    }
                                } catch (error) {
                                    console.error('Error serializing content in onChange:', error);
                                }
                            }, 500);
                        }}
                        className="size-full"
                        style={{ width: '100%', height: '100%', minHeight: '200px' }}
                    />
                </Suspense>
            </div>
        );
    };

    // Deserialize the active DOC slide's HTML into the shared Yoopta editor and
    // push it via setEditorValue. Returns whether the content is empty (for the
    // placeholder). Does NOT mount the editor component — setEditorContent()
    // does that. Split out so it can be re-run after the real <YooptaEditor>
    // mounts (see usedManualPluginInitRef / EditorWithPlaceholder onMount),
    // which fixes "DOC blank on first open".
    const applyDocContentToEditor = (): boolean => {
        // Ensure plugins and blocks are registered on the editor BEFORE
        // calling html.deserialize.  On a fresh page load the YooptaEditor
        // component hasn't mounted yet so editor.plugins / editor.blocks are
        // still empty — the deserializer would silently drop every block.
        if (!editor.plugins || Object.keys(editor.plugins).length === 0) {
            // Cold path: real editor maps not built yet. The manual
            // reconstruction below is incomplete, so flag a re-apply once the
            // real editor mounts.
            usedManualPluginInitRef.current = true;
            const pluginDefs = plugins.map((p: any) =>
                typeof p.getPlugin === 'object' ? p.getPlugin : p
            );

            // Build plugins map  (type → full plugin config)
            const pluginsMap: Record<string, any> = {};
            const inlineElements: Record<string, any> = {};
            pluginDefs.forEach((p: any) => {
                if (!p?.type) return;
                if (p.elements) {
                    Object.keys(p.elements).forEach((key: string) => {
                        const el = p.elements[key];
                        const nt = el?.props?.nodeType;
                        if (nt === 'inline' || nt === 'inlineVoid') {
                            inlineElements[key] = { ...el, rootPlugin: p.type };
                        }
                    });
                }
                pluginsMap[p.type] = p;
            });
            // Merge inline elements into every plugin (mirrors YooptaEditor init)
            pluginDefs.forEach((p: any) => {
                if (p?.elements) {
                    pluginsMap[p.type] = {
                        ...p,
                        elements: { ...p.elements, ...inlineElements },
                    };
                }
            });
            (editor as any).plugins = pluginsMap;

            // Build blocks map  (type → { type, elements (sans render), … })
            const blocksMap: Record<string, any> = {};
            pluginDefs.forEach((p: any) => {
                if (!p?.type || !p.elements) return;
                const rootKey = Object.keys(p.elements)[0];
                const rootEl = rootKey ? p.elements[rootKey] : undefined;
                const nodeType = rootEl?.props?.nodeType;
                if (nodeType === 'inline' || nodeType === 'inlineVoid') return;

                const elements: Record<string, any> = {};
                Object.keys(p.elements).forEach((key: string) => {
                    const { render: _render, ...rest } = p.elements[key] || {};
                    elements[key] = rest;
                });
                blocksMap[p.type] = {
                    type: p.type,
                    elements,
                    hasCustomEditor: !!p.customEditor,
                    options: p.options || {},
                };
            });
            (editor as any).blocks = blocksMap;
        } else {
            // Warm path: real editor already mounted with proper maps, so this
            // deserialize is reliable — no post-mount re-apply needed.
            usedManualPluginInitRef.current = false;
        }

        // Fall back to published_data when a non-published slide's draft `data`
        // is missing OR blank. `data` can be a non-null but empty editor wrapper
        // (e.g. an auto-save race that clobbered it, or a copied PUBLISHED doc
        // whose content lives only in published_data). A plain `data || ...`
        // would NOT fall back, because the empty wrapper is a truthy string — so
        // the slide opens blank even though the content survives in
        // published_data. checkIsHtmlEmpty detects the blank wrapper.
        const draftDocData = activeItem?.document_slide?.data;
        // Restore an unsaved LOCAL draft (stashed on a previous switch/refresh) over
        // the server content so in-progress edits are never lost on reopen.
        const restorableLocalDraft = getRestorableLocalDraftHtml(activeItem);
        const docData =
            restorableLocalDraft ??
            (activeItem?.status == 'PUBLISHED'
                ? activeItem.document_slide?.published_data || null
                : (draftDocData && !checkIsHtmlEmpty(draftDocData)
                      ? draftDocData
                      : null) ||
                  activeItem?.document_slide?.published_data ||
                  null);

        // Sanitize any public S3 URLs that may contain expired signatures
        let sanitizedDocData = stripAwsQueryParamsFromUrls(docData || '');

        // Check if content contains mermaid diagrams - they need preserved newlines
        const hasMermaid =
            sanitizedDocData.includes('class="mermaid"') ||
            sanitizedDocData.includes("class='mermaid'");

        // Extract inner content from full HTML documents (removes DOCTYPE, html, head, body wrappers)
        let contentForDeserialization = sanitizedDocData || '';

        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(contentForDeserialization, 'text/html');

            // Get body element and its inner HTML
            if (doc.body) {
                // Unwrap media/semantic elements from wrapper divs so Yoopta
                // deserializers can find them by nodeName (IFRAME, VIDEO, IMG, A).
                // Each plugin serializes as <div style="..."><element/></div>
                // but the deserializer looks for the bare element.
                const unwrapFromDiv = (el: Element) => {
                    const parent = el.parentElement;
                    if (parent && parent.tagName === 'DIV') {
                        const fragment = document.createDocumentFragment();
                        while (parent.firstChild) {
                            fragment.appendChild(parent.firstChild);
                        }
                        if (parent.parentNode) {
                            parent.parentNode.replaceChild(fragment, parent);
                        }
                    }
                };

                // Drop placeholder images (src="null" / "" / "undefined")
                // left behind by the Yoopta Image plugin when a block is
                // inserted without a successful upload. Otherwise learners
                // see broken thumbnails on older published slides until a
                // re-save sweeps them via formatHTMLString.
                doc.body.querySelectorAll('img').forEach((img) => {
                    const src = img.getAttribute('src');
                    if (src && src !== 'null' && src !== 'undefined') return;
                    const parent = img.parentElement;
                    // Only strip the wrapper div when it's clearly the
                    // Yoopta Image block container (no data-yoopta-type,
                    // no data-tab-index, etc.) holding just this img.
                    const isImageBlockWrapper =
                        parent &&
                        parent.tagName === 'DIV' &&
                        parent.children.length === 1 &&
                        parent.firstElementChild === img &&
                        !parent.hasAttribute('data-yoopta-type') &&
                        !parent.hasAttribute('data-tab-index') &&
                        !parent.hasAttribute('data-front') &&
                        !parent.hasAttribute('data-back');
                    if (isImageBlockWrapper) {
                        parent.remove();
                    } else {
                        img.remove();
                    }
                });

                doc.body.querySelectorAll('iframe').forEach(unwrapFromDiv);
                doc.body.querySelectorAll('video').forEach(unwrapFromDiv);
                doc.body.querySelectorAll('img').forEach(unwrapFromDiv);
                doc.body.querySelectorAll('a[download]').forEach(unwrapFromDiv);

                // Accordion: serializes as <div>…<details><summary/>…</details>…</div>
                // (the accordion-list wraps its items). Yoopta finds accordions by the
                // bare <details> nodeName, so lift them out of that wrapper div —
                // otherwise the buried accordion is dropped on reload and disappears.
                // Snapshot the wrapper divs (children are ALL <details>, so we don't
                // touch the outer content div) and unwrap each once.
                const accordionWrappers = new Set<Element>();
                doc.body.querySelectorAll('details').forEach((d) => {
                    const p = d.parentElement;
                    if (
                        p &&
                        p.tagName === 'DIV' &&
                        !p.hasAttribute('data-yoopta-type') &&
                        Array.from(p.children).every((c) => c.tagName === 'DETAILS')
                    ) {
                        accordionWrappers.add(p);
                    }
                });
                accordionWrappers.forEach((wrapper) => {
                    while (wrapper.firstChild) {
                        wrapper.parentNode?.insertBefore(wrapper.firstChild, wrapper);
                    }
                    wrapper.remove();
                });

                // Convert in-text newlines to <br> so Yoopta's deserializer
                // preserves line breaks in list items, paragraphs, etc.
                // Background: Yoopta's ra() strips all whitespace chars
                // from text nodes via replace(/[\t\n\r\f\v]+/g, " "), which
                // collapses soft breaks in <li>/<p>/blockquote on reload.
                // It has a special case for <BR> that yields {text: "\n"},
                // so rewriting \n → <br> here keeps the breaks through the
                // admin→learner round-trip. Skip <pre> (code block has its
                // own data-code path) and inline <code> (single-line marks).
                const convertNewlinesToBr = (node: Node) => {
                    const children = Array.from(node.childNodes);
                    for (const child of children) {
                        if (child.nodeType === 3) {
                            const raw = child.textContent || '';
                            // Normalize \r\n and lone \r to \n before splitting
                            const text = raw.replace(/\r\n?/g, '\n');
                            if (!text.includes('\n')) continue;
                            // Skip whitespace-only text nodes — those are
                            // just the formatting indentation between tags
                            // from formatHTMLString (e.g. "\n            "
                            // between <body> and <div>). Converting them
                            // to <br>s injects stray line breaks into the
                            // body root and corrupts the wrapper-unwrap
                            // logic below (it expects a single outer div).
                            if (text.trim() === '') continue;
                            const parent = child.parentNode;
                            if (!parent) continue;
                            const tag = (parent as Element).tagName;
                            if (
                                tag === 'PRE' ||
                                tag === 'CODE' ||
                                tag === 'SCRIPT' ||
                                tag === 'STYLE'
                            )
                                continue;
                            if ((parent as Element).closest?.('pre')) continue;
                            // Skip blocks whose Yoopta plugin has a custom
                            // parse built on deserializeTextNodes — that
                            // helper preserves literal \n in text nodes on
                            // its own and does NOT recognize <br>. Converting
                            // \n to <br> here turns each soft break into an
                            // empty text node, which Slate then merges —
                            // collapsing "Hello\n1.1\n1.2" into "Hello1.11.2"
                            // on Save Draft. Current denylist: lists (<li>),
                            // callouts (<dl>), the mermaid diagram (<div
                            // class="mermaid">, whose multi-line code is read via
                            // textContent — \n→<br> would collapse it to one line
                            // and break the diagram on reload), and any Yoopta
                            // custom block whose payload is load-bearing text/data
                            // (math latex, etc.).
                            if ((parent as Element).closest?.('li, dl, .mermaid, [data-yoopta-type]')) continue;
                            const parts = text.split('\n');
                            const frag = doc.createDocumentFragment();
                            parts.forEach((part, i) => {
                                if (i > 0) frag.appendChild(doc.createElement('br'));
                                if (part) frag.appendChild(doc.createTextNode(part));
                            });
                            parent.replaceChild(frag, child);
                        } else if (child.nodeType === 1) {
                            const tag = (child as Element).tagName;
                            if (tag === 'PRE' || tag === 'SCRIPT' || tag === 'STYLE') continue;
                            convertNewlinesToBr(child);
                        }
                    }
                };
                convertNewlinesToBr(doc.body);

                contentForDeserialization = doc.body.innerHTML.trim();

                // Recursively unwrap divs until we get to actual content
                // Yoopta needs semantic content like p, h1, a etc., not nested divs
                const wrapper = document.createElement('div');
                wrapper.innerHTML = contentForDeserialization;

                // Keep unwrapping single-child divs (but stop if div has
                // mermaid class or data-yoopta-type — those are content blocks)
                let current: Element = wrapper;
                while (current.children.length === 1) {
                    const firstChild = current.children[0];
                    if (
                        firstChild &&
                        firstChild.tagName === 'DIV' &&
                        !firstChild.classList.contains('mermaid') &&
                        !firstChild.hasAttribute('data-yoopta-type')
                    ) {
                        current = firstChild;
                    } else {
                        break;
                    }
                }

                // Get the final inner content
                contentForDeserialization = current.innerHTML.trim();
            }
        } catch (e) {
            console.error('Error parsing HTML for Yoopta:', e);
        }

        // Flatten semantic wrappers (<section>/<header>/nested <div>) LAST, so blocks
        // (headings/paragraphs) nested inside them survive html.deserialize instead of
        // being silently dropped. See docs/SLIDE_CONTENT_LOSS_INVESTIGATION.md.
        contentForDeserialization = flattenSemanticWrappers(contentForDeserialization || '');
        const rawEditorContent = html.deserialize(editor, contentForDeserialization || '');

        // Layer-2 load-integrity check: did html.deserialize drop any block (table,
        // image, heading, custom block) that the stored HTML contained? If so, this
        // editor state is a lossy view of the slide — record it so the save path can
        // refuse to overwrite the DB with the reduced content. Compares load INPUT vs
        // load OUTPUT, so it never fires on a genuine user edit.
        try {
            const loss = detectDeserializeLoss(
                contentForDeserialization || '',
                rawEditorContent as Record<string, unknown>
            );
            docLoadIntegrityRef.current = {
                slideId: activeItem?.id ?? null,
                lossy: loss.lossy,
                lost: loss.lost,
                imagesInsideTables: loss.imagesInsideTables,
            };
            if (loss.lossy) {
                console.error(
                    '[slide] deserialize dropped content on load — save disabled to protect it:',
                    loss.lost.join(', '),
                    'slide',
                    activeItem?.id
                );
            }
        } catch {
            docLoadIntegrityRef.current = {
                slideId: activeItem?.id ?? null,
                lossy: false,
                lost: [],
                imagesInsideTables: 0,
            };
        }

        const processNode = (node: any): any => {
            const newNode = { ...node };
            // Check if node is Embed, Video, File, or Link type
            if (
                ['Embed', 'Video', 'File', 'Link', 'embed', 'video', 'file', 'link'].includes(
                    newNode.type
                )
            ) {
                if (!newNode.data) {
                    newNode.data = { url: '', src: '' };
                }
                // Ensure url is populated (Yoopta sometimes expects url, sometimes src depending on version/plugin)
                if (!newNode.data.url && newNode.data.src) {
                    newNode.data.url = newNode.data.src;
                }
                if (!newNode.data.src && newNode.data.url) {
                    newNode.data.src = newNode.data.url;
                }
                // Fallbacks
                if (newNode.data.url === undefined) newNode.data.url = '';
                if (newNode.data.src === undefined) newNode.data.src = '';

                // For File blocks, ensure name is present and clean
                if (['File', 'file'].includes(newNode.type)) {
                    let name = newNode.data.name;

                    // 1. If name is missing, try to extract from src/url
                    if (!name) {
                        const src = newNode.data.src || newNode.data.url;
                        if (src) {
                            try {
                                const urlObj = new URL(src);
                                const parts = urlObj.pathname.split('/');
                                name = parts[parts.length - 1];
                            } catch (e) {
                                // If not a valid URL, try simple split
                                const parts = src.split('/');
                                name = parts[parts.length - 1];
                            }
                        }
                        if (!name) {
                            name = 'Attachment';
                        }
                    }

                    // 2. Clean up the name
                    if (name && typeof name === 'string') {
                        // Decode URI components (e.g. %20 -> space)
                        try {
                            name = decodeURIComponent(name);
                        } catch (e) {
                            // ignore error
                        }

                        // Remove common MIME type suffixes that might be appended (e.g. .application/pdf)
                        // This regex matches .type/subtype at the end of the string
                        name = name.replace(
                            /\.(application|image|text|video|audio|font|model)\/[\w\.\-\+]+$/,
                            ''
                        );

                        // Also remove generated timestamp prefixes if customary (optional, based on observation)
                        // name = name.replace(/^\d+-/, '');

                        newNode.data.name = name;
                    }
                }
            }

            // Guard Yoopta block `value` array — this becomes the `children` of
            // the block's internal Slate editor.  If it is empty or missing,
            // every Slate operation (Editor.start, Editor.point, …) throws
            // "Cannot get the start point … because it has no start text node."
            // That error fires inside Yoopta's own selection-sync useEffect,
            // which means our code never sees it — it just explodes on the next
            // user click.  Inject a single empty paragraph so Slate always has
            // a valid, non-empty document root.
            if (newNode.value !== undefined && Array.isArray(newNode.value)) {
                if (newNode.value.length === 0) {
                    newNode.value = [{ type: 'paragraph', children: [{ text: '' }] }];
                } else {
                    newNode.value = newNode.value.map((slateEl: any) => {
                        if (!slateEl) return { type: 'paragraph', children: [{ text: '' }] };
                        if (
                            !slateEl.children ||
                            !Array.isArray(slateEl.children) ||
                            slateEl.children.length === 0
                        ) {
                            return { ...slateEl, children: [{ text: '' }] };
                        }
                        // Heal Slate inline invariants — e.g. an empty inline
                        // <link> at the start of a heading/paragraph, which
                        // otherwise crashes the whole slide on open.
                        return { ...slateEl, children: repairSlateChildren(slateEl.children) };
                    });
                }
            }

            // Ensure inline nodes always have at least one text child.
            // This prevents Slate from throwing on selection/point lookup.
            if (newNode.children && Array.isArray(newNode.children)) {
                newNode.children = newNode.children.map((child: any) => {
                    if (!child) {
                        return { text: '' };
                    }
                    if (child.children && Array.isArray(child.children)) {
                        const normalized = processNode(child);
                        if (normalized.children.length === 0) {
                            return { ...normalized, children: [{ text: '' }] };
                        }
                        return normalized;
                    }
                    return child;
                });
                if (newNode.children.length === 0) {
                    newNode.children = [{ text: '' }];
                }
            }

            return newNode;
        };

        // Sanitize nodes to ensure mandatory properties (like url for Embed/Video/File) exist to prevent crashes
        const sanitizeNodes = (content: any): any => {
            // Handle Yoopta Map structure (Record<string, Block>)
            if (content && typeof content === 'object' && !Array.isArray(content)) {
                const newContent: Record<string, any> = {};
                Object.keys(content).forEach((key) => {
                    newContent[key] = processNode(content[key]);
                });
                return newContent;
            }
            // Fallback for arrays (e.g. if structure changes or for children processing)
            if (Array.isArray(content)) {
                return content.map(processNode);
            }
            return content;
        };

        const editorContent = sanitizeNodes(rawEditorContent);

        // Fix Embed/Video provider.type & provider.id after deserialization.
        // The @yoopta/embed deserializer sets provider.type to the hostname
        // (e.g. "www.youtube.com") and provider.id to the full URL, but the
        // render component looks up by short name ("youtube", "vimeo", …).
        // The @yoopta/video deserializer doesn't reconstruct provider at all,
        // so we detect provider from the src URL and add it back.
        if (editorContent && typeof editorContent === 'object') {
            Object.values(editorContent).forEach((block: any) => {
                if (block?.type !== 'Embed' && block?.type !== 'Video') return;
                const el = block?.value?.[0];
                if (!el?.props) return;

                // For Video blocks, reconstruct provider from src if missing
                if (block.type === 'Video' && !el.props.provider?.url && el.props.src) {
                    el.props.provider = { type: null, id: '', url: el.props.src };
                }

                const prov = el.props.provider;
                if (!prov?.url) return;
                const url = prov.url;
                const detect: [string, RegExp][] = [
                    ['youtube', /(?:youtube\.com\/(?:embed\/|watch\?v=)|youtu\.be\/)([^?&#]+)/],
                    ['vimeo', /vimeo\.com(?:\/video)?\/(\d+)/],
                    ['dailymotion', /dailymotion\.com\/(?:embed\/)?video\/([^_?&#]+)/],
                    ['loom', /loom\.com\/(?:share|embed)\/([a-zA-Z0-9]+)/],
                    ['wistia', /wistia\.(?:com|net)\/(?:embed\/iframe|medias)\/([a-zA-Z0-9]+)/],
                    ['figma', /figma\.com/],
                    ['twitter', /(?:twitter\.com|x\.com)\/.*\/status\/(\d+)/],
                    ['instagram', /instagram\.com\/(?:p|reel|tv)\/([^\/?#&]+)/],
                ];
                for (const [name, re] of detect) {
                    const m = url.match(re);
                    if (m) {
                        prov.type = name;
                        prov.id = m[1] || url;
                        break;
                    }
                }
            });
        }

        editor.setEditorValue(editorContent);

        // Clear any stale selection left over from the previous slide / paste.
        // setEditorValue replaces the entire Slate tree, but editor.selection
        // is preserved — a Point like {path:[0,1], offset:129} from the old
        // tree may not exist in the new one, and Slate's next render will
        // throw "Cannot resolve a DOM point from Slate point" from toDOMRange.
        try {
            (editor as any).selection = null;
        } catch {
            /* noop */
        }

        // Check if content is empty - use shared utility
        return checkIsHtmlEmpty(sanitizedDocData);
    };

    // Capture initial HTML for DOC slides to detect unsaved changes later.
    // IMPORTANT: We must capture AFTER Yoopta has loaded the content, because
    // html.deserialize → html.serialize is NOT a lossless round-trip.
    // If we compare raw stored HTML against Yoopta's serialized output, they
    // will always differ even with zero user edits → false positive dialog.
    const captureInitialDocSnapshot = () => {
        if (activeItem?.source_type === 'DOCUMENT' && activeItem?.document_slide?.type === 'DOC') {
            prevDocSlideRef.current = activeItem;
            // Cancel any earlier pending snapshot so a stale one can't fire after a
            // switch and write THIS editor's content into a previous slide's refs.
            if (snapshotTimeoutRef.current) clearTimeout(snapshotTimeoutRef.current);
            // Use a short delay so Yoopta finishes rendering before we snapshot
            snapshotTimeoutRef.current = setTimeout(() => {
                const editorHtml = getCurrentEditorHTMLContent();
                // SELF-HEAL for "slide opens blank until refresh": the source
                // content is non-empty but the editor ended up empty after the
                // load (deserialize raced/dropped everything). Re-apply once —
                // bounded by the per-slide flag so a genuinely empty slide or a
                // persistent failure can't loop.
                const sourceHtml =
                    (activeItem.status === 'PUBLISHED'
                        ? activeItem.document_slide?.published_data
                        : activeItem.document_slide?.data ||
                          activeItem.document_slide?.published_data) || '';
                if (
                    checkIsHtmlEmpty(editorHtml) &&
                    !checkIsHtmlEmpty(sourceHtml) &&
                    blankLoadRetrySlideIdRef.current !== activeItem.id
                ) {
                    blankLoadRetrySlideIdRef.current = activeItem.id;
                    console.error(
                        '[DOC-LOAD] editor empty after load but source has content — re-applying once.',
                        { slideId: activeItem.id, sourceLength: sourceHtml.length }
                    );
                    applyDocContentToEditor();
                    captureInitialDocSnapshot();
                    return;
                }
                initialDocHtmlRef.current = { slideId: activeItem.id, html: editorHtml };
                currentDocHtmlRef.current = { slideId: activeItem.id, html: editorHtml };
            }, 300);
        }
    };

    const setEditorContent = () => {
        const isEmpty = applyDocContentToEditor();

        // key={slide id} forces a clean editor remount per slide instead of reusing
        // the shared instance's DOM/state — the video preview below does the same.
        // Without it the reused editor can momentarily show the previous slide's
        // blocks after setEditorValue.
        setContent(<EditorWithPlaceholder key={activeItem?.id} initialIsEmpty={isEmpty} />);
        // Delay focus until after React re-renders the DOM with the new editor state.
        // Calling editor.focus() synchronously after setEditorValue causes
        // "Cannot resolve a DOM node from Slate node" because the DOM hasn't updated yet.
        // Use requestAnimationFrame + setTimeout to ensure the DOM paint has completed.
        setTimeout(() => {
            requestAnimationFrame(() => {
                try {
                    editor.focus();
                } catch (e) {
                    // Suppress focus errors — editor will still be functional
                    console.warn('Editor focus failed (DOM not ready):', e);
                }
            });
        }, 300);

        captureInitialDocSnapshot();
    };

    const getCurrentEditorHTMLContent: () => string = () => {
        // Lexical-routed DOC slide: delegate to the mounted Lexical editor's
        // getter (registered on mount). Everything downstream — SaveDraft,
        // publish, 409 retry, PDF export, switch-time stash — consumes the
        // returned HTML exactly as it does Yoopta's.
        if (activeDocIsLexicalRef.current) {
            lastSerializeDegradedRef.current = false;
            if (lexicalGetHtmlRef.current) {
                const htmlOut = lexicalGetHtmlRef.current();
                if (htmlOut && !checkIsHtmlEmpty(htmlOut)) {
                    currentDocHtmlRef.current = {
                        slideId: prevDocSlideRef.current?.id ?? activeItem?.id ?? null,
                        html: htmlOut,
                    };
                }
                return htmlOut;
            }
            // Mount window: the Lexical editor hasn't registered its getter yet.
            // Return the last-known HTML for this slide, else the stored data —
            // never fall through to Yoopta's serializer (wrong editor).
            if (
                currentDocHtmlRef.current.html &&
                currentDocHtmlRef.current.slideId ===
                    (prevDocSlideRef.current?.id ?? activeItem?.id)
            ) {
                return currentDocHtmlRef.current.html;
            }
            return (
                activeItem?.document_slide?.data ||
                activeItem?.document_slide?.published_data ||
                ''
            );
        }
        const data = editor.getEditorValue();
        // Fresh serialize — assume healthy until a fallback path proves otherwise.
        lastSerializeDegradedRef.current = false;
        try {
            let htmlString: string;
            try {
                htmlString = html.serialize(editor, data);
            } catch (wholeErr) {
                // A single block's serializer threw (e.g. timeline/columns with a
                // missing field, or a built-in callout with an unknown theme).
                // Whole-document serialize is all-or-nothing, so one bad block
                // would otherwise abort the ENTIRE Save/Publish and lose every
                // other block's content ("Could not read editor content" / a blank
                // publish). Fall back to per-block serialization and skip ONLY the
                // offending block, preserving everything else.
                console.error('[Save] whole-document serialize threw; retrying per-block', wholeErr);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const blocks = Object.values((data || {}) as Record<string, any>)
                    .filter((b) => b && b.id)
                    .sort((a, b) => (a?.meta?.order ?? 0) - (b?.meta?.order ?? 0));
                htmlString = blocks
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    .map((b: any) => {
                        try {
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            return html.serialize(editor, { [b.id]: b } as any);
                        } catch (blockErr) {
                            console.error(
                                '[Save] skipping block that failed to serialize:',
                                b?.type,
                                blockErr
                            );
                            // A block was DROPPED. Mark the result degraded so the
                            // silent auto-save-on-switch won't persist a copy that
                            // is missing this block (which would vanish its content
                            // and flip the slide to UNSYNC). Explicit Save still
                            // proceeds — but with a warning to the user.
                            lastSerializeDegradedRef.current = true;
                            return '';
                        }
                    })
                    .join('');
            }
            const formatted = formatHTMLString(htmlString);

            // ---- Save-side integrity: two independent checks ----
            // Both compare the HTML we are about to persist against a baseline that a
            // REAL user deletion would have already moved. Neither can fire on intent.
            const inBlockCount = Object.keys((data || {}) as Record<string, unknown>).length;
            const outBlockCount = countSerializedBlocks(formatted);

            // (1) Serializer dropped blocks: the editor value holds them, the HTML
            // doesn't. Catches silent drops that never throw (the per-block fallback
            // above only sees blocks whose serializer raised).
            if (inBlockCount >= 3 && outBlockCount > 0 && outBlockCount < inBlockCount * 0.5) {
                lastSerializeDegradedRef.current = true;
                console.error(
                    `[Save] serialize emitted ${outBlockCount} block(s) from an editor holding ` +
                        `${inBlockCount} — treating as degraded; refusing to overwrite stored content.`
                );
            }

            // (2) The editor VALUE itself collapsed — the case (1) is blind to, because
            // a collapsed value serializes faithfully (0 in -> 0 out, 1 in -> 1 out).
            // Seen live: a rename/slide-switch reload leaves the editor empty or
            // holding only the focused block for a window, while the screen still shows
            // the full slide. Saving in that window is what wiped published lessons
            // (58KB -> a single 3KB quiz block). Compare against the last GOOD serialize
            // of THIS slide: a real deletion lands there first via the onChange stash,
            // so this only fires when content vanished without the user touching it.
            const baselineSlideId = prevDocSlideRef.current?.id ?? activeItem?.id ?? null;
            const prevGoodHtml =
                currentDocHtmlRef.current.slideId === baselineSlideId
                    ? currentDocHtmlRef.current.html
                    : null;
            const prevGoodBlocks = prevGoodHtml ? countSerializedBlocks(prevGoodHtml) : 0;
            const collapsedVsBaseline =
                prevGoodBlocks >= 3 && outBlockCount < prevGoodBlocks * 0.5;
            if (collapsedVsBaseline) {
                lastSerializeDegradedRef.current = true;
                console.error(
                    `[Save] editor collapsed: about to write ${outBlockCount} block(s) where this ` +
                        `slide last held ${prevGoodBlocks}. Refusing — the editor is mid-reload, ` +
                        'not edited down. (rename / slide-switch race)'
                );
            }

            // Keep the last-known-good snapshot in sync so future serialize
            // failures (e.g. the Yoopta accordion "Cannot find descendant
            // at path" Slate bug) have something to fall back to. Only cache a
            // NON-empty, NON-collapsed result: a transient empty/degenerate
            // serialize (e.g. mid slide-switch) must not poison the fallback, or
            // the catch block below would itself recover reduced content.
            if (!checkIsHtmlEmpty(formatted) && !collapsedVsBaseline) {
                currentDocHtmlRef.current = {
                    slideId: baselineSlideId,
                    html: formatted,
                };
            }
            return formatted;
        } catch (error) {
            return getCurrentEditorHTMLContentFallback(error);
        }
    };

    // The serialize-threw path, extracted so the happy path can return early.
    // Behaviour unchanged from the original catch block.
    const getCurrentEditorHTMLContentFallback = (error: unknown): string => {
        console.error('Error serializing content in getCurrentEditorHTMLContent:', error);
        // Serialize blew up (typically Yoopta/Slate throwing on a
        // partially-normalized accordion/custom-block state). The value we
        // return here is a FALLBACK, not a faithful serialization of the
        // live editor — mark it degraded so no write path treats it as an
        // authoritative new version to overwrite stored data with.
        lastSerializeDegradedRef.current = true;
        // Fall back to the most recent successfully-serialized HTML
        // (captured on every onChange), then to the slide's stored
        // data. Returning '' used to land in SaveDraft's empty-guard
        // and surface "Could not read editor content" — we'd rather
        // preserve prior content than lose work.
        // Only reuse the cached HTML if it belongs to the slide currently in
        // the editor — otherwise it's a DIFFERENT slide's content, and handing
        // it back here is exactly how one slide's data bleeds into another.
        if (
            currentDocHtmlRef.current.html &&
            currentDocHtmlRef.current.slideId === (prevDocSlideRef.current?.id ?? activeItem?.id)
        ) {
            return currentDocHtmlRef.current.html;
        }
        if (activeItem?.document_slide?.data) {
            return activeItem.document_slide.data;
        }
        return '';
    };

    // Unified handler to check and handle unsaved DOC changes for the previous slide
    const handleUnsavedDocIfNeeded = useCallback(() => {
        const previous = prevDocSlideRef.current;
        if (
            !previous ||
            previous.source_type !== 'DOCUMENT' ||
            previous.document_slide?.type !== 'DOC'
        ) {
            return;
        }

        // Skip if the previous slide is deleted or no longer exists (use fresh store snapshot)
        const itemsNow = useContentStore.getState().items as unknown as Slide[] | undefined;
        const stillExists = Array.isArray(itemsNow) && itemsNow.some((s) => s.id === previous.id);
        const deletedInStore = Array.isArray(itemsNow)
            ? itemsNow.find((s) => s.id === previous.id)?.status === 'DELETED'
            : false;
        if (previous.status === 'DELETED' || deletedInStore || !stillExists) {
            return;
        }

        // Deduplicate by slide id; if we already handled this previous slide recently, skip
        if (lastHandledPrevSlideIdRef.current === previous.id) {
            return;
        }

        const initialHtml =
            initialDocHtmlRef.current.slideId === previous.id
                ? initialDocHtmlRef.current.html
                : getCurrentEditorHTMLContent();
        // Always read latest editor state at the moment of handling to avoid stale saves.
        // NORMALIZED compare (same rule as the onChange path): a no-op click adds an
        // empty paragraph, and a raw !== here would stash a phantom "unsaved" draft
        // that arms the banner/badges/leave-guard for a never-edited slide.
        const currentHtml = getCurrentEditorHTMLContent() || initialHtml;
        const hasEditorChanged =
            normalizeHtmlForDirtyCompare(currentHtml) !== normalizeHtmlForDirtyCompare(initialHtml);

        // Only act if the user actually changed something in the editor
        if (!hasEditorChanged) {
            return;
        }

        // Mark as handled to avoid duplicate calls during add+switch cascades
        lastHandledPrevSlideIdRef.current = previous.id;

        // Always auto-save draft on slide switch — never show a blocking dialog
        void autoPublishDocSlide(previous, currentHtml);
    }, [autoPublishDocSlide]);

    // Snapshot-based handler to avoid stale editor reads during transitions
    const handleUnsavedDocWithSnapshot = useCallback(
        (previous: Slide | null, snapshotHtml: string) => {
            if (
                !previous ||
                previous.source_type !== 'DOCUMENT' ||
                previous.document_slide?.type !== 'DOC'
            ) {
                return;
            }

            if (lastHandledPrevSlideIdRef.current === previous.id) {
                return;
            }

            // Skip if the previous slide is deleted or no longer exists (use fresh store snapshot)
            const itemsNow = useContentStore.getState().items as unknown as Slide[] | undefined;
            const stillExists =
                Array.isArray(itemsNow) && itemsNow.some((s) => s.id === previous.id);
            const deletedInStore = Array.isArray(itemsNow)
                ? itemsNow.find((s) => s.id === previous.id)?.status === 'DELETED'
                : false;
            if (previous.status === 'DELETED' || deletedInStore || !stillExists) {
                return;
            }

            const initialHtml =
                initialDocHtmlRef.current.slideId === previous.id
                    ? initialDocHtmlRef.current.html
                    : snapshotHtml; // fallback: treat as unchanged if we have no baseline

            // NORMALIZED compare — same reasoning as handleUnsavedDoc above.
            const hasEditorChanged =
                normalizeHtmlForDirtyCompare(snapshotHtml) !==
                normalizeHtmlForDirtyCompare(initialHtml);

            // Only act if the user actually changed something
            if (!hasEditorChanged) {
                return;
            }

            lastHandledPrevSlideIdRef.current = previous.id;

            // Always auto-save draft silently — never show a blocking dialog on slide switch
            void autoPublishDocSlide(previous, snapshotHtml);
        },
        [autoPublishDocSlide]
    );

    // On slide switch, detect unsaved changes for DOC and act based on role
    useEffect(() => {
        // Cleanup runs before switching away from this slide; capture exact editor HTML
        return () => {
            // Cancel the previous slide's pending 300ms baseline snapshot — if it
            // fired after the switch it would read the NEW editor and mislabel it
            // as this (old) slide's content.
            if (snapshotTimeoutRef.current) {
                clearTimeout(snapshotTimeoutRef.current);
                snapshotTimeoutRef.current = null;
            }
            const previous = prevDocSlideRef.current;
            if (!previous) return;
            const snapshot = getCurrentEditorHTMLContent();
            handleUnsavedDocWithSnapshot(previous, snapshot);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeItem?.id]);

    useEffect(() => {
        // Update previous ref for next transitions and reset dedup if new previous context
        if (
            activeItem?.source_type === 'DOCUMENT' &&
            activeItem?.document_slide?.type === 'DOC' &&
            activeItem?.status !== 'DELETED'
        ) {
            prevDocSlideRef.current = activeItem;
            lastHandledPrevSlideIdRef.current = null;
        }
    }, [activeItem]);

    // Handle Excalidraw onChange for auto-save - debounced database update only
    const handleExcalidrawChange = useCallback(
        async (elements: any[], appState: any, files: any, fileId?: string) => {
            if (!activeItem || activeItem.document_slide?.type !== 'PRESENTATION') return;

            // Only update database if we have a new fileId from auto-save
            if (fileId && fileId !== activeItem.document_slide?.data) {
                // Prevent infinite loops by tracking auto-save state
                if (isAutoSavingRef.current) {
                    return;
                }

                isAutoSavingRef.current = true;

                // Determine the correct status based on current state
                let newStatus = activeItem.status || 'DRAFT';

                // For non-admin users with hidePublishButtons=true, auto-publish presentations
                if (hidePublishButtons) {
                    newStatus = 'PUBLISHED';
                    console.log('🎨 Auto-publishing presentation for non-admin user');
                    // Show toast notification for auto-publish and trigger approval button
                    if (activeItem.status !== 'PUBLISHED') {
                        import('sonner').then(({ toast }) => {
                            toast.success(t('slideEditor:presentation.autoPublished'));
                        });
                        // Trigger approval button for non-admin users
                        localStorage.setItem('triggerApprovalButton', Date.now().toString());
                    }
                } else if (activeItem.status === 'PUBLISHED') {
                    // If the slide is PUBLISHED and being edited, change status to UNSYNC
                    newStatus = 'UNSYNC';
                }
                try {
                    await addUpdateDocumentSlide({
                        id: activeItem.id,
                        title: activeItem.title || '',
                        image_file_id: '',
                        description: activeItem.description || '',
                        slide_order: null,
                        document_slide: {
                            id: activeItem.document_slide?.id || '',
                            type: 'PRESENTATION',
                            data: fileId, // Store S3 file ID in data field
                            title: activeItem.document_slide?.title || '',
                            cover_file_id: '',
                            total_pages: 1,
                            published_data:
                                newStatus === 'PUBLISHED'
                                    ? fileId
                                    : activeItem.document_slide?.published_data || null, // Set published_data for non-admin auto-publish
                            published_document_total_pages: 1,
                        },
                        status: newStatus, // Use the determined status
                        new_slide: false,
                        notify: false,
                    });

                    // Update local activeItem state with the new fileId and status
                    // Only update if Excalidraw is not performing intensive operations
                    if (!isExcalidrawBusyRef.current) {
                        const updatedActiveItem = {
                            ...activeItem,
                            status: newStatus,
                            document_slide: activeItem.document_slide
                                ? {
                                      ...activeItem.document_slide,
                                      data: fileId, // Update local state with new fileId
                                      published_data:
                                          newStatus === 'PUBLISHED'
                                              ? fileId
                                              : activeItem.document_slide.published_data, // Update published_data for auto-publish
                                  }
                                : undefined,
                        };
                        setActiveItem(updatedActiveItem);
                    } else {
                        pendingStateUpdateRef.current = {
                            ...activeItem,
                            status: newStatus,
                            document_slide: activeItem.document_slide
                                ? {
                                      ...activeItem.document_slide,
                                      data: fileId,
                                      published_data:
                                          newStatus === 'PUBLISHED'
                                              ? fileId
                                              : activeItem.document_slide.published_data, // Update published_data for auto-publish
                                  }
                                : undefined,
                        };
                    }
                } catch (error) {
                    console.error('Error auto-saving Excalidraw:', error);
                } finally {
                    // Reset the flag after a short delay to allow for UI updates
                    setTimeout(() => {
                        isAutoSavingRef.current = false;
                    }, 1000);
                }
            }
        },
        [activeItem, addUpdateDocumentSlide]
    );

    // State for Admin unsaved DOC modal

    // Helper: Auto publish DOC for non-admins on slide switch/state change (hoisted function)
    async function autoPublishDocSlide(slide: Slide, htmlString: string) {
        try {
            // Final guard: ensure slide still exists and is not deleted before calling API
            const itemsNow = useContentStore.getState().items as unknown as Slide[] | undefined;
            const stillExists = Array.isArray(itemsNow) && itemsNow.some((s) => s.id === slide.id);
            const deletedInStore = Array.isArray(itemsNow)
                ? itemsNow.find((s) => s.id === slide.id)?.status === 'DELETED'
                : false;
            if (!stillExists || deletedInStore || slide.status === 'DELETED') {
                return;
            }

            // Never let an empty/blank editor serialization clobber a slide that
            // has content. Mirrors SaveDraft's empty-guard. Without this, a
            // slide-switch race (the editor is momentarily empty before its
            // content finishes loading) auto-saves the empty wrapper into `data`
            // and flips a PUBLISHED slide to UNSYNC — the slide then opens blank
            // even though the real content still lives in published_data.
            if (checkIsHtmlEmpty(htmlString)) {
                console.warn(
                    '⚠️ Skipping DOC auto-save — editor content is empty; refusing to overwrite existing slide data.'
                );
                return;
            }

            // Never let a DEGRADED serialization silently overwrite good content.
            // If the last serialize had to drop a block (its serializer threw) or
            // blew up entirely, htmlString is missing content. Auto-saving it on
            // slide switch would permanently vanish that block AND flip a
            // PUBLISHED slide to UNSYNC — the exact "data lost on switch" report.
            // Skip the silent save; the stored draft/published copy stays intact.
            // The user can still Save explicitly (which surfaces a warning).
            if (lastSerializeDegradedRef.current) {
                console.warn(
                    '⚠️ Skipping DOC auto-save — editor serialization was degraded (a block failed to serialize). ' +
                        'Refusing to overwrite stored content to avoid silently dropping that block.'
                );
                toast.warning(t('slideEditor:doc.degradedSkip'));
                return;
            }

            // Never let a catastrophically SHRUNKEN serialization overwrite good
            // content. A truncation (e.g. the S3-URL sanitizer eating a data-*
            // block, or a paste glitch) produces VALID but truncated HTML that
            // the empty/degraded guards above don't catch — a 15KB lesson can
            // collapse to a 200-byte fragment. If the new content is a small
            // fraction of what's already stored, refuse the silent auto-save so
            // the stored copy stays intact. Normal editing rarely removes >70%
            // of a slide in one go; genuine large deletions can still be saved
            // explicitly (that path surfaces a confirmation).
            const storedDocHtml = (
                slide.document_slide?.published_data ||
                slide.document_slide?.data ||
                ''
            ).trim();
            if (
                storedDocHtml.length > 1500 &&
                htmlString.trim().length < storedDocHtml.length * 0.3
            ) {
                console.warn(
                    `⚠️ Skipping DOC auto-save — new content (${htmlString.trim().length}B) is <30% of ` +
                        `stored (${storedDocHtml.length}B); refusing to overwrite (likely a truncation). ` +
                        'Reopen the slide and Save explicitly if this shrink was intentional.'
                );
                toast.warning(t('slideEditor:doc.shrunkSkip'));
                return;
            }

            // Process images in HTML content before saving
            let processedHtmlString = htmlString;
            if (containsBase64Images(htmlString)) {
                console.log('Processing base64 images in DOC content...');
                const imageSize = getBase64ImagesSize(htmlString);
                console.log(`Base64 images size: ${Math.round(imageSize / 1024)}KB`);

                const { processedHtml, uploadedImages, failedUploads } =
                    await processHtmlImages(htmlString);
                processedHtmlString = processedHtml;

                if (failedUploads > 0) {
                    toast.error(t('slideEditor:images.someFailedToUpload', { count: failedUploads }));
                }
                if (uploadedImages > 0) {
                    console.log(`Successfully processed ${uploadedImages} images`);
                }
            }

            // Autosave is gone: do NOT write to the DB or publish here. Persist the
            // edit to localStorage so it survives this slide switch / a refresh and is
            // restored when the slide reopens. The author commits it explicitly via the
            // Save draft / Publish buttons (which clear this local copy).
            stashDocDraftLocally(slide.id, processedHtmlString);
        } catch (error) {
            console.error('Error auto-publishing DOC slide:', error);
            toast.error(t('slideEditor:doc.autoSaveFailed'));
        }
    }
    interface YTPlayer {
        destroy(): void;
        getCurrentTime(): number;
        getDuration(): number;
        seekTo(seconds: number, allowSeekAhead: boolean): void;
        getPlayerState(): number;
    }

    const playerRef = useRef<YTPlayer | null>(null);

    const loadContent = async () => {
        // Did the slide identity stay the same since the last loadContent run?
        // If so this run was triggered by a non-id dep (notably activeItem.status,
        // which Save Draft flips PUBLISHED → UNSYNC), not by navigation. The DOC
        // branch uses this to avoid a destructive re-deserialize. Record the id
        // for the next run before any early return.
        const isSameSlideRerun = lastLoadContentSlideIdRef.current === activeItem?.id;
        // PLACEHOLDER activeItem: while the slides query is in flight the sidebar
        // stubs {id: slideId, source_type: ''} (slides-sidebar-slides.tsx). That
        // run renders the "No study material" fallback — recording its id would
        // make the REAL slide's arrival (same id, real source_type) look like a
        // same-slide rerun, which the DOC/HTML branches deliberately skip → the
        // slide stays blank until a full refresh. Record null instead so the real
        // data renders as a fresh load. (This was the "slide shows nothing until
        // I refresh" bug.)
        const isPlaceholderItem = activeItem != null && !activeItem.source_type;
        lastLoadContentSlideIdRef.current = isPlaceholderItem ? null : (activeItem?.id ?? null);

        if (activeItem == null) {
            setContent(
                <div className="flex h-[500px] flex-col items-center justify-center rounded-lg py-10">
                    <EmptySlideMaterial />
                    <p className="mt-4 text-neutral-500">No study material has been added yet</p>
                </div>
            );
            return;
        }

        // Check if the slide is deleted
        if (activeItem.status === 'DELETED') {
            setContent(
                <div className="flex h-[500px] flex-col items-center justify-center rounded-lg py-10">
                    <div className="text-center">
                        <div className="mb-4 flex size-16 items-center justify-center rounded-full bg-red-100">
                            <Trash size={24} className="text-red-500" />
                        </div>
                        <h3 className="mb-2 text-lg font-semibold text-slate-600">
                            {t('ui.slideDeletedTitle')}
                        </h3>
                        <p className="text-sm text-slate-400">
                            {t('ui.slideDeletedBody')}
                        </p>
                    </div>
                </div>
            );
            return;
        }

        // Handle HTML_VIDEO slides (AI-generated videos)
        if (activeItem.source_type === 'HTML_VIDEO') {
            setContent(<VideoSlidePreview key={activeItem.id} activeItem={activeItem} />);
            return;
        }

        if (activeItem.source_type === 'VIDEO') {
            // Check if this video slide is in split-screen mode
            if (activeItem.splitScreenMode && activeItem.splitScreenData) {
                setContent(
                    <SplitScreenSlide
                        splitScreenData={activeItem.splitScreenData as any}
                        slideType={
                            activeItem.splitScreenType as
                                | 'SPLIT_JUPYTER'
                                | 'SPLIT_SCRATCH'
                                | 'SPLIT_CODE'
                        }
                        isEditable={true}
                        currentSlideId={activeItem.id}
                        onDataChange={async (updatedSplitData) => {
                            // Update split-screen data locally and handle title changes
                            const projectName =
                                updatedSplitData.projectName || updatedSplitData.name;
                            const updatedSlide = {
                                ...activeItem,
                                title: projectName || activeItem.title,
                                splitScreenData: updatedSplitData,
                            };
                            setActiveItem(updatedSlide as any);

                            // Auto-save to backend for split-screen video slides
                            try {
                                const splitData = updatedSplitData as any;
                                const originalVideoData = splitData?.originalVideoData || {};

                                // Use the original video slide ID if available, otherwise use the slide ID
                                const originalVideoSlide = (activeItem as any).originalVideoSlide;
                                const videoSlideId =
                                    originalVideoSlide?.id ||
                                    originalVideoData.id ||
                                    activeItem.video_slide?.id ||
                                    crypto.randomUUID();

                                const videoSlidePayload = {
                                    id: activeItem.id,
                                    title: String(projectName || activeItem.title || ''),
                                    description: activeItem.description || '',
                                    image_file_id: activeItem.image_file_id || '',
                                    slide_order: activeItem.slide_order,
                                    video_slide: {
                                        id: videoSlideId,
                                        description:
                                            originalVideoData.description ||
                                            activeItem.description ||
                                            '',
                                        title: String(projectName || activeItem.title || ''),
                                        url: originalVideoData.url || '',
                                        video_length_in_millis:
                                            originalVideoData.video_length_in_millis || 0,
                                        published_url:
                                            originalVideoData.published_url ||
                                            originalVideoData.url ||
                                            '',
                                        published_video_length_in_millis:
                                            originalVideoData.published_video_length_in_millis || 0,
                                        source_type: originalVideoData.source_type || 'VIDEO',
                                        embedded_type: splitData?.splitType || 'SCRATCH',
                                        embedded_data: JSON.stringify(splitData || {}),
                                        questions: (originalVideoData.questions as any) || [],
                                    },
                                    status: activeItem.status,
                                    new_slide: false,
                                    notify: false,
                                };

                                await addUpdateVideoSlide(videoSlidePayload);
                                toast.success(t('slideEditor:splitScreen.savedSuccess'));
                            } catch (error) {
                                console.error('Error auto-saving split screen data:', error);
                                toast.error(t('slideEditor:splitScreen.autoSaveFailed'));
                            }
                        }}
                    />
                );
            } else {
                // Key on the URL too so editing the external link remounts the
                // player (YouTube/Vimeo) and the new link renders immediately.
                setContent(
                    <div className="flex h-full flex-col">
                        <VideoSlidePreview
                            key={`${activeItem.id}-${activeItem.video_slide?.url ?? ''}`}
                            activeItem={activeItem}
                        />
                        {/* Live AI Tutor: the only way a video slide can be taught. */}
                        {!isLearnerView && <TeachingDescriptionCard slideId={activeItem.id} kind="video" />}
                    </div>
                );
            }

            return;
        }

        // ✅ Handle ASSIGNMENT slides (check source_type first)
        if (activeItem.source_type === 'ASSIGNMENT') {
            try {
                if (!activeItem.assignment_slide) {
                    console.warn('[Assignment] No assignment_slide data found, showing fallback');
                    setContent(
                        <div className="flex h-[500px] flex-col items-center justify-center rounded-lg py-10">
                            <div className="text-center">
                                <h3 className="mb-2 text-lg font-semibold">Assignment Loading</h3>
                                <p className="text-gray-600">Assignment data is being loaded...</p>
                            </div>
                        </div>
                    );
                    return;
                }

                setContent(
                    <StudyLibraryAssignmentPreview key={activeItem.id} activeItem={activeItem} />
                );
            } catch (error) {
                console.error('Error rendering assignment preview:', error);
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                setContent(
                    <div className="flex h-[500px] flex-col items-center justify-center rounded-lg py-10">
                        <div className="text-center">
                            <h3 className="mb-2 text-lg font-semibold text-red-600">
                                {t('ui.assignmentError')}
                            </h3>
                            <p className="text-gray-600">
                                {t('ui.assignmentLoadFailed', { message: errorMessage })}
                            </p>
                        </div>
                    </div>
                );
            }
            return;
        }

        if (activeItem.source_type === 'DOCUMENT') {
            const documentType = activeItem.document_slide?.type;

            // Reset stableKeyRef when not on a presentation slide
            if (documentType !== 'PRESENTATION') {
                stableKeyRef.current = '';
            }

            if (documentType === 'PRESENTATION') {
                // Get the appropriate fileId based on status and learner view
                const fileId = isLearnerView
                    ? activeItem.document_slide?.published_data
                    : activeItem.status === 'PUBLISHED'
                      ? activeItem.document_slide?.published_data
                      : // Draft (UNSYNC) with a null draft `data` but valid
                        // published_data → show the published deck instead of a
                        // blank canvas (see PDF branch for the full rationale).
                        activeItem.document_slide?.data ||
                        activeItem.document_slide?.published_data;
                // Only set a new key if the id changes
                if (!stableKeyRef.current || !stableKeyRef.current.includes(activeItem.id)) {
                    stableKeyRef.current = `slide-editor-${activeItem.id}-${Date.now()}`;
                }

                setContent(
                    <div className="relative z-30 size-full">
                        <Suspense
                            fallback={
                                <div className="flex aspect-[4/3] w-full items-center justify-center border bg-slate-50">
                                    <div className="flex flex-col items-center">
                                        <div className="mx-auto mb-2 h-8 w-8 animate-spin rounded-full border-b-2 border-primary-600"></div>
                                        <span className="text-sm text-slate-500">
                                            {t('ui.loadingEditor')}
                                        </span>
                                    </div>
                                </div>
                            }
                        >
                            <SlideEditor
                                key={stableKeyRef.current} // Use stable key during operations
                                slideId={activeItem.id}
                                initialData={{
                                    elements: [],
                                    files: {},
                                    appState: {},
                                }}
                                fileId={fileId || undefined}
                                onChange={handleExcalidrawChange}
                                editable={!isLearnerView && activeItem.status !== 'PUBLISHED'}
                                isSaving={isSaving}
                                onEditorReady={(state) => {
                                    getCurrentExcalidrawStateRef.current = state;
                                }}
                                onBusyStateChange={(isBusy) => {
                                    const wasBusy = isExcalidrawBusyRef.current;
                                    isExcalidrawBusyRef.current = isBusy;

                                    // If operation just completed and we have a pending update, apply it
                                    if (wasBusy && !isBusy && pendingStateUpdateRef.current) {
                                        const pendingUpdate = pendingStateUpdateRef.current;
                                        setActiveItem(pendingUpdate);
                                        pendingStateUpdateRef.current = null;
                                        // Keep stable key unchanged to prevent component rebuilds
                                    }
                                }}
                            />
                        </Suspense>
                    </div>
                );
                return;
            }

            if (documentType === 'PPT_ANIM') {
                // .pptx converted to build-step snapshots; data/published_data holds
                // the deck base URL (manifest.json lives at <base>/manifest.json).
                const deckBase = isLearnerView
                    ? activeItem.document_slide?.published_data || ''
                    : activeItem.status === 'PUBLISHED'
                      ? activeItem.document_slide?.published_data || ''
                      : // Draft (UNSYNC) with a null draft `data` but valid
                        // published_data → play the published deck instead of an
                        // empty base (see PDF branch for the full rationale).
                        activeItem.document_slide?.data ||
                        activeItem.document_slide?.published_data ||
                        '';
                setContent(
                    <div className="size-full">
                        <DeckPlayer baseUrl={deckBase} />
                    </div>
                );
                return;
            }

            if (documentType === 'PDF') {
                // A draft (UNSYNC) slide can have a null draft `data` while still
                // holding a valid `published_data` (e.g. it was published, then a
                // metadata-only edit flipped status to UNSYNC without uploading a
                // new draft file). Fall back to the published file so the admin
                // sees the live PDF instead of an empty viewer that crashes
                // pdf.js ("Invalid parameter object: need either .data, .range or
                // .url"). Learners already use published_data, which is why only
                // the admin view broke.
                const data = isLearnerView
                    ? activeItem.document_slide?.published_data || null
                    : activeItem.status === 'PUBLISHED'
                      ? activeItem.document_slide?.published_data || null
                      : activeItem.document_slide?.data ||
                        activeItem.document_slide?.published_data ||
                        '';

                const url = await getPublicUrl(data || '');
                setContent(
                    <div className="flex h-full flex-col">
                        <Suspense
                            fallback={<div className="h-full w-full animate-pulse bg-gray-100" />}
                        >
                            <PDFViewer pdfUrl={url} />
                        </Suspense>
                        {/* Live AI Tutor: the only way a PDF slide can be taught. */}
                        {!isLearnerView && <TeachingDescriptionCard slideId={activeItem.id} kind="pdf" />}
                    </div>
                );
                return;
            }

            if (documentType === 'JUPYTER') {
                try {
                    // In learner view, always use published_data, otherwise use existing logic
                    const rawData = isLearnerView
                        ? activeItem.document_slide?.published_data ||
                          activeItem.document_slide?.data
                        : activeItem.status === 'PUBLISHED'
                          ? activeItem.document_slide?.data ||
                            activeItem.document_slide?.published_data
                          : // Draft (UNSYNC) with null draft `data` falls back to
                            // published_data so the published notebook shows.
                            activeItem.document_slide?.data ||
                            activeItem.document_slide?.published_data;

                    const notebookData = rawData
                        ? JSON.parse(rawData)
                        : { contentUrl: '', projectName: '' };

                    setContent(
                        <JupyterNotebookSlide
                            notebookData={notebookData}
                            // Allow editing even in PUBLISHED for non-learner
                            isEditable={!isLearnerView}
                            onDataChange={async (updatedNotebookData) => {
                                // Only allow data changes if not in learner view
                                if (isLearnerView) return;

                                // Save the notebook data to backend
                                try {
                                    const wasPublished = activeItem.status === 'PUBLISHED';
                                    const nextStatus = 'PUBLISHED';
                                    await addUpdateDocumentSlide({
                                        id: activeItem.id,
                                        title:
                                            updatedNotebookData.projectName ||
                                            activeItem.title ||
                                            '',
                                        image_file_id: '',
                                        description: activeItem.description || '',
                                        slide_order: null,
                                        document_slide: {
                                            id: activeItem.document_slide?.id || '',
                                            type: 'JUPYTER',
                                            data: JSON.stringify(updatedNotebookData),
                                            title:
                                                updatedNotebookData.projectName ||
                                                activeItem.document_slide?.title ||
                                                '',
                                            cover_file_id: '',
                                            total_pages: 1,
                                            published_data: JSON.stringify(updatedNotebookData),
                                            published_document_total_pages: 1,
                                        },
                                        status: nextStatus,
                                        new_slide: false,
                                        notify: false,
                                    });

                                    // Update activeItem with new title and data
                                    const updatedActiveItem = {
                                        ...activeItem,
                                        status: nextStatus,
                                        title: updatedNotebookData.projectName || activeItem.title,
                                        document_slide: activeItem.document_slide
                                            ? {
                                                  ...activeItem.document_slide,
                                                  title:
                                                      updatedNotebookData.projectName ||
                                                      activeItem.document_slide.title,
                                                  data: JSON.stringify(updatedNotebookData),
                                              }
                                            : undefined,
                                    };
                                    setActiveItem(updatedActiveItem);

                                    // On first configure, trigger approval UI and toast
                                    if (!wasPublished) {
                                        localStorage.setItem(
                                            'triggerApprovalButton',
                                            Date.now().toString()
                                        );
                                        toast.success(t('slideEditor:slide.autoPublished'));
                                    }

                                    // Re-render by reloading content with fresh store data
                                    // (avoids recursive callback nesting that closes over stale activeItem)
                                    loadContent();
                                } catch (error) {
                                    console.error('Error saving Jupyter notebook data:', error);
                                    toast.error(t('slideEditor:notebook.saveFailed'));
                                }
                            }}
                        />
                    );
                } catch (error) {
                    console.error('Error loading Jupyter notebook:', error);
                    setContent(<div>Error loading Jupyter notebook</div>);
                }
                return;
            }

            if (documentType === 'SCRATCH') {
                try {
                    // Fallback: first check data field, then published_data for published slides
                    const rawData =
                        activeItem.status === 'PUBLISHED'
                            ? activeItem.document_slide?.data ||
                              activeItem.document_slide?.published_data
                            : // Draft (UNSYNC) with null draft `data` falls back
                              // to published_data so the published project shows.
                              activeItem.document_slide?.data ||
                              activeItem.document_slide?.published_data;

                    const scratchData = rawData
                        ? JSON.parse(rawData)
                        : { projectId: '', projectName: '', scratchUrl: '', timestamp: Date.now() };

                    setContent(
                        <ScratchProjectSlide
                            scratchData={scratchData}
                            // Allow editing even in PUBLISHED when non-admin flow hides publish buttons
                            isEditable={!isLearnerView && (hidePublishButtons || true)}
                            onDataChange={async (updatedScratchData) => {
                                // Save the scratch data to backend
                                try {
                                    const wasPublished = activeItem.status === 'PUBLISHED';
                                    const nextStatus = 'PUBLISHED';
                                    await addUpdateDocumentSlide({
                                        id: activeItem.id,
                                        title:
                                            updatedScratchData.projectName ||
                                            activeItem.title ||
                                            '',
                                        image_file_id: '',
                                        description: activeItem.description || '',
                                        slide_order: null,
                                        document_slide: {
                                            id: activeItem.document_slide?.id || '',
                                            type: 'SCRATCH',
                                            data: JSON.stringify(updatedScratchData),
                                            title:
                                                updatedScratchData.projectName ||
                                                activeItem.document_slide?.title ||
                                                '',
                                            cover_file_id: '',
                                            total_pages: 1,
                                            published_data: JSON.stringify(updatedScratchData),
                                            published_document_total_pages: 1,
                                        },
                                        status: nextStatus,
                                        new_slide: false,
                                        notify: false,
                                    });

                                    // Update activeItem with new title and data
                                    const updatedActiveItem = {
                                        ...activeItem,
                                        status: nextStatus,
                                        title: updatedScratchData.projectName || activeItem.title,
                                        document_slide: activeItem.document_slide
                                            ? {
                                                  ...activeItem.document_slide,
                                                  title:
                                                      updatedScratchData.projectName ||
                                                      activeItem.document_slide.title,
                                                  data: JSON.stringify(updatedScratchData),
                                              }
                                            : undefined,
                                    };
                                    setActiveItem(updatedActiveItem);

                                    // On first configure, trigger approval UI and toast
                                    if (!wasPublished) {
                                        localStorage.setItem(
                                            'triggerApprovalButton',
                                            Date.now().toString()
                                        );
                                        toast.success(t('slideEditor:slide.autoPublished'));
                                    }

                                    // Re-render by reloading content with fresh store data
                                    // (avoids recursive callback nesting that closes over stale activeItem)
                                    loadContent();
                                } catch (error) {
                                    console.error('Error saving Scratch project data:', error);
                                    toast.error(t('slideEditor:scratch.saveFailed'));
                                }
                            }}
                        />
                    );
                } catch (error) {
                    console.error('Error loading Scratch project:', error);
                    setContent(<div>Error loading Scratch project</div>);
                }
                return;
            }

            if (documentType === 'CODE') {
                try {
                    // Fallback: first check data field, then published_data for published slides
                    const rawData =
                        activeItem.status === 'PUBLISHED'
                            ? activeItem.document_slide?.data ||
                              activeItem.document_slide?.published_data
                            : // Draft (UNSYNC) with null draft `data` falls back
                              // to published_data so the published code shows.
                              activeItem.document_slide?.data ||
                              activeItem.document_slide?.published_data;

                    const codeData = rawData
                        ? JSON.parse(rawData)
                        : { language: 'python', code: '', theme: 'light' };

                    setContent(
                        <CodeEditorSlide
                            key={`code-editor-${activeItem.id}`}
                            codeData={codeData}
                            // Allow editing even in PUBLISHED when non-admin flow hides publish buttons
                            isEditable={!isLearnerView && (hidePublishButtons || true)}
                            onDataChange={async (updatedCodeData) => {
                                // Update the slide data when user changes code
                                try {
                                    await addUpdateDocumentSlide({
                                        id: activeItem.id,
                                        title: activeItem.title || '',
                                        image_file_id: '',
                                        description: activeItem.description || '',
                                        slide_order: null,
                                        document_slide: {
                                            id: activeItem.document_slide?.id || '',
                                            type: 'CODE',
                                            data: JSON.stringify(updatedCodeData),
                                            title: activeItem.document_slide?.title || '',
                                            cover_file_id: '',
                                            total_pages: 1,
                                            published_data:
                                                hidePublishButtons ||
                                                activeItem.status === 'PUBLISHED'
                                                    ? JSON.stringify(updatedCodeData)
                                                    : null,
                                            published_document_total_pages: 1,
                                        },
                                        status: activeItem.status,
                                        new_slide: false,
                                        notify: false,
                                    });

                                    // Update the activeItem data to reflect the changes in local state
                                    setActiveItem({
                                        ...activeItem,
                                        document_slide: activeItem.document_slide
                                            ? {
                                                  ...activeItem.document_slide,
                                                  data: JSON.stringify(updatedCodeData),
                                              }
                                            : undefined,
                                    });
                                } catch (error) {
                                    console.error('Error saving code editor data:', error);
                                    toast.error(t('slideEditor:code.saveFailed'));
                                }
                            }}
                        />
                    );
                } catch (error) {
                    console.error('Error loading Code editor:', error);
                    setContent(<div>Error loading Code editor</div>);
                }
                return;
            }

            // Handle split-screen slides
            if (documentType?.startsWith('SPLIT_')) {
                try {
                    // Fallback: first check data field, then published_data for published slides
                    const rawData =
                        activeItem.status === 'PUBLISHED'
                            ? activeItem.document_slide?.data ||
                              activeItem.document_slide?.published_data
                            : // Draft (UNSYNC) with null draft `data` falls back
                              // to published_data so the published split shows.
                              activeItem.document_slide?.data ||
                              activeItem.document_slide?.published_data;

                    const splitScreenData = rawData
                        ? JSON.parse(rawData)
                        : { splitScreen: true, videoSlideId: '', timestamp: Date.now() };

                    // Use regular import since it's already imported at the top
                    setContent(
                        <SplitScreenSlide
                            splitScreenData={splitScreenData}
                            slideType={
                                documentType as 'SPLIT_JUPYTER' | 'SPLIT_SCRATCH' | 'SPLIT_CODE'
                            }
                            isEditable={true}
                            currentSlideId={activeItem.id}
                            onDataChange={async (updatedSplitData) => {
                                try {
                                    await addUpdateDocumentSlide({
                                        id: activeItem.id,
                                        title: activeItem.title || '',
                                        image_file_id: '',
                                        description: activeItem.description || '',
                                        slide_order: null,
                                        document_slide: {
                                            id:
                                                activeItem.document_slide?.id ||
                                                crypto.randomUUID(),
                                            type: documentType,
                                            data: JSON.stringify(updatedSplitData),
                                            title: activeItem.document_slide?.title || '',
                                            cover_file_id: '',
                                            total_pages: 1,
                                            published_data: null,
                                            published_document_total_pages: 1,
                                        },
                                        status: activeItem.status,
                                        new_slide: false,
                                        notify: false,
                                    });

                                    // Update active item
                                    setActiveItem({
                                        ...activeItem,
                                        document_slide: activeItem.document_slide
                                            ? {
                                                  ...activeItem.document_slide,
                                                  data: JSON.stringify(updatedSplitData),
                                              }
                                            : undefined,
                                    });
                                } catch (error) {
                                    console.error('Error saving split screen data:', error);
                                    toast.error(t('slideEditor:splitScreen.saveFailed'));
                                }
                            }}
                        />
                    );
                } catch (error) {
                    console.error('Error parsing split screen data:', error);
                    // Show error message with option to retry
                    setContent(
                        <div className="flex h-full items-center justify-center p-6">
                            <div className="text-center">
                                <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-red-100">
                                    <AlertCircle className="size-8 text-red-600" />
                                </div>
                                <h3 className="mb-2 text-lg font-semibold">
                                    {t('ui.splitScreenLoadingError')}
                                </h3>
                                <p className="mb-4 text-gray-600">
                                    {t('ui.splitScreenLoadingErrorBody')}
                                </p>
                                <MyButton
                                    buttonType="primary"
                                    scale="medium"
                                    onClick={() => loadContent()}
                                    className="mr-2"
                                >
                                    {t('ui.retry')}
                                </MyButton>
                                <MyButton
                                    buttonType="secondary"
                                    scale="medium"
                                    onClick={() =>
                                        setContent(
                                            <div className="flex h-[400px] items-center justify-center text-gray-500">
                                                {t('ui.splitScreenUnavailable')}
                                            </div>
                                        )
                                    }
                                >
                                    {t('ui.showFallback')}
                                </MyButton>
                            </div>
                        </div>
                    );
                }
                return;
            }

            // 'HTML' — the Tiptap-based document type. Content is a plain HTML
            // string, so no Yoopta deserialize/plugin machinery is involved.
            if (documentType === HTML_DOC_TYPE) {
                // Same-slide re-run (e.g. autosave flipped status DRAFT→UNSYNC,
                // a loadContent dep): the mounted editor already holds the
                // user's live edits — remounting would revert them.
                if (isSameSlideRerun) return;
                htmlDocRef.current = { slideId: activeItem.id, html: null };
                setContent(
                    <HtmlDocAiAuthor
                        key={activeItem.id}
                        slide={activeItem}
                        isLearnerView={isLearnerView}
                        onHtmlChange={handleHtmlDocChange}
                    />
                );
                return;
            }

            // 🔁 Then handle DOC
            if (documentType === 'DOC') {
                // Same slide, non-navigation re-run (e.g. Save Draft flipped
                // status PUBLISHED → UNSYNC via the post-save slides refetch).
                // The editor already holds this slide with the user's live
                // bold/colour edits — re-deserializing would revert them. Keep
                // the editor as-is and just advance the unsaved-changes baseline
                // to the latest (now-saved) HTML so a later slide switch doesn't
                // auto-save identical content again. (Shared by both editors.)
                if (isSameSlideRerun) {
                    if (
                        currentDocHtmlRef.current.html &&
                        currentDocHtmlRef.current.slideId === activeItem.id
                    ) {
                        initialDocHtmlRef.current = {
                            slideId: activeItem.id,
                            html: currentDocHtmlRef.current.html,
                        };
                    }
                    return;
                }

                // Marker-based editor routing: docs whose stored HTML carries
                // data-editor="lexical" open in the Lexical editor; everything
                // else stays on the (deprecated, frozen) Yoopta path. Detection
                // checks ALL content sources — a new Lexical doc's marker-only
                // `data` reads as "empty" to checkIsHtmlEmpty, so precedence-
                // based detection would misroute it into Yoopta and the first
                // Yoopta save would erase the marker permanently.
                const restorableDraft = getRestorableLocalDraftHtml(activeItem);
                if (isLexicalDocSlide(activeItem, restorableDraft)) {
                    activeDocIsLexicalRef.current = true;
                    // New editor instance incoming — drop the previous one's getter
                    // so the mount-window fallback (stored data) is used instead of
                    // another slide's editor state.
                    lexicalGetHtmlRef.current = null;
                    const slideForThisLoad = activeItem;
                    // Same content-source precedence as applyDocContentToEditor:
                    // restorable local draft → published (when PUBLISHED) → non-empty
                    // draft data → published fallback; final fallback = blank Lexical doc.
                    const draftData = slideForThisLoad.document_slide?.data;
                    const docData =
                        restorableDraft ??
                        ((slideForThisLoad.status === 'PUBLISHED'
                            ? slideForThisLoad.document_slide?.published_data
                            : (draftData && !checkIsHtmlEmpty(draftData) ? draftData : null) ||
                              slideForThisLoad.document_slide?.published_data) ||
                            null);
                    const initialHtml =
                        docData ||
                        draftData ||
                        slideForThisLoad.document_slide?.published_data ||
                        formatHTMLString(EMPTY_LEXICAL_INNER);
                    setContent(
                        <Suspense
                            fallback={
                                <div className="flex items-center justify-center p-8">
                                    <Loader2 className="size-8 animate-spin text-primary-500" />
                                </div>
                            }
                        >
                            <LexicalDocumentEditor
                                key={slideForThisLoad.id}
                                slideId={slideForThisLoad.id}
                                initialHtml={initialHtml}
                                readOnly={isLearnerView}
                                registerHtmlGetter={(fn) => {
                                    lexicalGetHtmlRef.current = fn;
                                }}
                                onReady={(roundTrippedHtml, lostTypes) => {
                                    // Mirror of captureInitialDocSnapshot: the post-import
                                    // round-trip is the only stable unsaved-changes baseline.
                                    prevDocSlideRef.current = slideForThisLoad;
                                    initialDocHtmlRef.current = {
                                        slideId: slideForThisLoad.id,
                                        html: roundTrippedHtml,
                                    };
                                    currentDocHtmlRef.current = {
                                        slideId: slideForThisLoad.id,
                                        html: roundTrippedHtml,
                                    };
                                    // Feed the existing Layer-2 publish/save guard. Lexical has
                                    // no images-inside-tables loss mode (that's Yoopta-specific).
                                    docLoadIntegrityRef.current = {
                                        slideId: slideForThisLoad.id,
                                        lossy: lostTypes.length > 0,
                                        lost: lostTypes,
                                        imagesInsideTables: 0,
                                    };
                                }}
                                onDebouncedHtml={(serializedHtml) => {
                                    currentDocHtmlRef.current = {
                                        slideId: slideForThisLoad.id,
                                        html: serializedHtml,
                                    };
                                    // Only stash a REAL edit (vs the load baseline), same as
                                    // the Yoopta onChange — otherwise merely opening a slide
                                    // would mark it dirty.
                                    const initialForThisSlide =
                                        initialDocHtmlRef.current.slideId === slideForThisLoad.id
                                            ? initialDocHtmlRef.current.html
                                            : null;
                                    const isRealEdit =
                                        initialForThisSlide !== null &&
                                        serializedHtml !== initialForThisSlide;
                                    if (
                                        serializedHtml &&
                                        !checkIsHtmlEmpty(serializedHtml) &&
                                        isRealEdit
                                    ) {
                                        stashDocDraftLocally(
                                            slideForThisLoad.id,
                                            serializedHtml,
                                            false
                                        );
                                    }
                                }}
                            />
                        </Suspense>
                    );
                    return;
                }
                activeDocIsLexicalRef.current = false;

                try {
                    // Single call — the focus() inside is already deferred via setTimeout
                    setEditorContent();
                } catch (error) {
                    console.error('Error preparing document content:', error);
                    setContent(<div>Error loading document content</div>);
                }
                return;
            }
        }

        if (
            activeItem.source_type?.toUpperCase() === 'QUIZ' ||
            activeItem.id?.startsWith('quiz-')
        ) {
            try {
                // For question slides, we don't need to parse data as it's already structured
                setContent(
                    <QuizPreview
                        activeItem={activeItem}
                        routeParams={{
                            chapterId,
                            moduleId,
                            subjectId,
                            sessionId,
                            courseId,
                            levelId,
                        }}
                    />
                );
            } catch (error) {
                console.error('Error loading quiz questions:', error);
                setContent(<div>Error loading quiz questions</div>);
            }
            return;
        }

        if (activeItem.source_type?.toUpperCase() === 'QUESTION') {
            setContent(
                <StudyLibraryQuestionsPreview key={activeItem.id} activeItem={activeItem} />
            );
            return;
        }

        // Handle AUDIO slides
        if (activeItem.source_type?.toUpperCase() === 'AUDIO') {
            setContent(
                <AudioSlidePreview
                    key={activeItem.id}
                    activeItem={activeItem}
                    isLearnerView={isLearnerView}
                />
            );
            return;
        }

        // Handle SCORM slides
        if (activeItem.source_type?.toUpperCase() === 'SCORM') {
            setContent(
                <ScormSlidePreview
                    key={activeItem.id}
                    activeItem={activeItem}
                    isLearnerView={isLearnerView}
                />
            );
            return;
        }

        // Handle ASSESSMENT slides (assessment linked to a slide)
        if (activeItem.source_type?.toUpperCase() === 'ASSESSMENT') {
            setContent(
                <AssessmentSlidePreview
                    key={activeItem.id}
                    activeItem={activeItem}
                    isLearnerView={isLearnerView}
                />
            );
            return;
        }

        // Fallback
        setContent(
            <div className="flex h-[500px] flex-col items-center justify-center rounded-lg py-10">
                <EmptySlideMaterial />
                <p className="mt-4 text-neutral-500">No study material has been added yet</p>
            </div>
        );
    };

    /**
     * Persist an 'HTML' (Tiptap) document slide. Draft-only semantics: a
     * PUBLISHED slide flips to UNSYNC (the published snapshot is preserved) —
     * publishing is always an explicit action.
     * silent=true (autosave) never toasts and skips the 409 confirm dialog;
     * the explicit Save Draft path surfaces both.
     */
    const saveHtmlDocDraft = async (
        slide: Slide,
        htmlString: string,
        { silent }: { silent: boolean }
    ): Promise<boolean> => {
        if (!htmlString || isHtmlDocEmpty(htmlString)) {
            if (!silent) toast.error(t('slideEditor:doc.readError'));
            return false;
        }
        const status =
            slide.status === 'PUBLISHED' || slide.status === 'UNSYNC' ? 'UNSYNC' : 'DRAFT';

        // Same base64-image hoisting as the DOC path — pasted images become
        // S3 files so the stored HTML stays lean.
        let processedHtmlString = htmlString;
        if (containsBase64Images(htmlString)) {
            const { processedHtml, failedUploads } = await processHtmlImages(htmlString);
            processedHtmlString = processedHtml;
            if (failedUploads > 0 && !silent) {
                toast.error(t('slideEditor:images.someFailedToUpload', { count: failedUploads }));
            }
        }

        const doSave = (force: boolean) =>
            addUpdateDocumentSlide({
                id: slide.id,
                title: slide.title || '',
                image_file_id: '',
                description: slide.description || '',
                slide_order: null,
                document_slide: {
                    id: slide.document_slide?.id || '',
                    type: HTML_DOC_TYPE,
                    data: processedHtmlString,
                    title: slide.document_slide?.title || '',
                    cover_file_id: '',
                    total_pages: estimatePageCount(processedHtmlString),
                    // Preserve the published snapshot — a draft save must never
                    // wipe the last-published content.
                    published_data: slide.document_slide?.published_data || null,
                    published_document_total_pages:
                        slide.document_slide?.published_document_total_pages || 1,
                    force_overwrite: force,
                },
                status,
                new_slide: false,
                notify: false,
            });

        try {
            await doSave(false);
            return true;
        } catch (error) {
            const response = (
                error as {
                    response?: { status?: number; data?: { ex?: string; message?: string } };
                }
            )?.response;
            const serverMessage = response?.data?.ex || response?.data?.message;
            if (response?.status === 409 && serverMessage) {
                if (silent) {
                    // Autosave never force-overwrites — the explicit Save
                    // button will surface the confirm dialog.
                    console.warn('[html-doc] autosave blocked by content guard:', serverMessage);
                    return false;
                }
                const confirmed = window.confirm(
                    `To prevent accidental data loss, please confirm.\n\n${serverMessage}\n\nAre you sure you want to continue and save?`
                );
                if (!confirmed) return false;
                await doSave(true);
                return true;
            }
            if (!silent) toast.error(serverMessage || t('slideEditor:slide.saveErrorGeneric'));
            else console.error('[html-doc] autosave failed:', error);
            return false;
        }
    };

    // onChange from HtmlDocAiAuthor: stash latest HTML + schedule the debounced
    // autosave. The slide object is captured at schedule time so a pending
    // save can never write into a different (newly-selected) slide.
    const handleHtmlDocChange = useCallback(
        (slideId: string, htmlString: string) => {
            htmlDocRef.current = { slideId, html: htmlString };
            if (isLearnerView) return;
            const slideForSave = useContentStore
                .getState()
                .items?.find((s) => s.id === slideId) as Slide | undefined;
            if (htmlDocAutosaveTimerRef.current) clearTimeout(htmlDocAutosaveTimerRef.current);
            htmlDocAutosaveTimerRef.current = setTimeout(() => {
                const target =
                    slideForSave ??
                    ((useContentStore.getState().activeItem?.id === slideId
                        ? useContentStore.getState().activeItem
                        : null) as Slide | null);
                if (!target || target.document_slide?.type !== HTML_DOC_TYPE) return;
                void saveHtmlDocDraft(target, htmlString, { silent: true });
            }, 4000);
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [isLearnerView]
    );

    // Clear any pending HTML-doc autosave on unmount.
    useEffect(() => {
        return () => {
            if (htmlDocAutosaveTimerRef.current) clearTimeout(htmlDocAutosaveTimerRef.current);
        };
    }, []);

    const SaveDraft = async (slideToSave?: Slide | null) => {
        setIsSaving(true);
        // Pessimistic until a branch actually persists: SaveDraft swallows most
        // failures (guard refusals, declined 409 confirm, network errors) with a
        // toast but NO throw, so callers can't infer success from "didn't throw".
        // Draft-clearing MUST key off this ref, not heuristics — clearing after
        // a refused save deletes the browser's only copy of the edits.
        lastSaveDraftOutcomeRef.current = 'failure';
        try {
            const slide = slideToSave ? slideToSave : activeItem;
            // Determine the correct status based on slide type and current state
            let status: string;
            if (
                slide?.source_type === 'DOCUMENT' &&
                slide?.document_slide?.type === 'PRESENTATION'
            ) {
                // For presentations, use the same logic as auto-save
                status = slide?.status || 'DRAFT';
                if (slide?.status === 'PUBLISHED') {
                    status = 'UNSYNC';
                }
            } else {
                // For other slide types, use the original logic
                status = slide
                    ? slide.status == 'PUBLISHED'
                        ? 'UNSYNC'
                        : slide.status == 'UNSYNC'
                          ? 'UNSYNC'
                          : 'DRAFT'
                    : 'DRAFT';
            }

            if (activeItem?.source_type == 'ASSIGNMENT') {
                const convertedData = converDataToAssignmentFormat({
                    activeItem,
                    status,
                    notify: false,
                    newSlide: false,
                });
                try {
                    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                    // @ts-expect-error
                    await updateAssignmentOrder(convertedData!);
                    toast.success(t('slideEditor:slide.savedDraft'));
                } catch {
                    toast.error(t('slideEditor:slide.publishErrorGeneric'));
                }
                return;
            }

            if (activeItem?.source_type == 'VIDEO' && activeItem?.splitScreenMode) {
                const splitData = activeItem.splitScreenData as any;
                const projectName = splitData?.projectName || splitData?.name || activeItem.title;
                const originalVideoData = splitData?.originalVideoData || {};

                // Use the original video slide ID if available, otherwise use the slide ID
                const originalVideoSlide = (activeItem as any).originalVideoSlide;
                const videoSlideId =
                    originalVideoSlide?.id ||
                    originalVideoData.id ||
                    activeItem.video_slide?.id ||
                    crypto.randomUUID();

                const videoSlidePayload = {
                    id: activeItem.id,
                    title: projectName || activeItem.title || '',
                    description: activeItem.description || '',
                    image_file_id: activeItem.image_file_id || '',
                    slide_order: activeItem.slide_order,
                    video_slide: {
                        id: videoSlideId,
                        description: originalVideoData.description || activeItem.description || '',
                        title: projectName || activeItem.title || '',
                        url: originalVideoData.url || '',
                        video_length_in_millis: originalVideoData.video_length_in_millis || 0,
                        published_url:
                            originalVideoData.published_url || originalVideoData.url || '',
                        published_video_length_in_millis:
                            originalVideoData.published_video_length_in_millis || 0,
                        source_type: originalVideoData.source_type || 'VIDEO',
                        embedded_type: splitData?.splitType || 'JUPYTER',
                        embedded_data: JSON.stringify(splitData || {}),
                        questions: (originalVideoData.questions as any) || [],
                    },
                    status: status,
                    new_slide: false,
                    notify: false,
                };
                try {
                    await addUpdateVideoSlide(videoSlidePayload);
                    toast.success(t('slideEditor:splitScreen.slideSavedSuccess'));

                    // Update the local state to reflect saved changes and clear the new split screen flag
                    const updatedSlide = {
                        ...activeItem,
                        ...(projectName &&
                            projectName !== activeItem.title && { title: projectName }),
                        isNewSplitScreen: false, // Clear the flag after first save
                    };
                    setActiveItem(updatedSlide);
                } catch (error) {
                    console.error('Error saving split screen slide:', error);
                    console.error('Payload that failed:', videoSlidePayload);
                    toast.error(t('slideEditor:splitScreen.slideSaveError', { error: String(error) }));
                }
                // Split-screen VIDEO is fully handled here. Return so it does
                // not fall through to the DOC path below and get overwritten as
                // a type:'DOC' document (the split embedded_data would be lost).
                return;
            } else if (activeItem?.source_type == 'VIDEO') {
                // Handle regular video slides (non-split screen)
                const convertedData = converDataToVideoFormat({
                    activeItem,
                    status,
                    notify: false,
                    newSlide: false,
                });
                try {
                    await addUpdateVideoSlide(convertedData);
                    toast.success(t('slideEditor:slide.savedDraft'));
                } catch {
                    toast.error(t('slideEditor:slide.saveErrorGeneric'));
                }
                // VIDEO is fully handled here. Without this return the slide
                // would continue into the DOC path below and risk being
                // overwritten as a type:'DOC' document (it only survives today
                // because the editor happens to be empty and the empty-guard
                // catches it — too fragile to rely on).
                return;
            }

            // HTML_VIDEO (AI Video / AI Slides / AI Storybook) is AI-generated,
            // rendered read-only via VideoSlidePreview, and has no editor content
            // or draft-save action (handlePublishSlide has no HTML_VIDEO branch
            // either). Return here so it never falls through to the DOC path and
            // gets overwritten as a type:'DOC' slide.
            if (activeItem?.source_type === 'HTML_VIDEO') {
                return;
            }

            if (activeItem?.source_type === 'QUESTION') {
                const convertedData = convertToQuestionBackendSlideFormat({
                    activeItem,
                    status,
                    notify: false,
                    newSlide: false,
                });
                try {
                    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                    // @ts-expect-error
                    await updateQuestionOrder(convertedData!);
                    toast.success(t('slideEditor:slide.savedDraft'));
                } catch {
                    toast.error(t('slideEditor:slide.genericSaveErrorLower'));
                }
                return;
            }

            if (activeItem?.source_type === 'QUIZ') {
                try {
                    // Use the createQuizSlidePayload function to properly transform the data
                    const payload = createQuizSlidePayload(activeItem.quiz_slide?.questions || [], {
                        ...activeItem,
                        status: status, // Use the determined status
                    });

                    await addUpdateQuizSlide(payload);
                    toast.success(t('slideEditor:quiz.savedDraft'));
                } catch (error) {
                    console.error('Error saving quiz slide:', error);
                    toast.error(t('slideEditor:quiz.saveError'));
                }
                return;
            }

            if (activeItem?.source_type === 'AUDIO') {
                if (!activeItem.audio_slide) {
                    toast.error(t('slideEditor:audio.missingData'));
                    return;
                }
                try {
                    await addUpdateAudioSlide({
                        id: activeItem.id,
                        title: activeItem.title,
                        description: activeItem.description || null,
                        image_file_id: activeItem.image_file_id || null,
                        status: status as 'DRAFT' | 'PUBLISHED',
                        slide_order: activeItem.slide_order,
                        notify: false,
                        new_slide: false,
                        audio_slide: {
                            id: activeItem.audio_slide.id,
                            audio_file_id: activeItem.audio_slide.audio_file_id,
                            thumbnail_file_id: activeItem.audio_slide.thumbnail_file_id || null,
                            audio_length_in_millis: activeItem.audio_slide.audio_length_in_millis,
                            source_type: activeItem.audio_slide.source_type,
                            external_url: activeItem.audio_slide.external_url || null,
                            transcript: activeItem.audio_slide.transcript || null,
                        },
                    });
                    toast.success(t('slideEditor:audio.savedSuccess'));
                } catch (error) {
                    console.error('Error saving audio slide:', error);
                    toast.error(t('slideEditor:audio.saveError'));
                }
                return;
            }

            // Handle SCORM slides
            if (activeItem?.source_type === 'SCORM') {
                if (!activeItem.scorm_slide) {
                    toast.error(t('slideEditor:scorm.missingData'));
                    return;
                }
                try {
                    await addUpdateScormSlide({
                        id: activeItem.id,
                        title: activeItem.title,
                        description: activeItem.description || null,
                        // Mirror the publish/unpublish SCORM payload so a draft
                        // save doesn't drop the thumbnail — the backend may
                        // treat an absent image_file_id as "clear".
                        image_file_id: activeItem.image_file_id || '',
                        status: status as 'DRAFT' | 'PUBLISHED',
                        slide_order: activeItem.slide_order,
                        notify: false,
                        new_slide: false,
                        scorm_slide: {
                            id: activeItem.scorm_slide.id,
                        },
                    });
                    toast.success(t('slideEditor:scorm.savedSuccess'));
                } catch (error) {
                    console.error('Error saving SCORM slide:', error);
                    toast.error(t('slideEditor:scorm.saveError'));
                }
                return;
            }

            // Handle ASSESSMENT slides (assessment linked to a slide)
            if (activeItem?.source_type === 'ASSESSMENT') {
                if (!activeItem.assessment_slide) {
                    toast.error(t('slideEditor:assessment.missingData'));
                    return;
                }
                try {
                    await addUpdateAssessmentSlide({
                        id: activeItem.id,
                        source_id: activeItem.assessment_slide.id,
                        source_type: 'ASSESSMENT',
                        title: activeItem.title,
                        description: activeItem.description || '',
                        image_file_id: activeItem.image_file_id || '',
                        status: status === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT',
                        slide_order: activeItem.slide_order,
                        notify: false,
                        new_slide: false,
                        assessment_slide: {
                            id: activeItem.assessment_slide.id,
                            assessment_id: activeItem.assessment_slide.assessment_id,
                            allow_reattempt: activeItem.assessment_slide.allow_reattempt ?? true,
                            show_result: activeItem.assessment_slide.show_result ?? true,
                        },
                    });
                    toast.success(t('slideEditor:assessment.savedSuccess'));
                } catch (error) {
                    console.error('Error saving assessment slide:', error);
                    toast.error(t('slideEditor:assessment.saveError'));
                }
                return;
            }

            if (
                activeItem?.source_type == 'DOCUMENT' &&
                activeItem?.document_slide?.type == 'PRESENTATION'
            ) {
                try {
                    // For non-admin users, use custom save function if available
                    if (customSaveFunction && slide) {
                        console.log('🎨 Using custom save function for presentation');
                        await customSaveFunction(slide);
                        return;
                    }

                    // For presentations, use the same status logic as auto-save
                    let presentationStatus = slide?.status || 'DRAFT';

                    // If the slide is PUBLISHED and being edited, change status to UNSYNC
                    if (slide?.status === 'PUBLISHED') {
                        presentationStatus = 'UNSYNC';
                    }
                    await addUpdateDocumentSlide({
                        id: slide?.id || '',
                        title: slide?.title || '',
                        image_file_id: '',
                        description: slide?.description || '',
                        slide_order: null,
                        document_slide: {
                            id: slide?.document_slide?.id || '',
                            type: 'PRESENTATION',
                            data: slide?.document_slide?.data || null, // Keep existing S3 file ID
                            title: slide?.document_slide?.title || '',
                            cover_file_id: '',
                            total_pages: 1,
                            published_data: slide?.document_slide?.published_data || null,
                            published_document_total_pages: 1,
                        },
                        status: presentationStatus, // Use the correct status logic
                        new_slide: false,
                        notify: false,
                    });
                    // Update local activeItem state with the new status
                    if (slide?.id === activeItem?.id) {
                        const updatedActiveItem = {
                            ...activeItem,
                            status: presentationStatus as any,
                        };
                        setActiveItem(updatedActiveItem);
                    }

                    const successMessage =
                        slide?.status === 'PUBLISHED'
                            ? t('slideEditor:presentation.savedUnsync')
                            : t('slideEditor:presentation.savedSuccess');
                    toast.success(successMessage);
                } catch {
                    toast.error(t('slideEditor:presentation.saveError'));
                }
                return;
            }

            // Handle CODE, JUPYTER, SCRATCH, and SPLIT slides
            if (
                activeItem?.source_type == 'DOCUMENT' &&
                (activeItem?.document_slide?.type == 'CODE' ||
                    activeItem?.document_slide?.type == 'JUPYTER' ||
                    activeItem?.document_slide?.type == 'SCRATCH' ||
                    activeItem?.document_slide?.type?.startsWith('SPLIT_'))
            ) {
                try {
                    // For these slide types, ensure the latest data is saved to backend
                    // Use fallback: first check data field, then published_data for published slides
                    const rawData =
                        activeItem.status === 'PUBLISHED'
                            ? activeItem.document_slide?.data ||
                              activeItem.document_slide?.published_data
                            : activeItem.document_slide?.data;

                    // CRITICAL FIX: Don't save if rawData is empty/null to prevent data loss
                    if (!rawData || rawData === '{}') {
                        console.warn(
                            '⚠️ Skipping save for interactive slide - no valid data found'
                        );
                        const slideTypeName =
                            activeItem.document_slide.type === 'CODE'
                                ? 'Code Editor'
                                : activeItem.document_slide.type === 'JUPYTER'
                                  ? 'Jupyter Notebook'
                                  : activeItem.document_slide.type === 'SCRATCH'
                                    ? 'Scratch Project'
                                    : activeItem.document_slide.type?.startsWith('SPLIT_')
                                      ? `Split Screen ${activeItem.document_slide.type.replace('SPLIT_', '')}`
                                      : 'Interactive Slide';
                        toast.success(t('slideEditor:slide.typeUpToDate', { type: slideTypeName }));
                        lastSaveDraftOutcomeRef.current = 'success'; // no-op, nothing to persist
                        return;
                    }

                    await addUpdateDocumentSlide({
                        id: slide?.id || '',
                        title: slide?.title || '',
                        image_file_id: '',
                        description: slide?.description || '',
                        slide_order: null,
                        document_slide: {
                            id: slide?.document_slide?.id || '',
                            type: activeItem.document_slide.type,
                            data: rawData, // Use the actual data without dangerous fallback
                            title: slide?.document_slide?.title || '',
                            cover_file_id: '',
                            total_pages: 1,
                            published_data: activeItem.status === 'PUBLISHED' ? rawData : null,
                            published_document_total_pages: 1,
                        },
                        status: status,
                        new_slide: false,
                        notify: false,
                    });

                    const slideTypeName =
                        activeItem.document_slide.type === 'CODE'
                            ? 'Code Editor'
                            : activeItem.document_slide.type === 'JUPYTER'
                              ? 'Jupyter Notebook'
                              : activeItem.document_slide.type === 'SCRATCH'
                                ? 'Scratch Project'
                                : activeItem.document_slide.type?.startsWith('SPLIT_')
                                  ? `Split Screen ${activeItem.document_slide.type.replace('SPLIT_', '')}`
                                  : 'Interactive Slide';
                    toast.success(t('slideEditor:slide.typeSavedSuccess', { type: slideTypeName }));
                    lastSaveDraftOutcomeRef.current = 'success';
                } catch (error) {
                    console.error(`Error saving ${activeItem.document_slide.type} slide:`, error);
                    toast.error(t('slideEditor:slide.typeSaveError', { type: activeItem.document_slide.type.toLowerCase() }));
                }
                return;
            }

            // 'HTML' (Tiptap) documents: latest HTML lives in htmlDocRef (set on
            // every editor change); fall back to stored data when the editor
            // hasn't been touched. Draft/409 semantics live in saveHtmlDocDraft.
            if (
                slide?.source_type === 'DOCUMENT' &&
                slide?.document_slide?.type === HTML_DOC_TYPE
            ) {
                if (htmlDocAutosaveTimerRef.current) {
                    clearTimeout(htmlDocAutosaveTimerRef.current);
                    htmlDocAutosaveTimerRef.current = null;
                }
                const htmlString =
                    (htmlDocRef.current.slideId === slide.id ? htmlDocRef.current.html : null) ||
                    slide.document_slide?.data ||
                    slide.document_slide?.published_data ||
                    '';
                const saved = await saveHtmlDocDraft(slide, htmlString, { silent: false });
                if (saved) {
                    toast.success(t('slideEditor:slide.savedDraft'));
                    lastSaveDraftOutcomeRef.current = 'success';
                }
                return;
            }

            // PDF and PPT_ANIM slides have no editor content — they reference an
            // uploaded file by id in document_slide.data (PDF = file id rendered
            // by the PDF viewer; PPT_ANIM = deck base rendered by DeckPlayer).
            // Without this branch, Save Draft falls through to the DOC path
            // below, serializes the (empty) document editor, and overwrites the
            // slide as type:'DOC' — wiping the file and leaving only the title.
            // Re-save in place, preserving the type / file id / page count /
            // published snapshot.
            if (
                slide?.source_type === 'DOCUMENT' &&
                (slide?.document_slide?.type === 'PDF' ||
                    slide?.document_slide?.type === 'PPT_ANIM')
            ) {
                try {
                    await addUpdateDocumentSlide({
                        id: slide?.id || '',
                        title: slide?.title || '',
                        image_file_id: slide?.image_file_id || '',
                        description: slide?.description || '',
                        slide_order: null,
                        document_slide: {
                            id: slide?.document_slide?.id || '',
                            type: slide?.document_slide?.type || 'PDF',
                            // Fall back to the published snapshot so we never
                            // write data:null for a deck/PDF that only has a
                            // published copy (the UNSYNC admin preview reads
                            // data, and a null would show a blank deck).
                            data:
                                slide?.document_slide?.data ||
                                slide?.document_slide?.published_data ||
                                null,
                            title: slide?.document_slide?.title || '',
                            cover_file_id: slide?.document_slide?.cover_file_id || '',
                            total_pages: slide?.document_slide?.total_pages || 1,
                            published_data:
                                slide?.document_slide?.published_data || null,
                            published_document_total_pages:
                                slide?.document_slide
                                    ?.published_document_total_pages || 1,
                        },
                        status: status,
                        new_slide: false,
                        notify: false,
                    });
                    toast.success(t('slideEditor:slide.savedDraft'));
                    lastSaveDraftOutcomeRef.current = 'success';
                } catch {
                    toast.error(t('slideEditor:slide.saveErrorGeneric'));
                }
                return;
            }

            // Handle regular documents
            // Layer-2 guard: if this slide's content was dropped by the deserializer on
            // load (a lossy round-trip), the editor holds LESS than the DB. Persisting
            // it would make the loss permanent, so refuse the save and keep the DB safe.
            if (
                docLoadIntegrityRef.current.lossy &&
                docLoadIntegrityRef.current.slideId === slide?.id
            ) {
                toast.error(describeLoadIntegrityFailure(docLoadIntegrityRef.current, 'saved'));
                return;
            }

            const currentHtml = getCurrentEditorHTMLContent();

            // A degraded serialize is NOT user intent — the editor still holds the
            // blocks; only the HTML we just produced is missing them. Persisting it
            // writes that loss into `data`, which is what an UNSYNC slide reopens
            // from, so the blocks are gone on the next load. Refuse, like the
            // auto-save and publish paths do. (This used to warn and save anyway.)
            if (lastSerializeDegradedRef.current) {
                toast.error(
                    t('slideEditor:doc.corruptNotSaved')
                );
                return;
            }

            // Process images in HTML content before saving
            let processedHtmlString = currentHtml;
            let uploadedImagesCount = 0;
            if (containsBase64Images(currentHtml)) {
                console.log('Processing base64 images in DOC content...');
                const imageSize = getBase64ImagesSize(currentHtml);
                console.log(`Base64 images size: ${Math.round(imageSize / 1024)}KB`);

                const { processedHtml, uploadedImages, failedUploads } =
                    await processHtmlImages(currentHtml);
                processedHtmlString = processedHtml;
                uploadedImagesCount = uploadedImages;

                if (failedUploads > 0) {
                    toast.error(t('slideEditor:images.someFailedToUpload', { count: failedUploads }));
                }
                if (uploadedImages > 0) {
                    console.log(`Successfully processed ${uploadedImages} images`);
                    toast.success(t('slideEditor:images.savedWithImages', { count: uploadedImages }));
                }
            }

            const totalPages = estimatePageCount(processedHtmlString);

            // Guard against empty/broken serialization wiping out the slide.
            // An empty Yoopta document serializes to the wrapper-only HTML
            // produced by formatHTMLString(''), so we detect both literal
            // emptiness and that empty wrapper before clobbering the slide.
            if (!processedHtmlString || checkIsHtmlEmpty(processedHtmlString)) {
                console.warn(
                    '⚠️ Skipping SaveDraft for DOC — editor returned empty content. html:',
                    processedHtmlString
                );
                toast.error(t('slideEditor:doc.readError'));
                return;
            }

            // force=false first; the backend rejects (409) a save that would drop a
            // structural block (table/image/video/custom block). On that 409 we ask the
            // author to confirm and retry with force_overwrite — mirrors handlePublishSlide.
            const saveDocDraft = (force: boolean) =>
                addUpdateDocumentSlide({
                    id: slide?.id || '',
                    title: slide?.title || '',
                    image_file_id: '',
                    description: slide?.description || '',
                    slide_order: null,
                    document_slide: {
                        id: slide?.document_slide?.id || '',
                        type: 'DOC',
                        data: processedHtmlString,
                        title: slide?.document_slide?.title || '',
                        cover_file_id: '',
                        total_pages: totalPages,
                        // Preserve the existing published snapshot so a draft
                        // save on a PUBLISHED slide does not wipe out the
                        // last-published content. setEditorContent reads from
                        // published_data whenever status === 'PUBLISHED'.
                        published_data: slide?.document_slide?.published_data || null,
                        published_document_total_pages:
                            slide?.document_slide?.published_document_total_pages || 1,
                        force_overwrite: force,
                    },
                    status: status,
                    new_slide: false,
                    notify: false,
                });

            try {
                await saveDocDraft(false);
                lastSaveDraftOutcomeRef.current = 'success';
                if (!containsBase64Images(currentHtml) || uploadedImagesCount === 0) {
                    toast.success(t('slideEditor:slide.savedDraft'));
                }
            } catch (error) {
                const response = (
                    error as {
                        response?: { status?: number; data?: { ex?: string; message?: string } };
                    }
                )?.response;
                const serverMessage = response?.data?.ex || response?.data?.message;
                if (response?.status === 409 && serverMessage) {
                    const confirmed = window.confirm(
                        `To prevent accidental data loss, please confirm.\n\n${serverMessage}\n\nAre you sure you want to continue and save?`
                    );
                    if (!confirmed) return;
                    try {
                        await saveDocDraft(true);
                        toast.success(t('slideEditor:slide.forcedOverride'));
                        lastSaveDraftOutcomeRef.current = 'success';
                    } catch {
                        toast.error(t('slideEditor:slide.saveErrorGeneric'));
                    }
                    return;
                }
                toast.error(serverMessage || t('slideEditor:slide.saveErrorGeneric'));
            }
        } finally {
            setIsSaving(false);
        }
    };

    // Custom publish function for Excalidraw presentations
    const publishExcalidrawPresentation = async (notify: boolean) => {
        if (!activeItem || activeItem.document_slide?.type !== 'PRESENTATION') return;

        try {
            // Step 1: Get current state from Excalidraw editor
            if (!getCurrentExcalidrawStateRef.current) {
                toast.error(t('slideEditor:presentation.editorNotReady'));
                return;
            }

            const currentState = getCurrentExcalidrawStateRef.current();

            if (!currentState.elements || currentState.elements.length === 0) {
                toast.error(t('slideEditor:presentation.noContentToPublish'));
                return;
            }

            // Step 2: Prepare Excalidraw data for S3 upload
            const excalidrawData = {
                isExcalidraw: true,
                elements: currentState.elements,
                files: currentState.files || {},
                appState: currentState.appState || {},
                lastModified: Date.now(),
            };

            // Step 3: Upload current state to S3
            const jsonBlob = new Blob([JSON.stringify(excalidrawData)], {
                type: 'application/json',
            });
            const fileName = `excalidraw_${activeItem.id}_published_${Date.now()}.json`;
            const jsonFile = new File([jsonBlob], fileName, {
                type: 'application/json',
            });

            // Get user and institute info for S3 upload
            const accessToken = getTokenFromCookie(TokenKey.accessToken);
            const tokenData = getTokenDecodedData(accessToken);
            const INSTITUTE_ID = tokenData && Object.keys(tokenData.authorities)[0];
            const USER_ID = tokenData?.sub;

            const publishedFileId = await UploadFileInS3(
                jsonFile,
                () => {}, // No progress callback needed
                USER_ID || '',
                INSTITUTE_ID,
                'ADMIN',
                true // public URL
            );

            if (!publishedFileId) {
                toast.error(t('slideEditor:presentation.uploadFailed'));
                return;
            }

            // Step 4: Update slide with both data and published_data set to the new file_id
            await addUpdateDocumentSlide({
                id: activeItem.id,
                title: activeItem.title || '',
                image_file_id: '',
                description: activeItem.description || '',
                slide_order: null,
                document_slide: {
                    id: activeItem.document_slide?.id || '',
                    type: 'PRESENTATION',
                    data: publishedFileId, // Set data to new file_id
                    title: activeItem.document_slide?.title || '',
                    cover_file_id: '',
                    total_pages: 1,
                    published_data: publishedFileId, // Set published_data to same file_id
                    published_document_total_pages: 1,
                },
                status: 'PUBLISHED',
                new_slide: false,
                notify: notify,
            });

            // Update local activeItem state with the new published data
            const updatedActiveItem = {
                ...activeItem,
                status: 'PUBLISHED' as any,
                document_slide: activeItem.document_slide
                    ? {
                          ...activeItem.document_slide,
                          data: publishedFileId,
                          published_data: publishedFileId,
                      }
                    : undefined,
            };
            setActiveItem(updatedActiveItem);

            toast.success(t('slideEditor:presentation.publishedSuccess'));
        } catch (error) {
            console.error('Error publishing presentation:', error);
            toast.error(t('slideEditor:presentation.publishFailed'));
        }
    };

    const handleSaveDraftClick = async () => {
        try {
            // Special handling for interactive slides (CODE, JUPYTER, SCRATCH, SPLIT)
            if (
                activeItem?.source_type === 'DOCUMENT' &&
                (activeItem?.document_slide?.type === 'CODE' ||
                    activeItem?.document_slide?.type === 'JUPYTER' ||
                    activeItem?.document_slide?.type === 'SCRATCH' ||
                    activeItem?.document_slide?.type?.startsWith('SPLIT_'))
            ) {
                // For interactive slides, check if we have valid data
                const rawData =
                    activeItem.status === 'PUBLISHED'
                        ? activeItem.document_slide?.data ||
                          activeItem.document_slide?.published_data
                        : activeItem.document_slide?.data;

                // If no valid data exists, skip manual save as auto-save handles these slides
                if (!rawData || rawData === '{}') {
                    const slideTypeName =
                        activeItem.document_slide.type === 'CODE'
                            ? 'Code Editor'
                            : activeItem.document_slide.type === 'JUPYTER'
                              ? 'Jupyter Notebook'
                              : activeItem.document_slide.type === 'SCRATCH'
                                ? 'Scratch Project'
                                : activeItem.document_slide.type?.startsWith('SPLIT_')
                                  ? `Split Screen ${activeItem.document_slide.type.replace('SPLIT_', '')}`
                                  : 'Interactive Slide';

                    toast.success(t('slideEditor:slide.typeUpToDateAutoSaved', { type: slideTypeName }));
                    return;
                }
            }

            const isEditableDocSlide =
                activeItem?.source_type === 'DOCUMENT' &&
                (activeItem?.document_slide?.type === 'DOC' ||
                    activeItem?.document_slide?.type === HTML_DOC_TYPE);

            // Use custom save function if provided (for non-admin users).
            // The custom fn isn't instrumented for success, so fall back to the
            // editor-readability heuristic before clearing the browser draft.
            if (customSaveFunction && activeItem) {
                console.log('🔄 Using custom save function for non-admin');
                await customSaveFunction(activeItem);
                const editorReadable =
                    !isEditableDocSlide ||
                    (!checkIsHtmlEmpty(getCurrentEditorHTMLContent()) &&
                        !lastSerializeDegradedRef.current);
                if (editorReadable) clearLocalDraft(activeItem?.id);
                return; // Don't show additional toast as custom function handles it
            }

            // SaveDraft owns user messaging for every slide-type branch
            // (success, error, empty-content, no-op). Don't add a second toast
            // here — it produced duplicate success toasts on every save and a
            // success-after-error stack when the DOC branch guarded empty
            // editor content.
            //
            // Clear the browser draft ONLY on a confirmed persist. SaveDraft
            // swallows guard refusals / declined 409s / network errors without
            // throwing, so "didn't throw" is NOT success — the outcome ref is.
            // Clearing after a refused save deletes the browser's only copy of
            // edits the DB never received (draft gone + DB stale = silent loss).
            await SaveDraft(activeItem);
            if (!isEditableDocSlide || lastSaveDraftOutcomeRef.current === 'success') {
                clearLocalDraft(activeItem?.id);
            }
        } catch {
            toast.error(t('slideEditor:doc.saveErrorGeneric'));
        }
    };

    useEffect(() => {
        setHeading(activeItem?.title || '');
        setSlideTitle(
            (activeItem?.source_type === 'DOCUMENT' && activeItem?.document_slide?.title) ||
                (activeItem?.source_type === 'VIDEO' && activeItem?.video_slide?.title) ||
                ''
        );
    }, [activeItem]);

    // Detect adding a new slide and handle unsaved DOC changes
    const prevItemsCountRef = useRef<number>(Array.isArray(items) ? items.length : 0);
    useEffect(() => {
        const currentCount = Array.isArray(items) ? items.length : 0;
        const previousCount = prevItemsCountRef.current;

        if (currentCount > previousCount) {
            // Defer slightly to let store reflect deletions before checking
            setTimeout(() => {
                if (prevDocSlideRef.current) {
                    const previous = prevDocSlideRef.current;
                    const snapshot = getCurrentEditorHTMLContent();
                    handleUnsavedDocWithSnapshot(previous, snapshot);
                }
            }, 50);
        }

        prevItemsCountRef.current = currentCount;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [items?.length]);

    useEffect(() => {
        setHeading(activeItem?.title || '');
        if (items && items.length === 0 && slideId === undefined) {
            setActiveItem(null);
            return;
        }

        if (items && items.length > 0) {
            // Priority 1: keep the current active slide if it still exists.
            // A slides refetch (e.g. after publishing a freshly-uploaded slide)
            // must NOT yank selection back to the URL slideId: the URL is only
            // updated on explicit sidebar clicks, not on new-slide creation, so
            // right after an upload it still points at the previously-selected
            // slide. Honoring it here flipped the sidebar highlight + header
            // title to that stale "previous" slide while the content stayed on
            // the new one. This mirrors the sidebar's own selection priority.
            const activeSlideStillExists =
                activeItem && items.find((slide) => slide.id === activeItem.id);

            if (activeSlideStillExists) {
                // Active slide still exists, keep it selected
                return;
            }

            // Priority 2: fall back to the URL slideId (initial load, deep link,
            // or after the active slide was deleted).
            if (slideId) {
                const targetSlide = items.find((slide) => slide.id === slideId);
                if (targetSlide) {
                    setActiveItem(targetSlide);
                    return;
                }
            }

            // Priority 3: Always set first available slide as active
            // This handles both new slide creation and slide deletion scenarios
            const firstSlide = items[0];

            setActiveItem(firstSlide || null);
        }
    }, [items, slideId]);

    // For read-only file-backed document slides (PDF / PPT_ANIM) the rendered
    // content is derived purely from the file URL in data/published_data — there's
    // no live editor to disrupt. Track it so the view re-renders when the URL fills
    // in (e.g. right after an upload, once the slides refetch lands). Scoped to
    // these two types so we never rebuild the DOC/CODE/JUPYTER/Excalidraw editors
    // on their autosave-triggered refetches (the reason `items` was kept out of deps).
    const docContentSignature =
        activeItem?.source_type === 'DOCUMENT' &&
        ['PDF', 'PPT_ANIM'].includes(activeItem?.document_slide?.type ?? '')
            ? `${activeItem?.document_slide?.data ?? ''}|${activeItem?.document_slide?.published_data ?? ''}`
            : null;

    useEffect(() => {
        setHeading(activeItem?.title || '');
        // Only reload content if the slide identity or shape changes.
        // IMPORTANT: `items` was intentionally removed from deps because
        // query refetches (triggered by auto-save) would re-run loadContent,
        // which reads from the stale `activeItem` object and overwrites
        // in-memory editor changes (e.g. newly-inserted YouTube embeds).
        loadContent();
    }, [
        activeItem?.id,
        activeItem?.source_type,
        activeItem?.document_slide?.type,
        activeItem?.status,
        // File-backed doc slides: re-render when the URL fills in (post-upload).
        docContentSignature,
        // Re-render the video preview when an external link is edited in place.
        activeItem?.video_slide?.url,
        activeItem?.video_slide?.published_url,
        // Reload the editor with the restored content after a history restore.
        historyRestoreNonce,
    ]);

    // ⋯ menu entries for the relocated header actions, per slide type.
    const slidesExtraMenuOptions = useMemo<DropdownItem[]>(() => {
        const options: DropdownItem[] = [{ label: 'Activity Stats', value: 'activity-stats' }];
        if (
            activeItem?.source_type === 'DOCUMENT' &&
            activeItem?.document_slide?.type !== 'PRESENTATION'
        ) {
            options.push({ label: 'Version History', value: 'history' });
        }
        if (
            activeItem?.source_type === 'DOCUMENT' &&
            (activeItem?.document_slide?.type === 'DOC' ||
                activeItem?.document_slide?.type === HTML_DOC_TYPE)
        ) {
            options.push({ label: 'Export as PDF', value: 'export-pdf' });
        }
        // Offer conversion only for legacy (Yoopta) DOC slides — those on the
        // old editor, i.e. type 'DOC' with no data-editor="lexical" marker.
        if (
            activeItem?.source_type === 'DOCUMENT' &&
            activeItem?.document_slide?.type === 'DOC' &&
            !isLexicalDocSlide(activeItem, getRestorableLocalDraftHtml(activeItem))
        ) {
            options.push({ label: 'Convert to new editor', value: 'convert-to-lexical' });
        }
        return options;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        activeItem?.source_type,
        activeItem?.document_slide?.type,
        activeItem?.id,
        activeItem?.status,
        getRestorableLocalDraftHtml,
    ]);

    // Which editor the active DOC slide uses — drives the small header badge so
    // authors can tell the new (Lexical) editor from the legacy (Yoopta) one at
    // a glance. null for non-DOC slides (no badge).
    const docEditorKind = useMemo<'lexical' | 'yoopta' | null>(() => {
        if (
            activeItem?.source_type !== 'DOCUMENT' ||
            activeItem?.document_slide?.type !== 'DOC'
        ) {
            return null;
        }
        return isLexicalDocSlide(activeItem, getRestorableLocalDraftHtml(activeItem))
            ? 'lexical'
            : 'yoopta';
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        activeItem?.source_type,
        activeItem?.document_slide?.type,
        activeItem?.id,
        activeItem?.status,
        getRestorableLocalDraftHtml,
    ]);

    const handleExtraMenuSelect = async (value: string) => {
        if (value === 'activity-stats') {
            setIsStatsOpen(true);
        } else if (value === 'history') {
            setIsHistoryOpen(true);
        } else if (value === 'export-pdf' && activeItem) {
            if (activeItem.status === 'PUBLISHED') {
                // Don't re-save a published slide on download — SaveDraft would
                // flip it to UNSYNC (un-publish it). Export the persisted
                // published content as-is.
                await handleConvertAndUpload(activeItem.document_slide?.published_data || null);
            } else {
                // Draft/unsync: persist the latest edits first so the exported
                // PDF reflects them.
                await SaveDraft(activeItem);
                await handleConvertAndUpload(activeItem.document_slide?.data || null);
            }
        } else if (value === 'convert-to-lexical' && activeItem) {
            // Snapshot the current Yoopta content; the dialog runs the loss
            // pre-flight and calls handleConvertToLexical on confirm.
            const current =
                getCurrentEditorHTMLContent() ||
                activeItem.document_slide?.data ||
                activeItem.document_slide?.published_data ||
                '';
            setConvertSourceHtml(current);
            setIsConvertOpen(true);
        }
    };

    // Persist the Lexical-round-tripped (marker-bearing) HTML and force a clean
    // editor reload so the slide re-routes to the new editor. `forced` = the
    // author overrode a detected data-loss warning.
    const handleConvertToLexical = async (convertedHtml: string, forced: boolean) => {
        if (!activeItem || !convertedHtml) return;
        setIsConverting(true);
        const isPublished = activeItem.status === 'PUBLISHED';
        const totalPages = estimatePageCount(convertedHtml);
        const doConvertSave = (force: boolean) =>
            addUpdateDocumentSlide({
                id: activeItem.id,
                title: activeItem.title || '',
                image_file_id: '',
                description: activeItem.description || '',
                slide_order: null,
                document_slide: {
                    id: activeItem.document_slide?.id || crypto.randomUUID(),
                    type: 'DOC',
                    data: convertedHtml,
                    title: activeItem.document_slide?.title || activeItem.title || '',
                    cover_file_id: '',
                    total_pages: totalPages,
                    // Convert the published snapshot too when the slide is live,
                    // so learners see the (equivalent) converted content and the
                    // status stays PUBLISHED; otherwise leave it untouched.
                    published_data: isPublished
                        ? convertedHtml
                        : activeItem.document_slide?.published_data || null,
                    published_document_total_pages: isPublished
                        ? totalPages
                        : activeItem.document_slide?.published_document_total_pages || 1,
                    force_overwrite: force,
                    force_publish: force,
                },
                status: activeItem.status,
                new_slide: false,
                notify: false,
            });
        try {
            try {
                await doConvertSave(forced);
            } catch (error) {
                // On the structural-loss 409, the author already accepted the
                // dialog's assessment — retry once forced rather than a second
                // confirm.
                const status = (error as { response?: { status?: number } })?.response?.status;
                if (status === 409) await doConvertSave(true);
                else throw error;
            }
            // Reflect in the store + force a clean reload that re-routes to Lexical.
            clearLocalDraft(activeItem.id);
            lastLoadContentSlideIdRef.current = null;
            setActiveItem({
                ...activeItem,
                document_slide: activeItem.document_slide
                    ? {
                          ...activeItem.document_slide,
                          data: convertedHtml,
                          published_data: isPublished
                              ? convertedHtml
                              : activeItem.document_slide.published_data,
                      }
                    : activeItem.document_slide,
            } as Slide);
            setHistoryRestoreNonce((n) => n + 1);
            setIsConvertOpen(false);
            toast.success(t('slideEditor:doc.convertedToLexical'));
        } catch (error) {
            console.error('Convert to Lexical failed:', error);
            toast.error(t('slideEditor:doc.convertFailed'));
        } finally {
            setIsConverting(false);
        }
    };

    // Discard the active slide's local unsaved draft and reload the editor
    // from the last saved (server) content — same reload mechanism as a
    // history restore: drop the draft, reset the same-slide guard, bump the
    // nonce so loadContent re-runs without the draft shadowing the content.
    const handleDiscardActiveDraft = () => {
        if (!activeItem) return;
        clearLocalDraft(activeItem.id);
        lastLoadContentSlideIdRef.current = null;
        setHistoryRestoreNonce((n) => n + 1);
        setIsDiscardConfirmOpen(false);
        toast.success(t('slideEditor:slide.discardedRestored'));
    };

    // A version-history snapshot was copied into this slide's draft on the
    // backend. Mirror it into the store and force a full editor reload: clear
    // the local (unsaved) draft so it can't shadow the restored content, and
    // reset the same-slide guard so the DOC branch re-deserializes.
    const handleHistoryRestored = (restoredValue: string, slideStatus: string) => {
        if (!activeItem) return;
        clearLocalDraft(activeItem.id);
        lastLoadContentSlideIdRef.current = null;
        setActiveItem({
            ...activeItem,
            status: slideStatus || activeItem.status,
            document_slide: activeItem.document_slide
                ? { ...activeItem.document_slide, data: restoredValue }
                : activeItem.document_slide,
        } as Slide);
        setHistoryRestoreNonce((n) => n + 1);
    };

    // Update the refs whenever these functions change
    useEffect(() => {
        setHeading(activeItem?.title || '');
        // Parent-facing content getter must be slide-type aware: 'HTML'
        // (Tiptap) slides read from htmlDocRef — asking the Yoopta editor
        // would return its empty wrapper and clobber the slide (the
        // non-admin publish path saves whatever this returns).
        setGetCurrentEditorHTMLContent(() => {
            const current = useContentStore.getState().activeItem;
            if (current?.document_slide?.type === HTML_DOC_TYPE) {
                return (
                    (htmlDocRef.current.slideId === current.id
                        ? htmlDocRef.current.html
                        : null) ||
                    current.document_slide?.data ||
                    current.document_slide?.published_data ||
                    ''
                );
            }
            return getCurrentEditorHTMLContent();
        });
        setSaveDraft(SaveDraft);
    }, [editor]);

    // External-link video slides (YouTube / Vimeo) support editing the link.
    // Uploaded files (FILE_ID), AI videos (HTML_VIDEO) and split-screen are excluded.
    const editableVideoSourceType = activeItem?.video_slide?.source_type;
    const isExternalVideoLink =
        activeItem?.source_type === 'VIDEO' &&
        (editableVideoSourceType === 'VIDEO' || editableVideoSourceType === 'VIMEO') &&
        !activeItem?.splitScreenMode;

    return (
        <div
            // Bounded-height scroll container so the `sticky top-0` header below
            // actually freezes. The LayoutContainer wraps page content in an
            // `overflow-x-hidden` div, which makes `overflow-y` compute to `auto`
            // — a scroll container that never scrolls (the body does), so a sticky
            // child has nothing to stick to. Owning the scroll here fixes that:
            // header stays put, editor content scrolls beneath it. Offsets ≈
            // viewport − navbar (h-14 / md:h-[72px]) − the wrapper's padding/margin
            // (p-2 / sm:p-3 / md:p-4 / lg:m-7).
            className="flex h-[calc(100vh-76px)] w-full flex-1 flex-col overflow-y-auto overflow-x-hidden transition-all duration-300 ease-in-out sm:h-[calc(100vh-84px)] md:h-[calc(100vh-108px)] lg:h-[calc(100vh-132px)]"
            ref={selectionRef}
        >
            {/* Leave-editor guard: course-scoped drafts dialog listing each unsaved
                slide (grouped subject → module → chapter) with jump links. */}
            {leaveBlocker.status === 'blocked' && (
                <UnsavedDraftsDialog
                    open
                    mode="leave"
                    drafts={courseDrafts}
                    onOpenChange={(open) => {
                        if (!open) leaveBlocker.reset?.();
                    }}
                    onBeforeJump={() => leaveBlocker.reset?.()}
                    onKeep={() => leaveBlocker.proceed?.()}
                    onDiscard={() => {
                        clearCourseDrafts();
                        leaveBlocker.proceed?.();
                    }}
                />
            )}
            {/* Confirm discarding the active slide's unsaved local edits. */}
            <MyDialog
                heading={t('ui.discardDialogHeading')}
                open={isDiscardConfirmOpen}
                onOpenChange={setIsDiscardConfirmOpen}
                dialogWidth="w-full max-w-md"
                footer={
                    <div className="flex w-full flex-wrap items-center justify-end gap-2">
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            onClick={() => setIsDiscardConfirmOpen(false)}
                        >
                            {t('ui.keepEditing')}
                        </MyButton>
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            className="border-danger-400 text-danger-600 hover:bg-danger-50"
                            onClick={handleDiscardActiveDraft}
                        >
                            {t('ui.discardChanges')}
                        </MyButton>
                    </div>
                }
            >
                <p className="text-subtitle text-neutral-600">
                    {t('ui.discardDialogBody', {
                        term: getTerminology(ContentTerms.Slide, SystemTerms.Slide).toLowerCase(),
                    })}
                </p>
            </MyDialog>
            {/* Convert legacy (Yoopta) DOC → new (Lexical) editor, with a
                pre-flight data-loss check. */}
            <ConvertToLexicalDialog
                open={isConvertOpen}
                onOpenChange={(open) => {
                    setIsConvertOpen(open);
                    if (!open) setConvertSourceHtml(null);
                }}
                sourceHtml={convertSourceHtml}
                onConfirm={handleConvertToLexical}
                converting={isConverting}
            />
            {activeItem && (
                <div className="sticky top-0 z-50 -mx-2 -mt-2 flex flex-col gap-2 border-b border-neutral-200 bg-white/80 px-2 py-1 shadow-sm backdrop-blur-sm sm:-mx-3 sm:-mt-3 sm:px-3 sm:py-1.5 md:-mx-4 md:-mt-4 md:px-4 md:py-2.5 lg:-mx-7 lg:-mt-7 lg:px-7 lg:py-3">
                    {/* Row 1 — editable title + actions. Wraps so the title truncates
                        and the actions drop to their own line before anything clips. */}
                    <div className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-2">
                    <div className="w-full min-w-0 md:w-auto md:flex-1">
                        {isEditing ? (
                            <div className="flex items-center justify-center gap-2 duration-200 animate-in fade-in">
                                <input
                                    type="text"
                                    value={heading}
                                    onChange={handleHeadingChange}
                                    className="w-fit border-b border-neutral-300 bg-transparent text-lg font-semibold text-neutral-700 transition-colors duration-200 focus:border-primary-500 focus:outline-none"
                                    autoFocus
                                />
                                <Check
                                    onClick={() =>
                                        updateHeading(
                                            activeItem,
                                            addUpdateVideoSlide,
                                            SaveDraft,
                                            heading,
                                            setIsEditing,
                                            addUpdateDocumentSlide,
                                            addUpdateQuizSlide, // <-- pass this for QUIZ support
                                            updateAssignmentOrder, // <-- pass for ASSIGNMENT
                                            updateQuestionOrder, // <-- pass for QUESTION
                                            addUpdateAudioSlide,
                                            addUpdateScormSlide,
                                            addUpdateAssessmentSlide,
                                            addUpdateHtmlVideoSlide
                                        )
                                    }
                                    className="cursor-pointer hover:text-primary-500"
                                />
                            </div>
                        ) : (
                            <div className="flex min-w-0 items-center gap-1.5">
                                <h3 className="truncate text-xs font-semibold text-neutral-600 sm:text-sm md:text-base lg:text-h3">
                                    {heading || 'No content selected'}
                                </h3>
                                {docEditorKind && (
                                    <span
                                        title={
                                            docEditorKind === 'lexical'
                                                ? 'This document uses the new editor'
                                                : 'This document uses the legacy editor — convert it from the ⋯ menu'
                                        }
                                        className={cn(
                                            'shrink-0 whitespace-nowrap rounded-full border px-2 py-0.5 text-caption font-medium',
                                            docEditorKind === 'lexical'
                                                ? 'border-primary-200 bg-primary-50 text-primary-600'
                                                : 'border-neutral-200 bg-neutral-100 text-neutral-500'
                                        )}
                                    >
                                        {docEditorKind === 'lexical' ? 'New editor' : 'Legacy editor'}
                                    </span>
                                )}
                                {!isLearnerView && (
                                    <PencilSimpleLine
                                        className="shrink-0 cursor-pointer hover:text-primary-500"
                                        onClick={() => setIsEditing(true)}
                                    />
                                )}
                            </div>
                        )}
                    </div>

                    {!isLearnerView && (
                        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1 sm:gap-2 md:gap-3">
                            <div className="flex items-center gap-1 sm:gap-2 md:gap-3">
                                {/* Occasional-use actions (Activity Stats, History, Export)
                                    live in the ⋯ menu — see slidesExtraMenuOptions. Their
                                    dialogs render controlled below. */}
                                <ActivityStatsSidebar
                                    hideTrigger
                                    open={isStatsOpen}
                                    onOpenChange={setIsStatsOpen}
                                />
                                {activeItem.source_type === 'DOCUMENT' &&
                                    activeItem?.document_slide?.type !== 'PRESENTATION' && (
                                        <SlideHistoryDialog
                                            key={activeItem.id}
                                            activeItem={activeItem}
                                            chapterId={chapterId || ''}
                                            onRestored={handleHistoryRestored}
                                            hideTrigger
                                            open={isHistoryOpen}
                                            onOpenChange={setIsHistoryOpen}
                                        />
                                    )}

                                {isExternalVideoLink && (
                                    <MyButton
                                        buttonType="secondary"
                                        scale="medium"
                                        layoutVariant="default"
                                        onClick={() => setIsEditLinkDialogOpen(true)}
                                    >
                                        <LinkSimple size={18} />
                                        <span className="hidden md:inline">Edit Link</span>
                                    </MyButton>
                                )}

                                {(!hidePublishButtons || // Show for admin users OR
                                    (hidePublishButtons && // Show for non-admin users if it's an editable slide type
                                        (activeItem?.document_slide?.type === 'DOC' ||
                                            activeItem?.document_slide?.type === 'PDF' ||
                                            activeItem?.document_slide?.type === 'PRESENTATION' ||
                                            activeItem?.document_slide?.type === 'CODE' ||
                                            activeItem?.document_slide?.type === 'JUPYTER' ||
                                            activeItem?.document_slide?.type === 'SCRATCH' ||
                                            activeItem?.source_type === 'QUESTION' ||
                                            activeItem?.source_type === 'ASSIGNMENT' ||
                                            activeItem?.source_type === 'QUIZ' ||
                                            activeItem?.source_type === 'DOCUMENT' ||
                                            activeItem?.source_type === 'VIDEO' ||
                                            activeItem?.source_type === 'HTML_VIDEO')) || // Include ALL video slides for non-admin
                                    (!hidePublishButtons &&
                                        activeItem?.source_type === 'VIDEO' &&
                                        activeItem?.splitScreenMode)) && ( // Keep split-screen condition for admin
                                    <MyButton
                                        buttonType="secondary"
                                        scale="medium"
                                        layoutVariant="default"
                                        onClick={handleSaveDraftClick}
                                        disabled={isSaving}
                                        className={cn(isSaving && 'pointer-events-none')}
                                    >
                                        {isSaving ? (
                                            <>
                                                <Loader2 className="size-4 animate-spin text-primary-500 " />
                                                {t('ui.saving')}
                                            </>
                                        ) : hidePublishButtons ? (
                                            <FloppyDisk size={18} />
                                        ) : (
                                            <>
                                                <FloppyDisk size={18} className="md:hidden" />
                                                <span className="hidden md:inline">{t('ui.saveDraft')}</span>
                                            </>
                                        )}
                                    </MyButton>
                                )}

                                {/* Assign this slide as a daily-engagement task. Offered only for a
                                    PUBLISHED slide: a draft is invisible to learners, so scheduling
                                    one would create a task nobody could open. */}
                                {!hidePublishButtons && activeItem.status === 'PUBLISHED' && (
                                    <MyButton
                                        buttonType="secondary"
                                        scale="medium"
                                        layoutVariant="default"
                                        onClick={() => setIsAssignTaskOpen(true)}
                                    >
                                        <span className="hidden md:inline">
                                            {t('slideAction.assignTask', {
                                                ns: 'engagement',
                                                defaultValue: 'Assign as task',
                                            })}
                                        </span>
                                        <span className="md:hidden">
                                            {t('slideAction.task', {
                                                ns: 'engagement',
                                                defaultValue: 'Task',
                                            })}
                                        </span>
                                    </MyButton>
                                )}

                                {/* Publish/Unpublish — shown to ALL roles (no auto-publish anymore).
                                    The confirm step is a compact popover anchored to this button
                                    (no full-screen modal); the button below is its anchor. */}
                                {activeItem.status === 'PUBLISHED' ? (
                                    <UnpublishDialog
                                        isOpen={isUnpublishDialogOpen}
                                        setIsOpen={setIsUnpublishDialogOpen}
                                        trigger={
                                            <MyButton
                                                buttonType="secondary"
                                                scale="medium"
                                                layoutVariant="default"
                                                onClick={() => setIsUnpublishDialogOpen(true)}
                                            >
                                                <span className="hidden sm:inline">{t('ui.unpublish')}</span>
                                                <span className="text-xs sm:hidden">{t('ui.unpublishShort')}</span>
                                            </MyButton>
                                        }
                                        handlePublishUnpublishSlide={() =>
                                            handleUnpublishSlide(
                                                setIsUnpublishDialogOpen,
                                                false,
                                                activeItem,
                                                addUpdateDocumentSlide,
                                                addUpdateVideoSlide,
                                                updateQuestionOrder,
                                                updateAssignmentOrder,
                                                addUpdateQuizSlide,
                                                addUpdateAudioSlide,
                                                addUpdateScormSlide,
                                                SaveDraft,
                                                playerRef,
                                                addUpdateAssessmentSlide
                                            )
                                        }
                                    />
                                ) : (
                                    <PublishDialog
                                        isOpen={isPublishDialogOpen}
                                        setIsOpen={setIsPublishDialogOpen}
                                        trigger={
                                            <MyButton
                                                buttonType="primary"
                                                scale="medium"
                                                layoutVariant="default"
                                                onClick={() => setIsPublishDialogOpen(true)}
                                            >
                                                <span className="hidden sm:inline">{t('ui.publish')}</span>
                                                <span className="text-xs sm:hidden">{t('ui.publishShort')}</span>
                                            </MyButton>
                                        }
                                        handlePublishUnpublishSlide={async (_setIsOpen, notify) => {
                                            if (
                                                activeItem?.document_slide?.type === 'PRESENTATION'
                                            ) {
                                                publishExcalidrawPresentation(notify);
                                                clearLocalDraft(activeItem?.id);
                                                setIsPublishDialogOpen(false);
                                            } else {
                                                // For DOC slides, get fresh editor HTML so
                                                // the latest content (including videos) is published
                                                let itemToPublish = activeItem;
                                                if (
                                                    activeItem?.source_type === 'DOCUMENT' &&
                                                    activeItem?.document_slide?.type === 'DOC'
                                                ) {
                                                    // Layer-2 guard: never publish a lossy-loaded
                                                    // slide (editor holds less than the DB).
                                                    if (
                                                        docLoadIntegrityRef.current.lossy &&
                                                        docLoadIntegrityRef.current.slideId ===
                                                            activeItem?.id
                                                    ) {
                                                        toast.error(
                                                            describeLoadIntegrityFailure(
                                                                docLoadIntegrityRef.current,
                                                                'published'
                                                            )
                                                        );
                                                        setIsPublishDialogOpen(false);
                                                        return;
                                                    }
                                                    let currentHtml = getCurrentEditorHTMLContent();
                                                    // A degraded serialize means blocks were
                                                    // DROPPED from currentHtml — the editor holds
                                                    // more than this HTML represents. The
                                                    // switch-time auto-save already refuses to
                                                    // persist that; publish MUST too. Publish is
                                                    // the only writer of published_data, so an
                                                    // unguarded write here replaces the live slide
                                                    // with the fragment that survived
                                                    // serialization. The author only ever sees the
                                                    // server's "this will remove N blocks"
                                                    // confirm, which reads as a false alarm after
                                                    // they've merely ADDED content — they click OK
                                                    // and the lesson is gone.
                                                    if (lastSerializeDegradedRef.current) {
                                                        toast.error(t('slideEditor:doc.corruptNotPublished'));
                                                        setIsPublishDialogOpen(false);
                                                        return;
                                                    }
                                                    if (containsBase64Images(currentHtml)) {
                                                        const { processedHtml } =
                                                            await processHtmlImages(currentHtml);
                                                        currentHtml = processedHtml;
                                                    }
                                                    itemToPublish = {
                                                        ...activeItem,
                                                        document_slide: {
                                                            ...activeItem.document_slide!,
                                                            data: currentHtml,
                                                            total_pages:
                                                                estimatePageCount(currentHtml),
                                                        },
                                                    };
                                                }
                                                // 'HTML' (Tiptap) docs: publish the live
                                                // editor HTML (htmlDocRef), falling back to
                                                // the stored draft.
                                                if (
                                                    activeItem?.source_type === 'DOCUMENT' &&
                                                    activeItem?.document_slide?.type ===
                                                        HTML_DOC_TYPE
                                                ) {
                                                    let currentHtml =
                                                        (htmlDocRef.current.slideId ===
                                                        activeItem.id
                                                            ? htmlDocRef.current.html
                                                            : null) ||
                                                        activeItem.document_slide?.data ||
                                                        '';
                                                    if (containsBase64Images(currentHtml)) {
                                                        const { processedHtml } =
                                                            await processHtmlImages(currentHtml);
                                                        currentHtml = processedHtml;
                                                    }
                                                    if (
                                                        !currentHtml ||
                                                        isHtmlDocEmpty(currentHtml)
                                                    ) {
                                                        toast.error(t('slideEditor:doc.readError'));
                                                        setIsPublishDialogOpen(false);
                                                        return;
                                                    }
                                                    itemToPublish = {
                                                        ...activeItem,
                                                        document_slide: {
                                                            ...activeItem.document_slide!,
                                                            data: currentHtml,
                                                            total_pages:
                                                                estimatePageCount(currentHtml),
                                                        },
                                                    };
                                                }
                                                handlePublishSlide(
                                                    setIsPublishDialogOpen,
                                                    notify,
                                                    itemToPublish,
                                                    addUpdateDocumentSlide,
                                                    addUpdateVideoSlide,
                                                    updateQuestionOrder,
                                                    updateAssignmentOrder,
                                                    addUpdateQuizSlide,
                                                    addUpdateAudioSlide,
                                                    addUpdateScormSlide,
                                                    SaveDraft,
                                                    playerRef,
                                                    addUpdateAssessmentSlide,
                                                    () => clearLocalDraft(activeItem?.id),
                                                    tPublish
                                                );
                                            }
                                        }}
                                    />
                                )}

                                {isExternalVideoLink && (
                                    <MyDialog
                                        trigger={<></>}
                                        heading={
                                            editableVideoSourceType === 'VIMEO'
                                                ? 'Edit Vimeo Link'
                                                : 'Edit YouTube Link'
                                        }
                                        dialogWidth="w-full max-w-md"
                                        open={isEditLinkDialogOpen}
                                        onOpenChange={setIsEditLinkDialogOpen}
                                    >
                                        <div className="duration-300 animate-in fade-in slide-in-from-bottom-4">
                                            {editableVideoSourceType === 'VIMEO' ? (
                                                <AddVimeoDialog
                                                    key={activeItem.id}
                                                    editSlide={activeItem}
                                                    openState={(open) =>
                                                        !open && setIsEditLinkDialogOpen(false)
                                                    }
                                                />
                                            ) : (
                                                <AddVideoDialog
                                                    key={activeItem.id}
                                                    editSlide={activeItem}
                                                    openState={(open) =>
                                                        !open && setIsEditLinkDialogOpen(false)
                                                    }
                                                />
                                            )}
                                        </div>
                                    </MyDialog>
                                )}
                            </div>

                            {/* ✅ Doubt Icon Trigger */}
                            {showManageDoubts && (
                                <MyButton
                                    layoutVariant="icon"
                                    buttonType="secondary"
                                    title={t('ui.openDoubtSidebar')}
                                    onClick={() => setSidebarOpen(true)}
                                >
                                    <ChatCircleDots className="size-5" />
                                </MyButton>
                            )}
                            {/* Slides Menu Option — includes relocated occasional-use
                                actions (Activity Stats / History / Export PDF). */}
                            <SlidesMenuOption
                                extraOptions={slidesExtraMenuOptions}
                                onExtraSelect={handleExtraMenuSelect}
                            />
                        </div>
                    )}
                    </div>
                </div>
            )}

            {/* Bottom floating bar — the ONE active-slide unsaved signal. Discard
                is deliberately isolated here, away from Save Draft/Publish, to
                prevent accidental destructive clicks. */}
            {!isLearnerView && activeSlideHasRealChanges && (
                <div
                    role="region"
                    aria-label={t('ui.unsavedChanges')}
                    className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full border border-warning-300 bg-white/95 py-1.5 pl-4 pr-2 shadow-xl backdrop-blur animate-in fade-in slide-in-from-bottom-2"
                >
                    <div className="flex items-center gap-2 whitespace-nowrap text-sm font-medium text-neutral-700">
                        <Warning className="size-4 shrink-0 text-warning-600" weight="fill" />
                        {t('ui.unsavedChanges')}
                    </div>
                    <MyButton
                        buttonType="text"
                        scale="small"
                        onClick={() => setIsCompareOpen(true)}
                    >
                        {t('ui.viewChanges')}
                    </MyButton>
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        onClick={() => setIsDiscardConfirmOpen(true)}
                        className="!rounded-full border-danger-300 text-danger-600 hover:bg-danger-50"
                    >
                        {t('ui.discardChanges')}
                    </MyButton>
                </div>
            )}
            {/* Saved vs current side-by-side comparison */}
            <UnsavedCompareDialog
                open={isCompareOpen}
                onOpenChange={setIsCompareOpen}
                savedHtml={compareContents.saved}
                currentHtml={compareContents.current}
            />

            <div
                className={`relative z-20 mx-auto mt-14 w-full ${
                    assessmentCreateMode
                        ? // Let the form grow to its natural height with bottom
                          // padding so the parent scroll container reveals all of
                          // it — pinning to h-full + overflow-hidden clips the
                          // lower fields (attempts / create button).
                          'h-auto overflow-visible pb-10'
                        : `${
                              activeItem?.document_slide?.type === 'PDF' ||
                              activeItem?.document_slide?.type === 'PPT_ANIM'
                                  ? 'h-[calc(100vh-200px)]'
                                  : 'h-full'
                          } ${
                              activeItem?.document_slide?.type === 'DOC' ||
                              // HTML (Tiptap) docs grow with their content just
                              // like DOC — overflow-hidden would clip them with
                              // no scrollbar.
                              activeItem?.document_slide?.type === HTML_DOC_TYPE ||
                              // CODE (esp. Question Mode) grows with its problem
                              // text / test cases / starter code; pinning it to
                              // overflow-hidden clips the lower tabs' content with
                              // no scrollbar. Let the outer page-scroll reveal it.
                              activeItem?.document_slide?.type === 'CODE' ||
                              activeItem?.source_type === 'ASSIGNMENT' ||
                              // VIDEO / HTML_VIDEO stack the player on top of a
                              // timeline, add-question form and questions list
                              // that together run taller than the viewport;
                              // pinning to h-full + overflow-hidden clips that
                              // lower content with no scrollbar. Let the outer
                              // page-scroll reveal it.
                              activeItem?.source_type === 'VIDEO' ||
                              activeItem?.source_type === 'HTML_VIDEO' ||
                              // ASSESSMENT stacks instructions HTML on top of a
                              // per-student submissions list into an unbounded
                              // column with no internal scroll of its own;
                              // pinning to h-full + overflow-hidden clips the
                              // lower rows. Let the outer page-scroll reveal it.
                              activeItem?.source_type?.toUpperCase() === 'ASSESSMENT'
                                  ? 'overflow-visible'
                                  : 'overflow-hidden'
                          }`
                }`}
            >
                <SlideContentErrorBoundary
                    resetKey={assessmentCreateMode ? 'assessment-create' : (activeItem?.id ?? null)}
                >
                    {assessmentCreateMode ? <AssessmentCreateForm /> : content}
                </SlideContentErrorBoundary>
            </div>

            {/* ✅ Doubt Sidebar (mounted only if allowed) */}
            {showManageDoubts && <DoubtResolutionSidebar />}

            {/* Schedule this slide as a daily-engagement task. Opens preloaded with the
                slide, so the teacher only chooses batches and a time window. */}
            {isAssignTaskOpen && presetSlide && (
                <PlanComposerDialog
                    open={isAssignTaskOpen}
                    onOpenChange={setIsAssignTaskOpen}
                    onCreated={() => setIsAssignTaskOpen(false)}
                    presetSlide={presetSlide}
                />
            )}
        </div>
    );
};
