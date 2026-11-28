import { useEffect, useRef, useState } from 'react';
import {
    ArrowSquareOut,
    CircleNotch,
    Desktop,
    DeviceMobile,
    Warning,
    X,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { MyButton } from '@/components/design-system/button';

/**
 * Blog post Preview — the unsaved draft on the REAL site, before publishing.
 *
 * Frames the post's own address on the learner site with
 * `?preview=true&blogPreview=1` and, once the site answers PREVIEW_READY,
 * posts the draft as BLOG_POST_PREVIEW {post}. The learner's BlogArticle shows
 * that draft instead of the published post (a DRAFT is not served by the
 * public API), with the site's header, theme and the blog section's layout —
 * exactly what visitors will see. Nothing is saved or published.
 *
 * Same handshake as the page editor's LiveSiteFrame: only the first READY from
 * this frame names the origin, and the draft is only ever posted to it.
 */

/** No READY by then = the site cannot answer here (blocked, older build). */
const READY_TIMEOUT_MS = 15_000;

export interface BlogPlacement {
    tagName: string;
    route: string;
    status: string;
}

const isHome = (route: string) => route === '' || route === 'home' || route === 'homepage';
const isActive = (status: string) => status === 'ACTIVE' || status === 'active';

/**
 * Where to show the draft: a published site first (a draft-only site has no
 * live config to render), and a dedicated blog page over the home page (its
 * articles get their own address and the section's layout).
 */
export const pickPreviewPlacement = (placements: BlogPlacement[]): BlogPlacement | null => {
    const rank = (p: BlogPlacement) => (isActive(p.status) ? 0 : 2) + (isHome(p.route) ? 1 : 0);
    return [...placements].sort((a, b) => rank(a) - rank(b))[0] ?? null;
};

/** The framed address of the post on `siteBase` (…/<tag>), or null if invalid. */
export const buildBlogPreviewUrl = (
    siteBase: string,
    placement: BlogPlacement,
    slug: string,
    instituteId: string | null
): string | null => {
    try {
        const safeSlug = encodeURIComponent(slug || 'preview');
        const url = new URL(
            isHome(placement.route) ? siteBase : `${siteBase}/${placement.route}/${safeSlug}`
        );
        if (isHome(placement.route)) url.searchParams.set('post', slug || 'preview');
        url.searchParams.set('preview', 'true');
        url.searchParams.set('blogPreview', '1');
        // Institutes without their own domain resolve to the host's institute;
        // the learner honours this only in a framed preview.
        if (instituteId) url.searchParams.set('instituteId', instituteId);
        return url.toString();
    } catch {
        return null;
    }
};

/** Roughly what the server computes: ~200 words a minute, at least 1. */
export const estimateReadingMinutes = (html: string): number => {
    const text = (html || '')
        .replace(/<(style|script)\b[^>]*>[\s\S]*?(<\/\1\s*>|$)/gi, ' ')
        .replace(/<[^>]+>/g, ' ');
    const words = text.split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.round(words / 200));
};

interface BlogPreviewDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** The framed address (buildBlogPreviewUrl), or null when there is none. */
    frameUrl: string | null;
    /** Shown above the frame, e.g. "my-site/blog". */
    placementLabel: string;
    /** The draft as the learner's BlogPostSummary (snake_case). */
    post: Record<string, unknown>;
}

export const BlogPreviewDialog = ({
    open,
    onOpenChange,
    frameUrl,
    placementLabel,
    post,
}: BlogPreviewDialogProps) => {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const frameOrigin = useRef<string | null>(null);
    const postRef = useRef(post);
    postRef.current = post;
    const [ready, setReady] = useState(false);
    const [timedOut, setTimedOut] = useState(false);
    const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');

    // A fresh frame (opened, or the device changed) waits for READY again.
    useEffect(() => {
        if (!open || !frameUrl) return;
        setReady(false);
        setTimedOut(false);
        frameOrigin.current = null;
        const timer = setTimeout(() => setTimedOut(true), READY_TIMEOUT_MS);
        const onMessage = (event: MessageEvent) => {
            if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return;
            if ((event.data as { type?: string } | null)?.type !== 'PREVIEW_READY') return;
            if (frameOrigin.current && event.origin !== frameOrigin.current) return;
            frameOrigin.current = event.origin;
            iframeRef.current.contentWindow?.postMessage(
                { type: 'BLOG_POST_PREVIEW', post: postRef.current },
                event.origin
            );
            clearTimeout(timer);
            setReady(true);
        };
        window.addEventListener('message', onMessage);
        return () => {
            clearTimeout(timer);
            window.removeEventListener('message', onMessage);
        };
    }, [open, frameUrl, device]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            {/* The base DialogContent is a fixed 400px card; the preview needs the screen. */}
            <DialogContent
                className="dialog-no-close-icon flex h-[92vh] w-[96vw] max-w-screen-2xl flex-col gap-0 overflow-hidden p-0" // design-lint-ignore: viewport-sized like BlogManagerDialog
                aria-describedby={undefined}
            >
                <div className="flex flex-wrap items-center gap-3 border-b border-neutral-200 bg-white px-4 py-3">
                    <DialogTitle className="text-sm font-semibold text-neutral-800">
                        Preview
                    </DialogTitle>
                    <span className="truncate font-mono text-xs text-neutral-500">
                        {placementLabel}
                    </span>
                    <span className="text-xs text-neutral-400">Unsaved draft · not published</span>
                    <div className="ml-auto flex items-center gap-2">
                        <div className="flex items-center gap-1 rounded-md border border-neutral-200 p-0.5">
                            {(
                                [
                                    { key: 'desktop', label: 'Desktop', Icon: Desktop },
                                    { key: 'mobile', label: 'Mobile', Icon: DeviceMobile },
                                ] as const
                            ).map(({ key, label, Icon }) => (
                                <button
                                    key={key}
                                    type="button"
                                    onClick={() => setDevice(key)}
                                    aria-pressed={device === key}
                                    className={cn(
                                        'inline-flex items-center gap-1 rounded-sm px-2 py-1 text-xs',
                                        device === key
                                            ? 'bg-primary-50 text-primary-500'
                                            : 'text-neutral-600 hover:bg-neutral-50'
                                    )}
                                >
                                    <Icon className="size-3.5" /> {label}
                                </button>
                            ))}
                        </div>
                        <DialogClose asChild>
                            <MyButton buttonType="text" scale="small" aria-label="Close preview">
                                <X className="size-4" />
                            </MyButton>
                        </DialogClose>
                    </div>
                </div>

                <div className="relative min-h-0 flex-1 overflow-auto bg-neutral-100">
                    {!frameUrl ? (
                        <div className="flex h-full items-center justify-center p-6 text-center text-sm text-neutral-500">
                            No website page has a Blog section yet, so there is nowhere to preview
                            this post.
                        </div>
                    ) : (
                        <>
                            <iframe
                                key={`${frameUrl}-${device}`}
                                ref={iframeRef}
                                src={frameUrl}
                                title="Blog post preview"
                                className={cn(
                                    'mx-auto block h-full border-0 bg-white',
                                    device === 'mobile' ? 'w-full max-w-sm shadow-md' : 'w-full'
                                )}
                            />
                            {!ready && (
                                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white/90 p-6 text-center text-sm text-neutral-600">
                                    {timedOut ? (
                                        <>
                                            <Warning className="size-6 text-warning-500" />
                                            <p>
                                                The website did not answer, so the draft could not
                                                be shown.
                                            </p>
                                            <a
                                                href={frameUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center gap-1 text-primary-500 hover:underline"
                                            >
                                                <ArrowSquareOut className="size-4" /> Open the site
                                            </a>
                                        </>
                                    ) : (
                                        <>
                                            <CircleNotch className="size-6 animate-spin text-primary-500" />
                                            <p>Loading the website…</p>
                                        </>
                                    )}
                                </div>
                            )}
                        </>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};
