import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ArrowDown,
    ArrowUp,
    Copy,
    DotsSixVertical,
    DotsThreeVertical,
    Trash,
} from '@phosphor-icons/react';
import {
    DndContext,
    KeyboardSensor,
    PointerSensor,
    closestCenter,
    useSensor,
    useSensors,
    type DragEndEvent,
} from '@dnd-kit/core';
import {
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';
import {
    DESKTOP_PLACEMENTS,
    type CheckIssue,
    type DesktopPlacement,
    type HomeBlock,
} from '../-types/learner-home-types';
import { BUILTIN_INFO } from '../-utils/builtins';
import { errorsOf } from '../-utils/publish-checks';
import { useInstituteZone } from '../-hooks/usePickerOptions';
import { audienceChip, BLOCK_TYPE_ICON, blockName, scheduleChip } from './block-display';

interface BlockListProps {
    blocks: HomeBlock[];
    selectedKey: string | null;
    issues: CheckIssue[];
    onSelect: (key: string) => void;
    onMove: (from: number, to: number) => void;
    onToggle: (key: string, enabled: boolean) => void;
    onPlacement: (key: string, placement: DesktopPlacement) => void;
    onDuplicate: (key: string) => void;
    onDelete: (key: string) => void;
}

/** The sortable block list (spec 8.2): list order = phone order. */
export function BlockList({
    blocks,
    selectedKey,
    issues,
    onSelect,
    onMove,
    onToggle,
    onPlacement,
    onDuplicate,
    onDelete,
}: BlockListProps) {
    const { t } = useTranslation('learnerHome');
    const [pendingDelete, setPendingDelete] = useState<HomeBlock | null>(null);
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );
    const onDragEnd = (e: DragEndEvent) => {
        if (!e.over || e.active.id === e.over.id) return;
        const from = blocks.findIndex((b) => b.block_key === e.active.id);
        const to = blocks.findIndex((b) => b.block_key === e.over!.id);
        if (from >= 0 && to >= 0) onMove(from, to);
    };

    if (blocks.length === 0) {
        return (
            <p className="rounded-md border border-dashed border-neutral-300 p-4 text-center text-caption text-neutral-500">
                {t('list.empty')}
            </p>
        );
    }

    return (
        <>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext
                    items={blocks.map((b) => b.block_key)}
                    strategy={verticalListSortingStrategy}
                >
                    <ol className="space-y-2" aria-label={t('list.title')}>
                        {blocks.map((block, i) => (
                            <BlockRow
                                key={block.block_key}
                                block={block}
                                index={i}
                                count={blocks.length}
                                selected={block.block_key === selectedKey}
                                errorCount={
                                    errorsOf(issues.filter((x) => x.block_key === block.block_key))
                                        .length
                                }
                                onSelect={() => onSelect(block.block_key)}
                                onMove={onMove}
                                onToggle={(v) => onToggle(block.block_key, v)}
                                onPlacement={(p) => onPlacement(block.block_key, p)}
                                onDuplicate={() => onDuplicate(block.block_key)}
                                onDelete={() => setPendingDelete(block)}
                            />
                        ))}
                    </ol>
                </SortableContext>
            </DndContext>
            <AlertDialog
                open={!!pendingDelete}
                onOpenChange={(open) => !open && setPendingDelete(null)}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('list.deleteTitle')}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {pendingDelete
                                ? t('list.deleteBody', { name: blockName(pendingDelete, t) })
                                : ''}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('topbar.cancel')}</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => {
                                if (pendingDelete) onDelete(pendingDelete.block_key);
                                setPendingDelete(null);
                            }}
                        >
                            {t('list.delete')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}

function BlockRow({
    block,
    index,
    count,
    selected,
    errorCount,
    onSelect,
    onMove,
    onToggle,
    onPlacement,
    onDuplicate,
    onDelete,
}: {
    block: HomeBlock;
    index: number;
    count: number;
    selected: boolean;
    errorCount: number;
    onSelect: () => void;
    onMove: (from: number, to: number) => void;
    onToggle: (enabled: boolean) => void;
    onPlacement: (p: DesktopPlacement) => void;
    onDuplicate: () => void;
    onDelete: () => void;
}) {
    const { t, i18n } = useTranslation('learnerHome');
    const zone = useInstituteZone();
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: block.block_key,
    });
    const Icon = BLOCK_TYPE_ICON[block.type];
    const name = blockName(block, t);
    const builtin = block.type === 'BUILTIN' ? BUILTIN_INFO[block.builtin_widget] : null;
    const removable = builtin ? builtin.removable : true;
    const schedule = scheduleChip(block, t, zone, i18n.language);

    return (
        <li
            ref={setNodeRef}
            style={{ transform: CSS.Translate.toString(transform), transition }} // design-lint-ignore: drag offset is computed
            className={cn(
                'rounded-md border bg-card p-2 transition-shadow',
                selected ? 'border-primary-300 ring-1 ring-primary-200' : 'border-neutral-200',
                isDragging && 'z-10 shadow-lg',
                !block.enabled && 'bg-neutral-50'
            )}
        >
            <div className="flex items-start gap-1.5">
                <button
                    type="button"
                    className="mt-1 cursor-grab touch-none rounded-sm p-0.5 text-neutral-400 hover:text-neutral-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
                    aria-label={t('list.drag', { name })}
                    {...attributes}
                    {...listeners}
                >
                    <DotsSixVertical className="size-4" weight="bold" />
                </button>
                <button
                    type="button"
                    onClick={onSelect}
                    aria-current={selected ? 'true' : undefined}
                    className="min-w-0 flex-1 rounded-sm text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                    <span className="flex items-center gap-1.5">
                        <Icon
                            className={cn(
                                'size-4 shrink-0',
                                block.enabled ? 'text-primary-500' : 'text-neutral-400'
                            )}
                            aria-hidden
                        />
                        <span
                            className={cn(
                                'truncate text-body font-semibold',
                                !block.enabled && 'text-neutral-500'
                            )}
                        >
                            {name}
                        </span>
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1">
                        <Badge variant="outline" className="font-normal">
                            {block.type === 'BUILTIN'
                                ? t('blockTypes.BUILTIN')
                                : t(`blockTypes.${block.type}`)}
                        </Badge>
                        <Badge variant="outline" className="font-normal">
                            {audienceChip(block, t)}
                        </Badge>
                        {schedule && (
                            <Badge variant="outline" className="font-normal">
                                {schedule}
                            </Badge>
                        )}
                        {block.devices !== 'BOTH' && (
                            <Badge variant="outline" className="font-normal">
                                {t(`devices.${block.devices}`)}
                            </Badge>
                        )}
                        {builtin?.hiddenInFun && (
                            <Badge variant="secondary" className="font-normal">
                                {t('list.funBadge')}
                            </Badge>
                        )}
                        {errorCount > 0 && (
                            <Badge variant="destructive" className="font-normal">
                                {t('list.issues', { count: errorCount })}
                            </Badge>
                        )}
                    </span>
                </button>
                <Switch
                    checked={block.enabled}
                    onCheckedChange={onToggle}
                    aria-label={t('list.toggle', { name })}
                    className="mt-1"
                />
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <MyButton
                            type="button"
                            buttonType="text"
                            layoutVariant="icon"
                            scale="small"
                            aria-label={t('list.more', { name })}
                        >
                            <DotsThreeVertical className="size-4" weight="bold" />
                        </MyButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem
                            disabled={index === 0}
                            onSelect={() => onMove(index, index - 1)}
                        >
                            <ArrowUp className="me-2 size-4" aria-hidden />
                            {t('list.moveUp')}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            disabled={index === count - 1}
                            onSelect={() => onMove(index, index + 1)}
                        >
                            <ArrowDown className="me-2 size-4" aria-hidden />
                            {t('list.moveDown')}
                        </DropdownMenuItem>
                        {block.type !== 'BUILTIN' && (
                            <DropdownMenuItem onSelect={onDuplicate}>
                                <Copy className="me-2 size-4" aria-hidden />
                                {t('list.duplicate')}
                            </DropdownMenuItem>
                        )}
                        {removable && (
                            <DropdownMenuItem onSelect={onDelete} className="text-danger-600">
                                <Trash className="me-2 size-4" aria-hidden />
                                {t('list.delete')}
                            </DropdownMenuItem>
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
            <div className="mt-2 flex items-center gap-2 ps-6">
                <span className="text-caption text-neutral-500">{t('list.placement')}</span>
                <Select
                    value={block.desktop_placement}
                    onValueChange={(v) => onPlacement(v as DesktopPlacement)}
                >
                    <SelectTrigger
                        className="h-7 w-36 text-caption"
                        aria-label={`${t('list.placement')}: ${name}`}
                    >
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {DESKTOP_PLACEMENTS.map((p) => (
                            <SelectItem key={p} value={p}>
                                {t(`placement.${p}`)}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
        </li>
    );
}
