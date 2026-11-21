import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChalkboardTeacher, CheckCircle, CircleNotch } from '@phosphor-icons/react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { getTutorOptions, type TutorAsset } from '@/services/tutor';
import type {
    GenerateVideoRequest,
    LessonConfig,
    LessonLayout,
} from '../../-services/video-generation';

type Options = Omit<GenerateVideoRequest, 'prompt'>;

const LAYOUTS: LessonLayout[] = ['corner', 'bubble', 'side', 'presenter', 'auto', 'board'];

/**
 * Lesson mode — an education video taught by a teacher at a board. Lesson
 * pacing and a teacher's narration always; with a teacher picked, a Spatius
 * avatar (the same ones the AI tutor uses) appears beside the board.
 * Turning it on clears `host`: the two cannot be combined.
 */
export function LessonModePanel({
    options,
    onOptionsChange,
}: {
    options: Options;
    onOptionsChange: (options: Options) => void;
}) {
    const { t } = useTranslation('videoApiStudioSettingsPopover');
    const lesson = options.lesson;
    const enabled = !!lesson?.enabled;

    const [avatars, setAvatars] = useState<TutorAsset[] | null>(null);
    const [avatarAvailable, setAvatarAvailable] = useState(true);

    useEffect(() => {
        if (!enabled || avatars !== null) return;
        let alive = true;
        getTutorOptions()
            .then((o) => {
                if (!alive) return;
                setAvatarAvailable(o.avatar_available !== false);
                setAvatars(
                    (o.avatars || []).filter(
                        (a) => a.provider === 'spatius' && a.status === 'ready' && !!a.external_id
                    )
                );
            })
            .catch(() => alive && setAvatars([]));
        return () => {
            alive = false;
        };
    }, [enabled, avatars]);

    const setLesson = (next: LessonConfig | undefined) => {
        // Lesson mode brings its own teacher, so the Host feature is cleared.
        onOptionsChange({ ...options, lesson: next, ...(next ? { host: undefined } : {}) });
    };
    const patch = (p: Partial<LessonConfig>) => {
        if (!lesson) return;
        setLesson({ ...lesson, ...p });
    };

    const pickTeacher = (a: TutorAsset | null) => {
        if (!lesson) return;
        if (!a || !a.external_id) {
            setLesson({ ...lesson, teacher: undefined, layout: 'board' });
            return;
        }
        setLesson({
            ...lesson,
            teacher: { avatar_id: a.external_id, name: a.display_name },
            // Smallest cut-out by default — the teacher should not crowd the board.
            layout: !lesson.layout || lesson.layout === 'board' ? 'corner' : lesson.layout,
        });
    };

    const teacherId = lesson?.teacher?.avatar_id;

    return (
        <div className="space-y-3 rounded-lg border p-3">
            <div className="flex items-start justify-between gap-3">
                <div className="space-y-0.5">
                    <Label className="flex items-center gap-1.5 text-xs font-medium">
                        <ChalkboardTeacher className="size-3.5" />
                        {t('lesson.toggle.label')}
                    </Label>
                    <p className="text-2xs text-muted-foreground">{t('lesson.toggle.helper')}</p>
                </div>
                <Switch
                    checked={enabled}
                    onCheckedChange={(on) =>
                        setLesson(
                            on
                                ? {
                                      enabled: true,
                                      layout: 'board',
                                      include_worked_example: true,
                                      include_recap: true,
                                  }
                                : undefined
                        )
                    }
                    aria-label={t('lesson.toggle.label')}
                />
            </div>

            {enabled && lesson && (
                <>
                    <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">
                            {t('lesson.teacher.label')}
                        </Label>
                        {avatars === null ? (
                            <p className="flex items-center gap-1.5 text-2xs text-muted-foreground">
                                <CircleNotch className="size-3 animate-spin" />
                                {t('lesson.teacher.loading')}
                            </p>
                        ) : (
                            <div className="grid gap-2">
                                <TeacherOption
                                    selected={!teacherId}
                                    title={t('lesson.teacher.none')}
                                    subtitle={t('lesson.teacher.noneHelper')}
                                    onClick={() => pickTeacher(null)}
                                />
                                {avatars.map((a) => (
                                    <TeacherOption
                                        key={a.id}
                                        selected={teacherId === a.external_id}
                                        title={a.display_name}
                                        subtitle={
                                            a.stock
                                                ? t('lesson.teacher.stock')
                                                : t('lesson.teacher.yours')
                                        }
                                        imageUrl={a.preview_url || undefined}
                                        onClick={() => pickTeacher(a)}
                                    />
                                ))}
                                {(!avatarAvailable || avatars.length === 0) && (
                                    <p className="text-2xs text-muted-foreground">
                                        {t('lesson.teacher.empty')}
                                    </p>
                                )}
                            </div>
                        )}
                        {teacherId && (
                            <p className="text-2xs text-muted-foreground">
                                {t('lesson.teacher.cost')}
                            </p>
                        )}
                    </div>

                    {teacherId && (
                        <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">
                                {t('lesson.layout.label')}
                            </Label>
                            <Select
                                value={lesson.layout || 'corner'}
                                onValueChange={(v) => patch({ layout: v as LessonLayout })}
                            >
                                <SelectTrigger className="h-8 text-xs">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {LAYOUTS.map((l) => (
                                        <SelectItem key={l} value={l} className="text-xs">
                                            {t(`lesson.layout.options.${l}`)}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <p className="text-2xs text-muted-foreground">
                                {t(`lesson.layout.help.${lesson.layout || 'corner'}`)}
                            </p>
                        </div>
                    )}

                    <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">
                            {t('lesson.subject.label')}
                        </Label>
                        <Input
                            className="h-8 text-xs"
                            value={lesson.subject || ''}
                            maxLength={80}
                            placeholder={t('lesson.subject.placeholder')}
                            onChange={(e) => patch({ subject: e.target.value || undefined })}
                        />
                    </div>

                    <div className="space-y-2">
                        <SwitchRow
                            label={t('lesson.workedExample')}
                            checked={lesson.include_worked_example !== false}
                            onChange={(v) => patch({ include_worked_example: v })}
                        />
                        <SwitchRow
                            label={t('lesson.recap')}
                            checked={lesson.include_recap !== false}
                            onChange={(v) => patch({ include_recap: v })}
                        />
                    </div>
                </>
            )}
        </div>
    );
}

function TeacherOption({
    selected,
    title,
    subtitle,
    imageUrl,
    onClick,
}: {
    selected: boolean;
    title: string;
    subtitle: string;
    imageUrl?: string;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={selected}
            className={`flex items-center gap-2 rounded-md border p-2 text-start transition-colors ${
                selected ? 'border-primary-500 bg-primary-50' : 'hover:bg-muted'
            }`}
        >
            <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-semibold">
                {imageUrl ? (
                    <img src={imageUrl} alt={title} className="size-full object-cover" />
                ) : (
                    title.slice(0, 1).toUpperCase()
                )}
            </span>
            <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">{title}</span>
                <span className="block truncate text-2xs text-muted-foreground">{subtitle}</span>
            </span>
            {selected && <CheckCircle className="size-4 shrink-0 text-primary-500" weight="fill" />}
        </button>
    );
}

function SwitchRow({
    label,
    checked,
    onChange,
}: {
    label: string;
    checked: boolean;
    onChange: (v: boolean) => void;
}) {
    return (
        <div className="flex items-center justify-between gap-3">
            <Label className="text-xs font-normal">{label}</Label>
            <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
        </div>
    );
}
