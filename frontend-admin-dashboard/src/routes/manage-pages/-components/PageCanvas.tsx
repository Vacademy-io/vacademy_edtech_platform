/**
 * PageCanvas — the canvas's "Structure" view: an honest outline of the page.
 *
 * One row per block (its name, the first heading a visitor reads, what it is
 * made of, and a Hidden badge), between the site header and footer. The look
 * of the page lives in the Website view (LiveSiteFrame, the real site); this
 * view is for order and picking a block.
 *
 * - Click a row to edit that block.
 * - Drag a row by its handle (or focus the handle and press ↑ / ↓) to move it.
 *   Native drag events, so it never mixes with the library's dnd-kit drags.
 * - Drag a block from the library onto the outline to add it at the end, or
 *   onto a column of a column layout to add it there (same drop ids as before).
 * - "Show previews" draws each block's look-alike picture (BlockPreview) in its
 *   row: the visual canvas for an institute whose Website view cannot load.
 */
import {
    useEffect,
    useRef,
    useState,
    type DragEvent,
    type KeyboardEvent,
    type ReactNode,
} from 'react';
import { useDroppable } from '@dnd-kit/core';
import { DotsSixVertical, EyeSlash } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { Switch } from '@/components/ui/switch';
import { useEditorStore } from '../-stores/editor-store';
import { useLocalizedView } from '../-hooks/use-localized-editing';
import type { CatalogueConfig, Component } from '../-types/editor-types';
import { componentLabel } from '../-utils/component-labels';
import { firstHeading, moveItem } from '../-utils/block-summary';
import { collectConfigFontFamilies, ensureFontsLoaded } from '../-utils/catalogue-fonts';
import { describeCatalogFeatures } from './ComponentPreviews';
import { BlockPreview, PreviewSurface } from './BlockPreview';

interface PageCanvasProps {
    /** The canvas's own 'canvas-drop-zone' droppable — owned by CanvasRenderer. */
    dropRef: (node: HTMLElement | null) => void;
    isDropOver: boolean;
    /** Draw each block's look-alike preview in its row. */
    showPreviews?: boolean;
    onShowPreviewsChange?: (on: boolean) => void;
    /** The Website view failed to load for this institute: say why previews are on. */
    websiteUnavailable?: boolean;
}

/** A block's preview inside a row, in the site's theme. */
const RowPreview = ({ config, component }: { config: CatalogueConfig | null; component: Component }) => (
    <div className="mt-2 overflow-hidden rounded-md border border-neutral-200">
        <PreviewSurface config={config}>
            <BlockPreview component={component} />
        </PreviewSurface>
    </div>
);

/** Column layouts show their columns side by side, up to four across. */
const COLUMN_GRID: Record<number, string> = {
    1: 'grid-cols-1',
    2: 'grid-cols-2',
    3: 'grid-cols-3',
    4: 'grid-cols-4',
};

const HiddenBadge = () => {
    const { t } = useTranslation('managePagesPageCanvas');
    return (
        <span
            className="flex shrink-0 items-center gap-1 rounded bg-neutral-100 px-1.5 py-0.5 text-caption font-medium text-neutral-600"
            title={t('structure.hiddenTitle')}
        >
            <EyeSlash className="size-3" />
            {t('structure.hidden')}
        </span>
    );
};

/** Name, first heading and summary of one block — the body of every row. */
const BlockText = ({ component, summary }: { component: Component; summary?: string }) => {
    const { t } = useTranslation('managePagesPageCanvas');
    const heading = firstHeading(component);
    return (
        <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold text-neutral-800">
                    {componentLabel(component.type)}
                </span>
                {component.enabled === false && <HiddenBadge />}
            </div>
            <div
                className={`truncate text-xs ${heading ? 'text-neutral-600' : 'italic text-neutral-400'}`}
            >
                {heading || t('structure.noHeading')}
            </div>
            {summary && <div className="truncate text-caption text-neutral-500">{summary}</div>}
        </div>
    );
};

/** A column of a column layout: its blocks, and a drop target for new ones. */
const ColumnSlot = ({
    layoutId,
    index,
    blocks,
    previewConfig,
}: {
    layoutId: string;
    index: number;
    blocks: Component[];
    /** Set when previews are on: the site whose theme they are drawn in. */
    previewConfig?: CatalogueConfig | null;
}) => {
    const { t } = useTranslation('managePagesPageCanvas');
    const { selectedComponentId, selectComponent } = useEditorStore();
    // '::' separates the ids — component ids only contain [a-z0-9-].
    const { setNodeRef, isOver } = useDroppable({ id: `slot::${layoutId}::${index}` });
    return (
        <div
            ref={setNodeRef}
            className={`rounded-md border border-dashed p-2 ${
                isOver ? 'border-primary-400 bg-primary-50' : 'border-neutral-200'
            }`}
        >
            <div className="mb-1 text-caption font-semibold uppercase text-neutral-500">
                {t('structure.column', { index: index + 1 })}
            </div>
            {blocks.length === 0 && (
                <div className="text-caption text-neutral-400">{t('structure.emptyColumn')}</div>
            )}
            <div className="flex flex-col gap-1">
                {blocks.map((child) => (
                    // The preview sits beside the button, never inside it: it
                    // draws the block's own buttons and links.
                    <div
                        key={child.id}
                        onClick={(e) => {
                            e.stopPropagation();
                            selectComponent(child.id);
                        }}
                        className={`cursor-pointer rounded border bg-white px-2 py-1 ${
                            child.id === selectedComponentId
                                ? 'border-primary-500 ring-1 ring-primary-200'
                                : 'border-neutral-200 hover:border-primary-300'
                        }`}
                    >
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                selectComponent(child.id);
                            }}
                            className="flex w-full rounded text-start"
                        >
                            <BlockText component={child} />
                        </button>
                        {previewConfig !== undefined && (
                            <RowPreview config={previewConfig} component={child} />
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};

/** Site header / footer: shared by every page, so it has no drag handle. */
const ChromeRow = ({
    section,
    component,
    previewConfig,
}: {
    section: 'header' | 'footer';
    component: Component;
    previewConfig?: CatalogueConfig | null;
}) => {
    const { t } = useTranslation('managePagesPageCanvas');
    const { selectedGlobalLayout, selectGlobalLayout } = useEditorStore();
    const select = (e: { stopPropagation: () => void }) => {
        e.stopPropagation();
        selectGlobalLayout(section);
    };
    return (
        <div
            onClick={select}
            className={`cursor-pointer rounded-lg border border-dashed bg-white px-3 py-2 ${
                selectedGlobalLayout === section
                    ? 'border-primary-500 ring-2 ring-primary-200'
                    : 'border-neutral-300 hover:border-primary-300'
            }`}
        >
            <button type="button" onClick={select} className="flex w-full min-w-0 flex-col rounded text-start">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-neutral-800">
                        {t(section === 'header' ? 'structure.header' : 'structure.footer')}
                    </span>
                    <span className="text-caption text-neutral-500">
                        {t('structure.everyPage')}
                    </span>
                    {component.enabled === false && <HiddenBadge />}
                </div>
                <div className="truncate text-xs text-neutral-600">{firstHeading(component)}</div>
            </button>
            {previewConfig !== undefined && <RowPreview config={previewConfig} component={component} />}
        </div>
    );
};

export const PageCanvas = ({
    dropRef,
    isDropOver,
    showPreviews = false,
    onShowPreviewsChange,
    websiteUnavailable = false,
}: PageCanvasProps) => {
    const { t } = useTranslation('managePagesPageCanvas');
    const { t: tPreviews } = useTranslation('managePagesComponentPreviews');
    const {
        config: storeConfig,
        editingLocale,
        selectedPageId,
        selectedComponentId,
        selectComponent,
        reorderComponents,
    } = useEditorStore();
    // Headings read in the language being edited; order is shared by all
    // languages, so moves are applied to the stored (base) blocks.
    const config = useLocalizedView(storeConfig, editingLocale);
    const page = config?.pages.find((p) => p.id === selectedPageId);
    const layout = config?.globalSettings?.layout;
    // undefined = previews off; otherwise the site they are drawn in.
    const previewConfig = showPreviews ? (config ?? null) : undefined;

    // Previews show the site's real typography: load the fonts it uses.
    useEffect(() => {
        if (showPreviews && config) ensureFontsLoaded(collectConfigFontFamilies(config));
    }, [showPreviews, config]);

    const [draggingId, setDraggingId] = useState<string | null>(null);
    const [overIndex, setOverIndex] = useState<number | null>(null);
    const rowRefs = useRef(new Map<string, HTMLElement>());

    // Keep the selected block in view when it is picked elsewhere (Layers).
    useEffect(() => {
        if (selectedComponentId) {
            rowRefs.current.get(selectedComponentId)?.scrollIntoView?.({ block: 'nearest' });
        }
    }, [selectedComponentId]);

    const moveBlock = (blockId: string, to: number) => {
        const blocks = storeConfig?.pages.find((p) => p.id === selectedPageId)?.components ?? [];
        const next = moveItem(
            blocks,
            blocks.findIndex((b) => b.id === blockId),
            to
        );
        if (next && selectedPageId) reorderComponents(selectedPageId, next);
    };

    const endDrag = () => {
        setDraggingId(null);
        setOverIndex(null);
    };

    // Every row is a drop target; only the handle starts a drag, so dragging a
    // block inside a column never drags its whole column layout.
    const rowDropProps = (index: number) => ({
        onDragOver: (e: DragEvent) => {
            if (!draggingId) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            setOverIndex(index);
        },
        onDrop: (e: DragEvent) => {
            if (!draggingId) return;
            e.preventDefault();
            moveBlock(draggingId, index);
            endDrag();
        },
    });

    const handleDragProps = (blockId: string) => ({
        draggable: true,
        onDragStart: (e: DragEvent) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', blockId);
            // Show the whole row under the pointer, not just the handle.
            const row = rowRefs.current.get(blockId);
            if (row) e.dataTransfer.setDragImage?.(row, 16, 16);
            setDraggingId(blockId);
        },
        onDragEnd: endDrag,
    });

    const onHandleKey = (e: KeyboardEvent, index: number, blockId: string) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        // The handle keeps focus: React refocuses it after moving its row.
        moveBlock(blockId, e.key === 'ArrowUp' ? index - 1 : index + 1);
    };

    let body: ReactNode;
    if (!config || !page) {
        body = (
            <p className="py-16 text-center text-sm text-neutral-500">{t('structure.noPage')}</p>
        );
    } else if (page.components.length === 0) {
        body = (
            <p className="rounded-lg border-2 border-dashed border-neutral-300 px-6 py-12 text-center text-sm text-neutral-500">
                {t('structure.empty')}
            </p>
        );
    } else {
        const draggingIndex = page.components.findIndex((b) => b.id === draggingId);
        body = (
            <ol
                className="flex flex-col gap-2"
                aria-label={t('structure.blockCount', { count: page.components.length })}
            >
                {page.components.map((block, index) => {
                    const isSelected = block.id === selectedComponentId;
                    const slots =
                        block.type === 'columnLayout' && Array.isArray(block.props?.slots)
                            ? (block.props.slots as Component[][])
                            : null;
                    const summary = slots
                        ? t('structure.columns', { count: slots.length })
                        : block.type === 'courseCatalog'
                          ? describeCatalogFeatures(block.props, tPreviews)
                          : '';
                    // Where the dragged row will land: a line on that side.
                    const dropLine =
                        overIndex === index && draggingIndex !== -1 && draggingIndex !== index
                            ? draggingIndex > index
                                ? 'border-t-primary-500'
                                : 'border-b-primary-500'
                            : '';
                    return (
                        <li
                            key={block.id}
                            ref={(node) => {
                                if (node) rowRefs.current.set(block.id, node);
                                else rowRefs.current.delete(block.id);
                            }}
                            data-block-id={block.id}
                            {...rowDropProps(index)}
                            onClick={(e) => {
                                e.stopPropagation();
                                selectComponent(block.id);
                            }}
                            className={`cursor-pointer rounded-lg border-2 bg-white p-2 transition-colors ${
                                isSelected
                                    ? 'border-primary-500'
                                    : 'border-neutral-200 hover:border-primary-300'
                            } ${dropLine} ${draggingId === block.id ? 'opacity-50' : ''}`}
                        >
                            <div className="flex items-center gap-2">
                                {/* A span, not a <button>: Firefox will not start a
                                    drag from a button. */}
                                <span
                                    role="button"
                                    tabIndex={0}
                                    {...handleDragProps(block.id)}
                                    className="flex shrink-0 cursor-grab items-center rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 active:cursor-grabbing"
                                    aria-label={t('structure.dragHandle', {
                                        name: componentLabel(block.type),
                                    })}
                                    title={t('structure.dragHandle', {
                                        name: componentLabel(block.type),
                                    })}
                                    onClick={(e) => e.stopPropagation()}
                                    onKeyDown={(e) => onHandleKey(e, index, block.id)}
                                >
                                    <DotsSixVertical className="size-4" weight="bold" />
                                </span>
                                <span className="w-5 shrink-0 text-center text-caption text-neutral-400">
                                    {index + 1}
                                </span>
                                {/* A real button, so the keyboard can open the block too. */}
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        selectComponent(block.id);
                                    }}
                                    className="flex min-w-0 flex-1 rounded text-start"
                                >
                                    <BlockText component={block} summary={summary} />
                                </button>
                            </div>
                            {/* A column layout previews each column's blocks instead. */}
                            {previewConfig !== undefined && !slots && (
                                <RowPreview config={previewConfig} component={block} />
                            )}
                            {slots && (
                                <div
                                    className={`mt-2 grid gap-2 ps-14 ${COLUMN_GRID[Math.min(slots.length, 4)] ?? ''}`}
                                >
                                    {slots.map((slotBlocks, slotIndex) => (
                                        <ColumnSlot
                                            key={slotIndex}
                                            layoutId={block.id}
                                            index={slotIndex}
                                            blocks={Array.isArray(slotBlocks) ? slotBlocks : []}
                                            previewConfig={previewConfig}
                                        />
                                    ))}
                                </div>
                            )}
                        </li>
                    );
                })}
            </ol>
        );
    }

    return (
        <div
            ref={dropRef}
            className={`flex flex-1 justify-center overflow-auto p-6 transition-colors ${isDropOver ? 'bg-primary-50' : ''}`}
            onClick={() => selectComponent(null)}
        >
            <div className={`flex w-full flex-col gap-2 ${showPreviews ? 'max-w-6xl' : 'max-w-3xl'}`}>
                <div className="flex items-start justify-between gap-4">
                    <p className="text-xs text-neutral-500">{t('structure.intro')}</p>
                    {onShowPreviewsChange && (
                        <label
                            className="flex shrink-0 cursor-pointer items-center gap-2 text-xs font-medium text-neutral-700"
                            title={t('structure.showPreviewsTitle')}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <Switch
                                checked={showPreviews}
                                onCheckedChange={onShowPreviewsChange}
                                aria-label={t('structure.showPreviews')}
                            />
                            {t('structure.showPreviews')}
                        </label>
                    )}
                </div>
                {websiteUnavailable && showPreviews && (
                    <p role="status" className="rounded-md border border-warning-200 bg-warning-50 px-3 py-2 text-xs text-warning-700">
                        {t('structure.previewsAuto')}
                    </p>
                )}
                {layout?.header && (
                    <ChromeRow
                        section="header"
                        component={layout.header as Component}
                        previewConfig={layout.header.enabled === false ? undefined : previewConfig}
                    />
                )}
                {body}
                {isDropOver && (
                    <div className="rounded-lg border-2 border-dashed border-primary-400 p-3 text-center text-xs text-primary-600">
                        {t('structure.dropHere')}
                    </div>
                )}
                {layout?.footer && (
                    <ChromeRow
                        section="footer"
                        component={layout.footer as Component}
                        previewConfig={layout.footer.enabled === false ? undefined : previewConfig}
                    />
                )}
            </div>
        </div>
    );
};
