import { useTranslation } from 'react-i18next';
import { MyInput } from '@/components/design-system/input';
import { Switch } from '@/components/ui/switch';
import { InstructionsEditor } from './InstructionsEditor';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import type { PaperSpec } from '../../-types/paper';

const DURATIONS = [30, 45, 60, 90, 120, 150, 180];
const DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD', 'MIXED'];
const LANGUAGES = ['English', 'Hindi'];

interface TestDetailsStepProps {
    value: PaperSpec;
    onChange: (next: PaperSpec) => void;
    /** Suggested when the teacher leaves the name blank. */
    defaultTitle?: string;
    disabled?: boolean;
}

/**
 * "Configure test details" — the paper's name, how long it runs, how hard it
 * is, and the two things that shape the wording: class level and paper
 * language. Everything here is printed on the sheet or read by the planner;
 * nothing is decorative.
 */
export const TestDetailsStep = ({
    value,
    onChange,
    defaultTitle,
    disabled = false,
}: TestDetailsStepProps) => {
    const { t } = useTranslation('knowledgeBaseTestDetails');
    const field = (label: string, help: string, control: JSX.Element) => (
        <div className="flex flex-col gap-1">
            <span className="text-subtitle font-regular text-neutral-600">{label}</span>
            {control}
            <span className="text-caption text-neutral-400">{help}</span>
        </div>
    );

    return (
        <div className="flex max-w-2xl flex-col gap-5">
            <MyInput
                label={t('title.label')}
                inputType="text"
                input={value.title ?? ''}
                onChangeFunction={(e) => onChange({ ...value, title: e.target.value })}
                inputPlaceholder={defaultTitle || t('title.placeholder')}
                className="w-full sm:w-full"
                disabled={disabled}
            />
            <p className="-mt-3 text-caption text-neutral-400">{t('title.help')}</p>

            <div className="grid gap-5 sm:grid-cols-2">
                {field(
                    t('duration.label'),
                    t('duration.help'),
                    <Select
                        value={String(value.duration_minutes ?? 90)}
                        onValueChange={(v) => onChange({ ...value, duration_minutes: Number(v) })}
                        disabled={disabled}
                    >
                        <SelectTrigger className="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {DURATIONS.map((m) => (
                                <SelectItem key={m} value={String(m)}>
                                    {t('duration.minutes', { count: m })}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )}
                {field(
                    t('difficulty.label'),
                    t('difficulty.help'),
                    <Select
                        value={value.difficulty ?? 'MIXED'}
                        onValueChange={(v) => onChange({ ...value, difficulty: v })}
                        disabled={disabled}
                    >
                        <SelectTrigger className="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {DIFFICULTIES.map((d) => (
                                <SelectItem key={d} value={d}>
                                    {t(`difficulty.${d.toLowerCase()}`)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )}
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
                <MyInput
                    label={t('grade.label')}
                    inputType="text"
                    input={value.grade ?? ''}
                    onChangeFunction={(e) => onChange({ ...value, grade: e.target.value })}
                    inputPlaceholder={t('grade.placeholder')}
                    className="w-full sm:w-full"
                    disabled={disabled}
                />
                {field(
                    t('examDate.label'),
                    t('examDate.help'),
                    <MyInput
                        inputType="date"
                        input={value.exam_date ?? ''}
                        onChangeFunction={(e) => onChange({ ...value, exam_date: e.target.value })}
                        className="w-full sm:w-full"
                        disabled={disabled}
                    />
                )}
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
                {field(
                    t('language.label'),
                    t('language.help'),
                    <Select
                        value={value.language ?? 'English'}
                        onValueChange={(v) => onChange({ ...value, language: v })}
                        disabled={disabled}
                    >
                        <SelectTrigger className="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {LANGUAGES.map((l) => (
                                <SelectItem key={l} value={l}>
                                    {t(`language.${l.toLowerCase()}`)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )}
            </div>

            <MyInput
                label={t('examStyle.label')}
                inputType="text"
                input={value.exam_style ?? ''}
                onChangeFunction={(e) => onChange({ ...value, exam_style: e.target.value })}
                inputPlaceholder={t('examStyle.placeholder')}
                className="w-full sm:w-full"
                disabled={disabled}
            />

            <InstructionsEditor
                value={value.instructions ?? []}
                onChange={(instructions) => onChange({ ...value, instructions })}
                disabled={disabled}
            />

            <label className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border border-neutral-200 p-3">
                <span className="flex flex-col gap-0.5">
                    <span className="text-subtitle text-neutral-700">{t('diagrams.label')}</span>
                    <span className="text-caption text-neutral-500">{t('diagrams.help')}</span>
                </span>
                <Switch
                    checked={Boolean(value.generate_diagrams)}
                    onCheckedChange={(on) => onChange({ ...value, generate_diagrams: on })}
                    disabled={disabled}
                    aria-label={t('diagrams.label')}
                />
            </label>
        </div>
    );
};
