/**
 * StepWorkflowTriggersCard — attach workflows to fire when a subject enters,
 * completes, or skips this onboarding step (workflow_trigger rows with
 * eventId = this step's id). Mirrors CourseWorkflowTriggersCard's UX, scoped
 * to the fixed ONBOARDING_STEP_* event set instead of the full catalog.
 *
 * Only usable once the step already exists (editing, not creating) — a
 * trigger needs a real step id to attach to.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { MyButton } from '@/components/design-system/button';
import { Label } from '@/components/ui/label';
import { Lightning, Plus, Trash, CircleNotch } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { fetchInstituteWorkflows, type InstituteWorkflowOption } from '@/services/package-settings';
import {
    fetchOnboardingStepTriggers,
    saveOnboardingStepTriggers,
    buildOnboardingStepTriggerEvents,
    type OnboardingStepTrigger,
    type OnboardingStepTriggerEvent,
} from '../-services/onboarding-service';

interface StepWorkflowTriggersCardProps {
    instituteId: string;
    flowId: string;
    stepId: string;
}

interface TriggerRow {
    triggerEventName: OnboardingStepTriggerEvent | '';
    workflowId: string;
}

export function StepWorkflowTriggersCard({ instituteId, flowId, stepId }: StepWorkflowTriggersCardProps) {
    const { t } = useTranslation('audienceManagerOnboardingService');
    const triggerEvents = useMemo(() => buildOnboardingStepTriggerEvents(t), [t]);
    const [workflows, setWorkflows] = useState<InstituteWorkflowOption[]>([]);
    const [rows, setRows] = useState<TriggerRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [wfs, existing] = await Promise.all([
                fetchInstituteWorkflows(),
                fetchOnboardingStepTriggers(flowId, stepId),
            ]);
            setWorkflows(wfs);
            setRows(
                existing.map((t) => ({
                    triggerEventName: t.trigger_event_name as OnboardingStepTriggerEvent,
                    workflowId: t.workflow_id,
                }))
            );
        } catch {
            toast.error('Failed to load this step’s workflow triggers');
        } finally {
            setLoading(false);
        }
    }, [flowId, stepId]);

    useEffect(() => {
        void load();
    }, [load]);

    const updateRow = (i: number, field: keyof TriggerRow, val: string) =>
        setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: val } : r)));
    const addRow = () => setRows((prev) => [...prev, { triggerEventName: '', workflowId: '' }]);
    const removeRow = (i: number) => setRows((prev) => prev.filter((_, idx) => idx !== i));

    const handleSave = async () => {
        const valid: OnboardingStepTrigger[] = rows
            .filter((r) => r.triggerEventName && r.workflowId)
            .map((r) => ({ trigger_event_name: r.triggerEventName, workflow_id: r.workflowId }));
        setSaving(true);
        try {
            const res = await saveOnboardingStepTriggers(instituteId, flowId, stepId, valid);
            toast.success(`Step triggers saved (${res.created} added, ${res.removed} removed).`);
            await load();
        } catch {
            toast.error('Failed to save this step’s workflow triggers');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-3">
            <div className="flex items-center gap-2">
                <Lightning className="size-4 text-primary-500" weight="fill" />
                <Label className="text-body font-medium text-neutral-800">
                    Workflow triggers for this step
                </Label>
            </div>
            <p className="text-caption text-neutral-500">
                Run a workflow automatically when a subject enters, completes, or skips this step.
            </p>

            {loading ? (
                <div className="flex items-center justify-center gap-2 py-4 text-caption text-neutral-500">
                    <CircleNotch className="size-4 animate-spin" /> Loading…
                </div>
            ) : (
                <>
                    {workflows.length === 0 && (
                        <p className="text-caption text-neutral-400">
                            No workflows in this institute yet — create one under Automations first.
                        </p>
                    )}

                    {rows.length === 0 ? (
                        <p className="text-caption text-neutral-400">No workflow triggers on this step yet.</p>
                    ) : (
                        rows.map((row, i) => (
                            <div
                                key={i}
                                className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-center"
                            >
                                <Select
                                    value={row.triggerEventName}
                                    onValueChange={(v) => updateRow(i, 'triggerEventName', v)}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="When…" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {triggerEvents.map((e) => (
                                            <SelectItem key={e.key} value={e.key}>
                                                {e.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <Select
                                    value={row.workflowId}
                                    onValueChange={(v) => updateRow(i, 'workflowId', v)}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Run workflow…" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {workflows.map((w) => (
                                            <SelectItem key={w.id} value={w.id}>
                                                {w.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => removeRow(i)}
                                    aria-label="Remove trigger"
                                >
                                    <Trash className="size-4 text-danger-500" />
                                </Button>
                            </div>
                        ))
                    )}

                    <div className="flex items-center justify-between">
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={addRow}
                            className="gap-1 text-primary-600"
                        >
                            <Plus className="size-4" /> Add trigger
                        </Button>
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            onClick={handleSave}
                            disable={saving}
                        >
                            {saving ? 'Saving…' : 'Save triggers'}
                        </MyButton>
                    </div>
                </>
            )}
        </div>
    );
}
