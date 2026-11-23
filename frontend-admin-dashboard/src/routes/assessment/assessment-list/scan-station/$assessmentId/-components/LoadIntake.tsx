import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle, CircleNotch, Warning, WarningCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { cn } from '@/lib/utils';
import {
    addScanLoad,
    replaceScanLoad,
    type ScanClientWarning,
    type ScanFileKind,
    type ScanIntakeMode,
    type ScanOrderSource,
    type ScanSession,
} from '../-services/scan-station-services';
import { orderScanFiles, type OrderedFiles } from '../-lib/order-files';
import { deinterleaveDuplex, splitOneFolder, type SplitRefusal } from '../-lib/split-passes';
import { MAX_PAGES_PER_PASS, precheckLoad, type PrecheckResult } from '../-lib/pass-precheck';
import { ScanUploadError, uploadScanFiles } from '../-lib/upload-scan-file';
import { buildLoadBody, type UploadedPassFile } from '../-lib/load-body';
import { rememberLocalFile } from '../-lib/local-files';
import { apiErrorMessage } from '../-lib/api-error';
import { useOnScanNotFound } from '../-hooks/useScanActions';
import { PassDropZone } from './PassDropZone';

const MODES: ScanIntakeMode[] = ['TWO_PASSES', 'ONE_FOLDER', 'DUPLEX'];

type Message = { key: string; params?: Record<string, string | number> };

interface Prepared {
    passes: [File[], File[]] | null;
    precheck: PrecheckResult | null;
    orderSource: ScanOrderSource;
    warnings: ScanClientWarning[];
    errors: Message[];
    notes: Message[];
    /** One-folder mode: the split the clerk must confirm. */
    split: { first: number; second: number; name: string } | null;
}

const listNames = (names: string[]) =>
    names.length > 3 ? `${names.slice(0, 3).join(', ')} +${names.length - 3}` : names.join(', ');

const orderMessages = (o: OrderedFiles<File>, pass: string): Message[] => {
    const out: Message[] = [];
    if (o.errors.includes('INDEX_GAP')) {
        out.push({
            key: 'intake.errors.INDEX_GAP',
            params: { pass, name: o.gapAfter ?? '', index: o.missingIndex ?? '' },
        });
    }
    if (o.errors.includes('DUPLICATE_INDEX')) {
        out.push({
            key: 'intake.errors.DUPLICATE_INDEX',
            params: { pass, names: listNames(o.duplicateNames ?? []) },
        });
    }
    if (o.errors.includes('MIXED_STEMS'))
        out.push({ key: 'intake.errors.MIXED_STEMS', params: { pass } });
    return out;
};

const precheckMessages = (r: PrecheckResult, maxPages: number): Message[] =>
    r.errors.map((code): Message => {
        switch (code) {
            case 'COUNT_MISMATCH':
                return {
                    key: 'intake.errors.COUNT_MISMATCH',
                    params: { a: r.pageCounts[0], b: r.pageCounts[1] },
                };
            case 'UNSUPPORTED_FILE':
                return {
                    key: 'intake.errors.UNSUPPORTED_FILE',
                    params: { names: listNames(r.unsupported) },
                };
            case 'PDF_UNREADABLE':
                return {
                    key: 'intake.errors.PDF_UNREADABLE',
                    params: { names: listNames(r.unreadable) },
                };
            case 'DUPLICATE_FILE':
                return {
                    key: 'intake.errors.DUPLICATE_FILE',
                    params: { names: listNames(r.duplicates) },
                };
            case 'TOO_MANY_PAGES':
                return { key: 'intake.errors.TOO_MANY_PAGES', params: { max: maxPages } };
            default:
                return { key: `intake.errors.${code}` };
        }
    });

const splitMessage = (reason: SplitRefusal, count: number): Message => ({
    key: `intake.errors.${reason}`,
    params: { count },
});

const prepare = async (
    mode: ScanIntakeMode,
    first: File[],
    second: File[],
    one: File[],
    maxPages: number,
    passLabels: { first: string; second: string; one: string }
): Promise<Prepared | null> => {
    const errors: Message[] = [];
    const notes: Message[] = [];
    let passes: [File[], File[]] | null = null;
    let orderSource: ScanOrderSource = 'NAME';
    const warnings: ScanClientWarning[] = [];
    let split: Prepared['split'] = null;

    const ordered = (files: File[], label: string) => {
        const o = orderScanFiles(files);
        errors.push(...orderMessages(o, label));
        if (o.warnings.includes('MTIME_DISAGREES')) {
            warnings.push('MTIME_DISAGREES');
            notes.push({ key: 'intake.warnings.MTIME_DISAGREES', params: { pass: label } });
        }
        return o;
    };

    if (mode === 'TWO_PASSES') {
        if (first.length === 0 && second.length === 0) return null;
        const a = ordered(first, passLabels.first);
        const b = ordered(second, passLabels.second);
        orderSource = a.ordered.length > 0 ? a.source : b.source;
        passes = [a.ordered, b.ordered];
    } else {
        if (one.length === 0) return null;
        const o = ordered(one, passLabels.one);
        orderSource = o.source;
        if (mode === 'ONE_FOLDER') {
            const s = splitOneFolder(o.ordered);
            if (s.ok) {
                passes = [s.first, s.second];
                split = { first: s.first.length, second: s.second.length, name: s.splitAfterName };
            } else {
                errors.push(splitMessage(s.reason, one.length));
            }
        } else {
            const d = deinterleaveDuplex(o.ordered);
            passes = [d.first, d.second];
            notes.push({ key: 'intake.duplexUntested' });
        }
    }

    const precheck = passes ? await precheckLoad(passes[0], passes[1], maxPages) : null;
    if (precheck) errors.push(...precheckMessages(precheck, maxPages));
    return { passes, precheck, orderSource, warnings, errors, notes, split };
};

/**
 * Add one load (or replace one, "Rescan this load"): pick the passes, see the
 * checks at once, then upload strictly and hand the load to the server.
 */
export const LoadIntake = ({
    sessionId,
    instituteId,
    maxPagesPerPass = MAX_PAGES_PER_PASS,
    replaceLoadNo = null,
    onDone,
    onCancel,
}: {
    sessionId: string;
    instituteId: string;
    maxPagesPerPass?: number;
    replaceLoadNo?: number | null;
    onDone: (session: ScanSession) => void;
    onCancel?: () => void;
}) => {
    const { t } = useTranslation('scanStation');
    const onNotFound = useOnScanNotFound(instituteId);
    const [mode, setMode] = useState<ScanIntakeMode>('TWO_PASSES');
    const [first, setFirst] = useState<File[]>([]);
    const [second, setSecond] = useState<File[]>([]);
    const [one, setOne] = useState<File[]>([]);
    const [prepared, setPrepared] = useState<Prepared | null>(null);
    const [checking, setChecking] = useState(false);
    const [splitConfirmed, setSplitConfirmed] = useState(false);
    const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
    const userId = getTokenDecodedData(getTokenFromCookie(TokenKey.accessToken))?.user ?? '';

    const passLabels = useMemo(
        () => ({ first: t('intake.first'), second: t('intake.second'), one: t('intake.one') }),
        [t]
    );

    useEffect(() => {
        let cancelled = false;
        setSplitConfirmed(false);
        setChecking(true);
        prepare(mode, first, second, one, maxPagesPerPass, passLabels)
            .then((p) => {
                if (!cancelled) setPrepared(p);
            })
            .catch(() => {
                if (!cancelled) setPrepared(null);
            })
            .finally(() => {
                if (!cancelled) setChecking(false);
            });
        return () => {
            cancelled = true;
        };
    }, [mode, first, second, one, maxPagesPerPass, passLabels]);

    const reset = () => {
        setFirst([]);
        setSecond([]);
        setOne([]);
        setPrepared(null);
        setProgress(null);
    };

    const send = useMutation({
        mutationFn: async () => {
            if (!prepared?.passes || !prepared.precheck) throw new Error('not ready');
            const [p1, p2] = prepared.passes;
            const { precheck } = prepared;
            const all = [...p1, ...p2];
            setProgress({ done: 0, total: all.length });
            const ids = await uploadScanFiles(all, { userId, instituteId }, (done, total) =>
                setProgress({ done, total })
            );
            const describe = (files: File[], pass: 0 | 1, offset: number): UploadedPassFile[] =>
                files.map((file, i) => ({
                    file,
                    fileId: ids[offset + i]!,
                    kind: (precheck.fileKinds[pass][i] === 'PDF' ? 'PDF' : 'IMAGE') as ScanFileKind,
                    pageCount: precheck.filePages[pass][i] ?? 1,
                }));
            const body = buildLoadBody(
                [describe(p1, 0, 0), describe(p2, 1, p1.length)],
                mode,
                prepared.orderSource,
                prepared.warnings
            );
            const session =
                replaceLoadNo !== null
                    ? await replaceScanLoad(sessionId, replaceLoadNo, instituteId, body)
                    : await addScanLoad(sessionId, instituteId, body);
            all.forEach((file, i) => rememberLocalFile(ids[i]!, file));
            return session;
        },
        onSuccess: (session) => {
            const loadNo = replaceLoadNo ?? Math.max(0, ...session.loads.map((l) => l.load_no));
            toast.success(
                t(replaceLoadNo !== null ? 'intake.replaced' : 'intake.added', { load: loadNo })
            );
            reset();
            onDone(session);
        },
        onError: (e) => {
            setProgress(null);
            toast.error(
                e instanceof ScanUploadError
                    ? t('intake.uploadFailed', { name: e.fileName })
                    : onNotFound(e)
                      ? t('intake.addFailed')
                      : apiErrorMessage(e, t('intake.addFailed'))
            );
        },
    });

    const busy = send.isPending;
    const blocked = !prepared || prepared.errors.length > 0 || !prepared.passes;
    const needsSplitConfirm = mode === 'ONE_FOLDER' && !!prepared?.split && !splitConfirmed;
    const canSend = !busy && !checking && !blocked && !needsSplitConfirm;
    const passSummary = (o: File[]) =>
        o.length === 0 || !prepared
            ? null
            : t('intake.summary', {
                  count: o.length,
                  source: t(`intake.source.${prepared.orderSource}`),
              });

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
                <p className="text-body font-medium text-neutral-800">{t('intake.mode.label')}</p>
                <RadioGroup
                    value={mode}
                    onValueChange={(v) => {
                        setMode(v as ScanIntakeMode);
                        reset();
                    }}
                    disabled={busy}
                    className="grid grid-cols-1 gap-3 md:grid-cols-3"
                >
                    {MODES.map((m) => (
                        <label
                            key={m}
                            htmlFor={`scan-mode-${m}`}
                            className={cn(
                                'flex cursor-pointer items-start gap-2 rounded-md border p-3 transition-colors',
                                mode === m
                                    ? 'border-primary-500 bg-primary-50'
                                    : 'border-neutral-200 hover:border-neutral-300'
                            )}
                        >
                            <RadioGroupItem id={`scan-mode-${m}`} value={m} className="mt-0.5" />
                            <span className="flex flex-col">
                                <span className="text-body font-medium text-neutral-800">
                                    {t(`intake.mode.${m}.title`)}
                                </span>
                                <span className="text-caption text-neutral-500">
                                    {t(`intake.mode.${m}.body`)}
                                </span>
                            </span>
                        </label>
                    ))}
                </RadioGroup>
            </div>

            {mode === 'TWO_PASSES' ? (
                <div className="flex flex-col gap-4 md:flex-row">
                    <PassDropZone
                        label={t('intake.first')}
                        files={first}
                        summary={passSummary(prepared?.passes?.[0] ?? [])}
                        onFiles={setFirst}
                        disabled={busy}
                    />
                    <PassDropZone
                        label={t('intake.second')}
                        files={second}
                        summary={passSummary(prepared?.passes?.[1] ?? [])}
                        onFiles={setSecond}
                        disabled={busy}
                    />
                </div>
            ) : (
                <PassDropZone
                    label={t('intake.one')}
                    files={one}
                    summary={passSummary(one)}
                    onFiles={setOne}
                    disabled={busy}
                />
            )}

            {checking && (
                <p className="flex items-center gap-2 text-caption text-neutral-600">
                    <CircleNotch size={14} className="animate-spin" />
                    {t('intake.checking')}
                </p>
            )}

            {!checking && prepared && prepared.errors.length > 0 && (
                <ul className="flex flex-col gap-1 rounded-md border border-danger-200 bg-danger-50 p-3">
                    {prepared.errors.map((m, i) => (
                        <li key={i} className="flex items-start gap-2 text-caption text-danger-700">
                            <WarningCircle size={16} className="mt-px shrink-0" />
                            {t(m.key, m.params)}
                        </li>
                    ))}
                </ul>
            )}

            {!checking && prepared && prepared.notes.length > 0 && (
                <ul className="flex flex-col gap-1 rounded-md border border-warning-200 bg-warning-50 p-3">
                    {prepared.notes.map((m, i) => (
                        <li
                            key={i}
                            className="flex items-start gap-2 text-caption text-warning-700"
                        >
                            <Warning size={16} className="mt-px shrink-0" />
                            {t(m.key, m.params)}
                        </li>
                    ))}
                </ul>
            )}

            {!checking && prepared?.precheck && prepared.errors.length === 0 && (
                <p className="flex items-center gap-2 text-caption text-success-700">
                    <CheckCircle size={16} />
                    {t('intake.ready', {
                        a: prepared.precheck.pageCounts[0],
                        b: prepared.precheck.pageCounts[1],
                    })}
                </p>
            )}

            {mode === 'ONE_FOLDER' && prepared?.split && prepared.errors.length === 0 && (
                <div className="flex flex-wrap items-center gap-3 rounded-md border border-info-200 bg-info-50 p-3 text-caption text-info-700">
                    <span className="flex-1">
                        {t('intake.splitAsk', {
                            first: prepared.split.first,
                            second: prepared.split.second,
                            name: prepared.split.name,
                        })}
                    </span>
                    {splitConfirmed ? (
                        <span className="flex items-center gap-1 font-medium">
                            <CheckCircle size={14} />
                            {t('intake.splitConfirmed')}
                        </span>
                    ) : (
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="small"
                            onClick={() => setSplitConfirmed(true)}
                        >
                            {t('intake.splitConfirm')}
                        </MyButton>
                    )}
                </div>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2">
                {progress && (
                    <span className="me-auto flex items-center gap-2 text-caption text-neutral-600">
                        <CircleNotch size={14} className="animate-spin" />
                        {progress.done < progress.total
                            ? t('intake.uploading', { done: progress.done, total: progress.total })
                            : t('intake.sending')}
                    </span>
                )}
                {onCancel && (
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        disabled={busy}
                        onClick={onCancel}
                    >
                        {t('intake.cancel')}
                    </MyButton>
                )}
                <MyButton
                    type="button"
                    buttonType="primary"
                    scale="medium"
                    disabled={!canSend}
                    onClick={() => send.mutate()}
                >
                    {replaceLoadNo !== null
                        ? t('intake.submitReplace', { load: replaceLoadNo })
                        : t('intake.submit')}
                </MyButton>
            </div>
        </div>
    );
};

export default LoadIntake;
