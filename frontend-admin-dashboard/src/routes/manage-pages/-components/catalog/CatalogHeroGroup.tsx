import { useTranslation } from 'react-i18next';
import { LinkPicker } from '../LinkPicker';
import {
    appendObject,
    chipActionOf,
    insertObject,
    moveObject,
    objectOf,
    objectsOf,
    patchObject,
    removeObject,
    replaceObject,
    setOrDelete,
    textOf,
    withChipAction,
    type ChipAction,
    type Props,
    type StreamOption,
} from './catalog-design-props';
import {
    AddButton,
    DesignGroup,
    ItemBox,
    RowActions,
    SelectField,
    SubHeading,
    TextField,
    ToggleField,
} from './design-fields';

/**
 * courseCatalog.hero: the page header band (breadcrumb, heading, intro, live
 * numbers, search, Popular chips), plus the "Showing N courses" results header
 * and the quick-filter label, which work without the band. Shown only when
 * one of them is already set up. See the learner's catalog-hero-types.ts.
 */

const STAT_KINDS = ['courses', 'streams', 'categories'] as const;
const SORT_TOKENS = [
    'popular',
    'newest',
    'oldest',
    'price-asc',
    'price-desc',
    'rating',
    'name-asc',
    'name-desc',
] as const;
const CHIP_ACTIONS: ChipAction[] = ['stream', 'quickFilter', 'search', 'link'];
const MAX_STATS = 3;
const MAX_CHIPS = 8;

export const heroGroupApplies = (props: Props): boolean => {
    const hero = objectOf(props.hero);
    return hero.enabled === true || !!hero.resultsHeader || !!hero.quickFilterBar;
};

export const CatalogHeroGroup = ({
    props,
    setNested,
    streams,
}: {
    props: Props;
    setNested: (key: string, next: Props) => void;
    streams: StreamOption[];
}) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const hero = objectOf(props.hero);
    const setHero = (next: Props) => setNested('hero', next);
    const setHeroPart = (key: string, next: Props) =>
        setHero({ [key]: { ...objectOf(hero[key]), ...next } });

    const breadcrumb = objectsOf(hero.breadcrumb);
    const stats = objectsOf(hero.stats);
    const search = objectOf(hero.search);
    const chips = objectsOf(hero.popular);
    const resultsHeader = hero.resultsHeader ? objectOf(hero.resultsHeader) : null;
    const quickFilterBar = hero.quickFilterBar ? objectOf(hero.quickFilterBar) : null;
    const quickFilters = objectsOf(props.quickFilters);

    const setChips = (list: unknown[]) => setHero({ popular: list });
    const setChip = (index: number, chip: Props) =>
        setChips(replaceObject(hero.popular, index, chip));
    // Without the band only the results line and the quick-filter label are edited here.
    const band = hero.enabled === true;
    const chipLabel = (n: number) => t('catalogDesign.hero.chipN', { n });

    return (
        <DesignGroup
            title={t(band ? 'catalogDesign.hero.group' : 'catalogDesign.hero.groupResults')}
            hint={t(band ? 'catalogDesign.hero.groupHint' : 'catalogDesign.hero.groupResultsHint')}
        >
            {band && (
                <>
                    <TextField
                        label={t('catalogDesign.hero.title')}
                        value={textOf(hero.title)}
                        onChange={(v) => setHero({ title: v })}
                        hint={t('catalogDesign.hero.titleHint')}
                    />
                    <TextField
                        label={t('catalogDesign.hero.lead')}
                        value={textOf(hero.lead)}
                        onChange={(v) => setHero({ lead: v })}
                        multiline
                    />

                    <SubHeading
                        title={t('catalogDesign.hero.breadcrumb')}
                        hint={t('catalogDesign.hero.breadcrumbHint')}
                    />
                    {breadcrumb.map((item, index) => {
                        const name = t('catalogDesign.hero.crumbN', { n: index + 1 });
                        const isLast = index === breadcrumb.length - 1;
                        const setList = (list: unknown[]) => setHero({ breadcrumb: list });
                        return (
                            <ItemBox
                                key={index}
                                title={name}
                                actions={
                                    <RowActions
                                        index={index}
                                        count={breadcrumb.length}
                                        item={name}
                                        onMove={(d) =>
                                            setList(moveObject(hero.breadcrumb, index, d))
                                        }
                                        onRemove={() =>
                                            setList(removeObject(hero.breadcrumb, index))
                                        }
                                    />
                                }
                            >
                                <TextField
                                    label={t('catalogDesign.common.text')}
                                    value={textOf(item.label)}
                                    onChange={(v) =>
                                        setList(patchObject(hero.breadcrumb, index, { label: v }))
                                    }
                                />
                                {isLast ? (
                                    <p className="text-caption text-neutral-500">
                                        {t('catalogDesign.hero.crumbCurrent')}
                                    </p>
                                ) : (
                                    <LinkPicker
                                        label={t('catalogDesign.common.link')}
                                        value={textOf(item.route)}
                                        onChange={(v) =>
                                            setList(
                                                patchObject(hero.breadcrumb, index, { route: v })
                                            )
                                        }
                                    />
                                )}
                            </ItemBox>
                        );
                    })}
                    <AddButton
                        label={t('catalogDesign.hero.addCrumb')}
                        // Before the last item: that one is this page and stays last.
                        onClick={() =>
                            setHero({
                                breadcrumb: insertObject(hero.breadcrumb, breadcrumb.length - 1, {
                                    label: '',
                                }),
                            })
                        }
                    />

                    <SubHeading
                        title={t('catalogDesign.hero.stats')}
                        hint={t('catalogDesign.hero.statsHint')}
                    />
                    {stats.map((stat, index) => {
                        const name = t('catalogDesign.hero.statN', { n: index + 1 });
                        const setList = (list: unknown[]) => setHero({ stats: list });
                        return (
                            <ItemBox
                                key={index}
                                title={name}
                                actions={
                                    <RowActions
                                        index={index}
                                        count={stats.length}
                                        item={name}
                                        onMove={(d) => setList(moveObject(hero.stats, index, d))}
                                        onRemove={() => setList(removeObject(hero.stats, index))}
                                    />
                                }
                            >
                                <SelectField
                                    label={t('catalogDesign.hero.statKind')}
                                    value={textOf(stat.kind)}
                                    options={STAT_KINDS.map((k) => ({
                                        value: k,
                                        label: t(`catalogDesign.hero.statKinds.${k}`),
                                    }))}
                                    onChange={(v) =>
                                        setList(patchObject(hero.stats, index, { kind: v }))
                                    }
                                />
                                <TextField
                                    label={t('catalogDesign.hero.statLabel')}
                                    value={textOf(stat.label)}
                                    placeholder={t('catalogDesign.common.builtInText')}
                                    onChange={(v) =>
                                        setList(patchObject(hero.stats, index, { label: v }))
                                    }
                                />
                            </ItemBox>
                        );
                    })}
                    <AddButton
                        label={t('catalogDesign.hero.addStat')}
                        disabled={stats.length >= MAX_STATS}
                        onClick={() =>
                            setHero({ stats: appendObject(hero.stats, { kind: 'courses' }) })
                        }
                    />

                    <SubHeading title={t('catalogDesign.hero.search')} />
                    <ToggleField
                        label={t('catalogDesign.hero.searchOn')}
                        checked={search.enabled === true}
                        onChange={(v) => setHeroPart('search', { enabled: v })}
                    />
                    {search.enabled === true && (
                        <>
                            <TextField
                                label={t('catalogDesign.hero.searchPlaceholder')}
                                value={textOf(search.placeholder)}
                                placeholder={t('catalogDesign.common.builtInText')}
                                onChange={(v) => setHeroPart('search', { placeholder: v })}
                            />
                            <TextField
                                label={t('catalogDesign.hero.searchButton')}
                                value={textOf(search.buttonText)}
                                placeholder={t('catalogDesign.common.builtInText')}
                                onChange={(v) => setHeroPart('search', { buttonText: v })}
                            />
                        </>
                    )}

                    <SubHeading
                        title={t('catalogDesign.hero.popular')}
                        hint={t('catalogDesign.hero.popularHint')}
                    />
                    <TextField
                        label={t('catalogDesign.hero.popularLabel')}
                        value={textOf(hero.popularLabel)}
                        placeholder={t('catalogDesign.common.builtInText')}
                        onChange={(v) => setHero({ popularLabel: v })}
                    />
                    {chips.map((chip, index) => {
                        const name = chipLabel(index + 1);
                        const action = chipActionOf(chip);
                        const update = (next: Props) =>
                            setChips(patchObject(hero.popular, index, next));
                        const stream = streams.find((s) => s.slug === textOf(chip.streamSlug));
                        return (
                            <ItemBox
                                key={index}
                                title={textOf(chip.label) || name}
                                actions={
                                    <RowActions
                                        index={index}
                                        count={chips.length}
                                        item={name}
                                        onMove={(d) => setChips(moveObject(hero.popular, index, d))}
                                        onRemove={() => setChips(removeObject(hero.popular, index))}
                                    />
                                }
                            >
                                <TextField
                                    label={t('catalogDesign.common.text')}
                                    value={textOf(chip.label)}
                                    onChange={(v) => update({ label: v })}
                                />
                                <SelectField
                                    label={t('catalogDesign.hero.chipAction')}
                                    value={action}
                                    options={CHIP_ACTIONS.map((a) => ({
                                        value: a,
                                        label: t(`catalogDesign.hero.chipActions.${a}`),
                                    }))}
                                    onChange={(v) =>
                                        setChip(index, withChipAction(chip, v as ChipAction))
                                    }
                                />
                                {action === 'stream' && (
                                    <>
                                        <SelectField
                                            label={t('catalogDesign.common.stream')}
                                            value={textOf(chip.streamSlug)}
                                            emptyLabel={t('catalogDesign.common.pickStream')}
                                            options={streams.map((s) => ({
                                                value: s.slug,
                                                label: s.label,
                                            }))}
                                            // A category belongs to one stream: a new stream starts with none.
                                            onChange={(v) => {
                                                const next: Props = { ...chip, streamSlug: v };
                                                delete next.categorySlug;
                                                setChip(index, next);
                                            }}
                                        />
                                        <SelectField
                                            label={t('catalogDesign.common.category')}
                                            value={textOf(chip.categorySlug)}
                                            emptyLabel={t('catalogDesign.hero.wholeStream')}
                                            options={(stream?.categories ?? []).map((c) => ({
                                                value: c.slug,
                                                label: c.label,
                                            }))}
                                            onChange={(v) => {
                                                const next: Props = { ...chip, categorySlug: v };
                                                if (!v) delete next.categorySlug;
                                                setChip(index, next);
                                            }}
                                        />
                                        {streams.length === 0 && (
                                            <p className="text-caption text-neutral-500">
                                                {t('catalogDesign.common.noStreams')}
                                            </p>
                                        )}
                                    </>
                                )}
                                {action === 'quickFilter' && (
                                    <SelectField
                                        label={t('catalogDesign.hero.quickFilter')}
                                        value={textOf(chip.quickFilterId)}
                                        emptyLabel={t('catalogDesign.hero.pickQuickFilter')}
                                        options={quickFilters
                                            .filter((q) => textOf(q.id))
                                            .map((q) => ({
                                                value: textOf(q.id),
                                                label:
                                                    textOf(q.label) ||
                                                    textOf(q.kind) ||
                                                    textOf(q.id),
                                            }))}
                                        onChange={(v) => update({ quickFilterId: v })}
                                    />
                                )}
                                {action === 'search' && (
                                    <TextField
                                        label={t('catalogDesign.hero.searchValue')}
                                        value={textOf(chip.searchValue)}
                                        onChange={(v) => update({ searchValue: v })}
                                    />
                                )}
                                {action === 'link' && (
                                    <LinkPicker
                                        label={t('catalogDesign.common.link')}
                                        value={textOf(chip.route)}
                                        onChange={(v) => update({ route: v })}
                                    />
                                )}
                            </ItemBox>
                        );
                    })}
                    <AddButton
                        label={t('catalogDesign.hero.addChip')}
                        disabled={chips.length >= MAX_CHIPS}
                        onClick={() =>
                            setChips(appendObject(hero.popular, { label: '', streamSlug: '' }))
                        }
                    />
                </>
            )}

            {resultsHeader && (
                <>
                    <SubHeading
                        title={t('catalogDesign.hero.results')}
                        hint={t('catalogDesign.hero.resultsHint')}
                    />
                    <TextField
                        label={t('catalogDesign.hero.countText')}
                        value={textOf(resultsHeader.countText)}
                        placeholder={t('catalogDesign.common.builtInText')}
                        hint={t('catalogDesign.hero.countHint')}
                        onChange={(v) => setHeroPart('resultsHeader', { countText: v })}
                    />
                    <TextField
                        label={t('catalogDesign.hero.countTextOne')}
                        value={textOf(resultsHeader.countTextOne)}
                        placeholder={t('catalogDesign.common.builtInText')}
                        onChange={(v) => setHeroPart('resultsHeader', { countTextOne: v })}
                    />
                    <TextField
                        label={t('catalogDesign.hero.allStreamsLabel')}
                        value={textOf(resultsHeader.allStreamsLabel)}
                        placeholder={t('catalogDesign.common.builtInText')}
                        onChange={(v) => setHeroPart('resultsHeader', { allStreamsLabel: v })}
                    />
                    <TextField
                        label={t('catalogDesign.hero.sortPrefix')}
                        value={textOf(resultsHeader.sortPrefix)}
                        placeholder={t('catalogDesign.common.builtInText')}
                        onChange={(v) => setHeroPart('resultsHeader', { sortPrefix: v })}
                    />
                    <details className="rounded border border-neutral-100 p-2">
                        <summary className="cursor-pointer text-xs font-medium text-neutral-700">
                            {t('catalogDesign.hero.sortLabels')}
                        </summary>
                        <div className="mt-2 space-y-2">
                            {SORT_TOKENS.map((token) => (
                                <TextField
                                    key={token}
                                    label={t(`catalogDesign.hero.sort.${token}`)}
                                    value={textOf(objectOf(resultsHeader.sortLabels)[token])}
                                    placeholder={t('catalogDesign.common.builtInText')}
                                    onChange={(v) =>
                                        setHeroPart('resultsHeader', {
                                            sortLabels: setOrDelete(
                                                resultsHeader.sortLabels,
                                                token,
                                                v
                                            ),
                                        })
                                    }
                                />
                            ))}
                        </div>
                    </details>
                </>
            )}

            {quickFilterBar && (
                <TextField
                    label={t('catalogDesign.hero.quickFilterLabel')}
                    value={textOf(quickFilterBar.label)}
                    onChange={(v) => setHeroPart('quickFilterBar', { label: v })}
                />
            )}
        </DesignGroup>
    );
};
