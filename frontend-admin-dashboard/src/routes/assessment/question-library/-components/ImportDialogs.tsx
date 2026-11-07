import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Files, MagnifyingGlass, Tag, WarningCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { MyDropdown } from '@/components/design-system/dropdown';
import { MyInput } from '@/components/design-system/input';
import { MyPagination } from '@/components/design-system/pagination';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { getQuestionPaperDataWithFilters } from '@/routes/assessment/question-papers/-utils/question-paper-services';
import { statusesForTab } from '@/routes/assessment/question-papers/-utils/question-paper-list';
import {
    flattenTree,
    nodePath,
    useLibrarySubjectTags,
    type LibraryNode,
    type LibraryTreeNode,
} from '../-services/question-library-services';

interface PaperRow {
    id: string;
    title: string;
    created_on?: string;
}

const PAPER_PAGE_SIZE = 8;

/** Topic choice as a dropdown with full paths ("Physics › Mechanics"). */
const TopicSelect = ({
    roots,
    nodes,
    value,
    onChange,
}: {
    roots: LibraryTreeNode[];
    nodes: LibraryNode[];
    value: string;
    onChange: (id: string) => void;
}) => {
    const { t } = useTranslation('assessmentQuestionLibrary');
    const list = useMemo(
        () =>
            flattenTree(roots).map((node) => ({ label: nodePath(node.id, nodes), value: node.id })),
        [roots, nodes]
    );
    return (
        <MyDropdown
            currentValue={value ? nodePath(value, nodes) : ''}
            placeholder={t('importPaper.chooseTopic')}
            dropdownList={list}
            handleChange={onChange}
            className="w-full"
            contentClassName="max-h-72 overflow-y-auto"
        />
    );
};

/** File every question of one saved question paper under a topic. */
export const AddPaperToTopicDialog = ({
    open,
    onOpenChange,
    instituteId,
    roots,
    nodes,
    defaultNodeId,
    onSubmit,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    instituteId: string;
    roots: LibraryTreeNode[];
    nodes: LibraryNode[];
    defaultNodeId?: string;
    onSubmit: (paperId: string, nodeId: string) => Promise<void>;
}) => {
    const { t } = useTranslation('assessmentQuestionLibrary');
    const [search, setSearch] = useState('');
    const [applied, setApplied] = useState('');
    const [page, setPage] = useState(0);
    const [paperId, setPaperId] = useState('');
    const [nodeId, setNodeId] = useState(defaultNodeId ?? '');

    useEffect(() => {
        if (open) setNodeId(defaultNodeId ?? '');
    }, [open, defaultNodeId]);

    const papers = useQuery({
        queryKey: ['QUESTION_LIBRARY_PAPER_PICKER', instituteId, applied, page],
        enabled: open,
        queryFn: () =>
            getQuestionPaperDataWithFilters(page, PAPER_PAGE_SIZE, instituteId, {
                statuses: statusesForTab('ACTIVE'),
                ...(applied ? { name: [{ id: applied, name: applied }] } : {}),
            }),
    });
    const rows: PaperRow[] = papers.data?.content ?? [];

    return (
        <MyDialog
            heading={t('importPaper.title')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-2xl"
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
                        disable={!paperId || !nodeId}
                        onAsyncClick={async () => onSubmit(paperId, nodeId)}
                    >
                        {t('importPaper.confirm')}
                    </MyButton>
                </>
            }
        >
            <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                    <span className="text-caption font-semibold text-neutral-600">
                        {t('importPaper.topic')}
                    </span>
                    {roots.length === 0 ? (
                        <p className="text-caption text-warning-600">{t('importPaper.noTopics')}</p>
                    ) : (
                        <TopicSelect
                            roots={roots}
                            nodes={nodes}
                            value={nodeId}
                            onChange={setNodeId}
                        />
                    )}
                </div>
                <div className="flex items-end gap-2">
                    <MyInput
                        label={t('importPaper.paper')}
                        inputType="text"
                        inputPlaceholder={t('importPaper.searchPapers')}
                        input={search}
                        onChangeFunction={(e) => setSearch(e.target.value)}
                        className="w-full"
                    />
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => {
                            setPage(0);
                            setApplied(search.trim());
                        }}
                    >
                        <MagnifyingGlass size={16} />
                    </MyButton>
                </div>
                {papers.isLoading ? (
                    <Skeleton className="h-48 w-full rounded-lg" />
                ) : papers.isError ? (
                    <div className="flex items-center gap-2 rounded-lg border border-danger-200 bg-danger-50 p-4 text-body text-neutral-700">
                        <WarningCircle size={16} className="text-danger-600" />
                        {t('importPaper.loadFailed')}
                    </div>
                ) : rows.length === 0 ? (
                    <p className="py-6 text-center text-body text-neutral-500">
                        {t('importPaper.noPapers')}
                    </p>
                ) : (
                    <div className="flex flex-col gap-2">
                        {rows.map((paper) => (
                            <button
                                key={paper.id}
                                type="button"
                                onClick={() => setPaperId(paper.id)}
                                className={cn(
                                    'flex items-center gap-3 rounded-lg border p-3 text-left',
                                    paperId === paper.id
                                        ? 'border-primary-400 bg-primary-50'
                                        : 'border-neutral-200 hover:border-primary-400'
                                )}
                            >
                                <Files size={18} className="shrink-0 text-primary-500" />
                                <span className="flex-1 truncate text-body text-neutral-700">
                                    {paper.title}
                                </span>
                                {paper.created_on && (
                                    <span className="text-caption text-neutral-500">
                                        {new Date(paper.created_on).toLocaleDateString()}
                                    </span>
                                )}
                            </button>
                        ))}
                        {(papers.data?.total_pages ?? 0) > 1 && (
                            <MyPagination
                                currentPage={page}
                                totalPages={papers.data?.total_pages ?? 0}
                                onPageChange={setPage}
                            />
                        )}
                    </div>
                )}
            </div>
        </MyDialog>
    );
};

/** Turn the subject tags questions already carry into top-level topics. */
export const ImportTagsDialog = ({
    open,
    onOpenChange,
    instituteId,
    onSubmit,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    instituteId: string;
    onSubmit: (tagIds: string[]) => Promise<void>;
}) => {
    const { t } = useTranslation('assessmentQuestionLibrary');
    const tags = useLibrarySubjectTags(instituteId, open);
    const [picked, setPicked] = useState<Set<string>>(new Set());
    const list = tags.data ?? [];
    const allPicked = list.length > 0 && list.every((tag) => picked.has(tag.tag_id));

    const toggle = (id: string) =>
        setPicked((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });

    return (
        <MyDialog
            heading={t('importTags.title')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-lg"
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
                        disable={picked.size === 0}
                        onAsyncClick={async () => onSubmit(Array.from(picked))}
                    >
                        {t('importTags.confirm', { count: picked.size })}
                    </MyButton>
                </>
            }
        >
            <div className="flex flex-col gap-3">
                <p className="text-caption text-neutral-500">{t('importTags.description')}</p>
                {tags.isLoading ? (
                    <Skeleton className="h-40 w-full rounded-lg" />
                ) : tags.isError ? (
                    <div className="flex items-center gap-2 rounded-lg border border-danger-200 bg-danger-50 p-4 text-body text-neutral-700">
                        <WarningCircle size={16} className="text-danger-600" />
                        {t('importTags.loadFailed')}
                    </div>
                ) : list.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-6 text-center">
                        <Tag size={24} className="text-neutral-300" />
                        <p className="text-body text-neutral-500">{t('importTags.empty')}</p>
                    </div>
                ) : (
                    <div className="flex flex-col gap-1">
                        <label className="flex cursor-pointer items-center gap-2 rounded-md p-2 text-body font-semibold text-neutral-600">
                            <Checkbox
                                checked={allPicked}
                                onCheckedChange={() =>
                                    setPicked(
                                        allPicked
                                            ? new Set()
                                            : new Set(list.map((tag) => tag.tag_id))
                                    )
                                }
                            />
                            {t('importTags.selectAll')}
                        </label>
                        {list.map((tag) => (
                            <label
                                key={tag.tag_id}
                                className={cn(
                                    'flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-body',
                                    picked.has(tag.tag_id)
                                        ? 'bg-primary-50 text-primary-500'
                                        : 'text-neutral-600 hover:bg-neutral-50'
                                )}
                            >
                                <Checkbox
                                    checked={picked.has(tag.tag_id)}
                                    onCheckedChange={() => toggle(tag.tag_id)}
                                />
                                <span className="flex-1 truncate capitalize">{tag.tag_name}</span>
                                <span className="text-caption text-neutral-500">
                                    {t('importTags.questions', { count: tag.question_count })}
                                </span>
                            </label>
                        ))}
                    </div>
                )}
            </div>
        </MyDialog>
    );
};
