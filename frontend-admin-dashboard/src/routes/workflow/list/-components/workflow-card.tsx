import { Workflow } from '@/types/workflow/workflow-types';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { WorkflowStatusBadge } from '@/routes/workflow/-components/workflow-status-badge';
import { formatDistanceToNow } from 'date-fns';
import { useNavigate } from '@tanstack/react-router';
import { Calendar, Clock, Tag } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

interface WorkflowCardProps {
    workflow: Workflow;
}

export function WorkflowCard({ workflow }: WorkflowCardProps) {
    const { t, i18n } = useTranslation('workflowCard');
    const navigate = useNavigate();

    const formatDate = (dateString: string) => {
        try {
            const date = new Date(dateString);
            return formatDistanceToNow(date, { addSuffix: true });
        } catch (error) {
            return t('unknownDate');
        }
    };

    const humanizeCronQuartz = (expr: string, t: TFunction): string => {
        const parts = expr.trim().split(/\s+/);
        if (parts.length < 6) return expr;
        const [sec, min, hour, dom, mon, dow] = parts as [
            string,
            string,
            string,
            string,
            string,
            string,
        ];

        const to12h = (h: number, m: number) => {
            const period = h >= 12 ? t('cron.pm') : t('cron.am');
            const h12 = h % 12 === 0 ? 12 : h % 12;
            const mm = m.toString().padStart(2, '0');
            return `${h12}:${mm} ${period}`;
        };

        const isStar = (v: string) => v === '*' || v === '?';
        const nMin = parseInt(min, 10);
        const nHour = parseInt(hour, 10);
        if (!Number.isNaN(nMin) && !Number.isNaN(nHour) && sec === '0') {
            const timeStr = to12h(nHour, nMin);
            if (isStar(dom) && isStar(mon) && isStar(dow)) {
                return t('cron.everyDayAt', { time: timeStr });
            }
            const dowNames: Record<string, string> = {
                SUN: t('cron.days.sunday'),
                MON: t('cron.days.monday'),
                TUE: t('cron.days.tuesday'),
                WED: t('cron.days.wednesday'),
                THU: t('cron.days.thursday'),
                FRI: t('cron.days.friday'),
                SAT: t('cron.days.saturday'),
                '1': t('cron.days.sunday'),
                '2': t('cron.days.monday'),
                '3': t('cron.days.tuesday'),
                '4': t('cron.days.wednesday'),
                '5': t('cron.days.thursday'),
                '6': t('cron.days.friday'),
                '7': t('cron.days.saturday'),
            };
            if (!isStar(dow)) {
                const days = dow
                    .split(',')
                    .map((d) => dowNames[d] || d)
                    .join(', ');
                return t('cron.everyDaysAt', { days, time: timeStr });
            }
            if (!isStar(dom) && isStar(mon)) {
                return t('cron.onDayOfEveryMonthAt', { day: dom, time: timeStr });
            }
            const monNames: Record<string, string> = {
                JAN: t('cron.months.january'),
                FEB: t('cron.months.february'),
                MAR: t('cron.months.march'),
                APR: t('cron.months.april'),
                MAY: t('cron.months.may'),
                JUN: t('cron.months.june'),
                JUL: t('cron.months.july'),
                AUG: t('cron.months.august'),
                SEP: t('cron.months.september'),
                OCT: t('cron.months.october'),
                NOV: t('cron.months.november'),
                DEC: t('cron.months.december'),
            };
            if (!isStar(dom) && !isStar(mon)) {
                const months = mon
                    .split(',')
                    .map((m) => monNames[m] || m)
                    .join(', ');
                return t('cron.onDayOfMonthsAt', { day: dom, months, time: timeStr });
            }
            if (isStar(dom) && !isStar(mon)) {
                const months = mon
                    .split(',')
                    .map((m) => monNames[m] || m)
                    .join(', ');
                return t('cron.everyDayOfMonthsAt', { months, time: timeStr });
            }
        }
        return expr;
    };

    const formatWorkflowType = (type: string) => {
        // Convert EVENT_DRIVEN to "Event Driven", SCHEDULED to "Scheduled", etc.
        return type
            .split('_')
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(' ');
    };

    const handleCardClick = () => {
        navigate({ to: '/workflow/$workflowId', params: { workflowId: workflow.id } });
    };

    const isScheduled = workflow.workflow_type === 'SCHEDULED';
    const isEventDriven =
        workflow.workflow_type === 'EVENT_DRIVEN' || workflow.workflow_type === 'TRIGGER';

    return (
        <Card
            className="group cursor-pointer border-neutral-200 transition-all duration-200 hover:border-primary-300 hover:shadow-lg"
            onClick={handleCardClick}
        >
            <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                    <h3 className="line-clamp-2 text-lg font-semibold text-neutral-900 transition-colors group-hover:text-primary-600">
                        {workflow.name}
                    </h3>
                    <WorkflowStatusBadge status={workflow.status} />
                </div>
            </CardHeader>

            <CardContent className="space-y-4">
                {/* Description */}
                <p className="line-clamp-3 min-h-12 text-sm text-neutral-600">
                    {workflow.description || t('noDescription')}
                </p>

                {/* Workflow Type */}
                <div className="flex items-center gap-2 text-sm">
                    <Tag className="text-primary-500" size={16} weight="fill" />
                    <span className="text-neutral-500">{t('type')}</span>
                    <Badge variant="outline" className="font-medium text-primary-600">
                        {formatWorkflowType(workflow.workflow_type)}
                    </Badge>
                </div>

                {/* Schedules (only for SCHEDULED workflows) */}
                {isScheduled && (
                    <div className="space-y-2 rounded-md border border-neutral-200 bg-neutral-50 p-3">
                        <div className="text-xs font-medium text-neutral-600">{t('schedules')}</div>
                        {workflow.schedules && workflow.schedules.length > 0 ? (
                            <div className="space-y-2">
                                {workflow.schedules.slice(0, 3).map((s, idx) => (
                                    <div
                                        key={idx}
                                        className="flex flex-wrap items-center gap-2 text-xs text-neutral-600"
                                    >
                                        <Badge
                                            variant="secondary"
                                            className="bg-blue-50 text-blue-700"
                                        >
                                            {s.schedule_type || t('cronBadge')}
                                        </Badge>
                                        {s.cron_expression && (
                                            <span
                                                className="truncate"
                                                title={s.cron_expression || undefined}
                                            >
                                                {humanizeCronQuartz(s.cron_expression, t)}
                                            </span>
                                        )}
                                        {s.timezone && <span>({s.timezone})</span>}
                                        {s.last_run_at && (
                                            <span className="flex items-center gap-1">
                                                <Clock size={12} className="text-neutral-400" />
                                                {t('lastRun', { time: new Date(s.last_run_at).toLocaleString(i18n.language) })}
                                            </span>
                                        )}
                                        {s.next_run_at && (
                                            <span className="flex items-center gap-1">
                                                <Clock size={12} className="text-neutral-400" />
                                                {t('nextRun', { time: new Date(s.next_run_at).toLocaleString(i18n.language) })}
                                            </span>
                                        )}
                                    </div>
                                ))}
                                {workflow.schedules.length > 3 && (
                                    <div className="text-xs text-neutral-500">
                                        {t('andMore', { count: workflow.schedules.length - 3 })}
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="text-xs text-neutral-500">{t('noScheduleAdded')}</div>
                        )}
                    </div>
                )}

                {/* Trigger (for EVENT_DRIVEN/TRIGGER workflows) */}
                {isEventDriven && (
                    <div className="space-y-2 rounded-md border border-neutral-200 bg-neutral-50 p-3">
                        <div className="text-xs font-medium text-neutral-600">{t('trigger')}</div>
                        {workflow.trigger ? (
                            <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-600">
                                {workflow.trigger.trigger_event_name && (
                                    <Badge
                                        variant="secondary"
                                        className="bg-purple-50 text-purple-700"
                                    >
                                        {workflow.trigger.trigger_event_name}
                                    </Badge>
                                )}
                                {workflow.trigger.event_applied_type && (
                                    <span className="text-xs text-muted-foreground">
                                        {t('appliesTo', { type: workflow.trigger.event_applied_type.replace(/_/g, ' ') })}
                                    </span>
                                )}
                                {workflow.trigger.trigger_status && (
                                    <Badge variant="outline" className="text-green-700">
                                        {workflow.trigger.trigger_status}
                                    </Badge>
                                )}
                                {workflow.trigger.trigger_description && (
                                    <span className="truncate">
                                        {workflow.trigger.trigger_description}
                                    </span>
                                )}
                            </div>
                        ) : (
                            <div className="text-xs text-neutral-500">{t('noTriggerDetails')}</div>
                        )}
                    </div>
                )}

                {/* Metadata */}
                <div className="space-y-2 border-t border-neutral-200 pt-3">
                    <div className="flex items-center gap-2 text-xs text-neutral-500">
                        <Calendar size={14} weight="duotone" className="text-neutral-400" />
                        <span>{t('created', { time: formatDate(workflow.created_at) })}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-neutral-500">
                        <Clock size={14} weight="duotone" className="text-neutral-400" />
                        <span>{t('updated', { time: formatDate(workflow.updated_at) })}</span>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
