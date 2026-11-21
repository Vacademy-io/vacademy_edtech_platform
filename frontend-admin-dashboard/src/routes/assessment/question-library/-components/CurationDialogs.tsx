import { useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Buildings, Eye, EyeSlash, WarningCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { MyDropdown } from '@/components/design-system/dropdown';
import { MyInput } from '@/components/design-system/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
    LIBRARY_TAG_KINDS,
    hideLibraryTopic,
    libraryErrorMessage,
    showLibraryTopic,
    useLibraryAccess,
    useLibraryRefresh,
    type LibraryNode,
    type LibraryTag,
    type LibraryTagKind,
} from '../-services/question-library-services';
import { LibraryTagChip } from './LibraryQuestionFilters';

/**
 * Which institutes see one course or topic. An institute sees only what it is given here,
 * with everything below it, and nothing else of the library.
 */
export const InstituteAccessDialog = ({
    open,
    onOpenChange,
    instituteId,
    node,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    instituteId: string;
    node: LibraryNode;
}) => {
    const { t } = useTranslation('assessmentQuestionLibrary');
    const access = useLibraryAccess(instituteId, node.id);
    const refresh = useLibraryRefresh();
    const [newId, setNewId] = useState('');
    const [removing, setRemoving] = useState<string | null>(null);
    const rows = access.data ?? [];

    const give = async () => {
        const target = newId.trim();
        if (!target) return;
        try {
            const added = await hideLibraryTopic(instituteId, {
                node_id: node.id,
                institute_id: target,
            });
            toast.success(
                t('access.given', { name: added.institute_name ?? target, topic: node.name })
            );
            setNewId('');
            refresh();
        } catch (error) {
            toast.error(libraryErrorMessage(error, t('toasts.failed')));
        }
    };

    const takeBack = async (target: string, name: string) => {
        setRemoving(target);
        try {
            await showLibraryTopic(instituteId, { node_id: node.id, institute_id: target });
            toast.success(t('access.removed', { name, topic: node.name }));
            refresh();
        } catch (error) {
            toast.error(libraryErrorMessage(error, t('toasts.failed')));
        } finally {
            setRemoving(null);
        }
    };

    return (
        <MyDialog
            heading={t('access.title', { name: node.name })}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-xl"
            footer={
                <MyButton buttonType="secondary" scale="medium" onClick={() => onOpenChange(false)}>
                    {t('common.close')}
                </MyButton>
            }
        >
            <div className="flex flex-col gap-4">
                <p className="text-caption text-neutral-500">{t('access.hint')}</p>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                    <div className="min-w-0 flex-1">
                        <MyInput
                            label={t('access.idLabel')}
                            inputType="text"
                            inputPlaceholder={t('access.idPlaceholder')}
                            input={newId}
                            onChangeFunction={(e) => setNewId(e.target.value)}
                            onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    void give();
                                }
                            }}
                            className="sm:w-full"
                        />
                    </div>
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        disable={!newId.trim()}
                        onAsyncClick={give}
                    >
                        {t('access.give')}
                    </MyButton>
                </div>

                {access.isLoading ? (
                    <div className="flex flex-col gap-2">
                        {[0, 1].map((i) => (
                            <Skeleton key={i} className="h-12 w-full rounded-md" />
                        ))}
                    </div>
                ) : access.isError ? (
                    <div className="flex items-center gap-2 rounded-md border border-danger-200 bg-danger-50 p-3 text-body text-neutral-700">
                        <WarningCircle size={18} className="text-danger-600" />
                        <span className="flex-1">{t('access.loadError')}</span>
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            onClick={() => access.refetch()}
                        >
                            {t('common.retry')}
                        </MyButton>
                    </div>
                ) : rows.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-neutral-300 p-6 text-center">
                        <EyeSlash size={28} className="text-neutral-300" />
                        <span className="text-body text-neutral-600">{t('access.empty')}</span>
                    </div>
                ) : (
                    <ul className="flex max-h-72 flex-col divide-y divide-neutral-100 overflow-y-auto rounded-md border border-neutral-200">
                        {rows.map((row) => {
                            const name = row.institute_name || row.institute_id;
                            return (
                                <li key={row.institute_id} className="flex items-center gap-3 p-3">
                                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-info-50 text-info-600">
                                        <Buildings size={16} />
                                    </span>
                                    <span className="flex min-w-0 flex-1 flex-col">
                                        <span className="truncate text-body font-semibold text-neutral-700">
                                            {name}
                                        </span>
                                        <span className="truncate text-caption text-neutral-500">
                                            {row.institute_id}
                                        </span>
                                    </span>
                                    <MyButton
                                        buttonType="text"
                                        scale="small"
                                        layoutVariant="icon"
                                        aria-label={t('access.remove', { name })}
                                        disable={removing === row.institute_id}
                                        onClick={() => void takeBack(row.institute_id, name)}
                                    >
                                        <Eye size={16} />
                                    </MyButton>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </MyDialog>
    );
};

/** Put one concept, past-paper or source tag on the selected questions. */
export const AddTagDialog = ({
    open,
    onOpenChange,
    count,
    existing,
    onSubmit,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** How many questions are selected. */
    count: number;
    /** Tags already in use, offered as one-click picks. */
    existing: LibraryTag[];
    onSubmit: (kind: LibraryTagKind, name: string) => Promise<void>;
}) => {
    const { t } = useTranslation('assessmentQuestionLibrary');
    const [kind, setKind] = useState<LibraryTagKind>('CONCEPT');
    const [name, setName] = useState('');
    const trimmed = name.trim();
    const suggestions = existing.filter((tag) => tag.kind === kind).slice(0, 20);

    return (
        <MyDialog
            heading={t('tags.addTitle', { count })}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-md"
            footer={
                <>
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => onOpenChange(false)}
                    >
                        {t('common.cancel')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        disable={!trimmed}
                        onAsyncClick={async () => onSubmit(kind, trimmed)}
                    >
                        {t('tags.add')}
                    </MyButton>
                </>
            }
        >
            <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                    <span className="text-caption font-semibold text-neutral-600">
                        {t('tags.kindLabel')}
                    </span>
                    <MyDropdown
                        currentValue={t(`tags.kind.${kind}`)}
                        dropdownList={LIBRARY_TAG_KINDS.map((value) => ({
                            label: t(`tags.kind.${value}`),
                            value,
                        }))}
                        handleChange={(value) => setKind(value as LibraryTagKind)}
                        className="w-full text-body"
                    />
                    <span className="text-caption text-neutral-500">
                        {t(`tags.kindHint.${kind}`)}
                    </span>
                </div>
                <MyInput
                    label={t('tags.nameLabel')}
                    required
                    inputType="text"
                    inputPlaceholder={t(`tags.namePlaceholder.${kind}`)}
                    input={name}
                    onChangeFunction={(e) => setName(e.target.value)}
                    className="w-full"
                />
                {suggestions.length > 0 && (
                    <div className="flex flex-col gap-2">
                        <span className="text-caption text-neutral-500">
                            {t('tags.pickExisting')}
                        </span>
                        <div className="flex flex-wrap gap-2">
                            {suggestions.map((tag) => (
                                <LibraryTagChip
                                    key={tag.tag_id}
                                    tag={tag}
                                    selected={trimmed.toLowerCase() === tag.tag_name.toLowerCase()}
                                    onClick={() => setName(tag.tag_name)}
                                />
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </MyDialog>
    );
};
