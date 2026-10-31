import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    ClockCounterClockwise,
    Coins,
    DownloadSimple,
    Sparkle,
    WarningCircle,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { DialogContent } from '@/components/ui/dialog';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import {
    GET_AI_ASSESSMENT_REPORT_STATUS_URL,
    GET_EXPORT_PDF_URL_AI_ASSESSMENT_REPORT,
} from '@/constants/urls';

interface ReportVersion {
    id: string;
    generated_at: string | null;
    /** The live report. Older entries were superseded by a paid refresh. */
    current: boolean;
}

interface ReportStatus {
    available: boolean;
    generating: boolean;
    generated_at: string | null;
    stale: boolean;
    credits_required: number | null;
    current_balance: number | null;
    /** null means the balance is unknown — treat as allowed, never as blocked. */
    sufficient: boolean | null;
    /** Every generation so far, newest first. Each is downloadable for free. */
    history?: ReportVersion[];
}

/**
 * Pulls the backend's message out of a failed PDF request. The download is a
 * blob request, so an error body arrives as a Blob rather than parsed JSON —
 * without this, "out of credits" and "already generating" read identically.
 */
const readErrorMessage = async (error: unknown): Promise<string | null> => {
    const data = (error as { response?: { data?: unknown } })?.response?.data;
    if (!data) return null;
    try {
        const raw = data instanceof Blob ? await data.text() : JSON.stringify(data);
        const parsed = JSON.parse(raw) as { ex?: string; message?: string };
        return parsed.ex || parsed.message || null;
    } catch {
        return null;
    }
};

const fmtDateTime = (iso: string | null) => {
    if (!iso) return null;
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
        ? null
        : d.toLocaleString([], {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
          });
};

interface AiAssessmentReportDialogProps {
    assessmentId: string;
    instituteId: string | undefined;
    assessmentName?: string;
    onClose: () => void;
}

/**
 * Generate-or-download for the class AI report.
 *
 * <p>Three states, because they mean three different things to the teacher's
 * credit balance: never generated (costs credits), already generated (free),
 * and stale (free to download, costs credits to refresh). Collapsing them
 * would either hide a charge or imply one that is not happening.
 */
export const AiAssessmentReportDialog = ({
    assessmentId,
    instituteId,
    assessmentName,
    onClose,
}: AiAssessmentReportDialogProps) => {
    const { t } = useTranslation('assessmentSubmissionsTab');
    const queryClient = useQueryClient();

    const statusQuery = useQuery({
        queryKey: ['AI_ASSESSMENT_REPORT_STATUS', assessmentId, instituteId],
        queryFn: async (): Promise<ReportStatus> => {
            const res = await authenticatedAxiosInstance({
                method: 'GET',
                url: GET_AI_ASSESSMENT_REPORT_STATUS_URL,
                params: { assessmentId, instituteId },
            });
            return res?.data;
        },
        enabled: !!assessmentId && !!instituteId,
        staleTime: 30 * 1000,
        retry: false,
    });

    const status = statusQuery.data;
    const alreadyGenerated = !!status?.available;
    const credits = status?.credits_required ?? null;
    const balance = status?.current_balance ?? null;
    // Only a definite "no" blocks. A null balance means unknown — a credit
    // service blip must not stop a teacher.
    const blocked = status?.sufficient === false;
    // Only past versions — the live one already has its own download button, and
    // repeating it here would read as two different reports.
    const pastVersions = (status?.history ?? []).filter((h) => !h.current);

    const download = useMutation({
        mutationFn: async (opts: {
            generate: boolean;
            regenerate: boolean;
            versionId?: string;
        }) => {
            const res = await authenticatedAxiosInstance({
                method: 'GET',
                responseType: 'blob',
                headers: { Accept: 'application/pdf' },
                url: GET_EXPORT_PDF_URL_AI_ASSESSMENT_REPORT,
                params: { assessmentId, instituteId, ...opts },
            });
            const blob = res?.data as Blob | undefined;
            if (!blob) throw new Error('empty response');
            return blob;
        },
        onSuccess: (blob, variables) => {
            const safeName = (assessmentName || 'assessment').replace(/[^\w.-]+/g, '_');
            const version = variables.versionId
                ? `_${
                      (status?.history ?? [])
                          .find((h) => h.id === variables.versionId)
                          ?.generated_at?.slice(0, 10) ?? 'previous'
                  }`
                : '';
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `AI_Report_${safeName}${version}.pdf`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);
            // The report now exists (or was refreshed) — re-read so a reopen
            // shows the free-download state rather than offering to charge again.
            void queryClient.invalidateQueries({
                queryKey: ['AI_ASSESSMENT_REPORT_STATUS', assessmentId, instituteId],
            });
            // Stay open when pulling an older version: teachers comparing two
            // rounds of a test want more than one file.
            if (!variables.versionId) onClose();
        },
        onError: async (error: unknown) => {
            toast.error((await readErrorMessage(error)) || t('aiReport.failed'));
        },
    });

    const busy = download.isPending;

    return (
        <DialogContent className="flex flex-col p-0">
            <h1 className="flex items-center gap-2 rounded-md bg-primary-50 p-4 text-primary-500">
                <Sparkle size={18} weight="fill" />
                {t('aiReport.title')}
            </h1>

            <div className="flex flex-col gap-3 p-4">
                <p className="text-body text-neutral-600">{t('aiReport.intro')}</p>
                <ul className="list-disc space-y-1 pl-5 text-caption text-neutral-500">
                    <li>{t('aiReport.bulletWeakness')}</li>
                    <li>{t('aiReport.bulletMisconceptions')}</li>
                    <li>{t('aiReport.bulletPlan')}</li>
                </ul>

                {statusQuery.isLoading && (
                    <p className="text-caption text-neutral-500">{t('aiReport.checking')}</p>
                )}

                {!statusQuery.isLoading && alreadyGenerated && (
                    <div
                        className={
                            status?.stale
                                ? 'rounded-md bg-warning-50 p-3 text-caption text-warning-700'
                                : 'rounded-md bg-success-50 p-3 text-caption text-success-600'
                        }
                    >
                        {status?.stale
                            ? t('aiReport.stale', { date: fmtDateTime(status.generated_at) ?? '' })
                            : t('aiReport.ready', {
                                  date: fmtDateTime(status?.generated_at ?? null) ?? '',
                              })}
                    </div>
                )}

                {!statusQuery.isLoading && (!alreadyGenerated || status?.stale) && (
                    <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
                        <div className="flex items-start gap-2 text-caption text-neutral-700">
                            <Coins size={16} className="mt-0.5 shrink-0 text-primary-500" />
                            <p>
                                {credits != null
                                    ? t('aiReport.costs', { count: credits })
                                    : t('aiReport.costsUnavailable')}
                            </p>
                        </div>
                        {balance != null && (
                            <p className="mt-2 border-t border-neutral-200 pt-2 text-right text-caption text-neutral-500">
                                {t('aiReport.balance', { count: balance })}
                            </p>
                        )}
                    </div>
                )}

                {pastVersions.length > 0 && (
                    <div className="rounded-md border border-neutral-200">
                        <p className="flex items-center gap-2 border-b border-neutral-200 px-3 py-2 text-caption font-medium text-neutral-600">
                            <ClockCounterClockwise size={15} className="shrink-0" />
                            {t('aiReport.historyTitle')}
                        </p>
                        <ul className="max-h-40 divide-y divide-neutral-100 overflow-y-auto">
                            {pastVersions.map((version) => (
                                <li
                                    key={version.id}
                                    className="flex items-center justify-between gap-2 px-3 py-2"
                                >
                                    <span className="text-caption text-neutral-500">
                                        {fmtDateTime(version.generated_at) ?? ''}
                                    </span>
                                    <button
                                        type="button"
                                        disabled={busy}
                                        className="flex items-center gap-1 text-caption text-primary-500 hover:underline disabled:opacity-50"
                                        onClick={() =>
                                            download.mutate({
                                                generate: false,
                                                regenerate: false,
                                                versionId: version.id,
                                            })
                                        }
                                    >
                                        <DownloadSimple size={14} />
                                        {t('aiReport.historyDownload')}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {blocked && (
                    <div className="flex items-start gap-2 rounded-md bg-danger-50 p-3 text-caption text-danger-600">
                        <WarningCircle size={16} className="mt-0.5 shrink-0" />
                        <p>{t('aiReport.insufficient')}</p>
                    </div>
                )}

                <div className="flex flex-wrap justify-end gap-2 pt-1">
                    <MyButton type="button" scale="large" buttonType="secondary" onClick={onClose}>
                        {t('aiReport.cancel')}
                    </MyButton>

                    {alreadyGenerated && (
                        <MyButton
                            type="button"
                            scale="large"
                            buttonType="primary"
                            className="font-medium"
                            disabled={busy}
                            onClick={() => download.mutate({ generate: false, regenerate: false })}
                        >
                            {busy ? t('aiReport.preparing') : t('aiReport.downloadFree')}
                        </MyButton>
                    )}

                    {(!alreadyGenerated || status?.stale) && (
                        <MyButton
                            type="button"
                            scale="large"
                            buttonType={alreadyGenerated ? 'secondary' : 'primary'}
                            className="font-medium"
                            disabled={busy || blocked || statusQuery.isLoading}
                            onClick={() =>
                                download.mutate({ generate: true, regenerate: alreadyGenerated })
                            }
                        >
                            {busy
                                ? t('aiReport.generating')
                                : credits == null
                                  ? // Price unknown (status call failed, or pricing
                                    // not deployed). Show no number rather than a
                                    // "0 credits" that reads as free.
                                    alreadyGenerated
                                      ? t('aiReport.refreshNoPrice')
                                      : t('aiReport.generateNoPrice')
                                  : alreadyGenerated
                                    ? t('aiReport.refresh', { count: credits })
                                    : t('aiReport.generate', { count: credits })}
                        </MyButton>
                    )}
                </div>
            </div>
        </DialogContent>
    );
};
