import { Info } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { StatusChip } from '@/components/design-system/status-chips';
import type { StageLine } from '../../-utils/diagnosis-stages';

/**
 * One line per stage of the chain. A quiet stage says why it is quiet ("Nothing sent", "Not
 * enough data yet") and one that could not be read says "Couldn't load": never "Normal".
 */
export function StageStatusList({ stages }: { stages: StageLine[] }) {
    const { t } = useTranslation('engagementDailyReport');
    if (stages.length === 0) return null;
    return (
        <ul
            aria-label={t('diagnosis.stagesLabel')}
            className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
        >
            {stages.map((s) => (
                <li
                    key={s.stage}
                    className="flex min-w-0 flex-col items-start gap-1 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2"
                >
                    <span className="font-medium text-neutral-800">
                        <span className="text-body">{s.label}</span>
                    </span>
                    <StatusChip
                        text={s.statusLabel}
                        textSize="text-caption"
                        status={s.chip.type}
                        showIcon={s.chip.icon}
                    />
                </li>
            ))}
        </ul>
    );
}

/** What the report cannot see, in a few words, so a 0 that is really "can't tell" is not read as a real 0. */
export function DataGapNotes({ notes }: { notes: string[] }) {
    const { t } = useTranslation('engagementDailyReport');
    if (notes.length === 0) return null;
    return (
        <ul
            aria-label={t('diagnosis.gapsLabel')}
            className="flex flex-col gap-2 rounded-lg border border-info-200 bg-info-50 p-3 text-info-700"
        >
            {notes.map((note, i) => (
                <li key={`${i}-${note}`} className="flex items-start gap-2">
                    <Info size={16} weight="fill" className="mt-0.5 shrink-0" />
                    <span className="break-words text-caption">{note}</span>
                </li>
            ))}
        </ul>
    );
}
