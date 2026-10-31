import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MyButton } from '@/components/design-system/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { CircleNotch, Lightning, FloppyDisk, Plus, Trash } from '@phosphor-icons/react';
import { toast } from 'sonner';
import {
    fetchInstituteWorkflows,
    fetchPackageWorkflowTriggers,
    fetchTriggerEvents,
    savePackageWorkflowTriggers,
    type InstituteWorkflowOption,
    type TriggerEventOption,
} from '@/services/package-settings';

interface CourseWorkflowTriggersCardProps {
    packageId: string;
}

interface TriggerRow {
    triggerEventName: string;
    workflowId: string;
}

/**
 * Manage the workflows that fire for this course, on ANY trigger event (not just enrolment). Each
 * row is an (event → workflow) pair; Save is authoritative — listed pairs are attached to the
 * course's package sessions, and pairs no longer listed are detached.
 */
export const CourseWorkflowTriggersCard: React.FC<CourseWorkflowTriggersCardProps> = ({
    packageId,
}) => {
    const { t } = useTranslation('studyLibraryCourseWorkflowTriggersCard');
    const [events, setEvents] = useState<TriggerEventOption[]>([]);
    const [workflows, setWorkflows] = useState<InstituteWorkflowOption[]>([]);
    const [rows, setRows] = useState<TriggerRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [confirmOpen, setConfirmOpen] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [evs, wfs, existing] = await Promise.all([
                fetchTriggerEvents(),
                fetchInstituteWorkflows(),
                fetchPackageWorkflowTriggers(packageId),
            ]);
            // Course triggers fire on the course's package sessions → only PACKAGE_SESSION events apply.
            const psEvents = evs.filter((e) => e.eventAppliedType === 'PACKAGE_SESSION');
            // Always include events already attached to this course, even if the catalog didn't tag
            // them PACKAGE_SESSION — otherwise their row would render blank and disappear on save.
            const known = new Set(psEvents.map((e) => e.key));
            const fromExisting = existing
                .map((t) => t.triggerEventName)
                .filter((k, i, a) => !!k && !known.has(k) && a.indexOf(k) === i)
                .map((k) => ({
                    key: k,
                    label: evs.find((e) => e.key === k)?.label ?? k,
                    eventAppliedType: 'PACKAGE_SESSION' as string | null,
                }));
            setEvents([...psEvents, ...fromExisting]);
            setWorkflows(wfs);
            setRows(
                existing.map((t) => ({
                    triggerEventName: t.triggerEventName,
                    workflowId: t.workflowId,
                }))
            );
        } catch (e) {
            console.error('Failed to load workflow triggers', e);
            toast.error(t('toast.loadFailed'));
        } finally {
            setLoading(false);
        }
    }, [packageId]);

    useEffect(() => {
        void load();
    }, [load]);

    const updateRow = (i: number, field: 'triggerEventName' | 'workflowId', val: string) =>
        setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: val } : r)));
    const addRow = () => setRows((prev) => [...prev, { triggerEventName: '', workflowId: '' }]);
    const removeRow = (i: number) => setRows((prev) => prev.filter((_, idx) => idx !== i));

    const handleSave = async () => {
        const valid = rows.filter((r) => r.triggerEventName && r.workflowId);
        setSaving(true);
        try {
            const res = await savePackageWorkflowTriggers(packageId, valid);
            toast.success(
                t('toast.saveSuccess', { created: res.created, removed: res.removed })
            );
            await load();
        } catch (e) {
            console.error('Failed to save workflow triggers', e);
            toast.error(e instanceof Error ? e.message : t('toast.saveFailed'));
        } finally {
            setSaving(false);
            setConfirmOpen(false);
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Lightning className="size-5 text-primary-500" weight="fill" />
                    {t('title')}
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                {loading ? (
                    <div className="flex items-center justify-center py-8 text-neutral-500">
                        <CircleNotch className="me-2 size-5 animate-spin" /> {t('loading')}
                    </div>
                ) : (
                    <>
                        <p className="text-sm text-neutral-500">{t('description')}</p>

                        {workflows.length === 0 && (
                            <p className="text-sm text-neutral-400">{t('noWorkflows')}</p>
                        )}

                        {rows.length === 0 ? (
                            <p className="text-sm text-neutral-400">{t('noTriggersYet')}</p>
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
                                            <SelectValue placeholder={t('whenEventPlaceholder')} />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {events.map((e) => (
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
                                            <SelectValue placeholder={t('runWorkflowPlaceholder')} />
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
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => removeRow(i)}
                                        aria-label={t('removeTrigger')}
                                    >
                                        <Trash className="size-4 text-danger-500" />
                                    </Button>
                                </div>
                            ))
                        )}

                        <div className="flex items-center justify-between">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={addRow}
                                className="gap-1 text-primary-600"
                            >
                                <Plus className="size-4" /> {t('addTrigger')}
                            </Button>
                            <MyButton
                                onClick={() => setConfirmOpen(true)}
                                disabled={saving}
                                className="gap-2 bg-primary-500"
                            >
                                <FloppyDisk className="size-4" />
                                {saving ? t('saving') : t('saveTriggers')}
                            </MyButton>
                        </div>
                    </>
                )}
            </CardContent>

            <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('confirmDialog.title')}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('confirmDialog.description')}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={saving}>{t('cancel')}</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={(e) => {
                                e.preventDefault();
                                void handleSave();
                            }}
                            disabled={saving}
                            className="bg-primary-500"
                        >
                            {saving ? t('saving') : t('confirmDialog.yesSave')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Card>
    );
};
