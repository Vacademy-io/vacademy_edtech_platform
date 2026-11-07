import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { LockSimple } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { omrErrorMessage, saveOmrConfig, type OmrOverview } from '../../-services/omr-services';
import { OmrCard } from './OmrCard';

const SET_COUNTS = [1, 2, 3, 4, 5, 6, 7, 8];

/** Sets to print and whether they shuffle. Read-only once a scan was uploaded. */
export const OmrSettingsCard = ({
    assessmentId,
    instituteId,
    overview,
}: {
    assessmentId: string;
    instituteId: string;
    overview: OmrOverview;
}) => {
    const { t } = useTranslation('assessmentOmr');
    const queryClient = useQueryClient();
    const config = overview.config;
    const [setCount, setSetCount] = useState(config?.set_count ?? 1);
    const [shuffleQuestions, setShuffleQuestions] = useState(config?.shuffle_questions ?? false);
    const [shuffleOptions, setShuffleOptions] = useState(config?.shuffle_options ?? false);

    useEffect(() => {
        setSetCount(config?.set_count ?? 1);
        setShuffleQuestions(config?.shuffle_questions ?? false);
        setShuffleOptions(config?.shuffle_options ?? false);
    }, [config?.set_count, config?.shuffle_questions, config?.shuffle_options]);

    const dirty =
        setCount !== (config?.set_count ?? 1) ||
        shuffleQuestions !== (config?.shuffle_questions ?? false) ||
        shuffleOptions !== (config?.shuffle_options ?? false);

    const save = useMutation({
        mutationFn: () =>
            saveOmrConfig(assessmentId, instituteId, {
                set_count: setCount,
                shuffle_questions: shuffleQuestions,
                shuffle_options: shuffleOptions,
            }),
        onSuccess: (next) => {
            queryClient.setQueryData(['OMR_OVERVIEW', assessmentId, instituteId], next);
            toast.success(t('settings.saved'));
        },
        onError: (e) => toast.error(omrErrorMessage(e, t('errors.saveFailed'))),
    });

    const locked = overview.locked;
    const singleSet = setCount <= 1;

    return (
        <OmrCard title={t('settings.title')} subtitle={t('settings.subtitle')}>
            {locked && (
                <p className="flex items-start gap-2 rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-600">
                    <LockSimple size={16} className="mt-0.5 shrink-0" />
                    {t('settings.locked')}
                </p>
            )}
            <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-3">
                    <Label className="text-sm text-neutral-700">{t('settings.setCount')}</Label>
                    <Select
                        value={String(setCount)}
                        onValueChange={(v) => setSetCount(Number(v))}
                        disabled={locked || save.isPending}
                    >
                        <SelectTrigger className="w-24">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {SET_COUNTS.map((n) => (
                                <SelectItem key={n} value={String(n)}>
                                    {n}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex items-center justify-between gap-4">
                    <Label htmlFor="omr-shuffle-questions" className="text-sm text-neutral-700">
                        {t('settings.shuffleQuestions')}
                    </Label>
                    <Switch
                        id="omr-shuffle-questions"
                        checked={shuffleQuestions}
                        onCheckedChange={setShuffleQuestions}
                        disabled={locked || singleSet || save.isPending}
                    />
                </div>
                <div className="flex items-center justify-between gap-4">
                    <Label htmlFor="omr-shuffle-options" className="text-sm text-neutral-700">
                        {t('settings.shuffleOptions')}
                    </Label>
                    <Switch
                        id="omr-shuffle-options"
                        checked={shuffleOptions}
                        onCheckedChange={setShuffleOptions}
                        disabled={locked || singleSet || save.isPending}
                    />
                </div>
                <p className="text-caption text-neutral-500">{t('settings.setAHint')}</p>
            </div>
            {!locked && (
                <div className="flex justify-end">
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="small"
                        disabled={!dirty || save.isPending}
                        onClick={() => save.mutate()}
                    >
                        {save.isPending ? t('settings.saving') : t('settings.save')}
                    </MyButton>
                </div>
            )}
        </OmrCard>
    );
};

export default OmrSettingsCard;
