import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { MyButton } from '@/components/design-system/button';
import {
    Rocket,
    CheckCircle,
    Circle,
    Warning,
    CircleNotch,
    CalendarBlank,
} from '@phosphor-icons/react';
import {
    confirmMilestone,
    milestoneProgress,
    postWidgetComment,
    type DashboardWidget,
    type Milestone,
    type MilestoneStatus,
} from '@/services/institute-widgets';

const buildStatusMeta = (
    t: TFunction
): Record<MilestoneStatus, { label: string; chip: string; Icon: typeof Circle }> => ({
    DONE: { label: t('status.done'), chip: 'bg-success-50 text-success-600', Icon: CheckCircle },
    IN_PROGRESS: {
        label: t('status.inProgress'),
        chip: 'bg-primary-50 text-primary-600',
        Icon: CircleNotch,
    },
    BLOCKED: { label: t('status.blocked'), chip: 'bg-danger-50 text-danger-600', Icon: Warning },
    NOT_STARTED: {
        label: t('status.notStarted'),
        chip: 'bg-neutral-100 text-neutral-500',
        Icon: Circle,
    },
});

export default function OnboardingTrackerWidget({ widget }: { widget: DashboardWidget }) {
    const { t } = useTranslation('dashboardOnboardingTrackerWidget');
    const queryClient = useQueryClient();
    const milestones: Milestone[] = widget.payload?.milestones ?? [];
    const progress = milestoneProgress(milestones);
    const [comment, setComment] = useState('');
    const statusMeta = buildStatusMeta(t);

    const invalidate = () => queryClient.invalidateQueries({ queryKey: ['institute-widgets'] });

    return (
        <Card className="flex w-full flex-col bg-white shadow-sm">
            <CardHeader className="p-4 pb-2">
                <div className="flex items-center gap-2">
                    <span className="flex size-7 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
                        <Rocket size={14} weight="duotone" />
                    </span>
                    <CardTitle className="text-subtitle font-semibold">{widget.title}</CardTitle>
                </div>
                <CardDescription className="text-caption text-neutral-500">
                    {t('header.progress', { count: progress })}
                </CardDescription>
                <div className="mt-2">
                    <Progress value={progress} />
                </div>
            </CardHeader>

            <div className="flex flex-col gap-2 px-4 pb-3">
                {milestones.length === 0 ? (
                    <p className="py-4 text-center text-caption text-neutral-400">
                        {t('empty.message')}
                    </p>
                ) : (
                    milestones.map((m) => {
                        const meta = statusMeta[m.status] ?? statusMeta.NOT_STARTED;
                        const Icon = meta.Icon;
                        return (
                            <div
                                key={m.id}
                                className="flex flex-col gap-1 rounded-md border border-neutral-100 p-3"
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2">
                                        <Icon size={16} weight="duotone" className="text-neutral-500" />
                                        <span className="text-body font-medium text-neutral-700">
                                            {m.label}
                                        </span>
                                    </div>
                                    <span
                                        className={`rounded-full px-2 py-0.5 text-caption font-medium ${meta.chip}`}
                                    >
                                        {meta.label}
                                    </span>
                                </div>
                                <div className="flex items-center justify-between gap-2 pl-6">
                                    <div className="flex items-center gap-3 text-caption text-neutral-500">
                                        {m.estimatedDate && (
                                            <span className="flex items-center gap-1">
                                                <CalendarBlank size={12} weight="duotone" />
                                                {t('milestone.eta', { date: m.estimatedDate })}
                                            </span>
                                        )}
                                        {m.note && <span>{m.note}</span>}
                                    </div>
                                    {m.status !== 'DONE' && (
                                        <MyButton
                                            buttonType="text"
                                            scale="small"
                                            onAsyncClick={async () => {
                                                await confirmMilestone(widget.id, m.id);
                                                invalidate();
                                            }}
                                        >
                                            {t('milestone.confirmButton')}
                                        </MyButton>
                                    )}
                                </div>
                            </div>
                        );
                    })
                )}

                {widget.payload?.overallNote && (
                    <p className="rounded-md bg-neutral-50 p-2 text-caption text-neutral-600">
                        {widget.payload.overallNote}
                    </p>
                )}

                {/* Comment box */}
                <div className="mt-1 flex items-end gap-2">
                    <textarea
                        className="min-h-9 w-full resize-none rounded-md border border-neutral-200 p-2 text-caption focus:outline-none focus:ring-2 focus:ring-primary-200"
                        rows={1}
                        placeholder={t('comment.placeholder')}
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                    />
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        disable={!comment.trim()}
                        onAsyncClick={async () => {
                            if (!comment.trim()) return;
                            await postWidgetComment(widget.id, comment.trim());
                            setComment('');
                            invalidate();
                        }}
                    >
                        {t('comment.sendButton')}
                    </MyButton>
                </div>
            </div>
        </Card>
    );
}
