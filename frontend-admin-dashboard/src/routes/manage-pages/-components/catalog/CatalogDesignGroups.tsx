import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import { CardTextGroup, cardGroupApplies } from './CardTextGroup';
import { CatalogHeroGroup, heroGroupApplies } from './CatalogHeroGroup';
import { CatalogSectionsGroup } from './CatalogSectionsGroup';
import { SidebarGroup, sidebarGroupApplies } from './SidebarGroup';
import { useCatalogStreams } from './use-catalog-streams';
import type { CatalogueConfig } from '../../-types/editor-types';

/** Section props are hand- or AI-written JSON: read them as unknown and narrow. */
type Props = Record<string, unknown>;

export interface CatalogDesignGroupsProps {
    /** The courseCatalog section (in the language being edited). */
    component: { id: string; type?: string; props: Props };
    pageId: string;
    updateComponent: (pageId: string, componentId: string, patch: { props: Props }) => void;
    /** Shallow-merges `next` into the section props (every other prop is kept). */
    patch: (next: Props) => void;
    /** Merges `next` into the object at props[key] (e.g. 'hero'), keeping its other keys. */
    setNested: (key: string, next: Props) => void;
    /** The whole site in the language being edited (read-only): globalSettings, pages. */
    catalogue: CatalogueConfig | null;
}

/**
 * Editors for the courses page's opt-in design (page header / hero, rows above
 * and below the grid, sidebar, card texts). Mounted by PropertyPanel under the
 * discovery settings of every courseCatalog section. Each group renders only
 * when its setting already exists, so other sites see nothing new, and every
 * write goes through `patch` / `setNested`, which keep the props a group does
 * not manage. In another site language the section and helpers are the
 * localized ones: typed text becomes a translation.
 */
export const CatalogDesignGroups: FC<CatalogDesignGroupsProps> = ({
    component,
    patch,
    setNested,
    catalogue,
}) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const { props } = component;
    const hero = heroGroupApplies(props);
    const rows = Array.isArray(props.columnSections);
    const sidebar = sidebarGroupApplies(props);
    const cards = cardGroupApplies(props);
    // Hooks before the early return: the stream pickers of the header chips and the coming-soon row.
    const streams = useCatalogStreams(props, hero || rows);
    if (!hero && !rows && !sidebar && !cards) return null;

    return (
        <div className="space-y-2">
            <div>
                <p className="text-sm font-semibold text-neutral-700">{t('catalogDesign.title')}</p>
                <p className="text-caption text-neutral-500">{t('catalogDesign.hint')}</p>
            </div>
            {hero && <CatalogHeroGroup props={props} setNested={setNested} streams={streams} />}
            {rows && <CatalogSectionsGroup props={props} patch={patch} streams={streams} />}
            {sidebar && <SidebarGroup props={props} patch={patch} setNested={setNested} />}
            {cards && (
                <CardTextGroup
                    props={props}
                    setNested={setNested}
                    globalSettings={(catalogue?.globalSettings ?? {}) as Props}
                />
            )}
        </div>
    );
};
