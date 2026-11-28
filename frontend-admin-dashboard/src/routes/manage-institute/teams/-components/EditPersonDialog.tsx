import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { MyButton } from '@/components/design-system/button';
import {
    updateTeamMember,
    type OrgChartNode,
} from '../-services/org-team-services';

interface PersonInTeam {
    mappingId: string;
    userId: string;
    name: string;
    depth: number;
}

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    teamId: string;
    /** The card being edited. */
    node: OrgChartNode;
    /** Name as resolved from the auth roster, for the header. */
    name: string;
    /** Everyone currently in the team, including the editee — we filter
     *  them and their reports out of the manager picker to prevent cycles. */
    peopleInTeam: PersonInTeam[];
    onSaved: () => void;
}

/**
 * Change a person's manager (reports-to) and/or their position label
 * without drag-and-drop. The same operations the chart's drag-drop fires,
 * but click-driven so it's reliable even when native HTML5 drag misbehaves.
 */
export function EditPersonDialog({
    open,
    onOpenChange,
    teamId,
    node,
    name,
    peopleInTeam,
    onSaved,
}: Props) {
    const { t } = useTranslation('manageInstituteEditPersonDialog');
    const [parentUserId, setParentUserId] = useState<string>('');
    const [roleLabel, setRoleLabel] = useState('');

    useEffect(() => {
        if (open) {
            setParentUserId(node.parent_user_id ?? '');
            setRoleLabel(node.role_label ?? '');
        }
    }, [open, node]);

    // Exclude self + every descendant of self so the picker can't create a cycle.
    const ineligibleUserIds = new Set<string>();
    ineligibleUserIds.add(node.user_id);
    const walk = (n: OrgChartNode) => {
        ineligibleUserIds.add(n.user_id);
        n.children?.forEach(walk);
    };
    node.children?.forEach(walk);
    const managerOptions = peopleInTeam.filter((p) => !ineligibleUserIds.has(p.userId));

    const initialParent = node.parent_user_id ?? '';
    const initialLabel = node.role_label ?? '';
    const parentChanged = parentUserId !== initialParent;
    const labelChanged = roleLabel.trim() !== initialLabel.trim();
    const dirty = parentChanged || labelChanged;

    const saveMutation = useMutation({
        mutationFn: () =>
            updateTeamMember(teamId, node.mapping_id, {
                ...(parentChanged && {
                    change_parent: true,
                    parent_user_id: parentUserId || null,
                }),
                ...(labelChanged && {
                    change_role_label: true,
                    role_label: roleLabel.trim(),
                }),
            }),
        onSuccess: () => {
            toast.success(t('toast.updated'));
            onSaved();
            onOpenChange(false);
        },
        onError: (e) => {
            const msg = (e as { response?: { data?: { ex?: string } } })?.response?.data?.ex;
            toast.error(msg ?? t('toast.saveFailed'));
        },
    });

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle className="text-h3">{t('title', { name })}</DialogTitle>
                    <p className="text-subtitle text-neutral-500">{t('subtitle')}</p>
                </DialogHeader>

                <div className="space-y-4">
                    <div>
                        <label className="mb-1 block text-caption font-medium text-neutral-700">
                            {t('reportsTo')}
                        </label>
                        <select
                            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-body"
                            value={parentUserId}
                            onChange={(e) => setParentUserId(e.target.value)}
                        >
                            <option value="">{t('noManager')}</option>
                            {managerOptions.map((p) => (
                                <option key={p.mappingId} value={p.userId}>
                                    {'  '.repeat(p.depth)}
                                    {p.depth > 0 ? '↳ ' : ''}
                                    {p.name}
                                </option>
                            ))}
                        </select>
                        <p className="mt-1 text-caption text-neutral-500">
                            {t('reportsToHint')}
                        </p>
                    </div>

                    <div>
                        <label className="mb-1 block text-caption font-medium text-neutral-700">
                            {t('positionLabel')}{' '}
                            <span className="text-neutral-400">{t('optional')}</span>
                        </label>
                        <input
                            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-body"
                            placeholder={t('positionLabelPlaceholder')}
                            value={roleLabel}
                            onChange={(e) => setRoleLabel(e.target.value)}
                            maxLength={100}
                        />
                    </div>
                </div>

                <DialogFooter>
                    <MyButton
                        buttonType="secondary"
                        onClick={() => onOpenChange(false)}
                        disable={saveMutation.isPending}
                    >
                        {t('actions.cancel')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        onClick={() => saveMutation.mutate()}
                        disable={!dirty || saveMutation.isPending}
                    >
                        {saveMutation.isPending ? t('actions.saving') : t('actions.saveChanges')}
                    </MyButton>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
