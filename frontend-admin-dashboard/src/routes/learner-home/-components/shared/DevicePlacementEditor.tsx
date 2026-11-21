import { useTranslation } from 'react-i18next';
import { Desktop, DeviceMobile, Devices as DevicesIcon } from '@phosphor-icons/react';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';
import {
    DESKTOP_PLACEMENTS,
    DEVICES,
    type DesktopPlacement,
    type Devices,
} from '../../-types/learner-home-types';

const DEVICE_ICONS = { BOTH: DevicesIcon, PHONE: DeviceMobile, DESKTOP: Desktop };

/** A small drawing of the desktop layout with the chosen place highlighted. */
function PlacementDiagram({ placement, label }: { placement: DesktopPlacement; label: string }) {
    const on = 'bg-primary-300';
    const off = 'bg-neutral-200';
    return (
        <div
            role="img"
            aria-label={label}
            className="flex w-24 shrink-0 flex-col gap-1 rounded-md border border-neutral-200 p-1.5"
        >
            <div className={cn('h-2.5 rounded-sm', placement === 'FULL' ? on : off)} />
            <div className="grid grid-cols-3 gap-1">
                <div className={cn('col-span-2 h-6 rounded-sm', placement === 'MAIN' ? on : off)} />
                <div className={cn('h-6 rounded-sm', placement === 'RAIL' ? on : off)} />
            </div>
        </div>
    );
}

export function DevicePlacementEditor({
    id,
    devices,
    placement,
    onChange,
}: {
    id: string;
    devices: Devices;
    placement: DesktopPlacement;
    onChange: (next: { devices?: Devices; desktop_placement?: DesktopPlacement }) => void;
}) {
    const { t } = useTranslation('learnerHome');
    return (
        <div className="space-y-4">
            <fieldset className="space-y-2">
                <legend className="text-body font-semibold text-neutral-700">
                    {t('where.devices')}
                </legend>
                <RadioGroup
                    value={devices}
                    onValueChange={(v) => onChange({ devices: v as Devices })}
                    className="flex flex-wrap gap-2"
                >
                    {DEVICES.map((d) => {
                        const Icon = DEVICE_ICONS[d];
                        return (
                            <Label
                                key={d}
                                htmlFor={`${id}-dev-${d}`}
                                className={cn(
                                    'flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 font-normal',
                                    devices === d
                                        ? 'border-primary-300 bg-primary-50'
                                        : 'border-neutral-200'
                                )}
                            >
                                <RadioGroupItem id={`${id}-dev-${d}`} value={d} />
                                <Icon className="size-4" aria-hidden />
                                {t(`devices.${d}`)}
                            </Label>
                        );
                    })}
                </RadioGroup>
            </fieldset>
            <fieldset className="space-y-2">
                <legend className="text-body font-semibold text-neutral-700">
                    {t('where.placement')}
                </legend>
                <div className="flex flex-wrap items-start gap-4">
                    <RadioGroup
                        value={placement}
                        onValueChange={(v) =>
                            onChange({ desktop_placement: v as DesktopPlacement })
                        }
                        className="space-y-1"
                    >
                        {DESKTOP_PLACEMENTS.map((p) => (
                            <div key={p} className="flex items-center gap-2">
                                <RadioGroupItem id={`${id}-place-${p}`} value={p} />
                                <Label htmlFor={`${id}-place-${p}`} className="font-normal">
                                    {t(`placement.${p}`)}
                                </Label>
                            </div>
                        ))}
                    </RadioGroup>
                    <PlacementDiagram placement={placement} label={t('where.diagram')} />
                </div>
                <p className="text-caption text-neutral-500">{t('where.placementHint')}</p>
            </fieldset>
        </div>
    );
}
