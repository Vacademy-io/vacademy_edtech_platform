import { useTranslation } from 'react-i18next';
import { SearchableSelect } from '@/components/design-system/searchable-select';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { objectOf, setOrDelete, stringsOf, textOf, type Props } from './catalog-design-props';
import { DesignGroup, ItemBox, RowActions, SubHeading, TextField } from './design-fields';

/**
 * courseCatalog.render (card design): the texts on the editorial course cards
 * (button texts, format pill names, "Free", a short description per course),
 * the Load more button and the heading above the grid. An empty field removes
 * the override, so the site's own (translated) text shows again.
 * See the learner's catalog-cards-types.ts.
 */

const CTA_KINDS = ['paid', 'start', 'watch', 'read', 'listen', 'comingSoon'] as const;

export const cardGroupApplies = (props: Props): boolean => {
    const render = objectOf(props.render);
    return render.cardStyle === 'editorial' || !!render.card;
};

/** Format keys in the site's order: Site settings first, then any only the cards name. */
const formatKeysOf = (globalSettings: Props, formatLabels: Props): string[] => [
    ...new Set([
        ...stringsOf(globalSettings.courseFormatOrder),
        ...Object.keys(objectOf(globalSettings.courseFormats)),
        ...Object.keys(formatLabels),
    ]),
];

export const CardTextGroup = ({
    props,
    setNested,
    globalSettings,
}: {
    props: Props;
    setNested: (key: string, next: Props) => void;
    /** Base-language site settings (course formats), read-only. */
    globalSettings: Props;
}) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const { getCourseFromPackage } = useInstituteDetailsStore();
    const courses = getCourseFromPackage();
    const render = objectOf(props.render);
    const card = objectOf(render.card);
    const setRender = (next: Props) => setNested('render', next);
    const setCard = (next: Props) => setRender({ card: { ...card, ...next } });
    const setRenderPart = (key: string, next: Props) =>
        setRender({ [key]: { ...objectOf(render[key]), ...next } });

    const ctaLabels = objectOf(card.ctaLabels);
    const formatLabels = objectOf(card.formatLabels);
    const formats = objectOf(globalSettings.courseFormats);
    const descriptions = objectOf(card.descriptions);
    const described = Object.keys(descriptions);
    const pagination = objectOf(render.pagination);
    const gridHeading = render.gridHeading ? objectOf(render.gridHeading) : null;
    const courseName = (id: string) => courses.find((c) => c.id === id)?.name || id;

    return (
        <DesignGroup
            title={t('catalogDesign.cards.group')}
            hint={t('catalogDesign.cards.groupHint')}
        >
            <SubHeading title={t('catalogDesign.cards.buttons')} />
            {CTA_KINDS.map((kind) => (
                <TextField
                    key={kind}
                    label={t(`catalogDesign.cards.cta.${kind}`)}
                    value={textOf(ctaLabels[kind])}
                    placeholder={t('catalogDesign.common.builtInText')}
                    onChange={(v) => setCard({ ctaLabels: setOrDelete(card.ctaLabels, kind, v) })}
                />
            ))}
            <TextField
                label={t('catalogDesign.cards.freeLabel')}
                value={textOf(card.freeLabel)}
                placeholder={t('catalogDesign.common.builtInText')}
                onChange={(v) => setCard({ freeLabel: v })}
            />

            {formatKeysOf(globalSettings, formatLabels).length > 0 && (
                <>
                    <SubHeading
                        title={t('catalogDesign.cards.formatLabels')}
                        hint={t('catalogDesign.cards.formatLabelsHint')}
                    />
                    {formatKeysOf(globalSettings, formatLabels).map((key) => (
                        <TextField
                            key={key}
                            label={textOf(objectOf(formats[key]).label) || key}
                            value={textOf(formatLabels[key])}
                            placeholder={textOf(objectOf(formats[key]).label) || key}
                            onChange={(v) =>
                                setCard({ formatLabels: setOrDelete(card.formatLabels, key, v) })
                            }
                        />
                    ))}
                </>
            )}

            <SubHeading
                title={t('catalogDesign.cards.descriptions')}
                hint={t('catalogDesign.cards.descriptionsHint')}
            />
            {described.map((id, index) => {
                const name = courseName(id);
                return (
                    <ItemBox
                        key={id}
                        title={name}
                        actions={
                            <RowActions
                                index={index}
                                count={described.length}
                                item={name}
                                onRemove={() => {
                                    const next = { ...descriptions };
                                    delete next[id];
                                    setCard({ descriptions: next });
                                }}
                            />
                        }
                    >
                        <TextField
                            label={t('catalogDesign.cards.descriptionOf', { name })}
                            value={textOf(descriptions[id])}
                            onChange={(v) =>
                                setCard({ descriptions: { ...descriptions, [id]: v } })
                            }
                            multiline
                        />
                    </ItemBox>
                );
            })}
            <SearchableSelect
                options={courses
                    .filter((c) => !described.includes(c.id))
                    .map((c) => ({ value: c.id, label: c.name }))}
                value=""
                onChange={(id) => id && setCard({ descriptions: { ...descriptions, [id]: '' } })}
                placeholder={t('catalogDesign.cards.addDescription')}
                searchPlaceholder={t('catalogDesign.common.searchCourses')}
                emptyText={t('catalogDesign.common.noCourses')}
                triggerClassName="h-8 text-xs"
            />

            {pagination.mode === 'loadMore' && (
                <>
                    <SubHeading title={t('catalogDesign.cards.loadMore')} />
                    <TextField
                        label={t('catalogDesign.cards.loadMoreLabel')}
                        value={textOf(pagination.loadMoreLabel)}
                        placeholder={t('catalogDesign.common.builtInText')}
                        onChange={(v) => setRenderPart('pagination', { loadMoreLabel: v })}
                    />
                    <TextField
                        label={t('catalogDesign.cards.countLabel')}
                        value={textOf(pagination.countLabel)}
                        placeholder={t('catalogDesign.common.builtInText')}
                        // The tokens are literal text here, not values to fill in.
                        hint={t('catalogDesign.cards.countLabelHint', {
                            shown: '{{shown}}',
                            total: '{{total}}',
                        })}
                        onChange={(v) => setRenderPart('pagination', { countLabel: v })}
                    />
                </>
            )}

            {gridHeading && (
                <TextField
                    label={t('catalogDesign.cards.gridHeading')}
                    value={textOf(gridHeading.title)}
                    placeholder={t('catalogDesign.common.builtInText')}
                    onChange={(v) => setRenderPart('gridHeading', { title: v })}
                />
            )}
        </DesignGroup>
    );
};
