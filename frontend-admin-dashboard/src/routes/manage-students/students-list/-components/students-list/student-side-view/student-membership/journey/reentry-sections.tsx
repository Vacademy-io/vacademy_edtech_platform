import { useMemo, type ReactNode } from 'react';
import type { Control, FieldArrayWithId } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus, Trash } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { SearchableSelect } from '@/components/design-system/searchable-select';
import { Checkbox } from '@/components/ui/checkbox';
import {
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import { useExtraClassBatches } from '@/services/extra-classes';
import {
    previewEndBreak,
    useLearnerBreaks,
    type EnrolmentBreak,
} from '@/services/enrolment-breaks';
import {
    fetchEligibleOrgUsers,
    type InstituteUser,
} from '@/routes/manage-institute/teams/-services/institute-users-service';
import { formatDay, formatInstant, lengthInDays } from '../breaks/break-utils';
import type { ReentryFormValues } from './start-reentry-dialog';

/**
 * The extra payment for a one-on-one class is a one-off charge (one-off dues service). The fields
 * show only when the institute has One-off charges switched on.
 */
export const EXTRA_PAYMENT_READY = true;

const DURATIONS = ['30', '45', '60', '90', '120'];

/** The current local time as HH:MM, to refuse a session that has already started today. */
export const nowHm = (): string => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

type FormControlT = Control<ReentryFormValues>;

const Section = ({ title, hint, children }: { title: string; hint?: string; children?: ReactNode }) => (
    <section className="space-y-3 rounded-md border border-neutral-200 p-3">
        <div className="space-y-0.5">
            <h3 className="text-subtitle font-semibold text-neutral-800">{title}</h3>
            {hint && <p className="text-caption text-neutral-500">{hint}</p>}
        </div>
        {children}
    </section>
);

// ── Staff (teacher) list ─────────────────────────────────────────────────────

export interface StaffOptions {
    isLoading: boolean;
    isError: boolean;
    refetch: () => void;
    users: InstituteUser[];
    nameOf: (id: string) => string;
}

/** The institute's active staff (every role but STUDENT), the list the class scheduler uses. */
export const useStaffOptions = (instituteId: string): StaffOptions => {
    const q = useQuery({
        queryKey: ['reentry-staff', instituteId],
        queryFn: () => fetchEligibleOrgUsers(instituteId),
        enabled: Boolean(instituteId),
        staleTime: 5 * 60_000,
    });
    const users = useMemo(() => q.data ?? [], [q.data]);
    return {
        isLoading: q.isLoading,
        isError: q.isError,
        refetch: () => void q.refetch(),
        users,
        nameOf: (id: string) => {
            const u = users.find((x) => x.id === id);
            return u?.full_name || u?.email || u?.username || id;
        },
    };
};

const TeacherPicker = ({
    staff,
    value,
    onChange,
}: {
    staff: StaffOptions;
    value: string;
    onChange: (v: string) => void;
}) => {
    const { t } = useTranslation('manageStudentsJourney');
    const options = useMemo(
        () =>
            staff.users.map((u) => ({
                value: u.id,
                label: u.full_name || u.email || u.username || u.id,
                keywords: [u.email, u.username].filter((x): x is string => Boolean(x)),
            })),
        [staff.users]
    );
    if (staff.isLoading) return <Skeleton className="h-9 w-full" />;
    if (staff.isError) {
        return (
            <div className="flex items-center justify-between gap-2 rounded-md bg-danger-50 p-3 text-caption text-danger-700 ring-1 ring-danger-200">
                <span>{t('reentry.teacher.failed')}</span>
                <MyButton type="button" buttonType="text" scale="small" onClick={staff.refetch}>
                    {t('card.retry')}
                </MyButton>
            </div>
        );
    }
    return (
        <SearchableSelect
            options={options}
            value={value}
            onChange={onChange}
            portal={false}
            placeholder={t('reentry.teacher.placeholder')}
            searchPlaceholder={t('reentry.batchSearch')}
            emptyText={t('reentry.teacher.empty')}
        />
    );
};

// ── Fees ─────────────────────────────────────────────────────────────────────

/**
 * "Restart fees and access now": resumes the running pause through the same path as the Resume
 * button (institute's default resume choice). Shows what restarts and, when the preview can tell
 * cheaply, the next charge date. No running pause: fees are already running.
 */
export const FeesSection = ({
    control,
    userId,
    instituteId,
    batch,
    onPause,
    restart,
}: {
    control: FormControlT;
    userId: string;
    instituteId: string;
    batch: string;
    onPause: boolean;
    restart: boolean;
}) => {
    const { t } = useTranslation('manageStudentsJourney');
    const breaks = useLearnerBreaks(userId, instituteId, onPause);
    const pause: EnrolmentBreak | undefined = (breaks.data?.breaks ?? []).find(
        (b) =>
            b.kind === 'PAUSE' &&
            b.status === 'ACTIVE' &&
            (!b.package_session_id || b.package_session_id === batch)
    );
    const mode = pause?.suggested_resume_mode ?? null;
    const preview = useQuery({
        queryKey: ['reentry-resume-preview', instituteId, pause?.id, mode],
        queryFn: () => previewEndBreak(instituteId, pause!.id, { resume_mode: mode! }),
        enabled: Boolean(onPause && restart && pause && mode),
        staleTime: 60_000,
    });

    if (!batch) return null;
    if (!onPause) {
        return (
            <Section title={t('reentry.fees.title')}>
                <p className="rounded-md bg-success-50 p-3 text-caption text-success-700 ring-1 ring-success-200">
                    {t('reentry.fees.running')}
                </p>
            </Section>
        );
    }
    const p = preview.data;
    const next = p?.next_charge_after ? formatInstant(p.next_charge_after) : null;
    const planEnd = p?.plan_end_after ? formatInstant(p.plan_end_after) : null;
    return (
        <Section title={t('reentry.fees.title')} hint={t('reentry.fees.pausedIntro')}>
            <FormField
                control={control}
                name="restartFees"
                render={({ field }) => (
                    <FormItem className="flex items-start gap-2 space-y-0">
                        <FormControl>
                            <Checkbox
                                className="mt-0.5"
                                checked={field.value}
                                onCheckedChange={(c) => field.onChange(c === true)}
                            />
                        </FormControl>
                        <div className="space-y-0.5">
                            <FormLabel className="cursor-pointer">{t('reentry.fees.restart')}</FormLabel>
                            <p className="text-caption text-neutral-500">{t('reentry.fees.restartHint')}</p>
                        </div>
                    </FormItem>
                )}
            />
            <ul className="list-disc space-y-1 ps-5 text-caption text-neutral-600">
                {(!pause || pause.remove_access) && <li>{t('reentry.fees.willAccess')}</li>}
                <li>{t('reentry.fees.willBilling')}</li>
                {(!pause || pause.stop_fee_reminders) && <li>{t('reentry.fees.willFeeReminders')}</li>}
                {pause?.stop_class_reminders && <li>{t('reentry.fees.willClassReminders')}</li>}
            </ul>
            {restart && preview.isLoading && <Skeleton className="h-5 w-2/3" />}
            {restart && p && (
                <div className="space-y-1 rounded-md bg-info-50 p-3 text-caption text-info-700 ring-1 ring-info-200">
                    {next && <p>{t('reentry.fees.nextCharge', { date: next })}</p>}
                    {planEnd && <p>{t('reentry.fees.planEnd', { date: planEnd })}</p>}
                    {p.unpaid_instalments_moved > 0 && (
                        <p>
                            {t('reentry.fees.instalmentsMoved', {
                                count: p.unpaid_instalments_moved,
                            })}
                        </p>
                    )}
                    {!next && !planEnd && <p>{t('reentry.fees.noDates')}</p>}
                </div>
            )}
            {!restart && (
                <p className="rounded-md bg-warning-50 p-3 text-caption text-warning-700 ring-1 ring-warning-200">
                    {t('reentry.fees.required')}
                </p>
            )}
        </Section>
    );
};

// ── Extra classes ────────────────────────────────────────────────────────────

export const ExtraClassesSection = ({
    control,
    fields,
    values,
    onAdd,
    onRemove,
    max,
    instituteId,
    batchTerm,
    today,
}: {
    control: FormControlT;
    fields: FieldArrayWithId<ReentryFormValues, 'extras', 'id'>[];
    values: ReentryFormValues['extras'];
    onAdd: () => void;
    onRemove: (i: number) => void;
    max: number;
    instituteId: string;
    batchTerm: string;
    today: string;
}) => {
    const { t } = useTranslation('manageStudentsJourney');
    return (
        <Section
            title={t('reentry.extra.title')}
            hint={t('reentry.extra.hint', { batch: batchTerm.toLowerCase() })}
        >
            {fields.map((f, i) => {
                const x = values[i];
                const length = x?.from && x?.to ? lengthInDays(x.from, x.to) : null;
                return (
                    <div key={f.id} className="space-y-3 rounded-md bg-neutral-50 p-3">
                        <div className="flex items-start gap-2">
                            <FormField
                                control={control}
                                name={`extras.${i}.batch`}
                                render={({ field }) => (
                                    <FormItem className="min-w-0 flex-1">
                                        <FormLabel>{batchTerm}</FormLabel>
                                        <FormControl>
                                            <LinkBatchPicker
                                                instituteId={instituteId}
                                                value={field.value}
                                                onChange={field.onChange}
                                                batchTerm={batchTerm}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <MyButton
                                type="button"
                                buttonType="text"
                                scale="small"
                                className="mt-7"
                                onClick={() => onRemove(i)}
                                aria-label={t('reentry.extra.remove')}
                            >
                                <Trash className="size-4" />
                            </MyButton>
                        </div>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <FormField
                                control={control}
                                name={`extras.${i}.from`}
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{t('reentry.from')}</FormLabel>
                                        <FormControl>
                                            <MyInput
                                                inputType="date"
                                                input={field.value}
                                                onChangeFunction={(e) => field.onChange(e.target.value)}
                                                className="w-full sm:w-full"
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={control}
                                name={`extras.${i}.to`}
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{t('reentry.to')}</FormLabel>
                                        <FormControl>
                                            <MyInput
                                                inputType="date"
                                                input={field.value}
                                                onChangeFunction={(e) => field.onChange(e.target.value)}
                                                min={x?.from || today}
                                                className="w-full sm:w-full"
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>
                        {length !== null && length > 0 && (
                            <p className="text-caption text-neutral-500">
                                {t('reentry.window', {
                                    count: length,
                                    from: formatDay(x!.from),
                                    to: formatDay(x!.to),
                                })}
                            </p>
                        )}
                    </div>
                );
            })}
            {fields.length < max ? (
                <MyButton type="button" buttonType="secondary" scale="small" onClick={onAdd}>
                    <Plus className="size-4" />
                    {fields.length === 0 ? t('reentry.extra.add') : t('reentry.extra.addAnother')}
                </MyButton>
            ) : (
                <p className="text-caption text-neutral-500">{t('reentry.extra.max', { count: max })}</p>
            )}
        </Section>
    );
};

/** The institute's active batches, the same list and picker the Extra classes card uses. */
const LinkBatchPicker = ({
    instituteId,
    value,
    onChange,
    batchTerm,
}: {
    instituteId: string;
    value: string;
    onChange: (v: string) => void;
    batchTerm: string;
}) => {
    const { t } = useTranslation('manageStudentsJourney');
    const batches = useExtraClassBatches(instituteId);
    const options = useMemo(
        () =>
            (batches.data ?? []).map((b) => ({
                value: b.package_session_id,
                label: b.label,
                keywords: [b.course_name, b.level_name, b.batch_name].filter(
                    (x): x is string => Boolean(x)
                ),
            })),
        [batches.data]
    );
    if (batches.isLoading) return <Skeleton className="h-9 w-full" />;
    if (batches.isError) {
        return (
            <div className="flex items-center justify-between gap-2 rounded-md bg-danger-50 p-3 text-caption text-danger-700 ring-1 ring-danger-200">
                <span>{t('reentry.batchesFailed')}</span>
                <MyButton type="button" buttonType="text" scale="small" onClick={() => batches.refetch()}>
                    {t('card.retry')}
                </MyButton>
            </div>
        );
    }
    return (
        <SearchableSelect
            options={options}
            value={value}
            onChange={onChange}
            portal={false}
            placeholder={t('reentry.batchPlaceholder', { batch: batchTerm })}
            searchPlaceholder={t('reentry.batchSearch')}
            emptyText={t('reentry.batchEmpty')}
        />
    );
};

// ── Slot fields (date, start time, duration) ─────────────────────────────────

const SlotFields = ({
    control,
    prefix,
    today,
    durations,
}: {
    control: FormControlT;
    prefix: `sessions.${number}` | 'assessment';
    today: string;
    durations?: string[];
}) => {
    const { t } = useTranslation('manageStudentsJourney');
    return (
        <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-3">
            <FormField
                control={control}
                name={`${prefix}.date`}
                render={({ field }) => (
                    <FormItem>
                        <FormLabel>{t('reentry.slot.date')}</FormLabel>
                        <FormControl>
                            <MyInput
                                inputType="date"
                                input={field.value}
                                onChangeFunction={(e) => field.onChange(e.target.value)}
                                min={today}
                                className="w-full sm:w-full"
                            />
                        </FormControl>
                        <FormMessage />
                    </FormItem>
                )}
            />
            <FormField
                control={control}
                name={`${prefix}.start`}
                render={({ field }) => (
                    <FormItem>
                        <FormLabel>{t('reentry.slot.start')}</FormLabel>
                        <FormControl>
                            <MyInput
                                inputType="time"
                                input={field.value}
                                onChangeFunction={(e) => field.onChange(e.target.value)}
                                className="w-full sm:w-full"
                            />
                        </FormControl>
                        <FormMessage />
                    </FormItem>
                )}
            />
            <FormField
                control={control}
                name={`${prefix}.duration`}
                render={({ field }) => (
                    <FormItem>
                        <FormLabel>{t('reentry.slot.duration')}</FormLabel>
                        <FormControl>
                            {durations ? (
                                <SearchableSelect
                                    options={durations.map((d) => ({
                                        value: d,
                                        label: t('reentry.slot.minutes', { count: Number(d) }),
                                    }))}
                                    value={field.value}
                                    onChange={field.onChange}
                                    portal={false}
                                />
                            ) : (
                                <MyInput
                                    inputType="number"
                                    input={field.value}
                                    onChangeFunction={(e) => field.onChange(e.target.value)}
                                    min={5}
                                    max={120}
                                    className="w-full sm:w-full"
                                />
                            )}
                        </FormControl>
                        <FormMessage />
                    </FormItem>
                )}
            />
        </div>
    );
};

// ── One-on-one bridge class ──────────────────────────────────────────────────

export const OneOnOneSection = ({
    control,
    on,
    fields,
    onAdd,
    onRemove,
    max,
    staff,
    today,
    paymentOn,
}: {
    control: FormControlT;
    paymentOn: boolean;
    on: boolean;
    fields: FieldArrayWithId<ReentryFormValues, 'sessions', 'id'>[];
    onAdd: () => void;
    onRemove: (i: number) => void;
    max: number;
    staff: StaffOptions;
    today: string;
}) => {
    const { t } = useTranslation('manageStudentsJourney');
    return (
        <section className="space-y-3 rounded-md border border-neutral-200 p-3">
            <FormField
                control={control}
                name="oneOnOneOn"
                render={({ field }) => (
                    <FormItem className="flex items-start gap-2 space-y-0">
                        <FormControl>
                            <Checkbox
                                className="mt-0.5"
                                checked={field.value}
                                onCheckedChange={(c) => field.onChange(c === true)}
                            />
                        </FormControl>
                        <div className="space-y-0.5">
                            <FormLabel className="cursor-pointer text-subtitle font-semibold text-neutral-800">
                                {t('reentry.oneOnOne.title')}
                            </FormLabel>
                            <p className="text-caption text-neutral-500">{t('reentry.oneOnOne.hint')}</p>
                        </div>
                    </FormItem>
                )}
            />
            {on && (
                <>
                    <FormField
                        control={control}
                        name="teacher"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>{t('reentry.teacher.label')}</FormLabel>
                                <FormControl>
                                    <TeacherPicker staff={staff} value={field.value} onChange={field.onChange} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={control}
                        name="title"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>{t('reentry.oneOnOne.titleLabel')}</FormLabel>
                                <FormControl>
                                    <MyInput
                                        inputType="text"
                                        input={field.value}
                                        onChangeFunction={(e) => field.onChange(e.target.value)}
                                        maxLength={120}
                                        className="w-full sm:w-full"
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <p className="text-caption font-semibold text-neutral-700">
                        {t('reentry.oneOnOne.sessions')}
                    </p>
                    {fields.map((f, i) => (
                        <div key={f.id} className="flex items-start gap-2 rounded-md bg-neutral-50 p-3">
                            <SlotFields
                                control={control}
                                prefix={`sessions.${i}`}
                                today={today}
                                durations={DURATIONS}
                            />
                            {fields.length > 1 && (
                                <MyButton
                                    type="button"
                                    buttonType="text"
                                    scale="small"
                                    className="mt-7"
                                    onClick={() => onRemove(i)}
                                    aria-label={t('reentry.oneOnOne.removeSession')}
                                >
                                    <Trash className="size-4" />
                                </MyButton>
                            )}
                        </div>
                    ))}
                    {fields.length < max && (
                        <MyButton type="button" buttonType="secondary" scale="small" onClick={onAdd}>
                            <Plus className="size-4" />
                            {t('reentry.oneOnOne.addSession')}
                        </MyButton>
                    )}
                    {!paymentOn && (
                        <p className="text-caption text-neutral-500">{t('reentry.oneOnOne.paymentOff')}</p>
                    )}
                    {paymentOn && (
                        <div className="space-y-3 rounded-md bg-neutral-50 p-3">
                            <div className="space-y-0.5">
                                <p className="text-caption font-semibold text-neutral-700">
                                    {t('reentry.oneOnOne.payment')}
                                </p>
                                <p className="text-caption text-neutral-500">
                                    {t('reentry.oneOnOne.paymentHint')}
                                </p>
                            </div>
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <FormField
                                    control={control}
                                    name="amount"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{t('reentry.oneOnOne.amount')}</FormLabel>
                                            <FormControl>
                                                <MyInput
                                                    inputType="number"
                                                    input={field.value}
                                                    onChangeFunction={(e) => field.onChange(e.target.value)}
                                                    min={0}
                                                    className="w-full sm:w-full"
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={control}
                                    name="dueDate"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{t('reentry.oneOnOne.dueDate')}</FormLabel>
                                            <FormControl>
                                                <MyInput
                                                    inputType="date"
                                                    input={field.value}
                                                    onChangeFunction={(e) => field.onChange(e.target.value)}
                                                    min={today}
                                                    className="w-full sm:w-full"
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>
                        </div>
                    )}
                </>
            )}
        </section>
    );
};

// ── Assessment session ───────────────────────────────────────────────────────

export const AssessmentSection = ({
    control,
    mode,
    staff,
    today,
}: {
    control: FormControlT;
    mode: 'skip' | 'schedule';
    staff: StaffOptions;
    today: string;
}) => {
    const { t } = useTranslation('manageStudentsJourney');
    return (
        <Section title={t('reentry.assessment.title')} hint={t('reentry.assessment.hint')}>
            <FormField
                control={control}
                name="assessmentMode"
                render={({ field }) => (
                    <FormItem>
                        <FormControl>
                            <RadioGroup
                                value={field.value}
                                onValueChange={field.onChange}
                                className="flex flex-wrap gap-4"
                            >
                                {(['skip', 'schedule'] as const).map((m) => (
                                    <label key={m} className="flex cursor-pointer items-center gap-2 text-body">
                                        <RadioGroupItem value={m} />
                                        {t(`reentry.assessment.${m}`)}
                                    </label>
                                ))}
                            </RadioGroup>
                        </FormControl>
                    </FormItem>
                )}
            />
            {mode === 'schedule' && (
                <>
                    <FormField
                        control={control}
                        name="assessmentTeacher"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>{t('reentry.teacher.label')}</FormLabel>
                                <FormControl>
                                    <TeacherPicker staff={staff} value={field.value} onChange={field.onChange} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <SlotFields control={control} prefix="assessment" today={today} />
                </>
            )}
        </Section>
    );
};

// ── Summary ──────────────────────────────────────────────────────────────────

/** Plain-language list of everything the confirm button will do. */
export const ReentrySummary = ({
    values: v,
    statusLabel,
    backTo,
    onPause,
    staff,
    batchLabel,
    instituteId,
    paymentOn,
}: {
    paymentOn: boolean;
    instituteId: string;
    values: ReentryFormValues;
    statusLabel: string;
    backTo: string;
    onPause: boolean;
    staff: StaffOptions;
    batchLabel: (id: string) => string;
}) => {
    const { t } = useTranslation('manageStudentsJourney');
    const batches = useExtraClassBatches(instituteId);
    if (!v.batch) return null;
    const lines: string[] = [];
    lines.push(t('reentry.summary.status', { batch: batchLabel(v.batch), status: statusLabel }));
    lines.push(onPause ? t('reentry.summary.feesRestart') : t('reentry.summary.feesRunning'));
    const extras = v.extras.filter((x) => x.batch && x.from && x.to);
    extras.forEach((x) => {
        const label = batches.data?.find((b) => b.package_session_id === x.batch)?.label ?? x.batch;
        lines.push(
            t('reentry.summary.extra', { batch: label, from: formatDay(x.from), to: formatDay(x.to) })
        );
    });
    const sessions = v.sessions.filter((s) => s.date && s.start);
    if (v.oneOnOneOn && v.teacher && sessions.length > 0) {
        const first = [...sessions].sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))[0]!;
        lines.push(
            t('reentry.summary.oneOnOne', {
                count: sessions.length,
                teacher: staff.nameOf(v.teacher),
                date: formatDay(first.date),
            })
        );
    }
    if (paymentOn && v.oneOnOneOn && Number(v.amount) > 0 && v.dueDate) {
        lines.push(t('reentry.summary.payment', { amount: v.amount, date: formatDay(v.dueDate) }));
    }
    if (v.assessmentMode === 'schedule' && v.assessmentTeacher && v.assessment.date && v.assessment.start) {
        lines.push(
            t('reentry.summary.assessment', {
                date: formatDay(v.assessment.date),
                time: v.assessment.start,
                teacher: staff.nameOf(v.assessmentTeacher),
                count: Number(v.assessment.duration) || 10,
            })
        );
    } else {
        lines.push(t('reentry.summary.assessmentSkipped'));
    }
    lines.push(
        v.returnOn
            ? t('reentry.summary.returnOn', { status: backTo, date: formatDay(v.returnOn) })
            : t('reentry.summary.noReturn', { status: statusLabel })
    );
    return (
        <div className="space-y-2 rounded-md bg-info-50 p-3 text-caption text-info-700 ring-1 ring-info-200">
            <p className="font-semibold">{t('reentry.summary.title')}</p>
            <ul className="list-disc space-y-1 ps-5">
                {lines.map((l) => (
                    <li key={l}>{l}</li>
                ))}
            </ul>
            <p>{t('reentry.summary.noMessage')}</p>
        </div>
    );
};
