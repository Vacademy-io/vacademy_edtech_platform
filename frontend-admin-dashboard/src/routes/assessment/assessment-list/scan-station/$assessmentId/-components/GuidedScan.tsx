import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
    CheckCircle,
    CircleNotch,
    DownloadSimple,
    FolderOpen,
    Printer,
    Scan,
    WarningCircle,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import type { ScanSession } from '../-services/scan-station-services';
import {
    detectHelper,
    downloadPassFiles,
    scanHelper,
    ScanHelperError,
    SCAN_HELPER_DOWNLOAD_URL,
    type HelperDetection,
    type HelperJob,
    type HelperPage,
} from '../-lib/scan-helper-client';
import { MAX_PAGES_PER_PASS } from '../-lib/pass-precheck';
import { ScanUploadError } from '../-lib/upload-scan-file';
import { newestLoadNo, prepareLoad, sendLoad } from '../-lib/submit-load';
import { apiErrorMessage } from '../-lib/api-error';
import { useOnScanNotFound } from '../-hooks/useScanActions';
import { HELPER_STATUS_POLL_MS, useScanHelperStatus } from '../-hooks/useScanHelperStatus';
import { PutPileIllustration, TurnOverIllustration } from './ScanIllustrations';

/** How often a running scan is asked for its pages. */
export const JOB_POLL_MS = 700;
/** What the clerk is told the feeder takes (the Brother ADF holds 20 sheets). */
export const FEEDER_SHEETS = 20;
const SCAN_DPI = 300;
/** Polls in a row the helper may miss before the scan counts as lost. */
const MAX_POLL_MISSES = 8;

interface Pass {
    jobId: string;
    pages: HelperPage[];
}

/** A = first side, B = the pile turned over, D = both sides in one go. */
type Side = 'A' | 'B' | 'D';

type Phase =
    | { name: 'stepA'; sentLoad: number | null }
    | {
          name: 'scanning';
          side: Side;
          jobId: string;
          pages: HelperPage[];
          passA: Pass | null;
          cancelling: boolean;
      }
    | { name: 'stepB'; passA: Pass }
    | { name: 'mismatch'; passes: Pass[]; duplex: boolean }
    | { name: 'sending'; passes: Pass[]; duplex: boolean }
    | { name: 'failed'; passes: Pass[]; duplex: boolean; lines: string[]; retry: boolean }
    | { name: 'finished' };

type Progress = { key: string; params?: Record<string, number> };

const byIndex = (pages: HelperPage[]) => [...pages].sort((a, b) => a.index - b.index);

const KNOWN_ERRORS = [
    'SCANNER_BUSY',
    'SCANNER_NOT_FOUND',
    'NO_PAPER',
    'UNSUPPORTED',
    'PAPER_JAM',
    'DEVICE_GONE',
    'UNREACHABLE',
    'ORIGIN_NOT_ALLOWED',
];
const errorKey = (code: string | undefined) =>
    `guided.errors.${code && KNOWN_ERRORS.includes(code) ? code : 'UNKNOWN'}`;

/**
 * Scan straight from the scanner through Vacademy Scan Helper: the clerk is
 * walked through each side of each pile, nothing scans until they click Start,
 * the two sides are counted at once, and a good load goes through the same
 * checks, strict upload and load call as the folder intake.
 */
export const GuidedScan = ({
    sessionId,
    instituteId,
    nextLoadNo,
    maxPagesPerPass = MAX_PAGES_PER_PASS,
    loadsFull = false,
    maxLoads = 0,
    onLoadSent,
    onUseFolders,
    statusPollMs = HELPER_STATUS_POLL_MS,
    jobPollMs = JOB_POLL_MS,
}: {
    sessionId: string;
    instituteId: string;
    /** The number the next load will get. */
    nextLoadNo: number;
    maxPagesPerPass?: number;
    loadsFull?: boolean;
    maxLoads?: number;
    onLoadSent: (session: ScanSession) => void;
    onUseFolders: () => void;
    statusPollMs?: number;
    jobPollMs?: number;
}) => {
    const { t } = useTranslation('scanStation');
    const onNotFound = useOnScanNotFound(instituteId);
    const [phase, setPhase] = useState<Phase>({ name: 'stepA', sentLoad: null });
    const [notice, setNotice] = useState<string | null>(null);
    const [starting, setStarting] = useState(false);
    const [progress, setProgress] = useState<Progress | null>(null);
    const phaseRef = useRef(phase);
    phaseRef.current = phase;
    /** Helper jobs this page still holds, freed after the load is sent or dropped. */
    const heldJobs = useRef(new Set<string>());

    const status = useScanHelperStatus(true, statusPollMs);
    const ownJob = phase.name === 'scanning' || phase.name === 'sending' || starting;
    const detection = detectHelper(status, ownJob);
    const ready = detection.kind === 'ready' ? detection : null;

    const passLabels = useMemo(
        () => ({ first: t('intake.first'), second: t('intake.second'), one: t('intake.one') }),
        [t]
    );

    const forget = (jobId: string) => {
        heldJobs.current.delete(jobId);
        scanHelper.remove(jobId).catch(() => undefined);
    };

    // Leaving the page: stop a running scan and free what the helper holds.
    useEffect(() => {
        const held = heldJobs.current;
        return () => {
            const p = phaseRef.current;
            const running = p.name === 'scanning' ? p.jobId : null;
            held.forEach((jobId) => {
                const free = () => scanHelper.remove(jobId).catch(() => undefined);
                if (jobId === running)
                    void scanHelper
                        .cancel(jobId)
                        .catch(() => undefined)
                        .then(free);
                else void free();
            });
            held.clear();
        };
    }, []);

    const backToStep = (side: Side, passA: Pass | null) =>
        setPhase(
            side === 'B' && passA ? { name: 'stepB', passA } : { name: 'stepA', sentLoad: null }
        );

    const start = async (side: Side, passA: Pass | null) => {
        if (!ready || loadsFull || starting) return;
        setNotice(null);
        setStarting(true);
        try {
            const jobId = await scanHelper.startScan({
                scanner_id: ready.scanner.id,
                source: 'feeder',
                duplex: side === 'D',
                dpi: SCAN_DPI,
                color: true,
            });
            heldJobs.current.add(jobId);
            setPhase({ name: 'scanning', side, jobId, pages: [], passA, cancelling: false });
        } catch (e) {
            setNotice(t(errorKey(e instanceof ScanHelperError ? e.code : undefined)));
        } finally {
            setStarting(false);
        }
    };

    const send = async (passes: Pass[], duplex: boolean) => {
        setPhase({ name: 'sending', passes, duplex });
        const total = passes.reduce((n, p) => n + p.pages.length, 0);
        let got = 0;
        const onPage = () => {
            got += 1;
            setProgress({ key: 'guided.downloading', params: { done: got, total } });
        };
        setProgress({ key: 'guided.downloading', params: { done: 0, total } });
        try {
            const mode = duplex ? 'DUPLEX' : 'TWO_PASSES';
            let prepared;
            if (duplex) {
                const files = await downloadPassFiles(
                    passes[0]!.pages,
                    'scan',
                    onPage,
                    scanHelper.pageBlob
                );
                setProgress({ key: 'intake.checking' });
                prepared = await prepareLoad(mode, [], [], files, maxPagesPerPass, passLabels);
            } else {
                const first = await downloadPassFiles(
                    passes[0]!.pages,
                    'pass1',
                    onPage,
                    scanHelper.pageBlob
                );
                const second = await downloadPassFiles(
                    passes[1]!.pages,
                    'pass2',
                    onPage,
                    scanHelper.pageBlob
                );
                setProgress({ key: 'intake.checking' });
                prepared = await prepareLoad(mode, first, second, [], maxPagesPerPass, passLabels);
            }
            if (!prepared || !prepared.passes || prepared.errors.length > 0) {
                setProgress(null);
                setPhase({
                    name: 'failed',
                    passes,
                    duplex,
                    retry: false,
                    lines: (prepared?.errors ?? []).map((m) => t(m.key, m.params)),
                });
                return;
            }
            const userId =
                getTokenDecodedData(getTokenFromCookie(TokenKey.accessToken))?.user ?? '';
            const session = await sendLoad({
                prepared,
                mode,
                sessionId,
                instituteId,
                userId,
                onProgress: (done, all) =>
                    setProgress(
                        done < all
                            ? { key: 'intake.uploading', params: { done, total: all } }
                            : { key: 'intake.sending' }
                    ),
            });
            onLoadSent(session);
            passes.forEach((p) => forget(p.jobId));
            setProgress(null);
            setPhase({ name: 'stepA', sentLoad: newestLoadNo(session) });
        } catch (e) {
            setProgress(null);
            let line: string;
            if (e instanceof ScanHelperError) line = t('guided.errors.DOWNLOAD');
            else if (e instanceof ScanUploadError)
                line = t('intake.uploadFailed', { name: e.fileName });
            else if (onNotFound(e)) line = t('intake.addFailed');
            else line = apiErrorMessage(e, t('intake.addFailed'));
            setPhase({ name: 'failed', passes, duplex, retry: true, lines: [line] });
        }
    };

    const scanned = (side: Side, passA: Pass | null, job: HelperJob) => {
        const pass: Pass = { jobId: job.job_id, pages: byIndex(job.pages) };
        if (pass.pages.length === 0) {
            forget(pass.jobId);
            setNotice(t('guided.errors.NOTHING_SCANNED'));
            backToStep(side, passA);
            return;
        }
        if (side === 'A') {
            setPhase({ name: 'stepB', passA: pass });
        } else if (side === 'B' && passA) {
            if (pass.pages.length === passA.pages.length) void send([passA, pass], false);
            else setPhase({ name: 'mismatch', passes: [passA, pass], duplex: false });
        } else if (pass.pages.length % 2 !== 0) {
            setPhase({ name: 'mismatch', passes: [pass], duplex: true });
        } else {
            void send([pass], true);
        }
    };

    // While a scan runs: ask for its pages every ~700 ms until it ends.
    const runningJob = phase.name === 'scanning' ? phase.jobId : null;
    useEffect(() => {
        if (!runningJob) return undefined;
        let stopped = false;
        let misses = 0;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const current = () => {
            const p = phaseRef.current;
            return p.name === 'scanning' && p.jobId === runningJob ? p : null;
        };
        const poll = async () => {
            let job: HelperJob | null = null;
            try {
                job = await scanHelper.job(runningJob);
                misses = 0;
            } catch {
                misses += 1;
            }
            const p = current();
            if (stopped || !p || p.cancelling) return;
            if (!job) {
                if (misses >= MAX_POLL_MISSES) {
                    forget(runningJob);
                    setNotice(t('guided.errors.UNREACHABLE'));
                    backToStep(p.side, p.passA);
                    return;
                }
            } else if (job.state === 'done') {
                scanned(p.side, p.passA, job);
                return;
            } else if (job.state === 'failed' || job.state === 'cancelled') {
                forget(runningJob);
                setNotice(
                    job.state === 'cancelled' ? t('guided.cancelled') : t(errorKey(job.error?.code))
                );
                backToStep(p.side, p.passA);
                return;
            } else {
                const pages = byIndex(job.pages);
                setPhase((prev) =>
                    prev.name === 'scanning' && prev.jobId === runningJob
                        ? { ...prev, pages }
                        : prev
                );
            }
            timer = setTimeout(() => void poll(), jobPollMs);
        };
        timer = setTimeout(() => void poll(), jobPollMs);
        return () => {
            stopped = true;
            if (timer) clearTimeout(timer);
        };
        // scanned/backToStep read the latest phase through phaseRef.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [runningJob, jobPollMs]);

    const cancel = async () => {
        const p = phaseRef.current;
        if (p.name !== 'scanning' || p.cancelling) return;
        setPhase({ ...p, cancelling: true });
        await scanHelper.cancel(p.jobId).catch(() => undefined);
        forget(p.jobId);
        setNotice(t('guided.cancelled'));
        backToStep(p.side, p.passA);
    };

    const restartLoad = (passes: Pass[]) => {
        passes.forEach((p) => forget(p.jobId));
        setNotice(null);
        setPhase({ name: 'stepA', sentLoad: null });
    };

    const deviceSummary = ready
        ? [
              ready.scanner.name,
              t('guided.device.feeder'),
              t(ready.duplex ? 'guided.device.bothSides' : 'guided.device.oneSide'),
              ready.printer
                  ? t(
                        ready.printer.duplex
                            ? 'guided.device.printsTwoSided'
                            : 'guided.device.printsOneSided'
                    )
                  : null,
          ]
              .filter(Boolean)
              .join(' · ')
        : null;

    const idle = phase.name === 'stepA' || phase.name === 'finished';
    const startBlocked = !ready || loadsFull || starting;

    const startButton = (side: Side, passA: Pass | null) => (
        <MyButton
            type="button"
            buttonType="primary"
            scale="medium"
            className="gap-1"
            disabled={startBlocked}
            onClick={() => void start(side, passA)}
        >
            {starting ? <CircleNotch size={16} className="animate-spin" /> : <Scan size={16} />}
            {t('guided.start')}
        </MyButton>
    );
    const restartButton = (passes: Pass[]) => (
        <MyButton
            type="button"
            buttonType="secondary"
            scale="medium"
            onClick={() => restartLoad(passes)}
        >
            {t('guided.restartLoad')}
        </MyButton>
    );

    const body = (): ReactNode => {
        if (idle && !ready) return <DetectionNotice detection={detection} />;
        const side = (s: 'first' | 'second' | 'both') =>
            t('guided.loadSide', { load: nextLoadNo, side: t(`guided.side.${s}`) });

        switch (phase.name) {
            case 'finished':
                return (
                    <div className="flex flex-wrap items-center gap-3">
                        <p className="flex items-center gap-2 text-body text-neutral-700">
                            <CheckCircle size={18} className="text-success-600" />
                            {t('guided.finished')}
                        </p>
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="medium"
                            disabled={loadsFull}
                            onClick={() => setPhase({ name: 'stepA', sentLoad: null })}
                        >
                            {t('guided.scanAnother')}
                        </MyButton>
                    </div>
                );
            case 'stepA': {
                const both = !!ready?.duplex;
                return (
                    <div className="flex flex-col gap-3">
                        {phase.sentLoad !== null && (
                            <p className="flex items-center gap-2 rounded-md border border-success-200 bg-success-50 p-3 text-body text-success-700">
                                <CheckCircle size={18} className="shrink-0" />
                                {t('guided.sent', { load: phase.sentLoad })}
                            </p>
                        )}
                        <Step
                            picture={<PutPileIllustration />}
                            label={side(both ? 'both' : 'first')}
                            instruction={t('guided.stepA', { max: FEEDER_SHEETS })}
                            extra={
                                both ? (
                                    <p className="text-caption text-warning-700">
                                        {t('intake.duplexUntested')}
                                    </p>
                                ) : null
                            }
                        >
                            {startButton(both ? 'D' : 'A', null)}
                            {phase.sentLoad !== null && (
                                <MyButton
                                    type="button"
                                    buttonType="secondary"
                                    scale="medium"
                                    onClick={() => {
                                        setNotice(null);
                                        setPhase({ name: 'finished' });
                                    }}
                                >
                                    {t('guided.finish')}
                                </MyButton>
                            )}
                        </Step>
                    </div>
                );
            }
            case 'scanning':
                return (
                    <div className="flex flex-col gap-3">
                        <div className="flex flex-wrap items-center gap-3">
                            <p className="flex items-center gap-2 text-body font-medium text-neutral-800">
                                <CircleNotch size={16} className="animate-spin text-primary-500" />
                                {t('guided.scanning', { count: phase.pages.length })}
                            </p>
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="small"
                                className="ms-auto"
                                disabled={phase.cancelling}
                                onClick={() => void cancel()}
                            >
                                {t('guided.cancel')}
                            </MyButton>
                        </div>
                        <Thumbs pages={phase.pages} />
                    </div>
                );
            case 'stepB':
                return (
                    <div className="flex flex-col gap-3">
                        <p className="flex items-center gap-2 text-body text-success-700">
                            <CheckCircle size={18} className="shrink-0" />
                            {t('guided.sideDone', { count: phase.passA.pages.length })}
                        </p>
                        <Thumbs pages={phase.passA.pages} />
                        <Step
                            picture={<TurnOverIllustration />}
                            label={side('second')}
                            instruction={[
                                t('guided.stepB1'),
                                t('guided.stepB2'),
                                t('guided.stepB3'),
                            ]}
                        >
                            {startButton('B', phase.passA)}
                            {restartButton([phase.passA])}
                        </Step>
                    </div>
                );
            case 'mismatch': {
                const [a, b] = phase.passes;
                return (
                    <div className="flex flex-col gap-3 rounded-md border border-danger-200 bg-danger-50 p-3">
                        <p className="flex items-start gap-2 text-body text-danger-700">
                            <WarningCircle size={18} className="mt-px shrink-0" />
                            {phase.duplex
                                ? t('guided.mismatchDuplex', { count: a?.pages.length ?? 0 })
                                : t('guided.mismatch', {
                                      a: a?.pages.length ?? 0,
                                      b: b?.pages.length ?? 0,
                                  })}
                        </p>
                        <div className="flex flex-wrap gap-2">
                            {!phase.duplex && a && b && (
                                <MyButton
                                    type="button"
                                    buttonType="primary"
                                    scale="medium"
                                    onClick={() => {
                                        forget(b.jobId);
                                        setNotice(null);
                                        setPhase({ name: 'stepB', passA: a });
                                    }}
                                >
                                    {t('guided.rescanSide')}
                                </MyButton>
                            )}
                            {restartButton(phase.passes)}
                        </div>
                    </div>
                );
            }
            case 'sending':
                return (
                    <p className="flex items-center gap-2 text-body text-neutral-700">
                        <CircleNotch size={16} className="animate-spin text-primary-500" />
                        {progress ? t(progress.key, progress.params) : t('intake.sending')}
                    </p>
                );
            case 'failed':
                return (
                    <div className="flex flex-col gap-3 rounded-md border border-danger-200 bg-danger-50 p-3">
                        <ul className="flex flex-col gap-1">
                            {phase.lines.map((line, i) => (
                                <li
                                    key={i}
                                    className="flex items-start gap-2 text-caption text-danger-700"
                                >
                                    <WarningCircle size={16} className="mt-px shrink-0" />
                                    {line}
                                </li>
                            ))}
                        </ul>
                        <div className="flex flex-wrap gap-2">
                            {phase.retry && (
                                <MyButton
                                    type="button"
                                    buttonType="primary"
                                    scale="medium"
                                    onClick={() => void send(phase.passes, phase.duplex)}
                                >
                                    {t('guided.retry')}
                                </MyButton>
                            )}
                            {restartButton(phase.passes)}
                        </div>
                    </div>
                );
            default:
                return null;
        }
    };

    return (
        <section
            className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4"
            aria-label={t('guided.title')}
        >
            <div className="flex flex-wrap items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary-500">
                    <Scan size={20} />
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                    <h2 className="text-subtitle font-semibold text-neutral-800">
                        {t('guided.title')}
                    </h2>
                    {deviceSummary && (
                        <p className="flex items-center gap-1 text-caption text-neutral-600">
                            {ready?.printer && <Printer size={14} className="shrink-0" />}
                            {deviceSummary}
                        </p>
                    )}
                </div>
                <MyButton
                    type="button"
                    buttonType="text"
                    scale="small"
                    className="gap-1"
                    disabled={phase.name === 'scanning' || phase.name === 'sending'}
                    onClick={onUseFolders}
                >
                    <FolderOpen size={14} />
                    {t('guided.useFolders')}
                </MyButton>
            </div>

            {body()}

            {!idle && !ready && phase.name !== 'scanning' && phase.name !== 'sending' && (
                <DetectionNotice detection={detection} compact />
            )}
            {loadsFull && phase.name === 'stepA' && (
                <p className="text-caption text-neutral-600">
                    {t('addLoad.full', { max: maxLoads })}
                </p>
            )}
            {notice && (
                <p role="alert" className="flex items-start gap-2 text-caption text-danger-700">
                    <WarningCircle size={16} className="mt-px shrink-0" />
                    {notice}
                </p>
            )}
        </section>
    );
};

const Step = ({
    picture,
    label,
    instruction,
    extra,
    children,
}: {
    picture: ReactNode;
    label: string;
    /** One sentence, or numbered steps when a single sentence would be too much. */
    instruction: string | string[];
    extra?: ReactNode;
    children: ReactNode;
}) => (
    <div className="flex flex-col gap-3 rounded-md border border-neutral-100 bg-neutral-50 p-3 sm:flex-row sm:items-center">
        {picture}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
            <p className="text-caption font-medium text-primary-600">{label}</p>
            {Array.isArray(instruction) ? (
                <ol className="flex list-decimal flex-col gap-1 ps-5 text-body text-neutral-800">
                    {instruction.map((line) => (
                        <li key={line}>{line}</li>
                    ))}
                </ol>
            ) : (
                <p className="text-body text-neutral-800">{instruction}</p>
            )}
            {extra}
            <div className="flex flex-wrap items-center gap-2">{children}</div>
        </div>
    </div>
);

const Thumbs = ({ pages }: { pages: HelperPage[] }) => {
    if (pages.length === 0) return null;
    return (
        <ol className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8">
            {pages.map((page, i) => (
                <li key={page.index} className="flex flex-col items-center gap-1">
                    <HelperThumb page={page} position={i + 1} />
                    <span className="text-caption text-neutral-500">{i + 1}</span>
                </li>
            ))}
        </ol>
    );
};

/** One preview from the helper, shown from a blob URL that is freed on unmount. */
const HelperThumb = ({ page, position }: { page: HelperPage; position: number }) => {
    const { t } = useTranslation('scanStation');
    const [src, setSrc] = useState<string | null>(null);
    useEffect(() => {
        let url: string | null = null;
        let gone = false;
        scanHelper
            .thumbBlob(page)
            .then((blob) => {
                if (gone) return;
                url = URL.createObjectURL(blob);
                setSrc(url);
            })
            .catch(() => undefined);
        return () => {
            gone = true;
            if (url) URL.revokeObjectURL(url);
        };
    }, [page]);
    const box = 'h-24 w-full rounded border border-neutral-200 bg-neutral-100';
    return src ? (
        <img
            src={src}
            alt={t('guided.pageAlt', { n: position })}
            className={`${box} object-contain`}
        />
    ) : (
        <span className={`${box} flex items-center justify-center`} aria-hidden="true">
            <CircleNotch size={14} className="animate-spin text-neutral-400" />
        </span>
    );
};

/** What to do when the scanner cannot be used yet. */
const DetectionNotice = ({
    detection,
    compact = false,
}: {
    detection: HelperDetection;
    compact?: boolean;
}) => {
    const { t } = useTranslation('scanStation');
    if (detection.kind === 'ready') return null;
    if (detection.kind === 'checking') {
        return (
            <p className="flex items-center gap-2 text-caption text-neutral-600">
                <CircleNotch size={14} className="animate-spin" />
                {t('guided.detect.checking')}
            </p>
        );
    }
    if (detection.kind === 'noHelper' && !compact) {
        return (
            <div className="flex flex-col gap-2 rounded-md border border-info-200 bg-info-50 p-3">
                <p className="text-body font-medium text-neutral-800">
                    {t('guided.detect.install.title')}
                </p>
                <p className="text-caption text-neutral-700">{t('guided.detect.install.body')}</p>
                <div className="flex flex-wrap items-center gap-2">
                    <a
                        href={SCAN_HELPER_DOWNLOAD_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-9 items-center gap-1 rounded-md bg-primary-500 px-3 text-body font-semibold text-neutral-50 hover:bg-primary-400"
                    >
                        <DownloadSimple size={16} />
                        {t('guided.detect.install.download')}
                    </a>
                </div>
                <p className="text-caption text-neutral-600">{t('guided.detect.install.hint')}</p>
            </div>
        );
    }
    const key =
        detection.kind === 'noHelper'
            ? 'guided.detect.lost'
            : detection.kind === 'noScanner'
              ? 'guided.detect.noScanner'
              : detection.kind === 'otherApp'
                ? 'guided.detect.otherApp'
                : detection.kind === 'busy'
                  ? 'guided.detect.busy'
                  : 'guided.detect.glassOnly';
    return (
        <p
            className="flex items-start gap-2 rounded-md border border-warning-200 bg-warning-50 p-3 text-body text-warning-700"
            data-detection={detection.kind}
        >
            <WarningCircle size={18} className="mt-px shrink-0" />
            {t(key)}
        </p>
    );
};

export default GuidedScan;
