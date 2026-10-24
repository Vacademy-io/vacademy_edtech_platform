import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getComponentTemplate, buildComponentTemplates } from '../-utils/component-templates';
import { componentLabel, componentDescription } from '../-utils/component-labels';
import { useEditorStore } from '../-stores/editor-store';
import { useDraggable } from '@dnd-kit/core';
import {
    Columns,
    ColumnsPlusLeft,
    DotsSixVertical,
    GridFour,
    GridNine,
    MagnifyingGlass,
    Plus,
    SquaresFour,
} from '@phosphor-icons/react';

// Layout presets — each maps a human label to the template key
const LAYOUT_PRESETS = [
    {
        key: 'columnLayout2',
        label: '2 Columns',
        description: '50 / 50',
        icon: <Columns className="size-4 shrink-0 text-teal-500" />,
    },
    {
        key: 'columnLayout2asymLeft',
        label: '2 Columns',
        description: '1/3 + 2/3',
        icon: <ColumnsPlusLeft className="size-4 shrink-0 text-teal-500" />,
    },
    {
        key: 'columnLayout3',
        label: '3 Columns',
        description: '33 / 33 / 33',
        icon: <GridNine className="size-4 shrink-0 text-teal-500" />,
    },
    {
        key: 'columnLayout4',
        label: '4 Columns',
        description: '25 / 25 / 25 / 25',
        icon: <SquaresFour className="size-4 shrink-0 text-teal-500" />,
    },
] as const;

// Template keys that are layout containers — excluded from the content list
const LAYOUT_KEYS = new Set<string>(LAYOUT_PRESETS.map((p) => p.key));

/**
 * The insert palette in the order an admin builds a page, not the order the
 * template file happens to declare things.
 *
 * A flat alphabetical-ish list of 40+ blocks is not browsable: the three that
 * show courses sat far apart, and the difference between them is where their
 * data comes from — which a name cannot carry. Grouping puts them side by side
 * so the choice is visible, and componentDescription() says what each one does.
 *
 * Any template key missing here still appears, under "More" — a new component
 * is never invisible just because nobody categorised it.
 */
const COMPONENT_GROUPS: { title: string; keys: string[] }[] = [
    {
        title: 'Page frame',
        keys: ['header', 'footer', 'heroSection', 'sectionHeading', 'spacer'],
    },
    {
        title: 'Courses & selling',
        keys: [
            'productPageOffer',
            'folderBrowser',
            'accessPassGrid',
            'learningPath',
            'courseCatalog',
            'productCourseGrid',
            'courseShowcase',
            'bookCatalogue',
            'pricingTable',
            'cartComponent',
            'buyRentSection',
            'courseDetails',
            'bookDetails',
        ],
    },
    {
        title: 'Why us',
        keys: [
            'featureGrid',
            'detailBlocks',
            'statsHighlights',
            'testimonialSection',
            'trustChip',
            'logoCloud',
            'teamSection',
            'stepsProcess',
        ],
    },
    {
        title: 'Ask the visitor',
        keys: ['promoPopup', 'leadForm', 'ctaBanner', 'contactForm', 'newsletterSignup', 'countdownTimer'],
    },
    {
        title: 'Media',
        keys: ['mediaShowcase', 'imageGallery', 'videoEmbed', 'documentViewer', 'imageBlock', 'marquee'],
    },
    {
        title: 'Answers & text',
        keys: [
            'blog',
            'jobOpenings',
            'faqSection',
            'tabsAccordion',
            'announcementFeed',
            'policyRenderer',
            'textBlock',
            'buttonBlock',
            'mapEmbed',
        ],
    },
    { title: 'Custom code', keys: ['htmlBlock', 'htmlPage'] },
];

/** Each component in the library is individually draggable */
const DraggableComponentItem = ({
    templateKey,
    label,
    description,
    onAdd,
    disabled,
    icon,
}: {
    templateKey: string;
    label: string;
    description: string;
    onAdd: (key: string) => void;
    disabled: boolean;
    icon?: React.ReactNode;
}) => {
    const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
        id: `library-${templateKey}`,
        data: { type: templateKey },
        disabled,
    });

    return (
        <div
            ref={setNodeRef}
            {...listeners}
            {...attributes}
            className={`flex items-center rounded border bg-white transition-opacity cursor-grab touch-none active:cursor-grabbing ${isDragging ? 'opacity-40' : 'opacity-100'}`}
        >
            {/* Drag handle icon */}
            <div className="px-2 py-3 text-gray-300">
                <DotsSixVertical className="size-4" />
            </div>

            {/* Click to add */}
            <button
                className="flex flex-1 items-start gap-2 px-2 py-3 text-left"
                onClick={(e) => { e.stopPropagation(); onAdd(templateKey); }}
                disabled={disabled}
            >
                {icon}
                <div className="flex flex-col items-start">
                    <span className="font-medium capitalize text-sm">{label}</span>
                    <span className="text-xs font-normal text-gray-400">
                        {disabled ? 'Select a page first' : description}
                    </span>
                </div>
            </button>

            {/* Quick-add button */}
            <button
                onClick={(e) => { e.stopPropagation(); onAdd(templateKey); }}
                disabled={disabled}
                className="px-2 py-3 text-gray-400 hover:text-gray-600 disabled:opacity-40"
                aria-label={`Add ${label}`}
            >
                <Plus className="size-4" />
            </button>
        </div>
    );
};

export const ComponentLibrary = () => {
    const { t } = useTranslation('managePagesComponentTemplates');
    const { addComponent, selectedPageId } = useEditorStore();
    const [query, setQuery] = useState('');

    const handleAdd = (templateKey: string) => {
        if (!selectedPageId) return;
        const component = getComponentTemplate(templateKey, t);
        addComponent(selectedPageId, component);
    };

    const contentTypes = useMemo(
        () => Object.keys(buildComponentTemplates(t)).filter((k) => !LAYOUT_KEYS.has(k)),
        [t]
    );

    // Search covers the description too, so "cart" finds Product Page Offer —
    // the block that actually carries a basket — and not just a name match.
    const q = query.trim().toLowerCase();
    const matches = (type: string) =>
        !q ||
        componentLabel(type).toLowerCase().includes(q) ||
        componentDescription(type).toLowerCase().includes(q) ||
        type.toLowerCase().includes(q);

    const grouped = COMPONENT_GROUPS.map((group) => ({
        title: group.title,
        // Intersect with what actually exists, so a key left behind by a
        // deleted template quietly disappears instead of rendering a dead row.
        keys: group.keys.filter((k) => contentTypes.includes(k) && matches(k)),
    })).filter((group) => group.keys.length > 0);

    const categorised = new Set(COMPONENT_GROUPS.flatMap((g) => g.keys));
    const uncategorised = contentTypes.filter((k) => !categorised.has(k) && matches(k));
    if (uncategorised.length > 0) grouped.push({ title: 'More', keys: uncategorised });

    const layoutPresets = LAYOUT_PRESETS.filter(
        (p) => !q || p.label.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)
    );

    const groupHeading = (text: string) => (
        <p className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
            {text}
        </p>
    );

    return (
        <div className="flex flex-col gap-1.5 overflow-y-auto p-3">
            <div className="relative">
                <MagnifyingGlass className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-gray-400" />
                <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search blocks"
                    className="ps-8"
                />
            </div>

            {/* ── Layout containers ── */}
            {layoutPresets.length > 0 && (
                <>
                    <p className="mb-1 mt-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-teal-600">
                        <GridFour className="size-3.5" /> Layout
                    </p>
                    {layoutPresets.map((preset) => (
                        <DraggableComponentItem
                            key={preset.key}
                            templateKey={preset.key}
                            label={preset.label}
                            description={preset.description}
                            icon={preset.icon}
                            onAdd={handleAdd}
                            disabled={!selectedPageId}
                        />
                    ))}
                </>
            )}

            {/* ── Content components, grouped by what they are for ── */}
            {grouped.map((group) => (
                <div key={group.title} className="flex flex-col gap-1.5">
                    {groupHeading(group.title)}
                    {group.keys.map((type) => (
                        <DraggableComponentItem
                            key={type}
                            templateKey={type}
                            label={componentLabel(type)}
                            description={componentDescription(type)}
                            onAdd={handleAdd}
                            disabled={!selectedPageId}
                        />
                    ))}
                </div>
            ))}

            {q && grouped.length === 0 && layoutPresets.length === 0 && (
                <p className="mt-4 text-center text-xs text-gray-400">
                    No block matches &ldquo;{query.trim()}&rdquo;.
                </p>
            )}
        </div>
    );
};
