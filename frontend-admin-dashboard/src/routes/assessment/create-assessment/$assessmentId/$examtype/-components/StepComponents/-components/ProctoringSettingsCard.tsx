import { Control, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Camera, VideoCamera, ShieldCheck, Lock } from '@phosphor-icons/react';
import { FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form';
import { Switch } from '@/components/ui/switch';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { BasicSectionFormType } from '@/types/assessments/assessment-steps';
import {
    PROCTORING_SNAPSHOT_INTERVALS,
    PROCTORING_TIERS,
    type ProctoringTier,
} from '@/types/assessments/proctoring';

/**
 * Step 1 "Proctoring" card: pick a tier, then tune the knobs the tier exposes.
 *
 * Tiers are rendered as a row of selectable cards rather than a switch so the
 * next ones (PRO / ULTRA) have a home the moment they ship — today they show
 * as "coming soon" and cannot be picked. Every string, including the price
 * hint, is a translation key so pricing can be changed without a code edit.
 */
export const ProctoringSettingsCard = ({ control }: { control: Control<BasicSectionFormType> }) => {
    const { t } = useTranslation('assessmentStep1BasicInfo');
    const tier = useWatch({ control, name: 'proctoring.tier' }) as ProctoringTier | undefined;
    const active = tier && tier !== 'NONE';

    const tierIcon = (value: ProctoringTier) => {
        switch (value) {
            case 'BASIC':
                return <Camera className="size-4" />;
            case 'PRO':
                return <VideoCamera className="size-4" />;
            case 'ULTRA':
                return <ShieldCheck className="size-4" />;
            default:
                return <Lock className="size-4" />;
        }
    };

    return (
        <div
            className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4"
            id="proctoring-settings"
        >
            <div className="flex items-start gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary-50 text-primary-500">
                    <Camera className="size-4" />
                </div>
                <div className="flex flex-col">
                    <span className="text-sm font-semibold text-slate-900">
                        {t('proctoring.title')}
                    </span>
                    <span className="text-xs text-slate-500">{t('proctoring.description')}</span>
                </div>
            </div>

            <FormField
                control={control}
                name="proctoring.tier"
                render={({ field }) => (
                    <FormItem className="space-y-0">
                        <FormControl>
                            <div
                                role="radiogroup"
                                aria-label={t('proctoring.title')}
                                className="grid grid-cols-2 gap-2 md:grid-cols-4"
                            >
                                {PROCTORING_TIERS.map((option) => {
                                    const selected = field.value === option.tier;
                                    return (
                                        <button
                                            key={option.tier}
                                            type="button"
                                            role="radio"
                                            aria-checked={selected}
                                            disabled={!option.available}
                                            onClick={() => field.onChange(option.tier)}
                                            className={cn(
                                                'flex flex-col items-start gap-1 rounded-md border p-3 text-start transition-colors',
                                                selected
                                                    ? 'border-primary-400 bg-primary-50'
                                                    : 'border-slate-200 bg-white hover:border-primary-200',
                                                !option.available &&
                                                    'cursor-not-allowed opacity-60 hover:border-slate-200'
                                            )}
                                        >
                                            <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                                                {tierIcon(option.tier)}
                                                {t(`proctoring.tiers.${option.tier}.label`)}
                                            </span>
                                            <span className="text-xs text-slate-500">
                                                {t(`proctoring.tiers.${option.tier}.description`)}
                                            </span>
                                            <span
                                                className={cn(
                                                    'mt-1 text-xs font-medium',
                                                    option.available
                                                        ? 'text-primary-500'
                                                        : 'text-slate-400'
                                                )}
                                            >
                                                {option.available
                                                    ? t(`proctoring.tiers.${option.tier}.price`)
                                                    : t('proctoring.comingSoon')}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </FormControl>
                    </FormItem>
                )}
            />

            {active && (
                <div className="flex flex-col gap-3 border-t border-slate-100 pt-3">
                    <ToggleRow
                        control={control}
                        name="proctoring.cameraRequired"
                        label={t('proctoring.knobs.cameraRequired.label')}
                        description={t('proctoring.knobs.cameraRequired.description')}
                    />
                    <ToggleRow
                        control={control}
                        name="proctoring.faceCheck"
                        label={t('proctoring.knobs.faceCheck.label')}
                        description={t('proctoring.knobs.faceCheck.description')}
                    />
                    <ToggleRow
                        control={control}
                        name="proctoring.showSelfView"
                        label={t('proctoring.knobs.showSelfView.label')}
                        description={t('proctoring.knobs.showSelfView.description')}
                    />

                    <FormField
                        control={control}
                        name="proctoring.snapshotIntervalSec"
                        render={({ field }) => (
                            <FormItem className="flex items-center justify-between gap-4 space-y-0">
                                <div className="flex flex-col">
                                    <FormLabel className="text-sm text-slate-900">
                                        {t('proctoring.knobs.snapshotInterval.label')}
                                    </FormLabel>
                                    <span className="text-xs text-slate-500">
                                        {t('proctoring.knobs.snapshotInterval.description')}
                                    </span>
                                </div>
                                <Select
                                    value={String(field.value)}
                                    onValueChange={(value) => field.onChange(Number(value))}
                                >
                                    <FormControl>
                                        <SelectTrigger className="w-32">
                                            <SelectValue />
                                        </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                        <SelectItem value="0">
                                            {t('proctoring.knobs.snapshotInterval.off')}
                                        </SelectItem>
                                        {PROCTORING_SNAPSHOT_INTERVALS.map((seconds) => (
                                            <SelectItem key={seconds} value={String(seconds)}>
                                                {t('proctoring.knobs.snapshotInterval.every', {
                                                    seconds,
                                                })}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </FormItem>
                        )}
                    />

                    <FormField
                        control={control}
                        name="proctoring.maxViolations"
                        render={({ field }) => (
                            <FormItem className="flex items-center justify-between gap-4 space-y-0">
                                <div className="flex flex-col">
                                    <FormLabel className="text-sm text-slate-900">
                                        {t('proctoring.knobs.maxViolations.label')}
                                    </FormLabel>
                                    <span className="text-xs text-slate-500">
                                        {t('proctoring.knobs.maxViolations.description')}
                                    </span>
                                </div>
                                <Select
                                    value={String(field.value)}
                                    onValueChange={(value) => field.onChange(Number(value))}
                                >
                                    <FormControl>
                                        <SelectTrigger className="w-32">
                                            <SelectValue />
                                        </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                        <SelectItem value="0">
                                            {t('proctoring.knobs.maxViolations.never')}
                                        </SelectItem>
                                        {[3, 5, 10].map((count) => (
                                            <SelectItem key={count} value={String(count)}>
                                                {t('proctoring.knobs.maxViolations.after', {
                                                    count,
                                                })}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </FormItem>
                        )}
                    />
                </div>
            )}
        </div>
    );
};

const ToggleRow = ({
    control,
    name,
    label,
    description,
}: {
    control: Control<BasicSectionFormType>;
    name: 'proctoring.cameraRequired' | 'proctoring.faceCheck' | 'proctoring.showSelfView';
    label: string;
    description: string;
}) => (
    <FormField
        control={control}
        name={name}
        render={({ field }) => (
            <FormItem className="flex items-center justify-between gap-4 space-y-0">
                <div className="flex flex-col">
                    <FormLabel className="text-sm text-slate-900">{label}</FormLabel>
                    <span className="text-xs text-slate-500">{description}</span>
                </div>
                <FormControl>
                    <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />
                </FormControl>
            </FormItem>
        )}
    />
);
