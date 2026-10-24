import { useState, useEffect } from 'react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { toast } from 'sonner';
import { getInstituteId } from '@/constants/helper';
import { fetchPaginatedBatches } from '@/routes/admin-package-management/-services/package-service';
import type { PackageSessionDTO } from '@/routes/admin-package-management/-types/package-types';
import { useBulkAssign } from '@/routes/manage-students/students-list/-services/bulkAssignService';
import type {
    BulkAssignRequest,
    BulkAssignResponse,
    AssignmentItem,
} from '@/routes/manage-students/students-list/-types/bulk-assign-types';
import {
    InvitePickerRow,
    type PackageSessionConfig,
} from '@/routes/manage-students/students-list/-components/students-list/student-side-view/student-courses/invite-picker-row';
import { getUserIdsByTags, type TagItem } from '@/services/tag-management';
import { getTerminology, getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

type WizardStep = 'SELECT_COURSES' | 'CONFIGURE' | 'PREVIEW' | 'RESULTS';

interface AssignCoursesToTagsDialogProps {
    selectedTags: TagItem[];
    userCount: number;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess?: () => void;
}

export const AssignCoursesToTagsDialog = ({
    selectedTags,
    userCount,
    open,
    onOpenChange,
    onSuccess,
}: AssignCoursesToTagsDialogProps) => {
    const instituteId = getInstituteId() || '';
    const [step, setStep] = useState<WizardStep>('SELECT_COURSES');
    const [batches, setBatches] = useState<PackageSessionDTO[]>([]);
    const [isLoadingBatches, setIsLoadingBatches] = useState(false);
    const [selectedPSIds, setSelectedPSIds] = useState<Set<string>>(new Set());
    const [searchQuery, setSearchQuery] = useState('');
    const [duplicateHandling, setDuplicateHandling] = useState<'SKIP' | 'ERROR' | 'RE_ENROLL'>('SKIP');
    const [notifyLearners, setNotifyLearners] = useState(false);
    const [previewData, setPreviewData] = useState<BulkAssignResponse | null>(null);
    const [finalResults, setFinalResults] = useState<BulkAssignResponse | null>(null);
    const [psConfigs, setPsConfigs] = useState<PackageSessionConfig[]>([]);
    const [resolvedUserIds, setResolvedUserIds] = useState<string[]>([]);
    const [isResolvingUsers, setIsResolvingUsers] = useState(false);

    const { mutateAsync: bulkAssign, isPending } = useBulkAssign();

    useEffect(() => {
        if (open) {
            setStep('SELECT_COURSES');
            setSelectedPSIds(new Set());
            setSearchQuery('');
            setDuplicateHandling('SKIP');
            setNotifyLearners(false);
            setPreviewData(null);
            setFinalResults(null);
            setPsConfigs([]);
            setResolvedUserIds([]);
            loadBatches();
            resolveUsers();
        }
    }, [open]);

    const loadBatches = async () => {
        try {
            setIsLoadingBatches(true);
            const data = await fetchPaginatedBatches({ page: 0, size: 100 });
            setBatches(data.content || []);
        } catch {
            toast.error(
                `Failed to load ${getTerminologyPlural(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()}`
            );
        } finally {
            setIsLoadingBatches(false);
        }
    };

    const resolveUsers = async () => {
        try {
            setIsResolvingUsers(true);
            const ids = await getUserIdsByTags(selectedTags.map((t) => t.id));
            setResolvedUserIds(ids);
        } catch {
            toast.error('Failed to resolve users for selected tags');
            setResolvedUserIds([]);
        } finally {
            setIsResolvingUsers(false);
        }
    };

    const togglePS = (id: string) => {
        setSelectedPSIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const goToConfigure = () => {
        const configs: PackageSessionConfig[] = Array.from(selectedPSIds).map((psId) => {
            const batch = batches.find((b) => b.id === psId);
            const name = batch
                ? batch.name
                    ? `${batch.package_dto.package_name} ${batch.name}`
                    : `${batch.package_dto.package_name} · ${batch.level.level_name} · ${batch.session.session_name}`
                : psId;
            const existing = psConfigs.find((c) => c.packageSessionId === psId);
            if (existing) return existing;
            return {
                packageSessionId: psId,
                packageSessionName: name,
                selectedInvite: null,
                isAutoMode: true,
                resolvedPaymentOption: null,
                resolvedPaymentPlan: null,
                accessDaysOverride: null,
            };
        });
        setPsConfigs(configs);
        setStep('CONFIGURE');
    };

    const updatePSConfig = (updated: PackageSessionConfig) => {
        setPsConfigs((prev) =>
            prev.map((c) => (c.packageSessionId === updated.packageSessionId ? updated : c))
        );
    };

    const buildRequest = (dryRun: boolean): BulkAssignRequest => {
        const assignments: AssignmentItem[] = psConfigs.map((cfg) => ({
            package_session_id: cfg.packageSessionId,
            enroll_invite_id: cfg.isAutoMode ? null : cfg.selectedInvite?.id || null,
            payment_option_id: cfg.isAutoMode ? null : cfg.resolvedPaymentOption?.id || null,
            plan_id: cfg.isAutoMode ? null : cfg.resolvedPaymentPlan?.id || null,
            access_days: cfg.accessDaysOverride,
        }));
        return {
            institute_id: instituteId,
            user_ids: resolvedUserIds,
            assignments,
            options: {
                duplicate_handling: duplicateHandling,
                notify_learners: notifyLearners,
                dry_run: dryRun,
            },
        };
    };

    const handlePreview = async () => {
        if (resolvedUserIds.length === 0) {
            toast.error('No users found for the selected tags');
            return;
        }
        try {
            const result = await bulkAssign(buildRequest(true));
            setPreviewData(result);
            setStep('PREVIEW');
        } catch (err: any) {
            toast.error(err?.response?.data?.message || 'Preview failed');
        }
    };

    const handleConfirm = async () => {
        try {
            const result = await bulkAssign(buildRequest(false));
            setFinalResults(result);
            setStep('RESULTS');
            if (result.summary.failed === 0) {
                toast.success(
                    `${result.summary.successful} enrollment(s) created successfully!`
                );
                onSuccess?.();
            } else {
                toast.warning(
                    `${result.summary.successful} assigned, ${result.summary.failed} failed.`
                );
            }
        } catch (err: any) {
            toast.error(err?.response?.data?.message || 'Assignment failed');
        }
    };

    const filteredBatches = batches.filter((b) => {
        const q = searchQuery.toLowerCase();
        return (
            b.package_dto.package_name.toLowerCase().includes(q) ||
            b.level.level_name.toLowerCase().includes(q) ||
            b.session.session_name.toLowerCase().includes(q)
        );
    });

    // ── Tag summary header ──
    const renderTagSummary = () => (
        <div className="mb-4 rounded-lg border border-indigo-100 bg-indigo-50/50 px-4 py-3">
            <div className="flex items-center justify-between">
                <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-400">
                        Assigning to users of
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                        {selectedTags.map((t) => (
                            <span
                                key={t.id}
                                className="inline-flex items-center rounded-full bg-indigo-100 px-2.5 py-0.5 text-[11px] font-medium text-indigo-700"
                            >
                                🏷️ {t.tagName}
                            </span>
                        ))}
                    </div>
                </div>
                <div className="text-right">
                    {isResolvingUsers ? (
                        <span className="text-xs text-neutral-400">Resolving...</span>
                    ) : (
                        <div className="rounded-lg bg-white px-3 py-1.5 shadow-sm">
                            <p className="text-lg font-bold text-indigo-600">
                                {resolvedUserIds.length}
                            </p>
                            <p className="text-[10px] text-neutral-500">users</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );

    const renderSelectCourses = () => (
        <div className="flex flex-col gap-4">
            {renderTagSummary()}

            <input
                type="text"
                placeholder={`Search ${getTerminologyPlural(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()}...`}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-primary-400 focus:ring-1 focus:ring-primary-200"
            />

            {!isLoadingBatches && filteredBatches.length > 0 && (
                <div className="flex items-center justify-between">
                    <span className="text-xs text-neutral-500">
                        {selectedPSIds.size} of {batches.length} selected
                    </span>
                    <button
                        type="button"
                        onClick={() => {
                            const ids = filteredBatches.map((b) => b.id);
                            const allSelected = ids.every((id) => selectedPSIds.has(id));
                            setSelectedPSIds((prev) => {
                                const next = new Set(prev);
                                ids.forEach((id) =>
                                    allSelected ? next.delete(id) : next.add(id)
                                );
                                return next;
                            });
                        }}
                        className="text-xs font-medium text-primary-600 hover:text-primary-700"
                    >
                        {filteredBatches.every((b) => selectedPSIds.has(b.id))
                            ? 'Deselect All'
                            : 'Select All'}
                    </button>
                </div>
            )}

                    {isLoadingBatches ? (
                <DashboardLoader />
            ) : (
                <div className="flex max-h-[260px] flex-col gap-2 overflow-y-auto pr-1">
                    {filteredBatches.length === 0 ? (
                        <p className="py-4 text-center text-sm text-neutral-400">
                            No{' '}
                            {getTerminologyPlural(
                                ContentTerms.Course,
                                SystemTerms.Course
                            ).toLocaleLowerCase()}{' '}
                            found
                        </p>
                    ) : (
                        filteredBatches.map((b) => {
                            const checked = selectedPSIds.has(b.id);
                            return (
                                <label
                                    key={b.id}
                                    className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-all ${
                                        checked
                                            ? 'border-primary-400 bg-primary-50/40'
                                            : 'border-neutral-200 hover:border-neutral-300'
                                    }`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => togglePS(b.id)}
                                        className="h-4 w-4 rounded border-neutral-300 text-primary-500 focus:ring-primary-300"
                                    />
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm font-medium text-neutral-800">
                                            {b.name
                                                ? `${b.package_dto.package_name} ${b.name}`
                                                : b.package_dto.package_name}
                                        </p>
                                        <p className="truncate text-xs text-neutral-500">
                                            {b.level.level_name} · {b.session.session_name}
                                        </p>
                                    </div>
                                </label>
                            );
                        })
                    )}
                </div>
            )}
        </div>
    );

    const renderConfigure = () => (
        <div className="flex flex-col gap-4">
            {renderTagSummary()}

            <p className="text-sm text-neutral-600">
                Configure enrollment settings for each{' '}
                {getTerminology(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()}.
            </p>

            <div className="flex max-h-[280px] flex-col gap-3 overflow-y-auto pr-1">
                {psConfigs.map((cfg) => (
                    <InvitePickerRow
                        key={cfg.packageSessionId}
                        config={cfg}
                        onChange={updatePSConfig}
                    />
                ))}
            </div>

            <div className="flex flex-col gap-3 rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
                    Options
                </p>
                <div className="flex items-center gap-2">
                    <label className="text-xs font-medium text-neutral-600">
                        If already enrolled:
                    </label>
                    <select
                        value={duplicateHandling}
                        onChange={(e) =>
                            setDuplicateHandling(e.target.value as 'SKIP' | 'ERROR' | 'RE_ENROLL')
                        }
                        className="rounded border border-neutral-200 px-2 py-1 text-xs"
                    >
                        <option value="SKIP">Skip</option>
                        <option value="ERROR">Error</option>
                        <option value="RE_ENROLL">Re-enroll</option>
                    </select>
                </div>
                <label className="flex items-center gap-2 text-xs text-neutral-600">
                    <input
                        type="checkbox"
                        checked={notifyLearners}
                        onChange={(e) => setNotifyLearners(e.target.checked)}
                        className="h-3.5 w-3.5 rounded border-neutral-300 text-primary-500"
                    />
                    Notify learners via email
                </label>
            </div>
        </div>
    );

    const renderPreview = () => {
        if (!previewData) return null;
        const { summary, results } = previewData;
        return (
            <div className="flex flex-col gap-4">
                {renderTagSummary()}

                <div className="flex flex-wrap gap-2">
                    <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-medium text-green-700">
                        ✅ {summary.successful} will succeed
                    </span>
                    {summary.skipped > 0 && (
                        <span className="rounded-full bg-yellow-50 px-3 py-1 text-xs font-medium text-yellow-700">
                            ⏭ {summary.skipped} skipped
                        </span>
                    )}
                    {summary.failed > 0 && (
                        <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-medium text-red-700">
                            ❌ {summary.failed} failed
                        </span>
                    )}
                    {summary.re_enrolled > 0 && (
                        <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                            🔄 {summary.re_enrolled} re-enrolled
                        </span>
                    )}
                </div>

                <div className="max-h-[200px] overflow-y-auto rounded-lg border border-neutral-200">
                    <table className="w-full text-left text-xs">
                        <thead className="sticky top-0 bg-neutral-50">
                            <tr>
                                <th className="px-3 py-2 font-medium text-neutral-600">{getTerminology(ContentTerms.Course, SystemTerms.Course)}</th>
                                <th className="px-3 py-2 font-medium text-neutral-600">Status</th>
                                <th className="px-3 py-2 font-medium text-neutral-600">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-neutral-100">
                            {results.slice(0, 50).map((r, idx) => {
                                const courseName =
                                    batches.find((b) => b.id === r.package_session_id)
                                        ?.package_dto.package_name || r.package_session_id;
                                return (
                                    <tr
                                        key={idx}
                                        className={
                                            r.status === 'FAILED'
                                                ? 'bg-red-50/50'
                                                : r.status === 'SKIPPED'
                                                  ? 'bg-yellow-50/50'
                                                  : ''
                                        }
                                    >
                                        <td className="px-3 py-2 text-neutral-800">{courseName}</td>
                                        <td className="px-3 py-2">
                                            <span
                                                className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                                    r.status === 'SUCCESS'
                                                        ? 'bg-green-100 text-green-700'
                                                        : r.status === 'SKIPPED'
                                                          ? 'bg-yellow-100 text-yellow-700'
                                                          : 'bg-red-100 text-red-700'
                                                }`}
                                            >
                                                {r.status}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2 text-neutral-500">
                                            {r.action_taken}
                                            {r.message && (
                                                <p className="text-[10px] text-neutral-400">
                                                    {r.message}
                                                </p>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    {results.length > 50 && (
                        <p className="border-t border-neutral-100 px-3 py-2 text-center text-[10px] text-neutral-400">
                            Showing first 50 of {results.length} results
                        </p>
                    )}
                </div>
            </div>
        );
    };

    const renderResults = () => {
        if (!finalResults) return null;
        const { summary } = finalResults;
        return (
            <div className="flex flex-col gap-4">
                <p className="text-sm font-semibold text-neutral-800">Assignment Complete</p>
                <div className="flex flex-wrap gap-2">
                    <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-medium text-green-700">
                        ✅ {summary.successful} assigned
                    </span>
                    {summary.skipped > 0 && (
                        <span className="rounded-full bg-yellow-50 px-3 py-1 text-xs font-medium text-yellow-700">
                            ⏭ {summary.skipped} skipped
                        </span>
                    )}
                    {summary.failed > 0 && (
                        <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-medium text-red-700">
                            ❌ {summary.failed} failed
                        </span>
                    )}
                </div>
                <p className="text-xs text-neutral-500">
                    {resolvedUserIds.length} user(s) × {psConfigs.length}{' '}
                    {getTerminology(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()}(s)
                    = {summary.total_requested} total enrollments processed
                </p>
            </div>
        );
    };

    // ── Stepper ──
    const stepLabels: { key: WizardStep; label: string }[] = [
        {
            key: 'SELECT_COURSES',
            label: getTerminologyPlural(ContentTerms.Course, SystemTerms.Course),
        },
        { key: 'CONFIGURE', label: 'Configure' },
        { key: 'PREVIEW', label: 'Preview' },
        { key: 'RESULTS', label: 'Done' },
    ];
    const stepIndex = stepLabels.findIndex((s) => s.key === step);

    const renderStepper = () => (
        <div className="mb-4 flex items-center gap-1">
            {stepLabels.map((s, i) => (
                <div key={s.key} className="flex items-center">
                    <div
                        className={`flex h-6 items-center gap-1 rounded-full px-2.5 text-[10px] font-medium transition-colors ${
                            i === stepIndex
                                ? 'bg-primary-500 text-white'
                                : i < stepIndex
                                  ? 'bg-primary-100 text-primary-700'
                                  : 'bg-neutral-100 text-neutral-400'
                        }`}
                    >
                        <span>{i + 1}</span>
                        <span className="hidden sm:inline">{s.label}</span>
                    </div>
                    {i < stepLabels.length - 1 && (
                        <div
                            className={`mx-1 h-px w-4 ${
                                i < stepIndex ? 'bg-primary-300' : 'bg-neutral-200'
                            }`}
                        />
                    )}
                </div>
            ))}
        </div>
    );

    const footer = (
        <div className="flex w-full items-center justify-between">
            {step === 'SELECT_COURSES' && (
                <>
                    <MyButton buttonType="secondary" scale="small" onClick={() => onOpenChange(false)}>
                        Cancel
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="small"
                        disable={selectedPSIds.size === 0 || isResolvingUsers}
                        onClick={goToConfigure}
                    >
                        Next → Configure ({selectedPSIds.size})
                    </MyButton>
                </>
            )}
            {step === 'CONFIGURE' && (
                <>
                    <MyButton buttonType="secondary" scale="small" onClick={() => setStep('SELECT_COURSES')}>
                        ← Back
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="small"
                        disable={isPending || resolvedUserIds.length === 0}
                        onClick={handlePreview}
                    >
                        {isPending ? 'Loading...' : `Preview (${resolvedUserIds.length} users)`}
                    </MyButton>
                </>
            )}
            {step === 'PREVIEW' && (
                <>
                    <MyButton buttonType="secondary" scale="small" onClick={() => setStep('CONFIGURE')}>
                        ← Back
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="small"
                        disable={isPending}
                        onClick={handleConfirm}
                    >
                        {isPending ? 'Assigning...' : '✓ Confirm Assignment'}
                    </MyButton>
                </>
            )}
            {step === 'RESULTS' && (
                <MyButton
                    buttonType="primary"
                    scale="small"
                    onClick={() => onOpenChange(false)}
                    className="ml-auto"
                >
                    Done
                </MyButton>
            )}
        </div>
    );

    return (
        <MyDialog
            heading={`Assign ${getTerminologyPlural(ContentTerms.Course, SystemTerms.Course)} to Tagged Users`}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-xl"
            footer={footer}
        >
            {renderStepper()}
            {step === 'SELECT_COURSES' && renderSelectCourses()}
            {step === 'CONFIGURE' && renderConfigure()}
            {step === 'PREVIEW' && renderPreview()}
            {step === 'RESULTS' && renderResults()}
        </MyDialog>
    );
};
