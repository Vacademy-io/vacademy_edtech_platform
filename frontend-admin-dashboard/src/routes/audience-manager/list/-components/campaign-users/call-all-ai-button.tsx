import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Robot } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { useAiCallButtonEnabled } from '@/components/shared/leads';
import { AiCallChooserFields } from '@/components/shared/leads/ai-call-chooser';
import { startAiCallCampaign } from '@/components/shared/leads/services/start-ai-campaign';
import { CampaignProgressDialog } from './campaign-progress-dialog';
import { fetchBulkRunSummary } from '@/components/shared/leads/services/start-ai-campaign';

interface CallAllWithAiButtonProps {
    /** Audience/campaign id — the lead list to call. */
    audienceId: string;
    instituteId?: string;
    /** Total leads currently in the list (drives the disabled state before the dry run). */
    totalElements: number;
    /** The rows the admin has check-selected (responseId → name); enables "only selected". */
    selectedLeads?: Map<string, { userId: string; responseId: string; name: string }>;
}

/**
 * Toolbar action on a campaign's lead list: place an AI call to every eligible lead
 * in the list. Opens a confirm dialog that first does a server dry run (counts the
 * eligible leads without dialing), then, on confirm, fires the bulk campaign — the
 * backend paces the calls and each outcome/assignment lands via the webhook.
 * Hidden unless AI calling's lead-list surface is enabled (same gate as the per-row
 * robot button), so it never shows for institutes not using AI calling.
 */
export function CallAllWithAiButton({
    audienceId,
    instituteId,
    totalElements,
    selectedLeads,
}: CallAllWithAiButtonProps) {
    const { t } = useTranslation('audienceManagerCallAllAiButton');
    const enabled = useAiCallButtonEnabled();
    const queryClient = useQueryClient();
    const [open, setOpen] = useState(false);
    // Chooser: '' = default agent / auto number (only shown when >1 exists).
    const [agentId, setAgentId] = useState('');
    const [numberId, setNumberId] = useState('');
    // Is a run for this audience still going? Drives the "view progress" button, so a
    // run outlives the dialog that started it.
    const activeRun = useQuery({
        queryKey: ['ai-bulk-run-summary', audienceId, instituteId],
        queryFn: () => fetchBulkRunSummary(audienceId, instituteId!),
        enabled: !!instituteId && !!audienceId,
        refetchInterval: 15000,
        retry: false,
    });

    /** Names for the rows we know; unknown leads fall back to their number. */
    const buildLeadNames = () => {
        const names = new Map<string, string>();
        selectedLeads?.forEach((v, k) => names.set(k, v.name));
        return names;
    };

    // Scope: when rows are checked, default to calling only those.
    const selectedCount = selectedLeads?.size ?? 0;
    const [scope, setScope] = useState<'selected' | 'all'>('selected');
    const effectiveScope = selectedCount > 0 ? scope : 'all';
    // Calls in parallel (completion-aware window server-side). 1 = one at a time.
    const [parallel, setParallel] = useState('1');
    // Live progress dialog state for the just-started run.
    const [progress, setProgress] = useState<{
        startedAtMs: number;
        expectedTotal: number;
        leadNames: Map<string, string>;
        parallel: number;
    } | null>(null);

    // Dry run: count eligible leads for the confirm copy, WITHOUT placing any calls.
    const preview = useQuery({
        queryKey: ['ai-campaign-preview', audienceId, instituteId],
        queryFn: () => startAiCallCampaign({ audienceId, instituteId: instituteId!, dryRun: true }),
        enabled: open && !!instituteId,
        staleTime: 0,
        gcTime: 0,
        retry: false,
    });

    const start = useMutation({
        mutationFn: () => {
            return startAiCallCampaign({
                audienceId,
                instituteId: instituteId!,
                dryRun: false,
                campaignId: agentId || undefined,
                preferredNumberId: numberId || undefined,
                responseIds:
                    effectiveScope === 'selected' && selectedLeads
                        ? Array.from(selectedLeads.keys())
                        : undefined,
                parallel: Number(parallel) || 1,
            });
        },
        onSuccess: (res) => {
            // dispatched=false means nothing was queued (e.g. every eligible lead was
            // already AI-called inside the cooldown). Reporting that as success left the
            // user believing calls were going out when none were.
            if (!res.dispatched) {
                toast.warning(res.message || t('toast.noneDispatched'));
                setOpen(false);
                return;
            }
            toast.success(res.message || t('toast.queued', { count: res.eligible }));
            setOpen(false);
            // Live progress: names for the rows we know (selected scope has them all;
            // 'all' scope labels rows for leads on the loaded page, others fall back).
            setProgress({
                startedAtMs: Date.now() - 30_000, // small skew guard for server clock
                expectedTotal: res.eligible,
                leadNames: buildLeadNames(),
                parallel: Number(parallel) || 1,
            });
            queryClient.invalidateQueries({ queryKey: ['campaignUsers', audienceId] });
        },
        onError: (err) => toast.error(errMsg(err, t)),
    });

    if (!enabled) return null;

    const eligible = preview.data?.eligible ?? 0;
    const totalInList = preview.data?.total ?? totalElements;
    // The number the button will actually dial under the chosen scope. Selected rows
    // are re-checked server-side for eligibility, so this is an upper bound there.
    const callCount =
        effectiveScope === 'selected'
            ? Math.min(selectedCount, eligible || selectedCount)
            : eligible;
    const previewError = preview.isError ? errMsg(preview.error, t) : null;

    const footer = (
        <div className="flex w-full items-center justify-end gap-2">
            <MyButton buttonType="secondary" scale="small" onClick={() => setOpen(false)}>
                {t('footer.cancel')}
            </MyButton>
            <MyButton
                buttonType="primary"
                scale="small"
                disable={preview.isLoading || !!previewError || eligible === 0 || start.isPending}
                onClick={() => start.mutate()}
            >
                {start.isPending
                    ? t('footer.starting')
                    : callCount > 0
                      ? t('footer.callLeads', { count: callCount })
                      : t('footer.callLeadsGeneric')}
            </MyButton>
        </div>
    );

    return (
        <>
            <Button
                variant="outline"
                size="sm"
                className="h-10"
                disabled={!totalElements || !instituteId}
                onClick={() => setOpen(true)}
            >
                <Robot className="mr-1.5 size-4" />
                {t('button.label')}
            </Button>

            {/* A run outlives the dialog by hours, and closing it used to lose the only
                view of it. This brings it back for as long as anything is unfinished. */}
            {activeRun.data && !activeRun.data.runFinished && activeRun.data.total > 0 && (
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-10"
                    onClick={() =>
                        setProgress({
                            startedAtMs: Date.now(),
                            expectedTotal: activeRun.data?.total ?? 0,
                            leadNames: buildLeadNames(),
                            parallel: Number(parallel) || 1,
                        })
                    }
                >
                    <Robot className="mr-1.5 size-4 animate-pulse text-primary-500" />
                    {t('button.viewProgress', {
                        defaultValue: 'View AI call progress',
                    })}
                </Button>
            )}

            <MyDialog
                heading={t('dialog.heading')}
                open={open}
                onOpenChange={setOpen}
                dialogWidth="w-full max-w-md"
                footer={footer}
            >
                <div className="space-y-3 text-body">
                    {preview.isLoading && (
                        <p className="text-neutral-500">{t('body.checkingEligibility')}</p>
                    )}
                    {previewError && <p className="text-danger-600">{previewError}</p>}
                    {!preview.isLoading && !previewError && (
                        <>
                            <p>
                                <Trans
                                    t={t}
                                    i18nKey="body.eligibleOfTotal"
                                    count={totalInList}
                                    values={{ eligible }}
                                    components={{ bold: <span className="font-semibold" /> }}
                                />
                            </p>
                            <p className="text-caption text-neutral-500">{t('body.disclaimer')}</p>
                            {eligible === 0 && (
                                <p className="text-warning-600">{t('body.noneEligible')}</p>
                            )}
                            {eligible > 0 && selectedCount > 0 && (
                                <div className="space-y-1.5">
                                    <Label>{t('body.scope.label')}</Label>
                                    <RadioGroup
                                        value={effectiveScope}
                                        onValueChange={(v) => setScope(v as 'selected' | 'all')}
                                        className="gap-1.5"
                                    >
                                        <div className="flex items-center gap-2">
                                            <RadioGroupItem
                                                value="selected"
                                                id="ai-scope-selected"
                                            />
                                            <Label
                                                htmlFor="ai-scope-selected"
                                                className="font-normal"
                                            >
                                                {t('body.scope.selectedOption', {
                                                    count: selectedCount,
                                                })}
                                            </Label>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <RadioGroupItem value="all" id="ai-scope-all" />
                                            <Label htmlFor="ai-scope-all" className="font-normal">
                                                {t('body.scope.allOption', { count: eligible })}
                                            </Label>
                                        </div>
                                    </RadioGroup>
                                </div>
                            )}
                            {eligible > 0 && (
                                <div className="space-y-1.5">
                                    <Label>{t('body.parallel.label')}</Label>
                                    <Select value={parallel} onValueChange={setParallel}>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="1">
                                                {t('body.parallel.options.one')}
                                            </SelectItem>
                                            <SelectItem value="2">
                                                {t('body.parallel.options.two')}
                                            </SelectItem>
                                            <SelectItem value="3">
                                                {t('body.parallel.options.three')}
                                            </SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <p className="text-caption text-neutral-500">
                                        {t('body.parallel.caption')}
                                    </p>
                                </div>
                            )}
                            {eligible > 0 && (
                                <AiCallChooserFields
                                    agentId={agentId}
                                    onAgentChange={setAgentId}
                                    numberId={numberId}
                                    onNumberChange={setNumberId}
                                />
                            )}
                        </>
                    )}
                </div>
            </MyDialog>

            {progress && (
                <CampaignProgressDialog
                    open={!!progress}
                    onOpenChange={(o) => !o && setProgress(null)}
                    audienceId={audienceId}
                    instituteId={instituteId!}
                    expectedTotal={progress.expectedTotal}
                    leadNames={progress.leadNames}
                />
            )}
        </>
    );
}

function errMsg(err: unknown, t: TFunction): string {
    if (err && typeof err === 'object') {
        const e = err as {
            response?: { data?: { ex?: string; message?: string } };
            message?: string;
        };
        if (typeof e.response?.data?.ex === 'string') return e.response.data.ex;
        if (typeof e.response?.data?.message === 'string') return e.response.data.message;
        if (typeof e.message === 'string') return e.message;
    }
    return t('errors.startFailed');
}
