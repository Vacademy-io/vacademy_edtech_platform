import { useTranslation } from 'react-i18next';
import { Info } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui/switch';
import { IconTile } from './engine-ui';
import { CRM_ACTION_ICON, CRM_ACTION_TINT } from './crm-action-ui';
import { CRM_ACTION_TYPES, type CrmActionType } from '../-types/actions';
import type { CrmActionEntry } from '../-types';

const typeOf = (e: CrmActionEntry) => (typeof e === 'string' ? e : e.type);

const isAuto = (e: CrmActionEntry) => typeof e !== 'string' && e.auto === true;

/**
 * Which CRM actions the engine may propose, and which may run on their own, asked while
 * creating or editing the engine. "Runs on its own" only takes effect once a person has
 * approved enough actions of that type; until then each one is an inbox task.
 */
export function CrmActionsPicker({
    value,
    onChange,
}: {
    value: CrmActionEntry[];
    onChange: (next: CrmActionEntry[]) => void;
}) {
    const { t } = useTranslation('engagementEnginesActions');
    const allowed = new Set(value.map(typeOf));
    const auto = new Set(value.filter(isAuto).map(typeOf));

    const toggle = (type: CrmActionType, on: boolean) => {
        if (on) {
            if (!allowed.has(type)) onChange([...value, type]);
        } else {
            onChange(value.filter((e) => typeOf(e) !== type));
        }
    };

    const setAuto = (type: CrmActionType, on: boolean) =>
        onChange(value.map((e) => (typeOf(e) === type ? (on ? { type, auto: true } : type) : e)));

    return (
        <div className="flex flex-col gap-2">
            <ul className="flex flex-col divide-y divide-neutral-100">
                {CRM_ACTION_TYPES.map((type) => (
                    <li key={type} className="flex items-center gap-3 py-2.5">
                        <IconTile
                            icon={CRM_ACTION_ICON[type]}
                            size="sm"
                            tint={CRM_ACTION_TINT[type]}
                        />
                        <div className="min-w-0 flex-1">
                            <p className="font-semibold text-neutral-900">
                                <span className="text-body">{t(`types.${type}.label`)}</span>
                            </p>
                            <p className="text-neutral-500">
                                <span className="text-caption">
                                    {t(`types.${type}.description`)}
                                </span>
                            </p>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center gap-4">
                            <label className="flex items-center gap-2">
                                <Switch
                                    checked={allowed.has(type)}
                                    onCheckedChange={(v) => toggle(type, v)}
                                    aria-label={t('panel.allowedFor', {
                                        action: t(`types.${type}.label`),
                                    })}
                                />
                                <span className="text-caption text-neutral-700">
                                    {t('panel.allowed')}
                                </span>
                            </label>
                            <label className="flex items-center gap-2">
                                <Switch
                                    checked={auto.has(type)}
                                    disabled={!allowed.has(type)}
                                    onCheckedChange={(v) => setAuto(type, v)}
                                    aria-label={t('panel.autoFor', {
                                        action: t(`types.${type}.label`),
                                    })}
                                />
                                <span
                                    className={cn(
                                        'text-caption',
                                        allowed.has(type) ? 'text-neutral-700' : 'text-neutral-400'
                                    )}
                                >
                                    {t('panel.auto')}
                                </span>
                            </label>
                        </div>
                    </li>
                ))}
            </ul>
            <p className="flex items-start gap-2 text-neutral-500">
                <Info size={14} className="mt-0.5 shrink-0" aria-hidden />
                <span className="text-caption">{t('picker.autoHelp')}</span>
            </p>
        </div>
    );
}
