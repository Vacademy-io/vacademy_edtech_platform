import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Check, PencilSimple, Sparkle, Trash, WarningCircle, X } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { MyInput } from '@/components/design-system/input';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
    autoTagLibrary,
    deleteLibraryTag,
    libraryErrorMessage,
    renameLibraryTag,
    useLibraryTags,
    type LibraryNode,
    type LibraryTag,
} from '../-services/question-library-services';
import { LibraryTagChip } from './LibraryQuestionFilters';

type RunState = 'counting' | 'ready' | 'running' | 'finished' | 'stopped' | 'failed';

/**
 * Concept tags by AI for every question under a topic that has none. Runs a batch at a time
 * so it shows progress and can stop; whatever is tagged stays tagged.
 */
export const AutoTagDialog = ({
    open,
    onOpenChange,
    instituteId,
    node,
    onTagged,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    instituteId: string;
    node: LibraryNode;
    /** After each batch, so the list and its filters catch up while it runs. */
    onTagged: () => void;
}) => {
    const { t } = useTranslation('assessmentQuestionLibrary');
    const [state, setState] = useState<RunState>('counting');
    const [untagged, setUntagged] = useState(0);
    const [tried, setTried] = useState(0);
    const [tagged, setTagged] = useState(0);
    const [names, setNames] = useState<string[]>([]);
    /** The server message; blank text means "show the generic failure". */
    const [error, setError] = useState<string | null>(null);
    const stop = useRef(false);

    useEffect(() => {
        let alive = true;
        autoTagLibrary(instituteId, { node_id: node.id, limit: 0 })
            .then((result) => {
                if (!alive) return;
                setUntagged(result.remaining);
                setState('ready');
            })
            .catch((failure) => {
                if (!alive) return;
                setError(libraryErrorMessage(failure, ''));
                setState('failed');
            });
        return () => {
            alive = false;
            stop.current = true;
        };
    }, [instituteId, node.id]);

    const start = async () => {
        stop.current = false;
        setState('running');
        setError(null);
        let attempted: string[] = [];
        let total = untagged;
        try {
            while (!stop.current) {
                const result = await autoTagLibrary(instituteId, {
                    node_id: node.id,
                    exclude_question_ids: attempted,
                });
                if (result.attempted_ids.length === 0) break;
                attempted = [...attempted, ...result.attempted_ids];
                total = Math.max(total, attempted.length + result.remaining);
                setUntagged(total);
                setTried(attempted.length);
                setTagged((value) => value + result.tagged);
                setNames((prev) => Array.from(new Set([...prev, ...result.tags])));
                onTagged();
                if (result.remaining === 0) break;
            }
            setState(stop.current ? 'stopped' : 'finished');
        } catch (failure) {
            setError(libraryErrorMessage(failure, ''));
            setState('failed');
            onTagged();
        }
    };

    const running = state === 'running';
    const percent = untagged > 0 ? Math.round((tried / untagged) * 100) : 0;

    return (
        <MyDialog
            heading={t('autoTag.title', { name: node.name })}
            open={open}
            onOpenChange={(next) => {
                if (running) return;
                onOpenChange(next);
            }}
            footer={
                <>
                    {running ? (
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="medium"
                            onClick={() => {
                                stop.current = true;
                            }}
                        >
                            {t('autoTag.stop')}
                        </MyButton>
                    ) : (
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="medium"
                            onClick={() => onOpenChange(false)}
                        >
                            {t('common.close')}
                        </MyButton>
                    )}
                    {(state === 'ready' || state === 'stopped' || state === 'failed') &&
                        untagged > tried && (
                            <MyButton
                                type="button"
                                buttonType="primary"
                                scale="medium"
                                className="gap-2"
                                onClick={() => void start()}
                            >
                                <Sparkle size={16} />
                                {state === 'ready' ? t('autoTag.start') : t('autoTag.resume')}
                            </MyButton>
                        )}
                </>
            }
        >
            <div className="flex flex-col gap-4 p-4 md:p-6">
                <p className="text-body text-neutral-600">{t('autoTag.hint')}</p>
                {state === 'counting' ? (
                    <Skeleton className="h-10 w-full rounded-md" />
                ) : (
                    <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-4">
                        <span className="text-subtitle font-semibold text-neutral-700">
                            {untagged === 0 && tried === 0
                                ? t('autoTag.nothingToDo')
                                : t('autoTag.untagged', { total: untagged })}
                        </span>
                        {(running || tried > 0) && (
                            <>
                                <Progress value={percent} className="h-2" />
                                <span className="text-caption text-neutral-500">
                                    {t('autoTag.progress', { tried, total: untagged, tagged })}
                                </span>
                            </>
                        )}
                        {state === 'finished' && (
                            <span className="flex items-center gap-1 text-caption text-success-600">
                                <Check size={14} />
                                {t('autoTag.done', { tagged })}
                            </span>
                        )}
                        {state === 'stopped' && (
                            <span className="text-caption text-warning-600">
                                {t('autoTag.stopped', { tagged })}
                            </span>
                        )}
                    </div>
                )}
                {error !== null && (
                    <div className="flex items-start gap-2 rounded-lg border border-danger-200 bg-danger-50 p-3 text-caption text-neutral-700">
                        <WarningCircle size={16} className="mt-0.5 shrink-0 text-danger-600" />
                        <span>{error || t('toasts.failed')}</span>
                    </div>
                )}
                {names.length > 0 && (
                    <div className="flex flex-col gap-2">
                        <span className="text-caption font-semibold uppercase text-neutral-500">
                            {t('autoTag.tagsUsed')}
                        </span>
                        <div className="flex flex-wrap gap-2">
                            {names.slice(0, 40).map((name) => (
                                <LibraryTagChip
                                    key={name}
                                    tag={{ tag_id: name, tag_name: name, kind: 'CONCEPT' }}
                                />
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </MyDialog>
    );
};

const TagRow = ({
    tag,
    busy,
    onRename,
    onDelete,
}: {
    tag: LibraryTag;
    busy: boolean;
    onRename: (name: string) => Promise<boolean>;
    onDelete: () => Promise<void>;
}) => {
    const { t } = useTranslation('assessmentQuestionLibrary');
    const [editing, setEditing] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const [name, setName] = useState(tag.tag_name);

    if (editing) {
        return (
            <li className="flex items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                    <MyInput
                        inputType="text"
                        input={name}
                        onChangeFunction={(e) => setName(e.target.value)}
                        className="sm:w-full"
                    />
                </div>
                <MyButton
                    type="button"
                    buttonType="primary"
                    scale="small"
                    disable={busy || !name.trim() || name.trim() === tag.tag_name}
                    onClick={async () => {
                        if (await onRename(name.trim())) setEditing(false);
                    }}
                >
                    {t('manageTags.save')}
                </MyButton>
                <MyButton
                    type="button"
                    buttonType="text"
                    scale="small"
                    layoutVariant="icon"
                    aria-label={t('common.cancel')}
                    onClick={() => {
                        setName(tag.tag_name);
                        setEditing(false);
                    }}
                >
                    <X size={14} />
                </MyButton>
            </li>
        );
    }
    return (
        <li className="flex items-center gap-2 py-2">
            <div className="flex min-w-0 flex-1 items-center gap-2">
                <LibraryTagChip tag={tag} count={tag.question_count} />
                <span className="text-caption text-neutral-500">{t(`tags.kind.${tag.kind}`)}</span>
            </div>
            {confirming ? (
                <>
                    <span className="text-caption text-danger-600">
                        {t('manageTags.confirmDelete', { total: tag.question_count ?? 0 })}
                    </span>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="small"
                        disable={busy}
                        onClick={() => void onDelete().then(() => setConfirming(false))}
                    >
                        {t('manageTags.yesDelete')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="text"
                        scale="small"
                        onClick={() => setConfirming(false)}
                    >
                        {t('common.cancel')}
                    </MyButton>
                </>
            ) : (
                <>
                    <MyButton
                        type="button"
                        buttonType="text"
                        scale="small"
                        layoutVariant="icon"
                        aria-label={t('manageTags.rename', { name: tag.tag_name })}
                        onClick={() => setEditing(true)}
                    >
                        <PencilSimple size={14} />
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="text"
                        scale="small"
                        layoutVariant="icon"
                        aria-label={t('manageTags.delete', { name: tag.tag_name })}
                        onClick={() => setConfirming(true)}
                    >
                        <Trash size={14} />
                    </MyButton>
                </>
            )}
        </li>
    );
};

/**
 * The library tags under a topic (or the whole library): rename one, which merges it into a
 * tag that already has that name, or take one off every question.
 */
export const ManageTagsDialog = ({
    open,
    onOpenChange,
    instituteId,
    node,
    onChanged,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    instituteId: string;
    node: LibraryNode | null;
    onChanged: () => void;
}) => {
    const { t } = useTranslation('assessmentQuestionLibrary');
    const tags = useLibraryTags(instituteId, node?.id);
    const [query, setQuery] = useState('');
    const [busy, setBusy] = useState(false);
    const rows = useMemo(() => {
        const needle = query.trim().toLowerCase();
        const list = tags.data ?? [];
        return needle ? list.filter((tag) => tag.tag_name.toLowerCase().includes(needle)) : list;
    }, [tags.data, query]);

    const rename = async (tag: LibraryTag, name: string) => {
        setBusy(true);
        try {
            await renameLibraryTag(instituteId, { tag_id: tag.tag_id, name });
            toast.success(t('manageTags.renamed', { from: tag.tag_name, to: name }));
            onChanged();
            return true;
        } catch (failure) {
            toast.error(libraryErrorMessage(failure, t('toasts.failed')));
            return false;
        } finally {
            setBusy(false);
        }
    };

    const remove = async (tag: LibraryTag) => {
        setBusy(true);
        try {
            await deleteLibraryTag(instituteId, { tag_id: tag.tag_id });
            toast.success(t('manageTags.deleted', { name: tag.tag_name }));
            onChanged();
        } catch (failure) {
            toast.error(libraryErrorMessage(failure, t('toasts.failed')));
        } finally {
            setBusy(false);
        }
    };

    return (
        <MyDialog
            heading={node ? t('manageTags.titleIn', { name: node.name }) : t('manageTags.title')}
            open={open}
            onOpenChange={onOpenChange}
            footer={
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="medium"
                    onClick={() => onOpenChange(false)}
                >
                    {t('common.close')}
                </MyButton>
            }
        >
            <div className="flex flex-col gap-3 p-4 md:p-6">
                <p className="text-caption text-neutral-500">{t('manageTags.hint')}</p>
                <MyInput
                    inputType="text"
                    inputPlaceholder={t('manageTags.search')}
                    input={query}
                    onChangeFunction={(e) => setQuery(e.target.value)}
                    className="sm:w-full"
                />
                {tags.isLoading ? (
                    <div className="flex flex-col gap-2">
                        {[0, 1, 2].map((i) => (
                            <Skeleton key={i} className="h-8 w-full rounded-md" />
                        ))}
                    </div>
                ) : tags.isError ? (
                    <div className="flex items-center gap-2 rounded-lg border border-danger-200 bg-danger-50 p-3 text-caption text-neutral-700">
                        <WarningCircle size={16} className="text-danger-600" />
                        <span className="flex-1">{t('manageTags.loadFailed')}</span>
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="small"
                            onClick={() => void tags.refetch()}
                        >
                            {t('common.retry')}
                        </MyButton>
                    </div>
                ) : rows.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-caption text-neutral-500">
                        {t('manageTags.empty')}
                    </p>
                ) : (
                    <ul className="flex flex-col divide-y divide-neutral-100">
                        {rows.map((tag) => (
                            <TagRow
                                key={`${tag.kind}-${tag.tag_id}`}
                                tag={tag}
                                busy={busy}
                                onRename={(name) => rename(tag, name)}
                                onDelete={() => remove(tag)}
                            />
                        ))}
                    </ul>
                )}
            </div>
        </MyDialog>
    );
};
