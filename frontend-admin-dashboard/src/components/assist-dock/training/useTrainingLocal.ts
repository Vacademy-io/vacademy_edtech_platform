import { useEffect, useSyncExternalStore } from 'react';

/**
 * Per-browser state for the Training popup — no backend needed:
 *  - watch progress (resume position, "watched" once 90% is seen)
 *  - recent searches
 *  - video durations and one thumbnail frame per video
 *
 * Thumbnails: the first frame of every recording is the same dashboard screen, so we grab a
 * frame ~30% in (the actual feature) once, cache it as a small JPEG, and never touch the
 * (large, often 100-700 MB .mov) file again for browsing. CloudFront sends CORS `*`, so the
 * canvas isn't tainted. If a frame can't be read the card just keeps its icon placeholder.
 */

interface Progress {
    t: number;
    d: number;
    done?: boolean;
    at: number;
}

const KEYS = {
    progress: 'training.progress.v1',
    recent: 'training.recent.v1',
    durations: 'training.durations.v1',
    thumbs: 'training.thumbs.v1',
} as const;
const MAX_THUMBS = 120;

function read<T>(key: string, fallback: T): T {
    try {
        const raw = localStorage.getItem(key);
        return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
        return fallback;
    }
}
function write(key: string, value: unknown) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Quota or private mode — the popup still works, it just forgets.
    }
}

let progress: Record<string, Progress> | null = null;
let recent: string[] | null = null;
let durations: Record<string, number> | null = null;
let thumbs: Record<string, { src: string; at: number }> | null = null;
const load = () => {
    if (progress) return;
    progress = read(KEYS.progress, {});
    recent = read(KEYS.recent, []);
    durations = read(KEYS.durations, {});
    thumbs = read(KEYS.thumbs, {});
};

let version = 0;
const listeners = new Set<() => void>();
const emit = () => {
    version++;
    listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
};

/** Re-renders the caller whenever progress / thumbnails / durations change. */
export function useTrainingLocalVersion(): number {
    return useSyncExternalStore(subscribe, () => version);
}

export const trainingLocal = {
    isDone(id: string) {
        load();
        return !!progress![id]?.done;
    },
    /** 0..1 of the video watched so far. */
    fraction(id: string) {
        load();
        const p = progress![id];
        return p?.d ? Math.min(1, p.t / p.d) : 0;
    },
    resumeAt(id: string) {
        load();
        const p = progress![id];
        return p && !p.done && p.t > 5 && p.t < p.d - 5 ? p.t : 0;
    },
    lastWatchedAt(id: string) {
        load();
        return progress![id]?.at ?? 0;
    },
    saveProgress(id: string, t: number, d: number, ended = false) {
        load();
        if (!d || !isFinite(d)) return;
        const prev = progress![id];
        const done = !!prev?.done || ended || t / d >= 0.9;
        progress![id] = { t, d, done, at: Date.now() };
        write(KEYS.progress, progress);
        if (done !== !!prev?.done) emit();
    },
    recent(): string[] {
        load();
        return recent!;
    },
    addRecent(q: string) {
        load();
        const query = q.trim();
        if (query.length < 2) return;
        recent = [query, ...recent!.filter((r) => r.toLowerCase() !== query.toLowerCase())].slice(
            0,
            6
        );
        write(KEYS.recent, recent);
        emit();
    },
    duration(id: string): number | undefined {
        load();
        return durations![id];
    },
    setDuration(id: string, d: number) {
        load();
        if (!isFinite(d) || durations![id] === d) return;
        durations![id] = d;
        write(KEYS.durations, durations);
        emit();
    },
    thumb(id: string): string | undefined {
        load();
        return thumbs![id]?.src;
    },
};

/* ------------------------------------------------ thumbnail capture queue */

const queue: Array<{ id: string; url: string }> = [];
const queued = new Set<string>();
let busy = 0;

function saveThumb(id: string, src: string) {
    load();
    thumbs![id] = { src, at: Date.now() };
    const entries = Object.entries(thumbs!);
    if (entries.length > MAX_THUMBS) {
        entries.sort((a, b) => a[1].at - b[1].at);
        for (const [k] of entries.slice(0, entries.length - MAX_THUMBS)) delete thumbs![k];
    }
    write(KEYS.thumbs, thumbs);
    emit();
}

function capture(id: string, url: string) {
    busy++;
    const el = document.createElement('video');
    let finished = false;
    const finish = (src?: string) => {
        if (finished) return;
        finished = true;
        window.clearTimeout(timer);
        el.removeAttribute('src');
        el.load();
        busy--;
        if (src) saveThumb(id, src);
        pump();
    };
    const timer = window.setTimeout(() => finish(), 25000);
    el.crossOrigin = 'anonymous';
    el.muted = true;
    el.preload = 'metadata';
    el.playsInline = true;
    el.addEventListener(
        'loadedmetadata',
        () => {
            trainingLocal.setDuration(id, el.duration);
            el.currentTime = Math.min((isFinite(el.duration) ? el.duration : 60) * 0.3, 45);
        },
        { once: true }
    );
    el.addEventListener(
        'seeked',
        () => {
            try {
                const W = 480;
                const H = 270;
                const canvas = document.createElement('canvas');
                canvas.width = W;
                canvas.height = H;
                const s = Math.max(W / el.videoWidth, H / el.videoHeight);
                canvas
                    .getContext('2d')!
                    .drawImage(
                        el,
                        (W - el.videoWidth * s) / 2,
                        (H - el.videoHeight * s) / 2,
                        el.videoWidth * s,
                        el.videoHeight * s
                    );
                finish(canvas.toDataURL('image/jpeg', 0.72));
            } catch {
                finish();
            }
        },
        { once: true }
    );
    el.addEventListener('error', () => finish(), { once: true });
    el.src = url;
}

function pump() {
    while (busy < 2 && queue.length) {
        const next = queue.shift()!;
        capture(next.id, next.url);
    }
}

function requestThumb(id: string, url: string) {
    if (trainingLocal.thumb(id) || queued.has(id)) return;
    queued.add(id);
    queue.push({ id, url });
    pump();
}

/** Starts the one-time frame grab for a video once its card scrolls near the viewport. */
export function useThumbOnVisible(ref: React.RefObject<HTMLElement>, id: string, url: string) {
    useEffect(() => {
        const el = ref.current;
        if (!el || trainingLocal.thumb(id)) return;
        const io = new IntersectionObserver(
            (entries) => {
                if (entries.some((e) => e.isIntersecting)) {
                    io.disconnect();
                    requestThumb(id, url);
                }
            },
            { rootMargin: '300px' }
        );
        io.observe(el);
        return () => io.disconnect();
    }, [ref, id, url]);
}
