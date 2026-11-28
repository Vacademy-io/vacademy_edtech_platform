import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { CPOForm } from './CreateCPODialog';
import {
    DEFAULT_FLEXIBLE_DEFAULTS,
    MAX_INSTALLMENTS,
    flexibleDefaultsError,
    flexibleHasNoSplitFee,
    type FlexibleDefaultsForm,
} from '../-utils/flexible-defaults';

interface Props {
    form: CPOForm;
    onChange: (patch: Partial<CPOForm>) => void;
}

/**
 * "When are installments due?" for a new fee plan: fixed dates shared by every learner
 * (the plan's own installment table), or chosen for each learner at enrollment
 * (FLEXIBLE). For a flexible plan the admin sets the defaults the Enroll wizard starts
 * from, and optionally a maximum number of installments.
 */
export function FlexibleScheduleSettings({ form, onChange }: Props) {
    const { t } = useTranslation('financialManagementFlexibleSchedule');
    const flexible = form.scheduleMode === 'FLEXIBLE';
    const defaults = form.flexibleDefaults ?? DEFAULT_FLEXIBLE_DEFAULTS;
    const setDefaults = (patch: Partial<FlexibleDefaultsForm>) =>
        onChange({ flexibleDefaults: { ...defaults, ...patch } });

    const option = (value: 'FIXED' | 'FLEXIBLE', title: string, description: string) => {
        const active = (form.scheduleMode ?? 'FIXED') === value;
        return (
            <button
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() =>
                    onChange(
                        value === 'FLEXIBLE'
                            ? { scheduleMode: 'FLEXIBLE', flexibleDefaults: defaults }
                            : { scheduleMode: 'FIXED' }
                    )
                }
                className={`flex-1 rounded-lg border px-3 py-2 text-start transition ${
                    active
                        ? 'border-primary-400 bg-primary-50'
                        : 'border-neutral-200 bg-white hover:bg-neutral-50'
                }`}
            >
                <span className="block text-sm font-semibold text-neutral-800">{title}</span>
                <span className="block text-xs text-neutral-500">{description}</span>
            </button>
        );
    };

    return (
        <div className="rounded-lg border border-neutral-200 px-4 py-3">
            <Label className="text-sm font-semibold text-neutral-800">{t('heading')}</Label>
            <div role="radiogroup" aria-label={t('heading')} className="mt-2 flex flex-col gap-2 sm:flex-row">
                {option('FIXED', t('fixed.title'), t('fixed.description'))}
                {option('FLEXIBLE', t('flexible.title'), t('flexible.description'))}
            </div>

            {flexible && (
                <div className="mt-3 flex flex-wrap items-end gap-4">
                    <div>
                        <Label className="mb-1 block text-xs font-medium text-neutral-500">
                            {t('defaults.count')}
                        </Label>
                        <Input
                            type="number"
                            min={1}
                            max={MAX_INSTALLMENTS}
                            value={defaults.count}
                            onChange={(e) => setDefaults({ count: e.target.value })}
                            className="w-24"
                        />
                    </div>
                    <div>
                        <Label className="mb-1 block text-xs font-medium text-neutral-500">
                            {t('defaults.every')}
                        </Label>
                        <div className="flex items-center gap-2">
                            <Input
                                type="number"
                                min={1}
                                value={defaults.value}
                                onChange={(e) => setDefaults({ value: e.target.value })}
                                className="w-20"
                            />
                            <select
                                value={defaults.unit}
                                onChange={(e) =>
                                    setDefaults({ unit: e.target.value as FlexibleDefaultsForm['unit'] })
                                }
                                className="h-9 rounded-md border border-neutral-200 bg-white px-2 text-sm"
                            >
                                <option value="DAYS">{t('units.days')}</option>
                                <option value="MONTHS">{t('units.months')}</option>
                            </select>
                        </div>
                    </div>
                    <div>
                        <Label className="mb-1 block text-xs font-medium text-neutral-500">
                            {t('defaults.maxCount')}
                        </Label>
                        <Input
                            type="number"
                            min={1}
                            max={MAX_INSTALLMENTS}
                            placeholder={t('defaults.maxCountPlaceholder', { max: MAX_INSTALLMENTS })}
                            value={defaults.maxCount}
                            onChange={(e) => setDefaults({ maxCount: e.target.value })}
                            className="w-28"
                        />
                    </div>
                    <p className="w-full text-xs text-neutral-500">{t('flexible.feesHint')}</p>
                    {flexibleDefaultsError(form.scheduleMode, defaults) && (
                        <p role="alert" className="w-full text-xs font-medium text-danger-600">
                            {t(`errors.${flexibleDefaultsError(form.scheduleMode, defaults)}`, {
                                max: MAX_INSTALLMENTS,
                                gap: defaults.unit === 'DAYS' ? 3660 : 120,
                            })}
                        </p>
                    )}
                    {flexibleHasNoSplitFee(form.scheduleMode, form.feeTypes) && (
                        <p role="alert" className="w-full text-xs font-medium text-danger-600">
                            {t('errors.noSplitFee')}
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
