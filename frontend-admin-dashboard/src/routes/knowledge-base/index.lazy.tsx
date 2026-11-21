import { createLazyFileRoute, useNavigate } from '@tanstack/react-router';
import { Helmet } from 'react-helmet';
import { useEffect, useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import {
    Books,
    BookOpen,
    FileText,
    Plus,
    Sparkle,
    Spinner,
    WarningCircle,
} from '@phosphor-icons/react';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { MyButton } from '@/components/design-system/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusChip } from '@/components/design-system/status-chips';
import { buildLanguageLabel, buildPurposeOptions } from './-constants';
import { useKnowledgeBases } from './-hooks';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CreateKbDialog } from './-components/CreateKbDialog';
import { LibraryBrowser } from './-components/library/LibraryBrowser';
import { ownOnly } from './-components/curriculum/curriculum';
import type { KnowledgeBase } from './-types';

export const Route = createLazyFileRoute('/knowledge-base/')({
    component: KnowledgeBaseListPage,
});

const formatCount = (n: number) => new Intl.NumberFormat('en-IN').format(n);

function KbCard({ kb }: { kb: KnowledgeBase }) {
    const navigate = useNavigate();
    const { t: tConstants } = useTranslation('knowledgeBaseConstants');
    const { t } = useTranslation('knowledgeBaseIndex');
    const purposeOptions = useMemo(() => buildPurposeOptions(tConstants), [tConstants]);
    const languageLabel = useMemo(() => buildLanguageLabel(tConstants), [tConstants]);
    const open = () => navigate({ to: '/knowledge-base/$kbId', params: { kbId: kb.id } });
    const purposeLabel =
        purposeOptions.find((p) => p.value === kb.purpose)?.label ??
        (kb.purpose === 'institute_info'
            ? t('purpose.instituteInfo')
            : t('purpose.generalReference'));
    const pages = kb.stats?.pages ?? 0;
    const figures = kb.stats?.figures ?? 0;

    return (
        <Card
            role="button"
            tabIndex={0}
            onClick={open}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    open();
                }
            }}
            className="flex cursor-pointer flex-col gap-3 p-4 transition-colors hover:border-primary-200"
        >
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="truncate text-subtitle font-semibold text-neutral-700">
                        {kb.name}
                    </p>
                    <p className="mt-0.5 text-caption text-neutral-400">{purposeLabel}</p>
                </div>
                {kb.owner_type === 'PLATFORM' && (
                    <StatusChip
                        status="INFO"
                        text={t('kbCard.sharedLibrary')}
                        textSize="text-caption"
                        showIcon={false}
                    />
                )}
            </div>

            {kb.description && (
                <p className="line-clamp-2 text-body text-neutral-500">{kb.description}</p>
            )}

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-neutral-500">
                <span className="flex items-center gap-1">
                    <FileText className="size-4 text-neutral-400" />
                    {t('kbCard.sources', {
                        count: kb.source_count,
                        formatted: formatCount(kb.source_count),
                    })}
                </span>
                {pages > 0 && (
                    <span className="flex items-center gap-1">
                        <BookOpen className="size-4 text-neutral-400" />
                        {t('kbCard.pages', { count: pages, formatted: formatCount(pages) })}
                    </span>
                )}
                {figures > 0 && (
                    <span>
                        {t('kbCard.figures', { count: figures, formatted: formatCount(figures) })}
                    </span>
                )}
                {kb.language_hint && (
                    <span>{languageLabel[kb.language_hint] ?? kb.language_hint}</span>
                )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
                {kb.processing_count > 0 ? (
                    <span className="flex items-center gap-1.5 text-caption text-primary-500">
                        <Spinner className="size-4 animate-spin" />
                        {t('kbCard.reading', {
                            count: kb.processing_count,
                            formatted: formatCount(kb.processing_count),
                        })}
                    </span>
                ) : kb.source_count === 0 ? (
                    <span className="text-caption text-neutral-400">
                        {t('kbCard.nothingAdded')}
                    </span>
                ) : (
                    <StatusChip
                        status="SUCCESS"
                        text={t('kbCard.readyToUse')}
                        textSize="text-caption"
                        showIcon={false}
                    />
                )}
                {kb.review_pages > 0 && (
                    <span className="flex items-center gap-1 text-caption text-warning-600">
                        <WarningCircle className="size-4" />
                        {t('kbCard.reviewPages', {
                            count: kb.review_pages,
                            formatted: formatCount(kb.review_pages),
                        })}
                    </span>
                )}
            </div>
        </Card>
    );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
    const { t } = useTranslation('knowledgeBaseIndex');
    const examples = [
        {
            key: 'science',
            title: t('emptyState.examples.science.title'),
            body: t('emptyState.examples.science.body'),
        },
        {
            key: 'jee',
            title: t('emptyState.examples.jee.title'),
            body: t('emptyState.examples.jee.body'),
        },
        {
            key: 'instituteInfo',
            title: t('emptyState.examples.instituteInfo.title'),
            body: t('emptyState.examples.instituteInfo.body'),
        },
    ];

    return (
        <Card className="flex flex-col items-center gap-5 px-6 py-12 text-center">
            <div className="rounded-lg bg-primary-50 p-3">
                <Books className="size-8 text-primary-500" />
            </div>
            <div className="max-w-xl">
                <p className="text-title font-semibold text-neutral-700">
                    {t('emptyState.heading')}
                </p>
                <p className="mt-2 text-body text-neutral-500">{t('emptyState.description')}</p>
            </div>

            <div className="grid w-full max-w-2xl gap-3 text-start sm:grid-cols-3">
                {examples.map((example) => (
                    <div
                        key={example.key}
                        className="rounded-md border border-neutral-200 bg-neutral-50 p-3"
                    >
                        <p className="text-caption font-semibold text-neutral-600">
                            {example.title}
                        </p>
                        <p className="mt-1 text-caption text-neutral-500">{example.body}</p>
                    </div>
                ))}
            </div>

            <MyButton buttonType="primary" scale="large" onClick={onCreate}>
                <Plus className="mr-1 size-4" />
                {t('emptyState.createFirst')}
            </MyButton>
        </Card>
    );
}

function KnowledgeBaseListPage() {
    const { t } = useTranslation('knowledgeBaseIndex');
    const { setNavHeading } = useNavHeadingStore();
    const navigate = useNavigate();
    const [createOpen, setCreateOpen] = useState(false);
    // Their own bases stay the landing view: the library is an offer, not an
    // interruption to what they came here to do.
    const [tab, setTab] = useState<'mine' | 'library'>('mine');
    const { data: allBases, isLoading, isError, refetch } = useKnowledgeBases();
    const bases = useMemo(() => ownOnly(allBases), [allBases]);

    useEffect(() => {
        setNavHeading(t('navHeading'));
    }, [setNavHeading, t]);

    return (
        <LayoutContainer>
            <Helmet>
                <title>{t('meta.title')}</title>
                <meta name="description" content={t('meta.description')} />
            </Helmet>

            <Tabs value={tab} onValueChange={(v) => setTab(v as 'mine' | 'library')}>
                <TabsList className="mb-5 inline-flex h-auto justify-start gap-4 rounded-none border-b !bg-transparent p-0">
                    <TabsTrigger
                        value="mine"
                        className={`rounded-none px-6 py-2 !shadow-none ${
                            tab === 'mine' ? 'border-b-2 border-primary-500 text-primary-500' : ''
                        }`}
                    >
                        {t('tabs.mine')}
                    </TabsTrigger>
                    <TabsTrigger
                        value="library"
                        className={`flex gap-1.5 rounded-none px-6 py-2 !shadow-none ${
                            tab === 'library'
                                ? 'border-b-2 border-primary-500 text-primary-500'
                                : ''
                        }`}
                    >
                        <Books className="size-4" />
                        {t('tabs.library')}
                    </TabsTrigger>
                </TabsList>
            </Tabs>

            {tab === 'library' && (
                <LibraryBrowser
                    onAddOwn={() => {
                        setTab('mine');
                        setCreateOpen(true);
                    }}
                />
            )}

            <div className={tab === 'mine' ? 'flex flex-col gap-5' : 'hidden'}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <p className="text-title font-semibold text-neutral-700">
                            {t('mine.heading')}
                        </p>
                        <p className="mt-1 max-w-2xl text-body text-neutral-500">
                            {t('mine.description')}
                        </p>
                    </div>
                    {(bases?.length ?? 0) > 0 && (
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            onClick={() => setCreateOpen(true)}
                        >
                            <Plus className="mr-1 size-4" />
                            {t('mine.newButton')}
                        </MyButton>
                    )}
                </div>

                {isLoading && (
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {[0, 1, 2].map((i) => (
                            <Skeleton key={i} className="h-40 w-full rounded-lg" />
                        ))}
                    </div>
                )}

                {isError && (
                    <Card className="flex flex-col items-center gap-3 p-8 text-center">
                        <WarningCircle className="size-7 text-danger-500" />
                        <p className="text-body text-neutral-600">{t('mine.loadError')}</p>
                        <MyButton buttonType="secondary" scale="medium" onClick={() => refetch()}>
                            {t('mine.tryAgain')}
                        </MyButton>
                    </Card>
                )}

                {!isLoading && !isError && (bases?.length ?? 0) === 0 && (
                    <EmptyState onCreate={() => setCreateOpen(true)} />
                )}

                {!isLoading && !isError && (bases?.length ?? 0) > 0 && (
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {bases?.map((kb) => <KbCard key={kb.id} kb={kb} />)}
                    </div>
                )}

                {!isLoading && !isError && (bases?.length ?? 0) > 0 && (
                    <Card className="flex items-start gap-3 border-primary-100 bg-primary-50 p-4">
                        <Sparkle className="mt-0.5 size-5 shrink-0 text-primary-500" />
                        <p className="text-caption text-neutral-600">
                            <Trans i18nKey="knowledgeBaseIndex:mine.tip">
                                <strong>Ask this knowledge base</strong>
                            </Trans>
                        </p>
                    </Card>
                )}
            </div>

            <CreateKbDialog
                open={createOpen}
                onOpenChange={setCreateOpen}
                onCreated={(kbId) => navigate({ to: '/knowledge-base/$kbId', params: { kbId } })}
            />
        </LayoutContainer>
    );
}
