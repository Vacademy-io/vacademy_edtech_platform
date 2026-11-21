import { useEffect, useMemo, useRef, useState } from 'react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription } from '@/components/ui/alert';
// Phosphor icons only (design-system governance — banned-icon-library rule).
// `as`-aliases keep call-site names unchanged from the previous lucide
// imports, so the JSX below reads identically.
import {
    BookOpenText as BookText,
    Copy,
    DownloadSimple as Download,
    FileText,
    Translate as Languages,
    CircleNotch as Loader2,
    Sparkle as Sparkles,
    MagicWand as Wand2,
    GraduationCap,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
// `remark-gfm` adds GitHub-Flavored Markdown support to react-markdown:
// tables, strikethrough, task lists, autolinks. Without it, our LLM-emitted
// `| col | col |` tables show up as literal pipe-delimited text instead of
// rendering as actual HTML tables.
import remarkGfm from 'remark-gfm';
import { formatDistanceToNow } from 'date-fns';
import { GENERATE_TRANSCRIPT_NOTES_URL } from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { saveStudyNotes, type AssessmentArtifact } from '../-services/utils';
import { PastPapersSection } from './PastPapersSection';
import { AddToCourseDialog } from './add-to-course/AddToCourseDialog';
import type { jsPDF as JsPDF } from 'jspdf';
import type { TFunction } from 'i18next';

/**
 * Single entrypoint dialog opened from the "Show Transcript" button on a
 * recording row. The teacher picks one of two actions:
 *
 *   1. Create Assessment  — closes this dialog and lets the parent open
 *      `CreateAssessmentFromRecordingModal` (the parent passes
 *      `onCreateAssessment` for this).
 *   2. Generate Lecture Notes — calls ai-service in-place and renders
 *      the resulting markdown.
 *
 * We deliberately do NOT surface every action available on the transcript
 * (raw source / English / markdown tabs, copy buttons, download buttons,
 * etc.) — those overcrowded the previous viewer. Power users can still
 * copy/download the generated notes once produced.
 */

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Recording identifiers — required to POST generated notes back to
     * admin-core for caching. */
    scheduleId: string;
    recordingId: string;
    sourceTextUrl?: string | null;
    englishTextUrl?: string | null;
    detectedLanguage?: string;
    recordingTitle?: string;
    /** Previously-generated notes loaded from the transcription status DTO.
     * When present, the dialog skips the action picker and shows the cached
     * notes immediately on open, with a "Regenerate" affordance. */
    savedNotesMarkdown?: string;
    savedNotesGeneratedAt?: string;
    /** Lift saved-notes state up to the parent so a regen here is reflected
     * everywhere the parent uses the same recording row. Called after a
     * successful save with the new markdown + ISO timestamp. */
    onSavedNotesChange?: (markdown: string, generatedAt: string) => void;
    /** Fires when the teacher clicks the Create Assessment card. */
    onCreateAssessment: () => void;
    /**
     * Fires when the teacher clicks "View / Export PDF" on a row in the
     * Past papers list. The parent should open
     * CreateAssessmentFromRecordingModal with this artifact as
     * `initialArtifact` so the modal jumps straight to the preview pane
     * with the stored questions loaded — no LLM call.
     */
    onOpenArtifact?: (artifact: AssessmentArtifact) => void;
    /** Live class's linked batches — used to default the course in "Add to course". */
    linkedBatches?: Array<{ package_session_id: string; package_name?: string }>;
}

type LoadState = 'idle' | 'loading' | 'loaded' | 'error';

interface TextState {
    state: LoadState;
    text: string;
    error?: string;
}

const buildLanguageNames = (t: TFunction): Record<string, string> => ({
    en: t('languages.en'),
    hi: t('languages.hi'),
    bn: t('languages.bn'),
    ta: t('languages.ta'),
    te: t('languages.te'),
    mr: t('languages.mr'),
    gu: t('languages.gu'),
    kn: t('languages.kn'),
    ml: t('languages.ml'),
    pa: t('languages.pa'),
    ur: t('languages.ur'),
});

const langName = (code: string | undefined, t: TFunction) =>
    code
        ? (buildLanguageNames(t)[code.toLowerCase()] ?? code.toUpperCase())
        : t('languages.source');

/**
 * Break a long Whisper transcript into readable paragraphs by sentence
 * boundaries. Whisper output is one long blob — chunking by 4 sentences
 * mirrors how a teacher would naturally paragraph a lecture.
 *
 * Trades off perfection (some run-ons, some short ends) for readability —
 * a "good enough" formatter is much better than a wall of text, and the
 * cost of a smarter approach (LLM call, semantic chunking) isn't worth
 * it for a viewer the user reads, not edits.
 */
const formatTranscript = (text: string): string[] => {
    if (!text) return [];
    const cleaned = text.replace(/\s+/g, ' ').trim();
    // `।` is Devanagari danda — Hindi sentence terminator.
    const sentences = cleaned.match(/[^.!?।]+[.!?।]+\s*/g) ?? [cleaned];
    const paragraphs: string[] = [];
    let buf: string[] = [];
    for (const s of sentences) {
        buf.push(s.trim());
        if (buf.length >= 4) {
            paragraphs.push(buf.join(' '));
            buf = [];
        }
    }
    if (buf.length) paragraphs.push(buf.join(' '));
    return paragraphs;
};

const wordCount = (text: string): number =>
    text.trim() ? text.trim().split(/\s+/).length : 0;

const downloadBlob = (filename: string, content: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
};

/**
 * Render a DOM node into a multi-page A4 PDF and trigger the download.
 *
 * Approach: html2canvas captures the rendered notes block to a single tall
 * canvas, then we slice that canvas across A4 pages and add each slice as
 * an image to a jsPDF document. This preserves every visual style the
 * react-markdown render applied (prose-img rounding, headings, blockquotes,
 * code blocks) without having to re-implement them as PDF primitives.
 *
 * CORS note: Serper-returned image URLs are random host domains. We pass
 * `useCORS: true` so html2canvas requests the image with `crossOrigin`. If
 * the host doesn't send CORS headers, the image is dropped from the canvas
 * (the rest of the notes still render fine). Re-hosting images on our S3
 * is the right long-term fix; not blocking the v1 ship for it.
 */
/**
 * Pick a page-break Y inside [targetCutY - searchHeight .. targetCutY]
 * that lands in the largest whitespace zone — so the cut falls in the gap
 * *above* a heading (between the previous paragraph and the heading),
 * keeping the heading attached to the content that follows it.
 *
 * The naive "whitest single row" approach we used before would happily
 * cut in the tight 8px gap *below* a heading (its mb-2 margin),
 * stranding the heading at the bottom of one page and its body text on
 * the next. By measuring zones (consecutive near-white rows) and
 * preferring the tallest one, the cut naturally lands in the more
 * generous mb-6/mb-8 gap that precedes section headings.
 */
const findSafePageBreak = (
    source: HTMLCanvasElement,
    startY: number,
    targetCutY: number,
): number => {
    const searchHeight = Math.min(320, Math.floor((targetCutY - startY) * 0.35));
    const minCut = targetCutY - searchHeight;
    // Refuse to shrink a page below ~65% of normal — better to cut through
    // a line than ship a half-empty page.
    if (minCut <= startY + 100) return targetCutY;
    const ctx = source.getContext('2d');
    if (!ctx) return targetCutY;
    const width = source.width;

    const isWhite = (y: number): boolean => {
        const { data } = ctx.getImageData(0, y, width, 1);
        let whitePx = 0;
        for (let i = 0; i < data.length; i += 4) {
            if (data[i]! >= 240 && data[i + 1]! >= 240 && data[i + 2]! >= 240) {
                whitePx += 1;
            }
        }
        return whitePx / width > 0.985;
    };

    // Walk the search window collecting whitespace zones. Sample every 2
    // rows; a real gap between content blocks spans at least 8-12px so
    // we won't miss any.
    const zones: Array<{ top: number; bottom: number }> = [];
    let zoneBottom = -1;
    for (let y = targetCutY; y >= minCut; y -= 2) {
        if (isWhite(y)) {
            if (zoneBottom === -1) zoneBottom = y;
        } else if (zoneBottom !== -1) {
            zones.push({ top: y + 2, bottom: zoneBottom });
            zoneBottom = -1;
        }
    }
    if (zoneBottom !== -1) {
        zones.push({ top: minCut, bottom: zoneBottom });
    }

    if (zones.length === 0) return targetCutY;

    // Tallest zone wins — most likely the gap before a heading or
    // between a heading and its preceding section. Cut at its bottom so
    // any heading sitting just below the gap travels with its content
    // to the next page.
    const tallest = zones.reduce((best, z) =>
        z.bottom - z.top > best.bottom - best.top ? z : best
    );
    // Require the tallest zone to be at least 8px — otherwise just use
    // the natural cut.
    if (tallest.bottom - tallest.top < 8) return targetCutY;
    return tallest.bottom;
};

const buildPdfFromNode = async (
    node: HTMLElement,
    opts?: { watermarkDataUrl?: string | null }
): Promise<{ pdf: JsPDF; totalPages: number }> => {
    const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
        import('jspdf'),
        import('html2canvas'),
    ]);

    // html2canvas clones the DOM into an internal iframe before capture,
    // so CSS mutations on the live DOM (className, inline style, even
    // setProperty) don't reliably reach the clone. On top of that,
    // html2canvas treats <img> as a replaced element and reads its
    // naturalWidth/naturalHeight for sizing, sidestepping CSS entirely —
    // which is why every max-width approach silently fails for wide
    // diagrams.
    //
    // Bulletproof fix: read each live <img>'s natural dimensions now,
    // then in onclone (which runs on the actual rendered clone) replace
    // every cloned <img> with a <canvas> we pre-paint at the clamped
    // target size. html2canvas renders <canvas> elements as-is, so no
    // further scaling decisions are involved.
    const PRINT_IMG_MAX_W = 540; // px — fits inside A4 reading area with margin
    const PRINT_IMG_MAX_H = 360; // px — leaves room for surrounding text
    const liveImgs = Array.from(node.querySelectorAll<HTMLImageElement>('img'));
    type ImgTarget = { src: string; w: number; h: number };
    const targets: ImgTarget[] = liveImgs.map((img) => {
        const naturalW = img.naturalWidth || 600;
        const naturalH = img.naturalHeight || 400;
        const aspect = naturalW / naturalH || 1.5;
        let w = naturalW;
        let h = naturalH;
        if (w > PRINT_IMG_MAX_W) {
            w = PRINT_IMG_MAX_W;
            h = w / aspect;
        }
        if (h > PRINT_IMG_MAX_H) {
            h = PRINT_IMG_MAX_H;
            w = h * aspect;
        }
        return { src: img.src, w: Math.round(w), h: Math.round(h) };
    });

    const canvas = await html2canvas(node, {
        scale: 2, // 2× for crisp output on retina; standard practice for PDF capture
        useCORS: true,
        backgroundColor: 'white',
        logging: false,
        onclone: (_doc, clonedRoot) => {
            const clonedImgs = Array.from(
                clonedRoot.querySelectorAll<HTMLImageElement>('img')
            );
            clonedImgs.forEach((clonedImg) => {
                const live = liveImgs.find((l) => l.src === clonedImg.src);
                const target = targets.find((t) => t.src === clonedImg.src);
                if (!live || !target || !live.complete) return;

                // Pre-paint the image into a canvas at the target size.
                // Canvases pass through html2canvas untouched, bypassing
                // its image-scaling logic entirely.
                const replacement = clonedImg.ownerDocument.createElement(
                    'canvas'
                ) as HTMLCanvasElement;
                replacement.width = target.w * 2; // 2× internal for retina
                replacement.height = target.h * 2;
                replacement.style.width = `${target.w}px`;
                replacement.style.height = `${target.h}px`;
                replacement.style.display = 'block';
                replacement.style.margin = '24px auto';
                replacement.style.borderRadius = '12px';

                const ctx = replacement.getContext('2d');
                if (ctx) {
                    ctx.fillStyle = 'white';
                    ctx.fillRect(0, 0, replacement.width, replacement.height);
                    ctx.imageSmoothingEnabled = true;
                    ctx.imageSmoothingQuality = 'high';
                    try {
                        ctx.drawImage(
                            live,
                            0,
                            0,
                            replacement.width,
                            replacement.height
                        );
                    } catch {
                        // CORS taint or load race — leave the original
                        // img in place; the on-screen <img> is fine,
                        // the PDF just may not include this one image.
                        return;
                    }
                }
                clonedImg.replaceWith(replacement);
            });
        },
    });

    const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    // Asymmetric margins — extra padding at the bottom so even when the
    // slicer can't find a perfect break, the last line of each page
    // never sits flush against the page edge.
    const marginX = 32;
    const marginTop = 32;
    const marginBottom = 56;
    const usableWidth = pageWidth - marginX * 2;
    const usableHeight = pageHeight - marginTop - marginBottom;

    // Scale the captured canvas width down to the page's usable width;
    // the page count is determined by how many vertical slices fit.
    const renderWidthPx = canvas.width;
    const renderHeightPx = canvas.height;
    const pxPerPt = renderWidthPx / usableWidth;
    const pageSliceHeightPx = Math.floor(usableHeight * pxPerPt);

    let yOffsetPx = 0;
    let pageNumber = 0;
    while (yOffsetPx < renderHeightPx) {
        // Target the natural page boundary, then nudge backwards to the
        // nearest near-white row so the cut lands between paragraphs / on
        // image padding — never through a text baseline.
        const naturalEnd = Math.min(
            yOffsetPx + pageSliceHeightPx,
            renderHeightPx
        );
        const cutY =
            naturalEnd < renderHeightPx
                ? findSafePageBreak(canvas, yOffsetPx, naturalEnd)
                : naturalEnd;
        const sliceHeightPx = cutY - yOffsetPx;

        const sliceCanvas = document.createElement('canvas');
        sliceCanvas.width = renderWidthPx;
        sliceCanvas.height = sliceHeightPx;
        const ctx = sliceCanvas.getContext('2d');
        if (!ctx) throw new Error('Could not create slice canvas context');
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, renderWidthPx, sliceHeightPx);
        ctx.drawImage(
            canvas,
            0, yOffsetPx, renderWidthPx, sliceHeightPx,
            0, 0, renderWidthPx, sliceHeightPx,
        );

        if (pageNumber > 0) pdf.addPage();
        const sliceHeightPt = sliceHeightPx / pxPerPt;
        pdf.addImage(
            sliceCanvas.toDataURL('image/jpeg', 0.92),
            'JPEG',
            marginX,
            marginTop,
            usableWidth,
            sliceHeightPt,
        );

        // Optional centred, faint institute-logo watermark on every page.
        if (opts?.watermarkDataUrl) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const anyPdf = pdf as any;
            const GState = anyPdf.GState;
            try {
                const props = anyPdf.getImageProperties(opts.watermarkDataUrl);
                const wmW = pageWidth * 0.5;
                const wmH = (props.height / props.width) * wmW;
                const wmX = (pageWidth - wmW) / 2;
                const wmY = (pageHeight - wmH) / 2;
                if (GState) anyPdf.setGState(new GState({ opacity: 0.08 }));
                pdf.addImage(opts.watermarkDataUrl, 'PNG', wmX, wmY, wmW, wmH, undefined, 'FAST');
            } catch {
                // watermark is decorative — never block PDF generation
            } finally {
                // Always restore full opacity so a mid-stamp failure can't leave
                // the NEXT page's content faint.
                if (GState) {
                    try {
                        anyPdf.setGState(new GState({ opacity: 1 }));
                    } catch {
                        /* ignore */
                    }
                }
            }
        }

        yOffsetPx = cutY;
        pageNumber += 1;
    }

    return { pdf, totalPages: pageNumber };
};

const renderNodeToPdf = async (node: HTMLElement, filename: string) => {
    const { pdf } = await buildPdfFromNode(node);
    pdf.save(filename);
};

// Same capture as the Download-PDF button, but returns a Blob so the rendered
// notes node can be uploaded as a PDF slide — the uploaded PDF is then
// byte-identical to what the user previews/downloads (plus optional watermark).
const captureNodeToPdfBlob = async (
    node: HTMLElement,
    opts?: { watermarkDataUrl?: string | null }
): Promise<{ blob: Blob; totalPages: number }> => {
    const { pdf, totalPages } = await buildPdfFromNode(node, opts);
    return { blob: pdf.output('blob') as Blob, totalPages };
};

/**
 * Image component used inside the rendered notes. Hides itself on load
 * failure so the user doesn't see the raw alt text (e.g. "osmosis diagram")
 * sitting where an image was supposed to be — a common failure when Serper
 * returns URLs from hosts that block hot-linking or don't send CORS
 * headers (which html2canvas needs for the PDF capture).
 *
 * crossOrigin="anonymous" lets the browser load the image AND lets the
 * PDF capture pull it into the canvas without tainting. Loading lazy keeps
 * the dialog snappy when several images are embedded.
 */
function NotesImage({ alt, src, ...rest }: React.ImgHTMLAttributes<HTMLImageElement>) {
    const [errored, setErrored] = useState(false);
    if (errored || !src) return null;
    return (
        <img
            alt={alt ?? ''}
            src={src}
            crossOrigin="anonymous"
            loading="lazy"
            onError={() => setErrored(true)}
            // Tight pixel caps so the captured PDF never gets an
            // overflowing diagram — `max-w-2xl` (672px) keeps wide banner
            // images within the A4 reading area after html2canvas captures
            // and jsPDF scales, while `max-h-96` (384px) keeps a single
            // image from spanning more than ~half a page. `object-contain`
            // letterboxes the image to fit both caps without stretching.
            className="mx-auto my-6 block h-auto max-h-96 w-full max-w-2xl rounded-xl border border-neutral-200 object-contain shadow-md"
            {...rest}
        />
    );
}

/**
 * Per-element renderers for the study-notes view. We previously relied on
 * Tailwind's `prose-*` utilities (@tailwindcss/typography plugin) but the
 * plugin isn't installed in this project, so every `prose-h1:…` /
 * `prose-li:…` class was a silent no-op and the rendered notes came out as
 * a wall of same-sized text. Defining the styles per element here makes
 * the styling work regardless of Tailwind config, and gives us tighter
 * control over the look (custom bullet markers, blockquote callouts,
 * underlined section headers, etc.) than what @tailwindcss/typography
 * defaults provide.
 *
 * `as Components` cast is required because react-markdown's `Components`
 * type is a bivariant mapped type that doesn't accept specifically-typed
 * arrow functions without coercion.
 */
const NOTES_MARKDOWN_COMPONENTS = {
    img: NotesImage,
    // Document title — large, bold, primary-coloured underline strip
    h1: ({ children }) => (
        <h1 className="mb-5 mt-0 border-b-2 border-primary-500 pb-2 text-3xl font-bold tracking-tight text-neutral-900">
            {children}
        </h1>
    ),
    // Section header — left bar + light tint, like a sidebar callout
    h2: ({ children }) => (
        <h2 className="mb-3 mt-7 rounded-r-md border-l-4 border-primary-500 bg-primary-50/50 px-3 py-1.5 text-2xl font-bold tracking-tight text-neutral-900">
            {children}
        </h2>
    ),
    // Sub-section — distinct, slightly smaller, with primary-coloured text
    h3: ({ children }) => (
        <h3 className="mb-2 mt-5 text-lg font-bold text-primary-700">{children}</h3>
    ),
    // Body paragraphs
    p: ({ children }) => (
        <p className="my-3 leading-relaxed text-neutral-800">{children}</p>
    ),
    // Custom bullet: small primary-coloured dot. Cleaner than the default
    // browser disc, especially when the body text uses the same neutral palette.
    ul: ({ children }) => (
        <ul className="my-3 list-none space-y-1.5 pl-0">{children}</ul>
    ),
    li: ({ children }) => (
        <li className="flex gap-3 leading-relaxed text-neutral-800">
            <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-primary-500" />
            <span className="flex-1">{children}</span>
        </li>
    ),
    // Ordered lists stay numbered (no marker override) but get the same
    // spacing rhythm as the unordered version.
    ol: ({ children }) => (
        <ol className="my-3 list-decimal space-y-1.5 pl-6 marker:font-semibold marker:text-primary-600">
            {children}
        </ol>
    ),
    // Inline emphasis
    strong: ({ children }) => (
        <strong className="font-bold text-neutral-900">{children}</strong>
    ),
    em: ({ children }) => <em className="italic text-neutral-700">{children}</em>,
    // "Key takeaway" callout — distinctly styled card so the eye lands on it
    blockquote: ({ children }) => (
        <blockquote className="my-5 rounded-r-lg border-l-4 border-l-primary-500 bg-primary-50 px-5 py-3 text-neutral-900 [&>p]:my-0 [&>p]:font-medium">
            {children}
        </blockquote>
    ),
    // Inline code
    code: ({ children }) => (
        <code className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-sm text-primary-700">
            {children}
        </code>
    ),
    // Code blocks
    pre: ({ children }) => (
        <pre className="my-4 overflow-x-auto rounded-lg border border-neutral-200 bg-neutral-900 p-4 text-sm text-neutral-100">
            {children}
        </pre>
    ),
    // Tables — used by the LLM for comparison sections (hyper vs hypo, etc.)
    table: ({ children }) => (
        <div className="my-5 overflow-x-auto rounded-lg border border-neutral-200">
            <table className="w-full border-collapse text-sm">{children}</table>
        </div>
    ),
    thead: ({ children }) => <thead className="bg-primary-50">{children}</thead>,
    th: ({ children }) => (
        <th className="border-b border-neutral-200 px-3 py-2 text-left font-semibold text-neutral-900">
            {children}
        </th>
    ),
    td: ({ children }) => (
        <td className="border-b border-neutral-100 px-3 py-2 align-top text-neutral-800">
            {children}
        </td>
    ),
    // Links
    a: ({ children, href }) => (
        <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-primary-600 underline-offset-2 hover:underline"
        >
            {children}
        </a>
    ),
    // Horizontal rule (section breaks if the LLM emits them)
    hr: () => <hr className="my-6 border-neutral-200" />,
} as Components;

const copyToClipboard = async (text: string, label: string, t: TFunction) => {
    try {
        await navigator.clipboard.writeText(text);
        toast.success(t('toasts.copied', { label }));
    } catch {
        toast.error(t('toasts.clipboardError'));
    }
};

export function TranscriptActionsDialog({
    open,
    onOpenChange,
    scheduleId,
    recordingId,
    sourceTextUrl,
    englishTextUrl,
    detectedLanguage,
    recordingTitle = 'transcript',
    savedNotesMarkdown,
    savedNotesGeneratedAt,
    onSavedNotesChange,
    onCreateAssessment,
    onOpenArtifact,
    linkedBatches,
}: Props) {
    const { t, i18n } = useTranslation('studyLibraryLiveSessionTranscriptActionsDialog');
    const [source, setSource] = useState<TextState>({ state: 'idle', text: '' });
    const [english, setEnglish] = useState<TextState>({ state: 'idle', text: '' });
    // Hydrate notes from the server-side cache so reopening the dialog shows
    // them immediately without an LLM call. If no cached notes, start idle —
    // the action picker will render and the user can click "Generate".
    const [notes, setNotes] = useState<{
        state: LoadState;
        markdown: string;
        error?: string;
    }>(() =>
        savedNotesMarkdown
            ? { state: 'loaded', markdown: savedNotesMarkdown }
            : { state: 'idle', markdown: '' },
    );
    // Local mirror of the generated-at timestamp so the "Generated X ago"
    // label updates instantly after a regen (without waiting for the parent
    // to re-fetch the transcription status).
    const [notesGeneratedAt, setNotesGeneratedAt] = useState<string | undefined>(
        savedNotesGeneratedAt,
    );
    // Which transcript view the user is currently reading. Defaults to
    // English when a translation is available (most users find the
    // English version easier to scan); falls back to the source when the
    // recording is already in English or the translation is missing.
    const [view, setView] = useState<'source' | 'english'>('english');
    // Ref to the rendered notes container — captured by html2canvas for
    // the PDF download. Living on the prose node (not the ScrollArea
    // wrapper) means the capture excludes scrollbars and matches what
    // the user actually sees.
    const notesPrintRef = useRef<HTMLDivElement | null>(null);
    const [downloadingPdf, setDownloadingPdf] = useState(false);
    const [addToCourseOpen, setAddToCourseOpen] = useState(false);

    useEffect(() => {
        if (!open) {
            // On close: reset to whatever the server has cached. This means:
            //  - Notes that were just generated (and saved) stay visible on
            //    reopen (because the parent passed them in via prop).
            //  - A regen-then-error doesn't strand the user on a stale view.
            // We deliberately don't blank the markdown unconditionally —
            // doing so would force a wasteful re-show of the action picker
            // every time the user closes/reopens the dialog.
            if (savedNotesMarkdown) {
                setNotes({ state: 'loaded', markdown: savedNotesMarkdown });
                setNotesGeneratedAt(savedNotesGeneratedAt);
            } else {
                setNotes({ state: 'idle', markdown: '' });
                setNotesGeneratedAt(undefined);
            }
            return;
        }
        const loadText = async (
            url: string | null | undefined,
            set: (s: TextState) => void,
        ) => {
            if (!url) {
                set({ state: 'idle', text: '' });
                return;
            }
            set({ state: 'loading', text: '' });
            try {
                const resp = await fetch(url);
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const text = await resp.text();
                set({ state: 'loaded', text });
            } catch (e) {
                set({
                    state: 'error',
                    text: '',
                    error: e instanceof Error ? e.message : 'Failed to load',
                });
            }
        };
        loadText(sourceTextUrl, setSource);
        loadText(englishTextUrl, setEnglish);
    }, [open, sourceTextUrl, englishTextUrl]);

    const fileBase = recordingTitle.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 60);
    const transcriptReady = source.state === 'loaded' || english.state === 'loaded';
    const isEnglishSource = detectedLanguage?.toLowerCase() === 'en';

    // ── Reader-view derived state ──────────────────────────────────
    // Whether the source and English texts are different documents (when
    // the source IS English the worker reuses the same blob, so there's
    // no point offering a toggle). The toggle also requires both to have
    // actually loaded — otherwise we'd flash an empty pane.
    const hasLanguageToggle =
        !isEnglishSource && source.state === 'loaded' && english.state === 'loaded';

    // What the reader actually renders. When source is already English
    // there's only one document — we still label it "English". When the
    // source is non-English, the toggle picks; otherwise we fall back to
    // whichever blob actually loaded so the viewer never goes blank.
    const showingEnglish = isEnglishSource || (hasLanguageToggle && view === 'english');
    const activeText = showingEnglish && english.text
        ? english.text
        : source.text || english.text;
    const activeLanguageLabel = showingEnglish
        ? t('languages.en')
        : langName(detectedLanguage, t);

    const activeParagraphs = useMemo(() => formatTranscript(activeText), [activeText]);
    const activeWordCount = useMemo(() => wordCount(activeText), [activeText]);

    const handleGenerateNotes = async () => {
        const transcriptForLlm = english.text || source.text;
        if (!transcriptForLlm || transcriptForLlm.trim().length < 20) {
            toast.error(t('errors.transcriptTooShort'));
            return;
        }
        setNotes({ state: 'loading', markdown: '' });
        try {
            // Authenticated call: the ai-service derives the actor + institute
            // from the JWT and charges credits (academy-credits). institute_id is
            // sent only as a fallback. The idempotency_key is per-ATTEMPT (not per
            // recording): every deliberate (re)generate is a fresh LLM call and
            // must be charged, so we mint a new key on each click. The button is
            // disabled while a generation is in flight, so a single click still
            // can't double-charge. (A recording-stable key would have made every
            // Regenerate free.)
            const resp = await authenticatedAxiosInstance.post(GENERATE_TRANSCRIPT_NOTES_URL, {
                transcript_text: transcriptForLlm,
                title_hint: recordingTitle,
                target_language:
                    english.text || isEnglishSource
                        ? 'en'
                        : (detectedLanguage ?? 'en').toLowerCase(),
                institute_id: getCurrentInstituteId(),
                idempotency_key: `notes:${recordingId}:${Date.now()}`,
            });
            const data = resp.data as { markdown: string };
            if (!data.markdown || !data.markdown.trim()) {
                throw new Error('ai-service returned empty notes');
            }
            setNotes({ state: 'loaded', markdown: data.markdown });
            // Persist so the next dialog open shows the cached version
            // without re-running the LLM. Failure here is non-fatal —
            // the user already has the notes on screen; we just log and
            // show a soft warning, no need to roll back the UI.
            try {
                const saved = await saveStudyNotes(scheduleId, recordingId, data.markdown);
                const generatedAt =
                    saved.savedNotesGeneratedAt ?? new Date().toISOString();
                setNotesGeneratedAt(generatedAt);
                onSavedNotesChange?.(data.markdown, generatedAt);
            } catch (saveErr) {
                console.warn('[study-notes] save failed (non-fatal):', saveErr);
                toast.warning(t('errors.cachingFailed'));
            }
            toast.success(t('toasts.notesGenerated'));
        } catch (e) {
            // Prefer the ai-service detail (e.g. the 402 "insufficient credits"
            // message) over the generic axios "status code 402".
            const axiosDetail = (e as { response?: { data?: { detail?: string } } })?.response
                ?.data?.detail;
            const msg =
                axiosDetail || (e instanceof Error ? e.message : t('errors.generateFailed'));
            setNotes({ state: 'error', markdown: '', error: msg });
            toast.error(msg);
        }
    };

    return (
        <MyDialog
            open={open}
            onOpenChange={onOpenChange}
            heading={t('dialogHeading')}
            dialogWidth="max-w-3xl"
        >
            {/* MyDialog already caps the body to a sensible viewport
                fraction and handles scroll on its inner wrapper, so we
                don't need to duplicate either constraint here. */}
            <div className="flex flex-col gap-4 p-5">
                {/* Status pill */}
                <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                        <Sparkles className="size-3" />
                        {t('statusPill.transcriptReady')}
                    </span>
                    {detectedLanguage && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-xs font-medium text-neutral-600">
                            <Languages className="size-3" />
                            {langName(detectedLanguage, t)}
                        </span>
                    )}
                    {transcriptReady && activeWordCount > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-xs font-medium text-neutral-600">
                            {t('statusPill.wordCount', {
                                count: activeWordCount,
                                formattedCount: activeWordCount.toLocaleString(i18n.language),
                            })}
                        </span>
                    )}
                </div>

                {/* Transcript reader — paragraph view of the actual lecture text.
                    Hidden while AI study notes are being generated/viewed so the
                    user focuses on one thing at a time, matching the existing
                    notes flow. */}
                {transcriptReady && notes.state === 'idle' && (
                    <div className="flex flex-col gap-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            {hasLanguageToggle ? (
                                <div className="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-neutral-50 p-0.5">
                                    <button
                                        type="button"
                                        onClick={() => setView('source')}
                                        className={
                                            view === 'source'
                                                ? 'rounded-sm bg-white px-2.5 py-1 text-xs font-semibold text-neutral-800 shadow-sm'
                                                : 'rounded-sm px-2.5 py-1 text-xs font-medium text-neutral-500 hover:text-neutral-700'
                                        }
                                    >
                                        {langName(detectedLanguage, t)}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setView('english')}
                                        className={
                                            view === 'english'
                                                ? 'rounded-sm bg-white px-2.5 py-1 text-xs font-semibold text-neutral-800 shadow-sm'
                                                : 'rounded-sm px-2.5 py-1 text-xs font-medium text-neutral-500 hover:text-neutral-700'
                                        }
                                    >
                                        {t('languages.en')}
                                    </button>
                                </div>
                            ) : (
                                <div className="text-xs font-medium text-neutral-500">
                                    {t('reader.transcriptLabel', {
                                        language: activeLanguageLabel,
                                    })}
                                </div>
                            )}
                            <div className="flex items-center gap-1.5">
                                <MyButton
                                    type="button"
                                    buttonType="secondary"
                                    scale="small"
                                    onClick={() =>
                                        copyToClipboard(
                                            activeText,
                                            t('reader.transcriptLabel', {
                                                language: activeLanguageLabel,
                                            }),
                                            t,
                                        )
                                    }
                                >
                                    <Copy className="mr-1.5 size-3.5" />
                                    {t('buttons.copy')}
                                </MyButton>
                                <MyButton
                                    type="button"
                                    buttonType="secondary"
                                    scale="small"
                                    onClick={() =>
                                        downloadBlob(
                                            `${fileBase}.${showingEnglish ? 'en' : detectedLanguage ?? 'src'}.txt`,
                                            activeText,
                                            'text/plain',
                                        )
                                    }
                                >
                                    <Download className="mr-1.5 size-3.5" />
                                    .txt
                                </MyButton>
                            </div>
                        </div>
                        {/* Plain div with overflow-y-auto + max-h works
                            reliably for variable-length content. Radix
                            ScrollArea needs an explicit height (not
                            max-height) on its root for its internal
                            viewport to enable scrolling, which would
                            waste space for shorter transcripts. */}
                        <div className="max-h-72 overflow-y-auto rounded-lg border border-neutral-200 bg-white">
                            <div className="space-y-3 px-5 py-4 text-sm leading-7 text-neutral-800">
                                {activeParagraphs.length > 0 ? (
                                    activeParagraphs.map((p, i) => (
                                        <p key={i}>{p}</p>
                                    ))
                                ) : (
                                    <p className="text-neutral-500">
                                        {t('reader.emptyTranscript')}
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* Action picker — visible until notes are generated */}
                {notes.state === 'idle' && (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <ActionCard
                            icon={<FileText className="size-5" />}
                            title={t('actions.createAssessment.title')}
                            description={t('actions.createAssessment.description')}
                            cta={t('actions.createAssessment.cta')}
                            onClick={onCreateAssessment}
                            tone="primary"
                            disabled={!transcriptReady}
                        />
                        <ActionCard
                            icon={<BookText className="size-5" />}
                            title={t('actions.generateNotes.title')}
                            description={t('actions.generateNotes.description')}
                            cta={t('actions.generateNotes.cta')}
                            onClick={handleGenerateNotes}
                            tone="violet"
                            disabled={!transcriptReady}
                        />
                    </div>
                )}

                {/* Past papers — list of previously generated assessments
                    for THIS same recording so the teacher can re-export
                    PDFs or re-publish without spending another LLM call.
                    Placed below the action cards (and collapsed by default
                    inside its own header click target) so a recording with
                    a long history doesn't push the primary actions out of
                    view. Hidden once notes generation has started so the
                    dialog stays focused on the active flow. */}
                {notes.state === 'idle' && onOpenArtifact && (
                    <PastPapersSection
                        scheduleId={scheduleId}
                        recordingId={recordingId}
                        onOpenArtifact={(artifact) => {
                            onOpenChange(false);
                            onOpenArtifact(artifact);
                        }}
                        savedNotesMarkdown={savedNotesMarkdown}
                        savedNotesGeneratedAt={savedNotesGeneratedAt}
                        onOpenNotes={
                            savedNotesMarkdown
                                ? () => {
                                      // Re-enter the cached notes view in
                                      // place — the markdown is already in
                                      // the parent props so we just flip
                                      // local notes state to 'loaded'.
                                      setNotes({
                                          state: 'loaded',
                                          markdown: savedNotesMarkdown,
                                      });
                                      setNotesGeneratedAt(
                                          savedNotesGeneratedAt
                                      );
                                  }
                                : undefined
                        }
                    />
                )}

                {/* Loading state */}
                {notes.state === 'loading' && (
                    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                        <Loader2 className="size-6 animate-spin text-primary-500" />
                        <div className="text-sm font-medium text-neutral-800">
                            {t('loading.generatingNotes')}
                        </div>
                        <div className="text-xs text-neutral-500">
                            {t('loading.usuallyTakes')}
                        </div>
                    </div>
                )}

                {/* Error state */}
                {notes.state === 'error' && (
                    <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
                        <Alert variant="destructive" className="max-w-md text-left">
                            <AlertDescription>
                                {notes.error ?? t('errors.couldNotGenerateNotes')}
                            </AlertDescription>
                        </Alert>
                        <div className="flex items-center gap-2">
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="small"
                                onClick={() => setNotes({ state: 'idle', markdown: '' })}
                            >
                                {t('buttons.back')}
                            </MyButton>
                            <MyButton
                                type="button"
                                scale="small"
                                onClick={handleGenerateNotes}
                            >
                                <Wand2 className="mr-1.5 size-3.5" />
                                {t('buttons.retry')}
                            </MyButton>
                        </div>
                    </div>
                )}

                {/* Loaded notes — concise toolbar + rendered markdown only.
                    Deliberately no language/word-count chrome — the user only
                    cares about the actual content here. */}
                {notes.state === 'loaded' && (
                    <div className="flex min-h-0 flex-1 flex-col gap-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-3">
                                <button
                                    type="button"
                                    onClick={() => setNotes({ state: 'idle', markdown: '' })}
                                    className="text-xs font-medium text-primary-600 hover:underline"
                                >
                                    {t('loaded.backToActions')}
                                </button>
                                {notesGeneratedAt && (
                                    <span
                                        className="text-xs text-neutral-500"
                                        title={new Date(notesGeneratedAt).toLocaleString(
                                            i18n.language,
                                        )}
                                    >
                                        {t('loaded.generated', {
                                            timeAgo: formatDistanceToNow(
                                                new Date(notesGeneratedAt),
                                                { addSuffix: true },
                                            ),
                                        })}
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center gap-1.5">
                                <MyButton
                                    type="button"
                                    buttonType="primary"
                                    scale="small"
                                    onClick={() => setAddToCourseOpen(true)}
                                >
                                    <GraduationCap className="mr-1.5 size-3.5" />
                                    {t('loaded.addToCourse')}
                                </MyButton>
                                <MyButton
                                    type="button"
                                    buttonType="secondary"
                                    scale="small"
                                    onClick={() =>
                                        copyToClipboard(
                                            notes.markdown,
                                            t('loaded.lectureNotes'),
                                            t,
                                        )
                                    }
                                >
                                    <Copy className="mr-1.5 size-3.5" />
                                    {t('buttons.copy')}
                                </MyButton>
                                <MyButton
                                    type="button"
                                    buttonType="secondary"
                                    scale="small"
                                    disabled={downloadingPdf}
                                    onClick={async () => {
                                        const node = notesPrintRef.current;
                                        if (!node) return;
                                        setDownloadingPdf(true);
                                        try {
                                            await renderNodeToPdf(
                                                node,
                                                `${fileBase}.notes.pdf`,
                                            );
                                            toast.success(t('toasts.pdfDownloaded'));
                                        } catch (e) {
                                            const msg =
                                                e instanceof Error
                                                    ? e.message
                                                    : t('errors.pdfGenerationFailed');
                                            toast.error(msg);
                                        } finally {
                                            setDownloadingPdf(false);
                                        }
                                    }}
                                >
                                    <Download className="mr-1.5 size-3.5" />
                                    {downloadingPdf
                                        ? t('loaded.preparing')
                                        : t('loaded.downloadPdf')}
                                </MyButton>
                                <MyButton
                                    type="button"
                                    buttonType="secondary"
                                    scale="small"
                                    onClick={handleGenerateNotes}
                                >
                                    <Wand2 className="mr-1.5 size-3.5" />
                                    {t('loaded.regenerate')}
                                </MyButton>
                            </div>
                        </div>
                        <ScrollArea className="min-h-0 flex-1 rounded-lg border border-neutral-200 bg-white">
                            {/* Every element gets its style from
                                NOTES_MARKDOWN_COMPONENTS above (not prose-*
                                utilities, since @tailwindcss/typography isn't
                                installed in this project). We capture this
                                node for the PDF export, so the PDF mirrors
                                exactly what the user sees on screen.
                                `overflow-hidden` keeps wide content (mostly
                                naturally-wide diagrams) from being rendered
                                outside the container — without this,
                                html2canvas would still capture the overflow
                                and the PDF would crop/stretch the image. */}
                            <div
                                ref={notesPrintRef}
                                className="overflow-hidden bg-white px-8 py-6 text-base"
                            >
                                <ReactMarkdown
                                    components={NOTES_MARKDOWN_COMPONENTS}
                                    remarkPlugins={[remarkGfm]}
                                >
                                    {notes.markdown}
                                </ReactMarkdown>
                            </div>
                        </ScrollArea>
                    </div>
                )}

                {/* Loading indicator while transcript is being fetched. Only
                    shown if we don't already have either copy and aren't in
                    the middle of generating notes. */}
                {!transcriptReady && notes.state === 'idle' && (
                    <div className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-500">
                        {t('reader.loadingTranscript')}
                    </div>
                )}

                {/* Push the generated lecture notes into a course slide.
                    Rendered as a React descendant so Radix's nested-layer
                    handling keeps this transcript dialog open underneath. */}
                <AddToCourseDialog
                    open={addToCourseOpen}
                    onOpenChange={setAddToCourseOpen}
                    linkedBatches={linkedBatches}
                    content={{
                        kind: 'NOTES',
                        markdown: notes.markdown,
                        suggestedTitle: recordingTitle,
                    }}
                    capturePdf={async (captureOpts) => {
                        // Capture the exact rendered notes node the Download-PDF
                        // button uses, so the uploaded PDF slide matches 1:1.
                        const printNode = notesPrintRef.current;
                        if (!printNode) throw new Error(t('errors.notesNotReady'));
                        return captureNodeToPdfBlob(printNode, captureOpts);
                    }}
                />
            </div>
        </MyDialog>
    );
}

/**
 * Single CTA card with icon + tinted background. Two tones supported —
 * primary (blue) for the create-assessment path, violet for notes — so the
 * two actions read as visually distinct without being garish.
 */
function ActionCard({
    icon,
    title,
    description,
    cta,
    onClick,
    tone,
    disabled,
}: {
    icon: React.ReactNode;
    title: string;
    description: string;
    cta: string;
    onClick: () => void;
    tone: 'primary' | 'violet';
    disabled?: boolean;
}) {
    const toneStyles =
        tone === 'primary'
            ? {
                  ring: 'hover:border-primary-300 hover:bg-primary-50/40',
                  iconBg: 'bg-primary-50 text-primary-600',
                  // Match MyButton's primary variant: hover goes to the
                  // lighter primary-400, not darker primary-600. Going
                  // darker on this orange palette reads as a different
                  // (brown-ish) colour and feels off-brand.
                  cta: 'bg-primary-500 hover:bg-primary-400 active:bg-primary-400',
              }
            : {
                  ring: 'hover:border-violet-300 hover:bg-violet-50/40',
                  iconBg: 'bg-violet-50 text-violet-600',
                  cta: 'bg-violet-500 hover:bg-violet-400 active:bg-violet-400',
              };
    return (
        <div
            className={`flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4 transition-colors ${toneStyles.ring}`}
        >
            <div
                className={`flex size-10 items-center justify-center rounded-lg ${toneStyles.iconBg}`}
            >
                {icon}
            </div>
            <div>
                <div className="text-sm font-semibold text-neutral-800">{title}</div>
                <div className="mt-0.5 text-xs leading-relaxed text-neutral-500">
                    {description}
                </div>
            </div>
            <button
                type="button"
                disabled={disabled}
                onClick={onClick}
                className={`mt-auto inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${toneStyles.cta}`}
            >
                {cta}
            </button>
        </div>
    );
}
