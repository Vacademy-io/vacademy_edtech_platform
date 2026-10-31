import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
    ArrowsLeftRight,
    CaretDown,
    ChatCircleText,
    Lightning,
    PlusCircle,
    UserCircleMinus,
    UserCirclePlus,
} from '@phosphor-icons/react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Textarea } from '@/components/ui/textarea';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';
import { formatISODateTimeReadable } from '@/helpers/formatISOTime';
import { useGetUserBasicDetails } from '@/services/get_user_basic_details';
import { useInstituteAssignees } from '@/routes/dashboard/-hooks/useInstituteAssignees';
import { getInstituteId } from '@/constants/helper';
import { Doubt } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-types/get-doubts-type';
import { useDoubtActivity } from '../../-services/use-doubt-activity';
import { useDoubtQueryTypes } from '../../-services/use-doubt-query-types';
import { useDoubtStatuses } from '../../-services/use-doubt-statuses';
import { useUpdateDoubt } from '../../-services/use-update-doubt';
import { DoubtActivity } from '../../-types/doubt-activity';

/**
 * Turn a stored rule code into words: `TYPE:TECHNICAL:ROLE:ADMIN` → "Technical Issue → Role: Admin",
 * `DEFAULT:SUBJECT_TEACHER` → "Default routing: Subject teacher", etc. Unknown codes are shown as-is
 * so a new backend rule is never hidden.
 */
const useRuleLabel = () => {
    const { t } = useTranslation('studyLibraryDoubtActivity');
    const { labelByKey } = useDoubtQueryTypes();
    const sourceLabel = (source: string) => {
        const key = `sources.${source}`;
        const translated = t(key);
        return translated === key ? source : translated;
    };
    return (code?: string | null): string => {
        if (!code) return '';
        const parts = code.split(':');
        if (parts[0] === 'TYPE' && parts[1]) {
            const rest = parts.slice(2);
            const source = rest[0] ? sourceLabel(rest[0]) : '';
            const role = rest[1] ? ` · ${rest[1].charAt(0) + rest[1].slice(1).toLowerCase()}` : '';
            return `${labelByKey(parts[1])}${source ? ` → ${source}${role}` : ''}`;
        }
        if (parts[0] === 'DEFAULT' && parts[1]) {
            return t('defaultRouting', { source: sourceLabel(parts[1]) });
        }
        return sourceLabel(code);
    };
};

const ICONS: Record<DoubtActivity['action'], typeof PlusCircle> = {
    CREATED: PlusCircle,
    ASSIGNED: UserCirclePlus,
    UNASSIGNED: UserCircleMinus,
    STATUS_CHANGED: ArrowsLeftRight,
    REMARK: ChatCircleText,
};

/**
 * Collapsible "Activity" section for the conversation pane: the doubt's audit trail (who assigned
 * whom — by hand or by which rule — status changes with their remarks, standalone remarks) plus a
 * composer to leave a remark on the current status. Staff only: the endpoint refuses learners.
 */
export const DoubtActivityTimeline = ({
    doubt,
    canRemark,
    defaultOpen = false,
}: {
    doubt: Doubt;
    canRemark: boolean;
    defaultOpen?: boolean;
}) => {
    const { t } = useTranslation('studyLibraryDoubtActivity');
    const [open, setOpen] = useState(defaultOpen);
    const { data: rows = [], isLoading, isError } = useDoubtActivity(doubt.id, { enabled: open });
    const { labelByKey: statusLabel } = useDoubtStatuses();
    const ruleLabel = useRuleLabel();
    const update = useUpdateDoubt();
    const [remark, setRemark] = useState('');

    // Names: institute staff first (cached), then anything else (learner who raised it, departed
    // staff) through user-basic-details.
    const { assignees } = useInstituteAssignees(getInstituteId());
    const staffNames = useMemo(() => new Map(assignees.map((a) => [a.id, a.name])), [assignees]);
    const unknownIds = useMemo(
        () =>
            [
                ...new Set(
                    rows
                        .flatMap((r) => [r.actor_user_id, r.target_user_id])
                        .filter((id): id is string => !!id && !staffNames.has(id))
                ),
            ].sort(),
        [rows, staffNames]
    );
    const { data: resolvedUsers } = useGetUserBasicDetails(unknownIds);
    const nameOf = (id?: string | null) =>
        (id && (staffNames.get(id) ?? resolvedUsers?.find((u) => u.id === id)?.name)) ||
        t('someone');

    const describe = (row: DoubtActivity): string => {
        const actor =
            row.actor_type === 'RULE'
                ? t('rule')
                : row.actor_type === 'SYSTEM'
                  ? t('system')
                  : nameOf(row.actor_user_id);
        switch (row.action) {
            case 'CREATED':
                return t('lines.created', { actor });
            case 'ASSIGNED':
                return row.actor_type === 'RULE'
                    ? t('lines.autoAssigned', {
                          target: nameOf(row.target_user_id),
                          rule: ruleLabel(row.rule_source),
                      })
                    : t('lines.assigned', { actor, target: nameOf(row.target_user_id) });
            case 'UNASSIGNED':
                return row.rule_source === 'DEFAULT_EXCLUDED'
                    ? t('lines.removedDefault', { actor, target: nameOf(row.target_user_id) })
                    : t('lines.unassigned', { actor, target: nameOf(row.target_user_id) });
            case 'STATUS_CHANGED':
                return t('lines.statusChanged', {
                    actor,
                    from: statusLabel(row.from_value),
                    to: statusLabel(row.to_value),
                });
            case 'REMARK':
                return t('lines.remark', { actor, status: statusLabel(row.to_value) });
        }
    };

    const submitRemark = async () => {
        const text = remark.trim();
        if (!text) return;
        try {
            await update.mutateAsync({ doubt, patch: { remark: text } });
            setRemark('');
            toast.success(t('remarkAdded'));
        } catch {
            toast.error(t('remarkFailed'));
        }
    };

    return (
        <Collapsible open={open} onOpenChange={setOpen} className="border-b border-neutral-200">
            <CollapsibleTrigger asChild>
                <button
                    type="button"
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-xs font-medium text-neutral-600 hover:bg-neutral-50"
                >
                    <Lightning
                        size={14}
                        weight="duotone"
                        className="text-primary-500"
                        aria-hidden
                    />
                    <span className="flex-1">
                        {t('title')}
                        {open && !isLoading && (
                            <span className="text-neutral-400"> · {rows.length}</span>
                        )}
                    </span>
                    <CaretDown
                        size={14}
                        className={cn(
                            'text-neutral-400 transition-transform',
                            open && 'rotate-180'
                        )}
                        aria-hidden
                    />
                </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
                <div className="space-y-3 px-4 pb-3">
                    {isLoading ? (
                        <div className="space-y-2">
                            {Array.from({ length: 3 }).map((_, i) => (
                                <div key={i} className="h-5 animate-pulse rounded bg-neutral-100" />
                            ))}
                        </div>
                    ) : isError ? (
                        <p className="text-xs text-danger-600">{t('failedToLoad')}</p>
                    ) : rows.length === 0 ? (
                        <p className="text-xs text-neutral-400">{t('empty')}</p>
                    ) : (
                        <ol className="space-y-2">
                            {rows.map((row) => {
                                const Icon = ICONS[row.action] ?? Lightning;
                                return (
                                    <li key={row.id} className="flex gap-2 text-xs">
                                        <span
                                            className={cn(
                                                'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full',
                                                row.actor_type === 'RULE'
                                                    ? 'bg-info-50 text-info-600'
                                                    : row.action === 'REMARK'
                                                      ? 'bg-warning-50 text-warning-600'
                                                      : 'bg-neutral-100 text-neutral-500'
                                            )}
                                            aria-hidden
                                        >
                                            <Icon size={12} weight="duotone" />
                                        </span>
                                        <div className="min-w-0 flex-1">
                                            <p className="text-neutral-700">
                                                {describe(row)}
                                                {row.actor_type === 'RULE' && (
                                                    <span className="ml-1 rounded-full bg-info-50 px-1.5 py-0.5 text-caption font-semibold text-info-700">
                                                        {t('ruleBadge')}
                                                    </span>
                                                )}
                                            </p>
                                            {row.remark && (
                                                <p className="mt-1 whitespace-pre-wrap rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1 text-neutral-700">
                                                    {row.remark}
                                                </p>
                                            )}
                                            <p className="mt-0.5 text-caption text-neutral-400">
                                                {formatISODateTimeReadable(row.created_at)}
                                            </p>
                                        </div>
                                    </li>
                                );
                            })}
                        </ol>
                    )}

                    {canRemark && (
                        <div className="flex flex-col gap-2">
                            <Textarea
                                value={remark}
                                onChange={(e) => setRemark(e.target.value)}
                                placeholder={t('remarkPlaceholder')}
                                rows={2}
                                aria-label={t('remarkPlaceholder')}
                                className="min-h-0 text-sm"
                            />
                            <div className="flex justify-end">
                                <MyButton
                                    buttonType="secondary"
                                    scale="small"
                                    disable={!remark.trim() || update.isPending}
                                    onAsyncClick={submitRemark}
                                    loadingText={t('saving')}
                                >
                                    {t('addRemark')}
                                </MyButton>
                            </div>
                        </div>
                    )}
                </div>
            </CollapsibleContent>
        </Collapsible>
    );
};
