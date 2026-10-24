import { createLazyFileRoute, useNavigate } from '@tanstack/react-router';
import { Helmet } from 'react-helmet';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ArrowLeft,
    Books,
    Exam,
    GraduationCap,
    ListNumbers,
    Plus,
    Spinner,
    WarningCircle,
} from '@phosphor-icons/react';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { StatusChip } from '@/components/design-system/status-chips';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { buildLanguageLabel, buildPurposeOptions } from './-constants';
import { useKnowledgeBase, useReviewPages } from './-hooks';
import { getOutline } from './-services/knowledge-base-service';
import { AddSourceDialog } from './-components/AddSourceDialog';
import { AskPanel } from './-components/AskPanel';
import { SourcesTable } from './-components/SourcesTable';
import { GenerationHistory } from './-components/GenerationHistory';
import { CompanionsSection } from './-components/companion/CompanionsSection';
import type { OutlineNode } from './-types';

export const Route = createLazyFileRoute('/knowledge-base/$kbId')({
    component: KnowledgeBaseDetailPage,
});

const formatCount = (n: number) => new Intl.NumberFormat('en-IN').format(n);

function StatTile({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2">
            <p className="text-caption text-neutral-500">{label}</p>
            <p className="text-subtitle font-semibold text-neutral-700">{value}</p>
        </div>
    );
}

function ReviewPagesDialog({
    kbId,
    open,
    onOpenChange,
}: {
    kbId: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const { t } = useTranslation('knowledgeBaseKbIdIndex');
    const { data: pages, isLoading } = useReviewPages(kbId, open);

    return (
        <MyDialog
            heading={t('reviewDialog.heading')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-2xl"
        >
            <div className="flex flex-col gap-3 p-6">
                <p className="text-body text-neutral-500">{t('reviewDialog.description')}</p>
                {isLoading && <Skeleton className="h-32 w-full rounded-md" />}
                {!isLoading && (pages?.length ?? 0) === 0 && (
                    <p className="text-body text-neutral-500">{t('reviewDialog.empty')}</p>
                )}
                {!isLoading && (pages?.length ?? 0) > 0 && (
                    <div className="max-h-80 overflow-y-auto rounded-md border border-neutral-200">
                        {pages?.map((page) => (
                            <div
                                key={page.id}
                                className="flex items-center justify-between gap-3 border-b border-neutral-100 px-3 py-2 last:border-b-0"
                            >
                                <div className="min-w-0">
                                    <p className="truncate text-body text-neutral-700">
                                        {page.source_title}
                                    </p>
                                    <p className="text-caption text-neutral-500">
                                        {t('reviewDialog.pageLabel', {
                                            number: page.page_number,
                                        })}
                                        {page.text_chars === 0
                                            ? ` — ${t('reviewDialog.noTextRead')}`
                                            : ` — ${t('reviewDialog.charsRead', {
                                                  formatted: formatCount(page.text_chars),
                                              })}`}
                                    </p>
                                </div>
                                {page.confidence != null && (
                                    <span className="shrink-0 text-caption text-neutral-500">
                                        {t('reviewDialog.confidence', {
                                            percent: Math.round(page.confidence * 100),
                                        })}
                                    </span>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </MyDialog>
    );
}

function OutlineDialog({
    kbId,
    open,
    onOpenChange,
}: {
    kbId: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const { t } = useTranslation('knowledgeBaseKbIdIndex');
    const [nodes, setNodes] = useState<OutlineNode[] | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!open) return;
        setLoading(true);
        getOutline(kbId)
            .then(setNodes)
            .catch(() => setNodes([]))
            .finally(() => setLoading(false));
    }, [open, kbId]);

    return (
        <MyDialog
            heading={t('outlineDialog.heading')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-3xl"
        >
            <div className="flex flex-col gap-3 p-6">
                <p className="text-body text-neutral-500">{t('outlineDialog.description')}</p>
                {loading && <Skeleton className="h-40 w-full rounded-md" />}
                {!loading && (nodes?.length ?? 0) === 0 && (
                    <p className="text-body text-neutral-500">{t('outlineDialog.empty')}</p>
                )}
                {!loading && (nodes?.length ?? 0) > 0 && (
                    <div className="max-h-96 space-y-3 overflow-y-auto">
                        {nodes
                            ?.filter((n) => n.level !== 'section' || n.summary)
                            .map((node) => (
                                <div
                                    key={node.id}
                                    className={
                                        node.level === 'book'
                                            ? 'rounded-md border border-primary-100 bg-primary-50 p-3'
                                            : node.level === 'chapter'
                                              ? 'ml-3 rounded-md border border-neutral-200 p-3'
                                              : 'ml-6 rounded-md border border-neutral-100 bg-neutral-50 p-3'
                                    }
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <p className="text-body font-medium text-neutral-700">
                                            {node.title || t('outlineDialog.untitled')}
                                        </p>
                                        {node.page_start != null && (
                                            <span className="shrink-0 text-caption text-neutral-400">
                                                {t('outlineDialog.pagePrefix', {
                                                    start: node.page_start,
                                                })}
                                                {node.page_end && node.page_end !== node.page_start
                                                    ? `-${node.page_end}`
                                                    : ''}
                                            </span>
                                        )}
                                    </div>
                                    {node.summary && (
                                        <p className="mt-1 text-caption text-neutral-500">
                                            {node.summary}
                                        </p>
                                    )}
                                    {node.keywords.length > 0 && (
                                        <div className="mt-2 flex flex-wrap gap-1">
                                            {node.keywords.slice(0, 8).map((k) => (
                                                <span
                                                    key={k}
                                                    className="rounded bg-white px-1.5 py-0.5 text-caption text-neutral-600"
                                                >
                                                    {k}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ))}
                    </div>
                )}
            </div>
        </MyDialog>
    );
}

function KnowledgeBaseDetailPage() {
    const { kbId } = Route.useParams();
    const navigate = useNavigate();
    const { t: tConstants } = useTranslation('knowledgeBaseConstants');
    const { t } = useTranslation('knowledgeBaseKbIdIndex');
    const purposeOptions = useMemo(() => buildPurposeOptions(tConstants), [tConstants]);
    const languageLabel = useMemo(() => buildLanguageLabel(tConstants), [tConstants]);
    const { setNavHeading } = useNavHeadingStore();
    const [addOpen, setAddOpen] = useState(false);
    const [reviewOpen, setReviewOpen] = useState(false);
    const [outlineOpen, setOutlineOpen] = useState(false);

    const { data: kb, isLoading, isError, refetch } = useKnowledgeBase(kbId);

    useEffect(() => {
        setNavHeading(kb?.name ?? t('navHeadingDefault'));
    }, [kb?.name, setNavHeading, t]);

    const sources = kb?.sources ?? [];
    const writable = kb?.writable ?? false;
    const readySources = sources.filter(
        (s) => s.is_active && (s.status === 'READY' || s.status === 'PARTIAL')
    );
    const processing = sources.filter(
        (s) => s.status === 'PENDING' || s.status === 'PROCESSING'
    ).length;

    // Openers drawn from the actual material, so the Ask box is never a blank page.
    const suggestions = useMemo(() => {
        const titles = readySources.slice(0, 2).map((s) => s.title);
        if (titles.length === 0) return [];
        return [
            t('suggestions.whatTopics', { title: titles[0] }),
            t('suggestions.mainFormulas'),
            t('suggestions.suggestExamQuestions'),
        ];
    }, [readySources, t]);

    const purposeLabel =
        purposeOptions.find((p) => p.value === kb?.purpose)?.label ??
        (kb?.purpose === 'institute_info'
            ? t('purpose.instituteInfo')
            : t('purpose.generalReference'));

    return (
        <LayoutContainer>
            <Helmet>
                <title>
                    {kb?.name
                        ? t('pageTitleWithName', { name: kb.name })
                        : t('pageTitleDefault')}
                </title>
            </Helmet>

            <div className="flex flex-col gap-5">
                <MyButton
                    buttonType="text"
                    scale="medium"
                    onClick={() => navigate({ to: '/knowledge-base' })}
                    className="w-fit"
                >
                    <ArrowLeft className="mr-1 size-4" />
                    {t('backToAll')}
                </MyButton>

                {isLoading && (
                    <div className="flex flex-col gap-4">
                        <Skeleton className="h-24 w-full rounded-lg" />
                        <Skeleton className="h-48 w-full rounded-lg" />
                    </div>
                )}

                {isError && (
                    <Card className="flex flex-col items-center gap-3 p-8 text-center">
                        <WarningCircle className="size-7 text-danger-500" />
                        <p className="text-body text-neutral-600">{t('loadError')}</p>
                        <MyButton buttonType="secondary" scale="medium" onClick={() => refetch()}>
                            {t('tryAgainButton')}
                        </MyButton>
                    </Card>
                )}

                {!isLoading && !isError && kb && (
                    <>
                        <Card className="flex flex-col gap-4 p-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="flex min-w-0 items-start gap-3">
                                    <div className="rounded-lg bg-primary-50 p-2">
                                        <Books className="size-6 text-primary-500" />
                                    </div>
                                    <div className="min-w-0">
                                        <p className="truncate text-title font-semibold text-neutral-700">
                                            {kb.name}
                                        </p>
                                        <p className="text-caption text-neutral-500">
                                            {purposeLabel}
                                            {kb.language_hint
                                                ? ` · ${languageLabel[kb.language_hint] ?? kb.language_hint}`
                                                : ''}
                                        </p>
                                        {kb.description && (
                                            <p className="mt-1 text-body text-neutral-500">
                                                {kb.description}
                                            </p>
                                        )}
                                    </div>
                                </div>

                                <div className="flex flex-wrap items-center gap-2">
                                    {kb.owner_type === 'PLATFORM' && (
                                        <StatusChip
                                            status="INFO"
                                            text={t('sharedLibraryBadge')}
                                            textSize="text-caption"
                                            showIcon={false}
                                        />
                                    )}
                                    <MyButton
                                        buttonType="secondary"
                                        scale="medium"
                                        onClick={() => setOutlineOpen(true)}
                                    >
                                        <ListNumbers className="mr-1 size-4" />
                                        {t('whatItCoversButton')}
                                    </MyButton>
                                    {readySources.length > 0 && (
                                        <MyButton
                                            buttonType="secondary"
                                            scale="medium"
                                            onClick={() =>
                                                navigate({
                                                    to: '/knowledge-base/paper/$kbId',
                                                    params: { kbId },
                                                })
                                            }
                                        >
                                            <Exam className="mr-1 size-4" />
                                            {t('createQuestionPaperButton')}
                                        </MyButton>
                                    )}
                                    {readySources.length > 0 && (
                                        <MyButton
                                            buttonType="secondary"
                                            scale="medium"
                                            onClick={() =>
                                                navigate({
                                                    to: '/study-library/ai-copilot',
                                                    search: { kb: kbId },
                                                })
                                            }
                                        >
                                            <GraduationCap className="mr-1 size-4" />
                                            {t('createCourseButton')}
                                        </MyButton>
                                    )}
                                    {writable && (
                                        <MyButton
                                            buttonType="primary"
                                            scale="medium"
                                            onClick={() => setAddOpen(true)}
                                        >
                                            <Plus className="mr-1 size-4" />
                                            {t('addMaterialButton')}
                                        </MyButton>
                                    )}
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                                <StatTile
                                    label={t('stats.sources')}
                                    value={formatCount(kb.stats?.sources ?? sources.length)}
                                />
                                <StatTile
                                    label={t('stats.pages')}
                                    value={formatCount(kb.stats?.pages ?? 0)}
                                />
                                <StatTile
                                    label={t('stats.searchablePassages')}
                                    value={formatCount(kb.stats?.chunks ?? 0)}
                                />
                                <StatTile
                                    label={t('stats.diagramsAndTables')}
                                    value={formatCount(kb.stats?.figures ?? 0)}
                                />
                            </div>

                            <div className="flex flex-wrap items-center gap-3">
                                {processing > 0 && (
                                    <span className="flex items-center gap-1.5 text-caption text-primary-500">
                                        <Spinner className="size-4 animate-spin" />
                                        {t('processingSources', { count: processing })}
                                    </span>
                                )}
                                {kb.review_pages > 0 && (
                                    <MyButton
                                        buttonType="text"
                                        scale="medium"
                                        onClick={() => setReviewOpen(true)}
                                        className="text-warning-600"
                                    >
                                        <WarningCircle className="mr-1 size-4" />
                                        {t('reviewPagesWarning', {
                                            count: kb.review_pages,
                                            formatted: formatCount(kb.review_pages),
                                        })}
                                    </MyButton>
                                )}
                            </div>
                        </Card>

                        <div className="grid gap-4 lg:grid-cols-2">
                            <div className="flex flex-col gap-2">
                                <p className="text-subtitle font-semibold text-neutral-700">
                                    {t('materialHeading')}
                                </p>
                                <SourcesTable kbId={kbId} sources={sources} writable={writable} />
                            </div>

                            <div className="flex flex-col gap-2">
                                <p className="text-subtitle font-semibold text-neutral-700">
                                    {t('checkItWorksHeading')}
                                </p>
                                <AskPanel
                                    kbId={kbId}
                                    kbName={kb.name}
                                    suggestions={suggestions}
                                    hasContent={readySources.length > 0}
                                />
                            </div>
                        </div>

                        {kb.purpose !== 'institute_info' && (
                            <CompanionsSection kbId={kbId} kbName={kb.name} />
                        )}

                        <div className="flex flex-col gap-2">
                            <p className="text-subtitle font-semibold text-neutral-700">
                                {t('madeFromHeading')}
                            </p>
                            <GenerationHistory kbId={kbId} />
                        </div>
                    </>
                )}
            </div>

            <AddSourceDialog kbId={kbId} open={addOpen} onOpenChange={setAddOpen} />
            <ReviewPagesDialog kbId={kbId} open={reviewOpen} onOpenChange={setReviewOpen} />
            <OutlineDialog kbId={kbId} open={outlineOpen} onOpenChange={setOutlineOpen} />
        </LayoutContainer>
    );
}
