import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ImageUploadField } from '../ImageUploadField';
import { LinkPicker } from '../LinkPicker';
import {
    appendObject,
    groupIdFrom,
    isReservedGroupId,
    movedGroupOrder,
    moveObject,
    objectOf,
    objectsOf,
    optionIdFrom,
    parseTagList,
    patchObject,
    removeObject,
    sidebarGroupRows,
    stringsOf,
    textOf,
    uniqueId,
    type Props,
} from './catalog-design-props';
import {
    AddButton,
    DesignGroup,
    ItemBox,
    RowActions,
    SubHeading,
    TextField,
    ToggleField,
} from './design-fields';

/**
 * courseCatalog.filterSidebar / customFilters: the order of the filter
 * groups (and which show), the extra option groups (FORMAT, FOR…) and the app
 * promo card under the filters. See the learner's catalog-sidebar-types.ts.
 */

export const sidebarGroupApplies = (props: Props): boolean =>
    !!props.filterSidebar || Array.isArray(props.customFilters);

export const SidebarGroup = ({
    props,
    patch,
    setNested,
}: {
    props: Props;
    patch: (next: Props) => void;
    setNested: (key: string, next: Props) => void;
}) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const sidebar = props.filterSidebar ? objectOf(props.filterSidebar) : null;
    const setSidebar = (next: Props) => setNested('filterSidebar', next);
    const rows = sidebarGroupRows(props);
    // Edited in place: entries the editor skips (not an object) stay where they are.
    const rawFilters: unknown[] = Array.isArray(props.customFilters) ? props.customFilters : [];
    const setFilter = (index: number, next: Props) =>
        patch({
            customFilters: rawFilters.map((f, i) =>
                i === index ? { ...objectOf(f), ...next } : f
            ),
        });
    const groupName = (id: string, label: string) =>
        label || t(`catalogDesign.sidebar.builtIn.${id}`, { defaultValue: id });
    const promo = sidebar?.promo ? objectOf(sidebar.promo) : null;
    const setPromo = (next: Props) => setSidebar({ promo: { ...promo, ...next } });
    const button = objectOf(promo?.button);
    // Google Play / App Store badges, shown on the site in place of the button.
    const appLinks = objectOf(promo?.appLinks);

    return (
        <DesignGroup
            title={t('catalogDesign.sidebar.group')}
            hint={t('catalogDesign.sidebar.groupHint')}
        >
            {sidebar && (
                <>
                    <TextField
                        label={t('catalogDesign.sidebar.title')}
                        value={textOf(sidebar.title)}
                        placeholder={t('catalogDesign.common.builtInText')}
                        onChange={(v) => setSidebar({ title: v })}
                    />
                    <TextField
                        label={t('catalogDesign.sidebar.clearAll')}
                        value={textOf(sidebar.clearAllLabel)}
                        placeholder={t('catalogDesign.common.builtInText')}
                        onChange={(v) => setSidebar({ clearAllLabel: v })}
                    />
                    <SubHeading
                        title={t('catalogDesign.sidebar.order')}
                        hint={t('catalogDesign.sidebar.orderHint')}
                    />
                    {rows.map((row, index) => {
                        const name = groupName(row.id, row.label);
                        return (
                            <div
                                key={row.id}
                                className="flex items-center gap-2 rounded border border-neutral-200 px-2 py-1"
                            >
                                <span className="min-w-0 flex-1 truncate text-xs text-neutral-700">
                                    {name}
                                </span>
                                <Switch
                                    checked={row.shown}
                                    aria-label={t('catalogDesign.sidebar.show', { item: name })}
                                    onCheckedChange={(v) =>
                                        row.filterKey
                                            ? setNested(row.filterKey, { enabled: v })
                                            : setFilter(row.customIndex!, { enabled: v })
                                    }
                                />
                                <RowActions
                                    index={index}
                                    count={rows.length}
                                    item={name}
                                    onMove={(d) =>
                                        setSidebar({
                                            order: movedGroupOrder(rows, index, d, sidebar.order),
                                        })
                                    }
                                />
                            </div>
                        );
                    })}
                </>
            )}

            {rawFilters.map((raw, index) => {
                if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
                return (
                    <ExtraFilterFields
                        key={index}
                        number={index + 1}
                        filter={raw as Props}
                        takenIds={rows
                            .map((r) => r.id)
                            .filter((id) => id !== textOf((raw as Props).id))}
                        update={(next) => setFilter(index, next)}
                    />
                );
            })}
            {Array.isArray(props.customFilters) && (
                <AddButton
                    label={t('catalogDesign.sidebar.addFilter')}
                    onClick={() =>
                        patch({
                            customFilters: [...rawFilters, { id: '', label: '', options: [] }],
                        })
                    }
                />
            )}

            {promo && (
                <>
                    <SubHeading
                        title={t('catalogDesign.sidebar.promo')}
                        hint={t('catalogDesign.sidebar.promoHint')}
                    />
                    <ToggleField
                        label={t('catalogDesign.sidebar.promoOn')}
                        checked={promo.enabled === true}
                        onChange={(v) => setPromo({ enabled: v })}
                    />
                    <ImageUploadField
                        label={t('catalogDesign.sidebar.screenImage')}
                        value={textOf(promo.screenImage)}
                        onChange={(url) => setPromo({ screenImage: url })}
                    />
                    <ImageUploadField
                        label={t('catalogDesign.sidebar.image')}
                        value={textOf(promo.image)}
                        onChange={(url) => setPromo({ image: url })}
                    />
                    <p className="text-caption text-neutral-500">
                        {t('catalogDesign.sidebar.imageHint')}
                    </p>
                    <TextField
                        label={t('catalogDesign.sidebar.imageAlt')}
                        value={textOf(promo.imageAlt)}
                        onChange={(v) => setPromo({ imageAlt: v })}
                    />
                    <TextField
                        label={t('catalogDesign.rows.eyebrow')}
                        value={textOf(promo.eyebrow)}
                        onChange={(v) => setPromo({ eyebrow: v })}
                    />
                    <TextField
                        label={t('catalogDesign.common.heading')}
                        value={textOf(promo.title)}
                        onChange={(v) => setPromo({ title: v })}
                    />
                    <TextField
                        label={t('catalogDesign.common.text')}
                        value={textOf(promo.text)}
                        onChange={(v) => setPromo({ text: v })}
                        multiline
                    />
                    <TextField
                        label={t('catalogDesign.rows.buttonText')}
                        value={textOf(button.text)}
                        onChange={(v) => setPromo({ button: { ...button, text: v } })}
                    />
                    <LinkPicker
                        label={t('catalogDesign.sidebar.buttonLink')}
                        value={textOf(button.target)}
                        onChange={(v) => setPromo({ button: { ...button, target: v } })}
                    />
                    <TextField
                        label={t('catalogDesign.sidebar.playStoreLink')}
                        hint={t('catalogDesign.sidebar.storeLinksHint')}
                        placeholder="https://play.google.com/store/apps/details?id=…"
                        value={textOf(appLinks.playStore)}
                        onChange={(v) => setPromo({ appLinks: { ...appLinks, playStore: v } })}
                    />
                    <TextField
                        label={t('catalogDesign.sidebar.appStoreLink')}
                        placeholder="https://apps.apple.com/…"
                        value={textOf(appLinks.appStore)}
                        onChange={(v) => setPromo({ appLinks: { ...appLinks, appStore: v } })}
                    />
                </>
            )}
        </DesignGroup>
    );
};

/** One extra option group: its heading and, unless it lists the course formats, its options. */
const ExtraFilterFields = ({
    number,
    filter,
    takenIds,
    update,
}: {
    /** Its place in the list, for the fallback URL key (filter-2). */
    number: number;
    filter: Props;
    takenIds: string[];
    update: (next: Props) => void;
}) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const options = objectsOf(filter.options);
    const setOptions = (list: unknown[]) => update({ options: list });
    const label = textOf(filter.label);
    const id = textOf(filter.id).trim();
    const fromFormats = filter.source === 'courseFormats';
    // source 'tags': the site also lists every course tag starting with the prefix ("for parents" → Parents).
    const fromTags = filter.source === 'tags';

    return (
        <ItemBox
            title={t('catalogDesign.sidebar.filterTitle', {
                name: label || textOf(filter.id) || '…',
            })}
        >
            <TextField
                label={t('catalogDesign.common.heading')}
                value={label}
                onChange={(v) => update({ label: v })}
                // A new group gets its URL key (?for=…) from its first heading; an existing key never
                // changes, so links to it keep working.
                onBlur={() => {
                    if (!id && label.trim())
                        update({ id: groupIdFrom(label, takenIds, `filter-${number}`) });
                }}
            />
            {id && (
                <p className="text-caption text-neutral-500">
                    {t('catalogDesign.sidebar.urlKey', { id })}
                </p>
            )}
            {id && isReservedGroupId(id) && (
                <p className="text-caption text-danger-600">
                    {t('catalogDesign.sidebar.urlKeyReserved')}
                </p>
            )}
            {fromFormats ? (
                <p className="text-caption text-neutral-500">
                    {t('catalogDesign.sidebar.formatsNote')}
                </p>
            ) : (
                <>
                    <ToggleField
                        label={t('catalogDesign.sidebar.fromTags')}
                        checked={fromTags}
                        onChange={(v) => update({ source: v ? 'tags' : 'options' })}
                    />
                    {fromTags && (
                        <>
                            <TextField
                                label={t('catalogDesign.sidebar.tagPrefix')}
                                hint={t('catalogDesign.sidebar.tagPrefixHint')}
                                placeholder="for"
                                value={textOf(filter.prefix)}
                                onChange={(v) => update({ prefix: v })}
                            />
                            {!textOf(filter.prefix).trim() && (
                                <p className="text-caption text-warning-600">
                                    {t('catalogDesign.sidebar.tagPrefixMissing')}
                                </p>
                            )}
                            <TagListField
                                label={t('catalogDesign.sidebar.tagExclude')}
                                hint={t('catalogDesign.sidebar.tagExcludeHint')}
                                tags={stringsOf(filter.exclude)}
                                onCommit={(exclude) => update({ exclude })}
                            />
                        </>
                    )}
                    {options.map((option, index) => {
                        const name = t('catalogDesign.sidebar.optionN', { n: index + 1 });
                        return (
                            <ItemBox
                                key={index}
                                title={textOf(option.label) || name}
                                actions={
                                    <RowActions
                                        index={index}
                                        count={options.length}
                                        item={name}
                                        onMove={(d) =>
                                            setOptions(moveObject(filter.options, index, d))
                                        }
                                        onRemove={() =>
                                            setOptions(removeObject(filter.options, index))
                                        }
                                    />
                                }
                            >
                                <TextField
                                    label={t('catalogDesign.common.text')}
                                    value={textOf(option.label)}
                                    onChange={(v) =>
                                        setOptions(patchObject(filter.options, index, { label: v }))
                                    }
                                    // Like the group: a key from the first text, option-N when it has no Latin letters.
                                    onBlur={() => {
                                        const text = textOf(option.label).trim();
                                        const key = optionIdFrom(text) || `option-${index + 1}`;
                                        const taken = options
                                            .filter((_, i) => i !== index)
                                            .map((o) => textOf(o.id));
                                        if (!textOf(option.id) && text)
                                            setOptions(
                                                patchObject(filter.options, index, {
                                                    id: uniqueId(key, taken),
                                                })
                                            );
                                    }}
                                />
                                <TagListField
                                    label={t('catalogDesign.sidebar.tags')}
                                    hint={t('catalogDesign.sidebar.tagsHint')}
                                    tags={stringsOf(option.tags)}
                                    onCommit={(tags) =>
                                        setOptions(patchObject(filter.options, index, { tags }))
                                    }
                                />
                                {!stringsOf(option.tags).length &&
                                    !stringsOf(option.levels).length && (
                                        <p className="text-caption text-warning-600">
                                            {t('catalogDesign.sidebar.needsTag')}
                                        </p>
                                    )}
                            </ItemBox>
                        );
                    })}
                    <AddButton
                        label={t('catalogDesign.sidebar.addOption')}
                        onClick={() =>
                            setOptions(
                                appendObject(filter.options, { id: '', label: '', tags: [] })
                            )
                        }
                    />
                </>
            )}
        </ItemBox>
    );
};

/** Comma-separated course tags, saved when the field loses focus (so commas and spaces can be typed). */
const TagListField = ({
    label,
    hint,
    tags,
    onCommit,
}: {
    label: string;
    hint: string;
    tags: string[];
    onCommit: (tags: string[]) => void;
}) => {
    const id = useId();
    const shown = tags.join(', ');
    return (
        <div>
            <Label htmlFor={id} className="text-xs">
                {label}
            </Label>
            <Input
                id={id}
                // Re-mount when the stored list changes so the box shows it tidied.
                key={shown}
                className="mt-1 h-8 text-xs"
                defaultValue={shown}
                aria-describedby={`${id}-hint`}
                onBlur={(e) => {
                    const next = parseTagList(e.target.value);
                    if (next.join(',') !== tags.join(',')) onCommit(next);
                }}
            />
            <p id={`${id}-hint`} className="mt-1 text-caption text-neutral-500">
                {hint}
            </p>
        </div>
    );
};
