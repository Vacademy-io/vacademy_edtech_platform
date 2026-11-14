import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle, UserMinus } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { MyInput } from '@/components/design-system/input';
import { Textarea } from '@/components/ui/textarea';
import { reportApiError } from '@/lib/report-api-error';
import { useRecordSession } from '../-hooks/use-mentorship';
import type { MentorSessionDTO } from '../-types/mentorship-types';

const MAX_NOTES = 5000;

/**
 * The mentor records what happened after a session. Outcome is the required part —
 * notes and topic are optional, because forcing prose is the fastest way to get no
 * records at all, and an unrecorded session is invisible to the admin dashboard.
 */
export function RecordSessionDialog({
    session,
    instituteId,
    open,
    onOpenChange,
}: {
    session: MentorSessionDTO | null;
    instituteId: string | undefined;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const { t } = useTranslation('mentorshipRecordSessionDialog');
    const [outcome, setOutcome] = useState<'COMPLETED' | 'NO_SHOW' | null>(null);
    const [topic, setTopic] = useState('');
    const [notes, setNotes] = useState('');
    const record = useRecordSession();

    // Re-seed whenever a different session is opened, and pre-fill when revising.
    useEffect(() => {
        if (!open || !session) return;
        setOutcome((session.outcome as 'COMPLETED' | 'NO_SHOW' | null) ?? null);
        setTopic(session.topic ?? '');
        setNotes(session.notes ?? '');
    }, [open, session]);

    const submit = async () => {
        if (!session || !instituteId || !outcome) return;
        try {
            await record.mutateAsync({
                instituteId,
                data: {
                    booking_instance_id: session.booking_instance_id,
                    outcome,
                    topic: topic.trim() || undefined,
                    notes: notes.trim() || undefined,
                },
            });
            toast.success(
                outcome === 'COMPLETED' ? t('sessionRecorded') : t('markedNoShow')
            );
            onOpenChange(false);
        } catch (error) {
            reportApiError(error, {
                feature: 'mentorship',
                tags: { 'mentorship.action': 'record-session' },
                extra: { bookingInstanceId: session.booking_instance_id, outcome },
                fallbackMessage: t('saveFailed'),
            });
        }
    };

    if (!session) return null;

    return (
        <MyDialog
            heading={t('heading')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-md"
            footer={
                <div className="flex justify-end gap-2">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => onOpenChange(false)}
                    >
                        {t('cancel')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        onClick={submit}
                        disable={!outcome || record.isPending}
                        title={!outcome ? t('pickOutcomeFirst') : undefined}
                    >
                        {record.isPending ? t('saving') : t('save')}
                    </MyButton>
                </div>
            }
        >
            <div className="flex flex-col gap-4">
                <p className="text-body text-neutral-600">
                    <b>{session.title || t('sessionFallback')}</b> {t('withMentee')}{' '}
                    <b>{session.student_name || t('menteeFallback')}</b>
                </p>

                <div className="flex flex-col gap-1.5">
                    <span className="text-caption font-semibold uppercase tracking-wide text-neutral-400">
                        {t('whatHappened')}
                    </span>
                    <div className="flex gap-2">
                        <OutcomeChoice
                            label={t('outcomeWentAhead')}
                            icon={<CheckCircle size={18} weight="fill" />}
                            selected={outcome === 'COMPLETED'}
                            tone="success"
                            onClick={() => setOutcome('COMPLETED')}
                        />
                        <OutcomeChoice
                            label={t('outcomeNoShow')}
                            icon={<UserMinus size={18} weight="fill" />}
                            selected={outcome === 'NO_SHOW'}
                            tone="danger"
                            onClick={() => setOutcome('NO_SHOW')}
                        />
                    </div>
                </div>

                <MyInput
                    input={topic}
                    onChangeFunction={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setTopic(e.target.value)
                    }
                    inputType="text"
                    inputPlaceholder={t('topicPlaceholder')}
                    label={t('topicLabel')}
                    className="sm:w-full"
                />

                <div className="flex flex-col gap-1.5">
                    <label
                        htmlFor="session-notes"
                        className="text-caption font-medium text-neutral-600"
                    >
                        {t('notesLabel')}
                    </label>
                    <Textarea
                        id="session-notes"
                        value={notes}
                        maxLength={MAX_NOTES}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder={t('notesPlaceholder')}
                        className="min-h-24 resize-none"
                    />
                    <span className="text-caption text-neutral-400">
                        {t('notesHelp')}
                    </span>
                </div>
            </div>
        </MyDialog>
    );
}

function OutcomeChoice({
    label,
    icon,
    selected,
    tone,
    onClick,
}: {
    label: string;
    icon: React.ReactNode;
    selected: boolean;
    tone: 'success' | 'danger';
    onClick: () => void;
}) {
    const selectedTone =
        tone === 'success'
            ? 'border-success-400 bg-success-50 text-success-700'
            : 'border-danger-400 bg-danger-50 text-danger-700';
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={selected}
            className={`flex flex-1 items-center justify-center gap-2 rounded-md border px-3 py-2 text-body transition-colors ${
                selected ? selectedTone : 'border-neutral-200 text-neutral-600 hover:bg-neutral-50'
            }`}
        >
            {icon}
            {label}
        </button>
    );
}
