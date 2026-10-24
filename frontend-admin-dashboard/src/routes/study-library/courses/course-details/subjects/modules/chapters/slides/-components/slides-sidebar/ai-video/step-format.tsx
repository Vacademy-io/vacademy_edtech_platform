import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    BookOpenText,
    CaretDown,
    Chalkboard,
    ChalkboardTeacher,
    ChatsCircle,
    CircleNotch,
    Code,
    DeviceMobile,
    Lightning,
    MathOperations,
} from '@phosphor-icons/react';
import { MyInput } from '@/components/design-system/input';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { TutorAsset } from '@/services/tutor';
import type {
    LmsVideoDuration,
    LmsVideoFormat,
    LmsVideoOrientation,
    LmsVideoPolicy,
    LmsVideoQuality,
} from '@/services/lms-ai-video';
import {
    AI_VIDEO_FORMATS,
    DURATIONS,
    QUALITIES,
    SUBJECT_MAX,
    TEACHER_LAYOUTS,
    effectiveRecap,
    effectiveWorkedExample,
    isWorkedExampleForced,
    getFormatOption,
    isDurationAllowed,
    isQualityAllowed,
    selectFormat,
    type AiVideoFormState,
    type FormatError,
} from './ai-video-form';
import { ChoiceGroup, LayoutThumbnail, SectionHeading, TeacherCard } from './ai-video-ui';

const NS = 'studyLibraryAddAiVideoDialog';

const FORMAT_ICON: Record<LmsVideoFormat, typeof Code> = {
    lesson_teacher: ChalkboardTeacher,
    board_explainer: Chalkboard,
    problem_walkthrough: MathOperations,
    quick_concept: Lightning,
    revision_short: DeviceMobile,
    storybook: BookOpenText,
    conversation: ChatsCircle,
    code_lesson: Code,
};

/** i18n keys can't hold the server's "1-2 minutes" values cleanly — map them. */
export const DURATION_KEY: Record<LmsVideoDuration, string> = {
    '1-2 minutes': 'd1to2',
    '2-3 minutes': 'd2to3',
    '3-5 minutes': 'd3to5',
    '5-8 minutes': 'd5to8',
};

export function StepFormat({
    state,
    onChange,
    error,
    avatars,
    avatarsFailed,
    policy,
}: {
    state: AiVideoFormState;
    onChange: (next: AiVideoFormState) => void;
    error: FormatError | null;
    /** Ready Spatius avatars; null while loading. */
    avatars: TutorAsset[] | null;
    avatarsFailed: boolean;
    /** Institute policy from the last estimate, when one has been fetched. */
    policy: LmsVideoPolicy | null;
}) {
    const { t } = useTranslation(NS);
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const option = getFormatOption(state.format);
    const patch = (p: Partial<AiVideoFormState>) => onChange({ ...state, ...p });
    const teacherBlocked = policy?.teacher_allowed === false;

    const pickTeacher = (avatar: TutorAsset | null) => {
        if (!avatar || !avatar.external_id) {
            patch({ teacher: null });
            return;
        }
        const gender = (avatar.gender || '').toLowerCase();
        patch({
            teacher: { avatar_id: avatar.external_id, name: avatar.display_name },
            // The narration should match the teacher on screen.
            ...(gender === 'male' || gender === 'female' ? { voiceGender: gender } : {}),
            layout: state.layout === 'board' ? 'corner' : state.layout,
        });
    };

    const orientationLabel = (o: LmsVideoOrientation) => t(`format.advanced.orientation.${o}`);

    return (
        <div className="flex flex-col gap-6">
            <section className="flex flex-col gap-2">
                <SectionHeading title={t('format.title')} />
                <div
                    role="radiogroup"
                    aria-label={t('format.title')}
                    className="grid grid-cols-1 gap-2 sm:grid-cols-2"
                >
                    {AI_VIDEO_FORMATS.map((f) => {
                        const Icon = FORMAT_ICON[f.value];
                        const selected = f.value === state.format;
                        return (
                            <button
                                key={f.value}
                                type="button"
                                role="radio"
                                aria-checked={selected}
                                onClick={() => onChange(selectFormat(state, f.value))}
                                className={cn(
                                    'flex items-start gap-3 rounded-lg border p-3 text-start transition-colors',
                                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300',
                                    selected
                                        ? 'border-primary-500 bg-primary-50'
                                        : 'border-border bg-card hover:border-primary-200 hover:bg-muted'
                                )}
                            >
                                <span
                                    className={cn(
                                        'flex size-9 shrink-0 items-center justify-center rounded-md',
                                        selected
                                            ? 'bg-primary-500 text-white'
                                            : 'bg-primary-50 text-primary-500'
                                    )}
                                >
                                    <Icon className="size-5" />
                                </span>
                                <span className="min-w-0">
                                    <span className="block text-sm font-medium text-foreground">
                                        {t(`format.options.${f.value}.label`)}
                                    </span>
                                    <span className="block text-xs text-muted-foreground">
                                        {t(`format.options.${f.value}.bestFor`)}
                                    </span>
                                </span>
                            </button>
                        );
                    })}
                </div>
            </section>

            {option.teacher !== 'hidden' && (
                <section className="flex flex-col gap-2">
                    <SectionHeading
                        title={
                            option.teacher === 'required'
                                ? t('format.teacher.label')
                                : t('format.teacher.labelOptional')
                        }
                    />
                    {teacherBlocked ? (
                        <p className="text-xs text-warning-700">{t('format.teacher.notAllowed')}</p>
                    ) : avatars === null ? (
                        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <CircleNotch className="size-3.5 animate-spin" />
                            {t('format.teacher.loading')}
                        </p>
                    ) : (
                        <div
                            role="radiogroup"
                            aria-label={t('format.teacher.label')}
                            className="grid grid-cols-1 gap-2 sm:grid-cols-2"
                        >
                            {option.teacher === 'optional' && (
                                <TeacherCard
                                    selected={!state.teacher}
                                    title={t('format.teacher.none')}
                                    subtitle={t('format.teacher.noneHelper')}
                                    onClick={() => pickTeacher(null)}
                                />
                            )}
                            {avatars.map((a) => (
                                <TeacherCard
                                    key={a.id}
                                    selected={state.teacher?.avatar_id === a.external_id}
                                    title={a.display_name}
                                    subtitle={
                                        a.stock
                                            ? t('format.teacher.stock')
                                            : t('format.teacher.yours')
                                    }
                                    imageUrl={a.preview_url || undefined}
                                    onClick={() => pickTeacher(a)}
                                />
                            ))}
                        </div>
                    )}
                    {!teacherBlocked && avatars !== null && avatars.length === 0 && (
                        <p className="text-xs text-muted-foreground">
                            {avatarsFailed
                                ? t('format.teacher.loadFailed')
                                : t('format.teacher.empty')}
                        </p>
                    )}
                    {error === 'teacherRequired' && (
                        <p className="text-xs text-danger-600">{t('format.teacher.required')}</p>
                    )}
                </section>
            )}

            {option.teacher !== 'hidden' && state.teacher && (
                <section className="flex flex-col gap-2">
                    <SectionHeading title={t('format.layout.label')} />
                    <div
                        role="radiogroup"
                        aria-label={t('format.layout.label')}
                        className="grid grid-cols-3 gap-2 sm:grid-cols-5"
                    >
                        {TEACHER_LAYOUTS.map((layout) => (
                            <LayoutThumbnail
                                key={layout}
                                layout={layout}
                                label={t(`format.layout.options.${layout}`)}
                                selected={state.layout === layout}
                                onClick={() => patch({ layout })}
                            />
                        ))}
                    </div>
                </section>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="flex flex-col gap-2">
                    <SectionHeading title={t('format.voice.label')} />
                    <ChoiceGroup
                        label={t('format.voice.label')}
                        value={state.voiceGender}
                        columns="two"
                        options={[
                            { value: 'female', label: t('format.voice.female') },
                            { value: 'male', label: t('format.voice.male') },
                        ]}
                        onChange={(voiceGender) => patch({ voiceGender })}
                    />
                </div>
                <div className="flex flex-col gap-2 sm:col-span-2">
                    <SectionHeading title={t('format.duration.label')} />
                    <ChoiceGroup<LmsVideoDuration>
                        label={t('format.duration.label')}
                        value={state.duration}
                        columns="four"
                        options={DURATIONS.map((d) => ({
                            value: d,
                            label: t(`format.duration.options.${DURATION_KEY[d]}`),
                            disabled: !isDurationAllowed(d, policy),
                            disabledReason: t('format.duration.notAllowed'),
                        }))}
                        onChange={(duration) => patch({ duration, durationTouched: true })}
                    />
                </div>
            </div>

            <div className="flex flex-col gap-2">
                <SectionHeading title={t('format.quality.label')} />
                <ChoiceGroup<LmsVideoQuality>
                    label={t('format.quality.label')}
                    value={state.quality}
                    columns="three"
                    options={QUALITIES.map((q) => ({
                        value: q,
                        label: t(`format.quality.options.${q}.label`),
                        helper: isQualityAllowed(q, policy)
                            ? t(`format.quality.options.${q}.helper`)
                            : t('format.quality.notAllowed'),
                        disabled: !isQualityAllowed(q, policy),
                        disabledReason: t('format.quality.notAllowed'),
                    }))}
                    onChange={(quality) => patch({ quality })}
                />
            </div>

            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                <CollapsibleTrigger asChild>
                    <button
                        type="button"
                        className="flex w-full items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                    >
                        <span>{t('format.advanced.toggle')}</span>
                        <CaretDown
                            className={cn(
                                'size-4 text-muted-foreground transition-transform',
                                advancedOpen && 'rotate-180'
                            )}
                        />
                    </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-3 flex flex-col gap-4 rounded-md border border-border p-3">
                    {option.lesson && (
                        <div className="flex flex-col gap-3">
                            <SwitchRow
                                id="ai-video-worked-example"
                                label={t('format.advanced.workedExample')}
                                checked={effectiveWorkedExample(state)}
                                disabled={isWorkedExampleForced(state)}
                                onChange={(v) => patch({ includeWorkedExample: v })}
                            />
                            <SwitchRow
                                id="ai-video-recap"
                                label={t('format.advanced.recap')}
                                checked={effectiveRecap(state)}
                                onChange={(v) => patch({ includeRecap: v })}
                            />
                        </div>
                    )}
                    <SwitchRow
                        id="ai-video-captions"
                        label={t('format.advanced.captions')}
                        checked={state.captionsEnabled}
                        onChange={(v) => patch({ captionsEnabled: v })}
                    />
                    <SwitchRow
                        id="ai-video-music"
                        label={t('format.advanced.music')}
                        checked={state.backgroundMusic === true}
                        onChange={(v) => patch({ backgroundMusic: v })}
                    />
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <MyInput
                            label={t('format.advanced.subject.label')}
                            input={state.subject}
                            onChangeFunction={(e) => patch({ subject: e.target.value })}
                            inputPlaceholder={t('format.advanced.subject.placeholder')}
                            maxLength={SUBJECT_MAX}
                            error={
                                error === 'subjectTooLong'
                                    ? t('format.errors.subjectTooLong', { max: SUBJECT_MAX })
                                    : undefined
                            }
                            className="sm:w-full"
                        />
                        <div className="flex flex-col gap-1">
                            <Label className="text-subtitle font-regular">
                                {t('format.advanced.orientation.label')}
                            </Label>
                            <Select
                                value={state.orientation}
                                onValueChange={(v) =>
                                    patch({ orientation: v as AiVideoFormState['orientation'] })
                                }
                            >
                                <SelectTrigger className="h-9">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="auto">
                                        {t('format.advanced.orientation.auto', {
                                            value: orientationLabel(option.defaultOrientation),
                                        })}
                                    </SelectItem>
                                    <SelectItem value="landscape">
                                        {orientationLabel('landscape')}
                                    </SelectItem>
                                    <SelectItem value="portrait">
                                        {orientationLabel('portrait')}
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </CollapsibleContent>
            </Collapsible>
        </div>
    );
}

function SwitchRow({
    id,
    label,
    checked,
    disabled,
    onChange,
}: {
    id: string;
    label: string;
    checked: boolean;
    disabled?: boolean;
    onChange: (value: boolean) => void;
}) {
    return (
        <div className="flex items-center justify-between gap-3">
            <Label htmlFor={id} className="text-sm font-normal text-foreground">
                {label}
            </Label>
            <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
        </div>
    );
}
