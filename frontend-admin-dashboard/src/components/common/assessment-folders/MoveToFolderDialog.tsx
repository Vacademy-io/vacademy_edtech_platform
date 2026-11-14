import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CheckCircle, FolderMinus, Plus, ArrowLeft } from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';
import { reportApiError } from '@/lib/report-api-error';
import {
    AssessmentFolder,
    createAssessmentFolder,
    useAssessmentFolderLinks,
    useAssessmentFolders,
    useInvalidateAssessmentFolders,
    useMoveAssessmentsMutation,
} from '@/services/assessment-folders';
import { EMPTY_FOLDER_DRAFT, FolderDraft, FolderFormFields } from './FolderFormFields';
import { FolderThumb } from './FolderThumb';

/**
 * Pick the folder for one or more assessments, or create a new folder and put them
 * straight in it. `variant="afterPublish"` is the step shown right after an
 * assessment is published: it adds a Skip action and different wording.
 */
export const MoveToFolderDialog = ({
    open,
    onOpenChange,
    assessmentIds,
    assessmentName,
    currentFolderId: currentFolderIdProp,
    variant = 'move',
    onDone,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    assessmentIds: string[];
    assessmentName?: string;
    /** The assessments' folder; undefined = look it up (single assessment). */
    currentFolderId?: string | null;
    variant?: 'move' | 'afterPublish';
    /** Called after a successful move / create / skip, with the folder chosen (null = none). */
    onDone?: (folderId: string | null) => void;
}) => {
    const { t } = useTranslation('assessmentFolders');
    const { data: folders = [], isLoading: foldersLoading } = useAssessmentFolders(open);
    const lookUp = currentFolderIdProp === undefined && assessmentIds.length === 1;
    const { data: links, isLoading: linksLoading } = useAssessmentFolderLinks(
        assessmentIds,
        open && lookUp
    );
    const currentFolderId =
        currentFolderIdProp !== undefined
            ? currentFolderIdProp
            : links?.find((l) => l.assessment_id === assessmentIds[0])?.folder_id ?? null;
    const isLoading = foldersLoading || (lookUp && linksLoading);
    const moveMutation = useMoveAssessmentsMutation();
    const invalidate = useInvalidateAssessmentFolders();
    const [selected, setSelected] = useState<string | null>(currentFolderId);
    const [view, setView] = useState<'pick' | 'create'>('pick');
    const [draft, setDraft] = useState<FolderDraft>(EMPTY_FOLDER_DRAFT);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!open) return;
        setDraft(EMPTY_FOLDER_DRAFT);
        setView('pick');
    }, [open]);

    useEffect(() => {
        if (open) setSelected(currentFolderId);
    }, [open, currentFolderId]);

    // No folders yet: go straight to creating the first one.
    useEffect(() => {
        if (open && !isLoading && folders.length === 0) setView('create');
    }, [open, isLoading, folders.length]);

    const finish = (folderId: string | null) => {
        onOpenChange(false);
        onDone?.(folderId);
    };

    const handleMove = async () => {
        if (selected === currentFolderId) {
            finish(selected);
            return;
        }
        setSaving(true);
        try {
            await moveMutation.mutateAsync({ folderId: selected, assessmentIds });
            const target = folders.find((f) => f.id === selected);
            toast.success(target ? t('toast.moved', { name: target.name }) : t('toast.removed'));
            finish(selected);
        } catch (error) {
            reportApiError(error, {
                feature: 'assessment-folders',
                fallbackMessage: t('toast.error'),
            });
        } finally {
            setSaving(false);
        }
    };

    const handleCreate = async () => {
        const name = draft.name.trim();
        if (!name) {
            toast.error(t('form.nameRequired'));
            return;
        }
        setSaving(true);
        try {
            const folder = await createAssessmentFolder({
                name,
                description: draft.description.trim() || null,
                image_url: draft.image_url.trim() || null,
                status: draft.visible ? 'ACTIVE' : 'HIDDEN',
                assessment_ids: assessmentIds,
            });
            await invalidate();
            toast.success(t('toast.createdAndMoved', { name: folder.name }));
            finish(folder.id);
        } catch (error) {
            reportApiError(error, {
                feature: 'assessment-folders',
                fallbackMessage: t('toast.error'),
            });
        } finally {
            setSaving(false);
        }
    };

    const heading =
        view === 'create'
            ? t('form.createTitle')
            : variant === 'afterPublish'
              ? t('move.afterPublishTitle')
              : t('move.title');

    const footer =
        view === 'create' ? (
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
                {folders.length > 0 ? (
                    <MyButton
                        type="button"
                        buttonType="text"
                        scale="medium"
                        className="gap-1"
                        onClick={() => setView('pick')}
                    >
                        <ArrowLeft size={16} />
                        {t('move.back')}
                    </MyButton>
                ) : (
                    <span />
                )}
                <div className="flex gap-2">
                    {variant === 'afterPublish' ? (
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="medium"
                            onClick={() => finish(null)}
                        >
                            {t('move.skip')}
                        </MyButton>
                    ) : null}
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        disable={saving || !draft.name.trim()}
                        onClick={handleCreate}
                    >
                        {saving ? t('form.saving') : t('move.createAndAdd')}
                    </MyButton>
                </div>
            </div>
        ) : (
            <div className="flex w-full justify-end gap-2">
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="medium"
                    onClick={() =>
                        variant === 'afterPublish' ? finish(null) : onOpenChange(false)
                    }
                >
                    {variant === 'afterPublish' ? t('move.skip') : t('form.cancel')}
                </MyButton>
                <MyButton
                    type="button"
                    buttonType="primary"
                    scale="medium"
                    disable={saving || (variant === 'afterPublish' && !selected)}
                    onClick={handleMove}
                >
                    {saving
                        ? t('form.saving')
                        : variant === 'afterPublish'
                          ? t('move.add')
                          : t('move.move')}
                </MyButton>
            </div>
        );

    return (
        <MyDialog
            open={open}
            onOpenChange={(next) =>
                next
                    ? onOpenChange(true)
                    : variant === 'afterPublish'
                      ? finish(null)
                      : onOpenChange(false)
            }
            heading={heading}
            dialogWidth="max-w-lg"
            footer={footer}
        >
            <div className="flex flex-col gap-3">
                {assessmentName ? (
                    <p className="text-sm text-neutral-600">
                        {variant === 'afterPublish'
                            ? t('move.afterPublishHint', { name: assessmentName })
                            : t('move.hint', { name: assessmentName })}
                    </p>
                ) : null}

                {view === 'create' ? (
                    <FolderFormFields
                        value={draft}
                        onChange={(patch) => setDraft((prev) => ({ ...prev, ...patch }))}
                    />
                ) : (
                    <>
                        <div
                            role="radiogroup"
                            aria-label={t('move.title')}
                            className="flex max-h-80 flex-col gap-1 overflow-y-auto"
                        >
                            {isLoading ? (
                                <p className="py-6 text-center text-sm text-neutral-500">
                                    {t('rail.loading')}
                                </p>
                            ) : (
                                folders.map((folder: AssessmentFolder) => (
                                    <FolderOption
                                        key={folder.id}
                                        selected={selected === folder.id}
                                        onSelect={() => setSelected(folder.id)}
                                        title={folder.name}
                                        subtitle={t('rail.count', {
                                            count: folder.assessment_count,
                                        })}
                                        badge={
                                            folder.id === currentFolderId
                                                ? t('move.current')
                                                : folder.status === 'HIDDEN'
                                                  ? t('rail.hidden')
                                                  : undefined
                                        }
                                        icon={<FolderThumb imageUrl={folder.image_url} />}
                                    />
                                ))
                            )}
                            {variant === 'move' && currentFolderId ? (
                                <FolderOption
                                    selected={selected === null}
                                    onSelect={() => setSelected(null)}
                                    title={t('move.noFolder')}
                                    subtitle={t('move.noFolderHint')}
                                    icon={
                                        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-neutral-500">
                                            <FolderMinus size={18} />
                                        </span>
                                    }
                                />
                            ) : null}
                        </div>
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="medium"
                            className="w-full gap-1.5 border-dashed"
                            onClick={() => setView('create')}
                        >
                            <Plus size={16} />
                            {t('move.createNew')}
                        </MyButton>
                    </>
                )}
            </div>
        </MyDialog>
    );
};

const FolderOption = ({
    selected,
    onSelect,
    title,
    subtitle,
    badge,
    icon,
}: {
    selected: boolean;
    onSelect: () => void;
    title: string;
    subtitle?: string;
    badge?: string;
    icon: React.ReactNode;
}) => (
    <button
        type="button"
        role="radio"
        aria-checked={selected}
        onClick={onSelect}
        className={cn(
            'flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors',
            selected
                ? 'border-primary-500 bg-primary-50'
                : 'border-neutral-200 hover:border-primary-300 hover:bg-neutral-50'
        )}
    >
        {icon}
        <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-neutral-800">{title}</span>
            {subtitle ? (
                <span className="block truncate text-caption text-neutral-500">{subtitle}</span>
            ) : null}
        </span>
        {badge ? (
            <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-caption text-neutral-600">
                {badge}
            </span>
        ) : null}
        {selected ? (
            <CheckCircle size={20} weight="fill" className="shrink-0 text-primary-500" />
        ) : null}
    </button>
);
