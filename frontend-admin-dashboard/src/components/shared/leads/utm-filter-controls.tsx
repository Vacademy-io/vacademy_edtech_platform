import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Megaphone } from '@phosphor-icons/react';
import type { ListCustomFieldSurface } from '@/types/display-settings';
import type { UtmFilterDimension, UtmFilterSelection } from '@/services/utm-list-filters';
import { MultiSelectFilter, type MultiSelectOption } from './multi-select-filter';
import { useUtmListFilters } from './use-utm-list-filters';
import { UTM_UNTAGGED_SENTINEL } from './utm-filter-encoding';

interface UtmFilterControlsProps {
    /** Which list surface this bar belongs to — decides visibility + dimensions. */
    surface: ListCustomFieldSurface;
    instituteId: string;
    /** Current selection per dimension. */
    selection: UtmFilterSelection;
    /** Fired with the full new value list for ONE dimension. */
    onChange: (dimension: UtmFilterDimension, values: string[]) => void;
    /** Trigger look — 'pill' on Manage Students, 'button' on the leads bars. */
    variant?: 'button' | 'pill';
    /** Width class for the button variant. */
    widthClass?: string;
}

/**
 * Labels for the capture surfaces a tagged link can point at. Kept here (not
 * in the catalog) because the KEYS are API constants; only the label text is
 * translated.
 */
const SOURCE_TYPE_LABEL_KEYS: Record<string, string> = {
    AUDIENCE: 'sourceTypes.audience',
    LIVE_SESSION: 'sourceTypes.liveSession',
    ASSESSMENT: 'sourceTypes.assessment',
    ENROLL_INVITE: 'sourceTypes.enrollInvite',
    PRODUCT_PAGE: 'sourceTypes.productPage',
    CATALOGUE: 'sourceTypes.catalogue',
    CUSTOM: 'sourceTypes.custom',
};

/**
 * The campaign (UTM) filter dropdowns for a list page: one searchable
 * multi-select per active dimension, driven entirely by
 * {@link useUtmListFilters} — the component renders nothing while the
 * institute's UTM setting is off or the surface is hidden in display settings,
 * so every list page can mount it unconditionally.
 *
 * The Source dropdown also pins a "No campaign" option, which is how an admin
 * asks the organic-vs-campaign question. It is exclusive within the dimension:
 * picking it drops the named sources, picking a named source drops it.
 */
export function UtmFilterControls({
    surface,
    instituteId,
    selection,
    onChange,
    variant = 'button',
    widthClass = 'w-44',
}: UtmFilterControlsProps) {
    const { t } = useTranslation('utmListFilters');
    const { enabled, dimensions } = useUtmListFilters(surface, instituteId || undefined);

    const labels = useMemo<Record<UtmFilterDimension, string>>(
        () => ({
            source: t('dimensions.source'),
            medium: t('dimensions.medium'),
            campaign: t('dimensions.campaign'),
            content: t('dimensions.content'),
            term: t('dimensions.term'),
            source_type: t('dimensions.sourceType'),
        }),
        [t]
    );

    if (!enabled || dimensions.length === 0) return null;

    const optionsFor = (dimension: UtmFilterDimension, values: string[]): MultiSelectOption[] => {
        const base: MultiSelectOption[] = values.map((v) => ({
            value: v,
            label:
                dimension === 'source_type'
                    ? t(SOURCE_TYPE_LABEL_KEYS[v] ?? 'sourceTypes.custom', { defaultValue: v })
                    : v,
        }));
        if (dimension === 'source') {
            return [{ value: UTM_UNTAGGED_SENTINEL, label: t('untagged') }, ...base];
        }
        return base;
    };

    const handleChange = (dimension: UtmFilterDimension, next: string[]) => {
        if (dimension === 'source') {
            const prev = selection.source ?? [];
            const hadUntagged = prev.includes(UTM_UNTAGGED_SENTINEL);
            const hasUntagged = next.includes(UTM_UNTAGGED_SENTINEL);
            if (hasUntagged && !hadUntagged) {
                // Just picked "No campaign": it stands alone.
                onChange('source', [UTM_UNTAGGED_SENTINEL]);
                return;
            }
            if (hasUntagged && hadUntagged && next.length > 1) {
                // Picked a named source while "No campaign" was on: drop it.
                onChange(
                    'source',
                    next.filter((v) => v !== UTM_UNTAGGED_SENTINEL)
                );
                return;
            }
        }
        onChange(dimension, next);
    };

    return (
        <>
            {dimensions.map(({ dimension, options }) => (
                <MultiSelectFilter
                    key={dimension}
                    label={labels[dimension]}
                    icon={<Megaphone className="size-4 shrink-0 text-neutral-400" />}
                    options={optionsFor(dimension, options)}
                    selected={selection[dimension] ?? []}
                    onChange={(values) => handleChange(dimension, values)}
                    placeholder={t('searchPlaceholder', { dimension: labels[dimension] })}
                    variant={variant}
                    widthClass={widthClass}
                />
            ))}
        </>
    );
}
