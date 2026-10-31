import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { toast } from 'sonner';
import {
    NotePencil,
    Phone,
    CalendarCheck,
    Buildings,
    type Icon as PhosphorIcon,
} from '@phosphor-icons/react';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { CREATE_TIMELINE_EVENT, GET_TIMELINE_EVENTS } from '@/constants/urls';
import { parseHtmlToString } from '@/lib/utils';
import { invalidateLeadCaches } from '@/hooks/use-invalidate-lead-caches';
import { MyButton } from '@/components/design-system/button';
import { Textarea } from '@/components/ui/textarea';
import { ContactCallButton } from '@/components/shared/telephony/contact-call-button';
import { ProfileSectionCard, ProfileEmpty } from '../profile-ui';

const REMARKS_PAGE_SIZE = 5;

interface RemarkEvent {
    id: string;
    action_type: string;
    actor_name: string | null;
    title: string | null;
    description: string | null;
    created_at: string;
}

interface RemarksPage {
    content: RemarkEvent[];
    totalElements: number;
}

// Same STUDENT-scoped events the Lead Profile / Full History tabs list, so a
// remark left here shows up there too (and vice versa).
async function fetchRemarks(userId: string): Promise<RemarksPage> {
    const response = await authenticatedAxiosInstance.get<RemarksPage>(GET_TIMELINE_EVENTS, {
        params: { type: 'STUDENT', typeId: userId, page: 0, size: REMARKS_PAGE_SIZE },
    });
    return response.data;
}

const ACTION_ICONS: Record<string, PhosphorIcon> = {
    NOTE: NotePencil,
    CALL_LOG: Phone,
    FOLLOW_UP: CalendarCheck,
    MEETING: Buildings,
};

/**
 * Remarks card — the Overview tab's "call the learner, then write down what was
 * said" surface. Academic staff reach it from the Live Class Feedback page (a
 * low rating → open the learner → call → remark) without leaving the sheet.
 *
 * Remarks are STUDENT timeline NOTE events keyed by user_id, the same rows the
 * Lead Profile tab's note form writes, so nothing here is a second store.
 */
export const OverviewRemarks = ({
    userId,
    userName,
    phone,
    leadResponseId,
}: {
    userId?: string | null;
    userName?: string | null;
    phone?: string | null;
    /** audience_response id when the sheet was opened for a CRM lead. */
    leadResponseId?: string | null;
}) => {
    const { t } = useTranslation('manageStudentsOverviewRemarks');
    const queryClient = useQueryClient();
    const [text, setText] = useState('');
    const enabled = !!userId;

    const remarksQuery = useQuery({
        queryKey: ['overview-remarks', userId],
        queryFn: () => fetchRemarks(userId as string),
        enabled,
        staleTime: 30_000,
    });

    const addRemark = useMutation({
        mutationFn: () =>
            authenticatedAxiosInstance.post(CREATE_TIMELINE_EVENT, {
                type: 'STUDENT',
                type_id: userId,
                action_type: 'NOTE',
                title: t('noteTitle'),
                description: text.trim(),
                student_user_id: userId,
            }),
        onSuccess: () => {
            toast.success(t('toast.added'));
            setText('');
            queryClient.invalidateQueries({ queryKey: ['overview-remarks', userId] });
            queryClient.invalidateQueries({ queryKey: ['latest-notes-batch'] });
            invalidateLeadCaches(queryClient, userId as string);
        },
        onError: () => toast.error(t('toast.failed')),
    });

    if (!enabled) return null;

    const remarks = remarksQuery.data?.content ?? [];
    const canSubmit = text.trim().length > 0 && !addRemark.isPending;

    return (
        <ProfileSectionCard
            icon={NotePencil}
            heading={t('heading')}
            action={
                <ContactCallButton
                    appearance="button"
                    label={t('callButton')}
                    userId={userId}
                    responseId={leadResponseId}
                    phone={phone}
                    name={userName}
                />
            }
        >
            <div className="flex flex-col gap-2">
                <Textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={t('placeholder')}
                    rows={2}
                    className="min-h-14 resize-y text-caption"
                    disabled={addRemark.isPending}
                />
                <div className="flex justify-end">
                    <MyButton
                        buttonType="primary"
                        scale="small"
                        disable={!canSubmit}
                        onClick={() => canSubmit && addRemark.mutate()}
                    >
                        {addRemark.isPending ? t('adding') : t('addButton')}
                    </MyButton>
                </div>

                {remarksQuery.isLoading ? (
                    <div className="flex flex-col gap-2">
                        {[1, 2].map((i) => (
                            <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
                        ))}
                    </div>
                ) : remarksQuery.isError ? (
                    <p className="text-caption text-danger-600">{t('loadError')}</p>
                ) : remarks.length === 0 ? (
                    <ProfileEmpty
                        icon={NotePencil}
                        title={t('empty.title')}
                        hint={t('empty.hint')}
                    />
                ) : (
                    <ul className="flex flex-col divide-y divide-border">
                        {remarks.map((remark) => {
                            const Icon = ACTION_ICONS[remark.action_type] ?? NotePencil;
                            // Rich-text composers store HTML; render everything as text here.
                            const body = parseHtmlToString(remark.description ?? '').trim();
                            return (
                                <li
                                    key={remark.id}
                                    className="flex items-start gap-2 py-2 first:pt-1 last:pb-0"
                                >
                                    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                                        <Icon className="size-3.5" weight="duotone" />
                                    </span>
                                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                        <p className="whitespace-pre-line break-words text-caption text-card-foreground">
                                            {body || remark.title || t('noteTitle')}
                                        </p>
                                        <span className="text-2xs text-muted-foreground">
                                            {[
                                                remark.actor_name,
                                                dayjs(remark.created_at).format(
                                                    'DD MMM YYYY, HH:mm'
                                                ),
                                            ]
                                                .filter(Boolean)
                                                .join(' · ')}
                                        </span>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </ProfileSectionCard>
    );
};
