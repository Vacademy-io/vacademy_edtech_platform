import { useTranslation } from 'react-i18next';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { useAudienceListNames } from '../-hooks/audience-names';
import { batchNameParts } from '../-utils';
import type { AudienceSelector } from '../-types';
import { Chip } from './engine-ui';

const MAX_SHOWN = 6;

/**
 * Where an engine's people come from, by name: the audience lists and batches it was built on
 * (not "2 lists"), plus the number of people added one by one. A source whose name cannot be read
 * falls back to a plain count so nothing is hidden.
 */
export function EngineSources({
    audience,
    batchLabel,
    listLabel,
    peopleLabel,
}: {
    audience: AudienceSelector[];
    batchLabel: string;
    listLabel: string;
    peopleLabel: string;
}) {
    const { t } = useTranslation('engagementEnginesEngineIdIndex');
    const { instituteDetails } = useInstituteDetailsStore();

    const listIds = audience.filter((a) => a.type === 'AUDIENCE').map((a) => a.id);
    const batchIds = audience.filter((a) => a.type === 'PACKAGE_SESSION').map((a) => a.id);
    const peopleCount = audience.filter((a) => a.type === 'USER').length;
    const { names: listNames } = useAudienceListNames(listIds);

    const batchName = (id: string) => {
        const b = (instituteDetails?.batches_for_sessions ?? []).find((x) => x.id === id);
        if (!b) return undefined;
        const { label, sub } = batchNameParts(b);
        return [label, sub].filter(Boolean).join(' · ');
    };

    const groups = [
        { key: 'batches', label: batchLabel, ids: batchIds, nameOf: batchName },
        { key: 'lists', label: listLabel, ids: listIds, nameOf: (id: string) => listNames[id] },
    ].filter((g) => g.ids.length > 0);

    if (groups.length === 0 && peopleCount === 0) return <>{t('status.noSources')}</>;

    return (
        <div className="flex flex-col gap-2">
            {groups.map((g) => {
                const named = g.ids.map(g.nameOf).filter((n): n is string => !!n);
                const unnamed = g.ids.length - named.length;
                const shown = named.slice(0, MAX_SHOWN);
                const hidden = named.length - shown.length + unnamed;
                return (
                    <div key={g.key} className="flex flex-col gap-1">
                        <span className="text-neutral-500">
                            <span className="text-caption">
                                {g.label} ({g.ids.length})
                            </span>
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                            {shown.map((n, i) => (
                                <Chip key={`${n}-${i}`} label={n} className="max-w-full" />
                            ))}
                            {hidden > 0 && (
                                <Chip
                                    label={t('status.sourcesMore', { count: hidden })}
                                    className="bg-neutral-50"
                                />
                            )}
                        </div>
                    </div>
                );
            })}
            {peopleCount > 0 && (
                <span className="text-neutral-500">
                    <span className="text-caption">
                        {peopleCount} {peopleLabel}
                    </span>
                </span>
            )}
        </div>
    );
}
