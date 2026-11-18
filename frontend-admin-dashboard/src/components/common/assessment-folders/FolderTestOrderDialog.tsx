import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { arrayMove } from '@dnd-kit/sortable';
import { ArrowDown, ArrowUp, DotsSixVertical } from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import { Sortable, SortableDragHandle, SortableItem } from '@/components/ui/sortable';
import { cn } from '@/lib/utils';
import { reportApiError } from '@/lib/report-api-error';
import {
    AssessmentFolder,
    FolderTestOrderItem,
    FolderTestOrderMode,
    compareTestNames,
    saveFolderTestOrder,
    useFolderTestOrder,
    useInvalidateAssessmentFolders,
} from '@/services/assessment-folders';

type Row = FolderTestOrderItem & { id: string };

const toRows = (items: FolderTestOrderItem[]): Row[] =>
    items.map((item) => ({ ...item, id: item.assessment_id }));

const sortByName = (rows: Row[]) => [...rows].sort((a, b) => compareTestNames(a.name, b.name));

/**
 * The order students see a folder's tests in: by name (A to Z, the default) or an order
 * arranged here by drag or the arrows. Moving a test switches to the arranged order.
 */
export const FolderTestOrderDialog = ({
    folder,
    onOpenChange,
}: {
    /** The folder to arrange; null = closed. */
    folder: AssessmentFolder | null;
    onOpenChange: (open: boolean) => void;
}) => {
    const { t } = useTranslation('assessmentFolders');
    const open = !!folder;
    const folderId = folder?.id;
    const { data, isError, isFetching, refetch } = useFolderTestOrder(folderId);
    const invalidate = useInvalidateAssessmentFolders();
    const [mode, setMode] = useState<FolderTestOrderMode>('NAME');
    // The arranged order; shown A to Z while "By name" is picked, kept for switching back.
    const [customRows, setCustomRows] = useState<Row[]>([]);
    const [loadedFor, setLoadedFor] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    // Take the saved order once per opening, after the fresh fetch, so an earlier
    // cancelled edit or a cached copy never shows.
    useEffect(() => {
        if (!folderId) {
            setLoadedFor(null);
            return;
        }
        if (!data || isFetching || loadedFor === folderId || data.folder_id !== folderId) return;
        setMode(data.mode);
        setCustomRows(toRows(data.assessments));
        setLoadedFor(folderId);
    }, [folderId, data, isFetching, loadedFor]);

    const ready = !!folderId && loadedFor === folderId;
    const rows = useMemo(
        () => (mode === 'NAME' ? sortByName(customRows) : customRows),
        [mode, customRows]
    );
    const hasDrafts = rows.some((row) => row.status === 'DRAFT');

    const move = (from: number, to: number) => {
        if (from === to || to < 0 || to >= rows.length) return;
        setCustomRows(arrayMove(rows, from, to));
        setMode('CUSTOM');
    };

    const save = async () => {
        if (!folder) return;
        setSaving(true);
        try {
            await saveFolderTestOrder(
                folder.id,
                mode,
                rows.map((row) => row.id)
            );
            await invalidate();
            toast.success(t('order.saved'));
            onOpenChange(false);
        } catch (error) {
            reportApiError(error, {
                feature: 'assessment-folders',
                fallbackMessage: t('toast.error'),
            });
        } finally {
            setSaving(false);
        }
    };

    const modes: { value: FolderTestOrderMode; title: string; hint: string }[] = [
        { value: 'NAME', title: t('order.byName'), hint: t('order.byNameHint') },
        { value: 'CUSTOM', title: t('order.custom'), hint: t('order.customHint') },
    ];

    const renderList = () => {
        if (isError && !ready) {
            return (
                <div className="flex flex-col items-center gap-3 rounded-lg border border-neutral-200 p-6 text-center">
                    <p className="text-sm text-neutral-600">{t('order.loadError')}</p>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="small"
                        onClick={() => refetch()}
                    >
                        {t('order.retry')}
                    </MyButton>
                </div>
            );
        }
        if (!ready) {
            return (
                <div className="flex flex-col gap-2" aria-busy="true">
                    {[0, 1, 2, 3].map((i) => (
                        <Skeleton key={i} className="h-10 w-full rounded-lg" />
                    ))}
                </div>
            );
        }
        if (rows.length === 0) {
            return (
                <p className="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500">
                    {t('order.empty')}
                </p>
            );
        }
        return (
            <Sortable
                value={rows}
                onMove={({ activeIndex, overIndex }) => move(activeIndex, overIndex)}
            >
                <ol className="flex flex-col gap-1.5" aria-label={t('order.listLabel')}>
                    {rows.map((row, index) => (
                        <SortableItem key={row.id} value={row.id} asChild>
                            <li className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white py-1.5 pl-1 pr-2">
                                <SortableDragHandle
                                    variant="ghost"
                                    size="icon"
                                    className="size-7 shrink-0 text-neutral-400 hover:text-neutral-700"
                                    aria-label={t('order.drag', { name: row.name })}
                                    title={t('order.drag', { name: row.name })}
                                >
                                    <DotsSixVertical size={16} />
                                </SortableDragHandle>
                                <span className="w-6 shrink-0 text-right text-caption tabular-nums text-neutral-500">
                                    {index + 1}
                                </span>
                                <span
                                    className="min-w-0 flex-1 truncate text-sm text-neutral-800"
                                    title={row.name}
                                >
                                    {row.name}
                                </span>
                                {row.status === 'DRAFT' ? (
                                    <Badge variant="outline" className="shrink-0 text-neutral-500">
                                        {t('order.draft')}
                                    </Badge>
                                ) : null}
                                <div className="flex shrink-0 items-center">
                                    <MyButton
                                        type="button"
                                        buttonType="text"
                                        layoutVariant="icon"
                                        scale="small"
                                        aria-label={t('order.moveUp', { name: row.name })}
                                        disable={index === 0}
                                        onClick={() => move(index, index - 1)}
                                    >
                                        <ArrowUp size={14} />
                                    </MyButton>
                                    <MyButton
                                        type="button"
                                        buttonType="text"
                                        layoutVariant="icon"
                                        scale="small"
                                        aria-label={t('order.moveDown', { name: row.name })}
                                        disable={index === rows.length - 1}
                                        onClick={() => move(index, index + 1)}
                                    >
                                        <ArrowDown size={14} />
                                    </MyButton>
                                </div>
                            </li>
                        </SortableItem>
                    ))}
                </ol>
            </Sortable>
        );
    };

    return (
        <MyDialog
            open={open}
            onOpenChange={onOpenChange}
            heading={t('order.title')}
            dialogWidth="max-w-lg"
            footer={
                <div className="flex w-full justify-end gap-2">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => onOpenChange(false)}
                    >
                        {t('form.cancel')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        disable={!ready || saving}
                        onClick={save}
                    >
                        {saving ? t('form.saving') : t('form.save')}
                    </MyButton>
                </div>
            }
        >
            <div className="flex flex-col gap-4">
                <p className="text-sm text-neutral-600">
                    {t('order.hint', { name: folder?.name ?? '' })}
                </p>
                <RadioGroup
                    value={mode}
                    onValueChange={(value) => setMode(value as FolderTestOrderMode)}
                    aria-label={t('order.title')}
                    className="gap-2"
                >
                    {modes.map((option) => (
                        <label
                            key={option.value}
                            htmlFor={`folder-test-order-${option.value}`}
                            className={cn(
                                'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
                                mode === option.value
                                    ? 'border-primary-500 bg-primary-50'
                                    : 'border-neutral-200 hover:border-primary-300'
                            )}
                        >
                            <RadioGroupItem
                                id={`folder-test-order-${option.value}`}
                                value={option.value}
                                className="mt-0.5 shrink-0"
                            />
                            <span className="min-w-0">
                                <span className="block text-sm font-medium text-neutral-800">
                                    {option.title}
                                </span>
                                <span className="block text-caption text-neutral-500">
                                    {option.hint}
                                </span>
                            </span>
                        </label>
                    ))}
                </RadioGroup>
                {renderList()}
                {ready && hasDrafts ? (
                    <p className="text-caption text-neutral-500">{t('order.draftNote')}</p>
                ) : null}
            </div>
        </MyDialog>
    );
};
