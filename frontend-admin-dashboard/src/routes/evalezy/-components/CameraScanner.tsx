import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Camera, Check, CircleNotch, UserPlus, X } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';
import type { EvalezyScanQuality } from '@/types/assessment-settings';
import { toScanPage, type ScanPage } from '../-lib/scan-pdf';

type CameraState = 'starting' | 'live' | 'unavailable';

/**
 * Full-screen camera for scanning answer copies one page after another. Pages
 * pile up on the current student's copy; "Next student" starts a new copy.
 * "Done" hands every non-empty copy back. Where the live camera is not
 * available (permission refused, old WebView, plain http) the phone's own
 * camera app is offered instead, one photo at a time, into the same copies.
 */
export const CameraScanner = ({
    scanQuality,
    onDone,
    singleDocument = false,
}: {
    scanQuality: EvalezyScanQuality;
    onDone: (copies: ScanPage[][]) => void;
    /** One document's pages (the question paper): no "Next student". */
    singleDocument?: boolean;
}) => {
    const { t } = useTranslation('evalezy');
    const videoRef = useRef<HTMLVideoElement>(null);
    const fallbackRef = useRef<HTMLInputElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const [camera, setCamera] = useState<CameraState>('starting');
    // A camera that has not answered in a few seconds (a permission prompt left
    // open, a stuck WebView) gets the camera-app way in alongside the spinner.
    const [slowStart, setSlowStart] = useState(false);
    useEffect(() => {
        const timer = window.setTimeout(() => setSlowStart(true), 8000);
        return () => window.clearTimeout(timer);
    }, []);
    // The ref is the truth ("Done" reads it right after the last page lands);
    // the state mirrors it for rendering.
    const copiesRef = useRef<ScanPage[][]>([[]]);
    const [copies, setCopies] = useState<ScanPage[][]>(copiesRef.current);
    const updateCopies = useCallback((change: (prev: ScanPage[][]) => ScanPage[][]) => {
        copiesRef.current = change(copiesRef.current);
        setCopies(copiesRef.current);
    }, []);
    const [busy, setBusy] = useState(0);
    const [flash, setFlash] = useState(false);
    // Pages are encoded one at a time, in tap order.
    const queue = useRef<Promise<void>>(Promise.resolve());

    useEffect(() => {
        let cancelled = false;
        const start = async () => {
            try {
                if (!navigator.mediaDevices?.getUserMedia) throw new Error('no camera api');
                const stream = await navigator.mediaDevices.getUserMedia({
                    audio: false,
                    video: {
                        facingMode: { ideal: 'environment' },
                        width: { ideal: 3840 },
                        height: { ideal: 2160 },
                    },
                });
                if (cancelled) {
                    stream.getTracks().forEach((track) => track.stop());
                    return;
                }
                streamRef.current = stream;
                const video = videoRef.current;
                if (video) {
                    video.srcObject = stream;
                    // Not awaited: some WebViews never settle play() for a muted
                    // inline stream, and the frames flow regardless.
                    void video.play().catch(() => undefined);
                }
                setCamera('live');
            } catch {
                if (!cancelled) setCamera('unavailable');
            }
        };
        void start();
        return () => {
            cancelled = true;
            streamRef.current?.getTracks().forEach((track) => track.stop());
            streamRef.current = null;
        };
    }, []);

    const addPage = useCallback(
        (source: Blob | HTMLCanvasElement) => {
            setBusy((n) => n + 1);
            queue.current = queue.current.then(async () => {
                try {
                    const page = await toScanPage(source, scanQuality);
                    updateCopies((prev) => {
                        const next = prev.slice();
                        next[next.length - 1] = [...(next[next.length - 1] ?? []), page];
                        return next;
                    });
                } catch {
                    toast.error(t('scanner.pageFailed'));
                } finally {
                    setBusy((n) => n - 1);
                }
            });
        },
        [scanQuality, t, updateCopies]
    );

    const capture = () => {
        const video = videoRef.current;
        if (!video || !video.videoWidth) return;
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
        setFlash(true);
        window.setTimeout(() => setFlash(false), 120);
        addPage(canvas);
    };

    const current = copies[copies.length - 1] ?? [];
    const copyNumber = copies.length;
    // Copies already closed with "Next student" (the one being scanned is not done).
    const finished = copies.slice(0, -1).filter((c) => c.length > 0);

    const nextStudent = () => {
        if (current.length === 0) return;
        updateCopies((prev) => [...prev, []]);
        toast.success(t('scanner.copySaved', { number: copyNumber }), { duration: 1500 });
    };

    const removePage = (id: string) => {
        updateCopies((prev) => {
            const next = prev.slice();
            const last = next[next.length - 1] ?? [];
            const gone = last.find((p) => p.id === id);
            if (gone) URL.revokeObjectURL(gone.url);
            next[next.length - 1] = last.filter((p) => p.id !== id);
            return next;
        });
    };

    const done = async () => {
        // Let the last tap finish encoding before handing the pages over.
        await queue.current;
        onDone(copiesRef.current.filter((c) => c.length > 0));
    };

    return (
        <div className="top-safe-native fixed inset-0 z-50 flex flex-col bg-neutral-900">
            <div className="flex items-center justify-between gap-3 bg-white px-4 py-3">
                <div className="flex min-w-0 flex-col">
                    <span className="text-subtitle font-semibold text-neutral-800">
                        {singleDocument
                            ? t('scanner.paperTitle')
                            : t('scanner.copy', { number: copyNumber })}
                    </span>
                    <span className="text-caption text-neutral-500">
                        {t('scanner.pages', { count: current.length })}
                        {finished.length > 0 &&
                            ` · ${t('scanner.copiesSoFar', { count: finished.length })}`}
                    </span>
                </div>
                <MyButton
                    type="button"
                    buttonType="primary"
                    scale="medium"
                    disabled={busy > 0}
                    onClick={() => void done()}
                >
                    <Check size={18} weight="bold" />
                    {t('scanner.done')}
                </MyButton>
            </div>

            <div className="relative flex flex-1 items-center justify-center overflow-hidden">
                <video
                    ref={videoRef}
                    playsInline
                    muted
                    autoPlay
                    className={cn('size-full object-contain', camera !== 'live' && 'hidden')}
                />
                {camera === 'starting' && !slowStart && (
                    <CircleNotch size={36} className="animate-spin text-neutral-300" />
                )}
                {(camera === 'unavailable' || (camera === 'starting' && slowStart)) && (
                    <div className="flex max-w-sm flex-col items-center gap-3 px-6 text-center">
                        <Camera size={40} className="text-neutral-300" />
                        <p className="text-body text-neutral-200">{t('scanner.noCamera')}</p>
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="large"
                            onClick={() => fallbackRef.current?.click()}
                        >
                            <Camera size={18} />
                            {t('scanner.takePhoto')}
                        </MyButton>
                        <input
                            ref={fallbackRef}
                            type="file"
                            accept="image/*"
                            capture="environment"
                            className="hidden"
                            onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) addPage(file);
                                e.target.value = '';
                            }}
                        />
                    </div>
                )}
                {flash && <div className="absolute inset-0 bg-white/70" />}
            </div>

            <div className="pb-safe-4 flex flex-col gap-3 bg-white p-4">
                {current.length > 0 && (
                    <ul className="flex gap-2 overflow-x-auto">
                        {current.map((page, index) => (
                            <li key={page.id} className="relative shrink-0">
                                <img
                                    src={page.url}
                                    alt={t('scanner.pageAlt', { number: index + 1 })}
                                    className="h-16 w-12 rounded-sm border border-neutral-200 object-cover"
                                />
                                <button
                                    type="button"
                                    aria-label={t('scanner.removePage', { number: index + 1 })}
                                    onClick={() => removePage(page.id)}
                                    className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-danger-600 text-white"
                                >
                                    <X size={12} weight="bold" />
                                </button>
                            </li>
                        ))}
                    </ul>
                )}

                <p className="text-center text-caption text-neutral-500">
                    {busy > 0
                        ? t('scanner.saving')
                        : singleDocument
                          ? t('scanner.paperHint')
                          : t('scanner.hint')}
                </p>
                {/* Equal side columns keep the shutter centred; on a 360px phone a third of the
                    row is narrower than "Next student", so that button may wrap instead of
                    spilling onto the shutter. */}
                <div className="flex items-center gap-3">
                    <div className="flex-1" />
                    <div className="flex shrink-0 justify-center">
                        <button
                            type="button"
                            aria-label={t('scanner.capture')}
                            disabled={camera !== 'live'}
                            onClick={capture}
                            className="flex size-16 items-center justify-center rounded-full border-4 border-primary-500 bg-white transition-transform active:scale-95 disabled:opacity-40"
                        >
                            <span className="size-12 rounded-full bg-primary-500" />
                        </button>
                    </div>
                    <div className="flex min-w-0 flex-1 justify-end">
                        {!singleDocument && (
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="medium"
                                className="h-auto min-h-10 whitespace-normal py-1.5 text-center leading-tight"
                                disabled={current.length === 0}
                                onClick={nextStudent}
                            >
                                <UserPlus size={18} />
                                {t('scanner.nextStudent')}
                            </MyButton>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
