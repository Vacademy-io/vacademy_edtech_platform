import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Megaphone, Plus } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { SectionCard } from '@/routes/study-library/live-session/-components/dashboard/dashboard-charts';
import { listTemplates } from '../-services';
import {
    createEngineUpdate,
    endEngineUpdate,
    engineUpdateState,
    listEngineUpdates,
} from '../-services/updates';

const MESSAGE_MAX = 1000;
const APPROVED_TEMPLATE = new Set(['META_APPROVED', 'META_RECATEGORISED']);

const errorText = (e: unknown, fallback: string) =>
    (e as { response?: { data?: { ex?: string } } })?.response?.data?.ex || fallback;

/**
 * Time-boxed news for this engine: a festival greeting, an offer. Everyone in the engine is looked
 * at again when it starts, and nothing drafted for it goes out after it ends.
 */
export function EngineUpdatesCard({
    engineId,
    instituteId,
    canEdit,
    className,
}: {
    engineId: string;
    instituteId: string;
    canEdit: boolean;
    className?: string;
}) {
    const { t } = useTranslation('engagementEnginesEngineIdIndex');
    const queryClient = useQueryClient();
    const queryKey = ['engagement-engine-updates', engineId];
    const [open, setOpen] = useState(false);
    const [message, setMessage] = useState('');
    const [startsAt, setStartsAt] = useState('');
    const [endsAt, setEndsAt] = useState('');
    const [templateName, setTemplateName] = useState('');

    const { data: updates = [], isLoading } = useQuery({
        queryKey,
        queryFn: () => listEngineUpdates(engineId, instituteId),
    });
    const { data: templates = [] } = useQuery({
        queryKey: ['engagement-engine-templates', engineId],
        queryFn: () => listTemplates(engineId, instituteId),
        enabled: open,
    });
    const approved = useMemo(
        () => templates.filter((p) => APPROVED_TEMPLATE.has(p.status) && p.name),
        [templates]
    );

    const refresh = () => queryClient.invalidateQueries({ queryKey });
    const create = useMutation({
        mutationFn: () =>
            createEngineUpdate(engineId, instituteId, {
                message: message.trim(),
                templateName: templateName || undefined,
                startsAt: startsAt ? new Date(startsAt).toISOString() : undefined,
                endsAt: new Date(endsAt).toISOString(),
            }),
        onSuccess: () => {
            toast.success(t('updates.added'));
            setOpen(false);
            setMessage('');
            setStartsAt('');
            setEndsAt('');
            setTemplateName('');
            refresh();
        },
        onError: (e) => toast.error(errorText(e, t('updates.saveFailed'))),
    });
    const end = useMutation({
        mutationFn: (updateId: string) => endEngineUpdate(engineId, updateId, instituteId),
        onSuccess: () => {
            toast.success(t('updates.endedToast'));
            refresh();
        },
        onError: (e) => toast.error(errorText(e, t('updates.saveFailed'))),
    });

    const canSave = !!message.trim() && !!endsAt && !create.isPending;

    return (
        <SectionCard
            title={t('updates.title')}
            subtitle={t('updates.subtitle')}
            icon={Megaphone}
            className={className}
            right={
                canEdit && (
                    <MyButton buttonType="secondary" scale="small" onClick={() => setOpen(true)}>
                        <Plus className="me-1 size-4" /> {t('updates.add')}
                    </MyButton>
                )
            }
        >
            {isLoading ? (
                <Skeleton className="h-10 w-full rounded-lg" />
            ) : updates.length === 0 ? (
                <p className="text-neutral-500">
                    <span className="text-body">{t('updates.empty')}</span>
                </p>
            ) : (
                <ul className="flex flex-col gap-3">
                    {updates.map((u) => {
                        const state = engineUpdateState(u);
                        return (
                            <li
                                key={u.id}
                                className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-neutral-200 p-3"
                            >
                                <div className="flex min-w-0 flex-1 flex-col gap-1">
                                    <span className="whitespace-pre-wrap text-neutral-800">
                                        <span className="text-body">{u.message}</span>
                                    </span>
                                    <span className="text-neutral-500">
                                        <span className="text-caption">
                                            {t(`updates.state.${state}`)} ·{' '}
                                            {t('updates.dates', {
                                                start: new Date(u.startsAt).toLocaleString(),
                                                end: new Date(u.endsAt).toLocaleString(),
                                            })}
                                            {u.templateName
                                                ? ` · ${t('updates.templateLabel', { name: u.templateName })}`
                                                : ''}
                                        </span>
                                    </span>
                                </div>
                                {canEdit && state !== 'ended' && (
                                    <MyButton
                                        buttonType="secondary"
                                        scale="small"
                                        disable={end.isPending}
                                        onClick={() => end.mutate(u.id)}
                                    >
                                        {t('updates.end')}
                                    </MyButton>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}
            {open && (
                <MyDialog
                    heading={t('updates.dialogHeading')}
                    open={open}
                    onOpenChange={setOpen}
                    dialogWidth="max-w-lg"
                >
                    <div className="flex flex-col gap-3 p-1">
                        <p className="text-neutral-500">
                            <span className="text-caption">{t('updates.dialogHint')}</span>
                        </p>
                        <div className="flex flex-col gap-1">
                            <Label htmlFor="engine-update-message">{t('updates.message')}</Label>
                            <Textarea
                                id="engine-update-message"
                                rows={4}
                                maxLength={MESSAGE_MAX}
                                value={message}
                                onChange={(e) => setMessage(e.target.value)}
                                placeholder={t('updates.messagePlaceholder')}
                            />
                        </div>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div className="flex flex-col gap-1">
                                <Label htmlFor="engine-update-start">{t('updates.start')}</Label>
                                <Input
                                    id="engine-update-start"
                                    type="datetime-local"
                                    value={startsAt}
                                    onChange={(e) => setStartsAt(e.target.value)}
                                />
                            </div>
                            <div className="flex flex-col gap-1">
                                <Label htmlFor="engine-update-end">{t('updates.endDate')}</Label>
                                <Input
                                    id="engine-update-end"
                                    type="datetime-local"
                                    value={endsAt}
                                    onChange={(e) => setEndsAt(e.target.value)}
                                />
                            </div>
                        </div>
                        <div className="flex flex-col gap-1">
                            <Label htmlFor="engine-update-template">{t('updates.template')}</Label>
                            <select
                                id="engine-update-template"
                                className="h-9 rounded-md border border-neutral-300 bg-white px-2"
                                value={templateName}
                                onChange={(e) => setTemplateName(e.target.value)}
                            >
                                <option value="">{t('updates.noTemplate')}</option>
                                {approved.map((p) => (
                                    <option key={p.id} value={p.name}>
                                        {p.name}
                                    </option>
                                ))}
                            </select>
                            <p className="text-neutral-500">
                                <span className="text-caption">{t('updates.templateHint')}</span>
                            </p>
                        </div>
                        <div className="flex justify-end gap-2">
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                onClick={() => setOpen(false)}
                            >
                                {t('updates.cancel')}
                            </MyButton>
                            <MyButton
                                buttonType="primary"
                                scale="small"
                                disable={!canSave}
                                onClick={() => create.mutate()}
                            >
                                {create.isPending ? t('updates.saving') : t('updates.save')}
                            </MyButton>
                        </div>
                    </div>
                </MyDialog>
            )}
        </SectionCard>
    );
}
