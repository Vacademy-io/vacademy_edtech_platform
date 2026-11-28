import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useQuery } from '@tanstack/react-query';
import { CaretDown, CaretRight, Users } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { MyButton } from '@/components/design-system/button';
import { pulseContentMapQueryOptions } from '../../-services/pulse-services';
import type {
    ContentMapChapterNode,
    ContentMapModuleNode,
    ContentMapSlideNode,
    ContentMapSubjectNode,
} from '../../-types/pulse-types';
import { formatDuration, LiveStatusLine, PulseMessage, slideIconFor } from './pulse-shared';

function HeadsBadge({ count }: { count: number }) {
    return (
        <span className="flex items-center gap-1 rounded-full bg-primary-50 px-2 py-0.5 text-xs font-semibold text-primary-600">
            <Users size={12} weight="fill" />
            {count}
        </span>
    );
}

function Caret({ open }: { open: boolean }) {
    return open ? (
        <CaretDown size={14} className="shrink-0 text-neutral-400" />
    ) : (
        <CaretRight size={14} className="shrink-0 text-neutral-400" />
    );
}

function SlideRow({ slide, t }: { slide: ContentMapSlideNode; t: TFunction }) {
    const Icon = slideIconFor(slide.slideType);
    return (
        <div className="flex items-center gap-2 py-1.5 pl-12 pr-3 hover:bg-neutral-50">
            <Icon size={15} className="shrink-0 text-neutral-400" />
            <span className="min-w-0 flex-1 truncate text-sm text-neutral-700">
                {slide.title ?? t('untitledSlide')}
            </span>
            {slide.friction && slide.baselineMedianSeconds != null && (
                <span className="rounded-full bg-danger-50 px-2 py-0.5 text-xs font-semibold text-danger-600">
                    {t('frictionUsually', { duration: formatDuration(slide.baselineMedianSeconds) })}
                </span>
            )}
            <span className="w-20 shrink-0 text-right text-xs tabular-nums text-neutral-400">
                {t('avgDuration', { duration: formatDuration(slide.avgOnSlideSeconds) })}
            </span>
            <HeadsBadge count={slide.headsNow} />
        </div>
    );
}

function ChapterRow({
    chapter,
    collapsed,
    toggle,
    t,
}: {
    chapter: ContentMapChapterNode;
    collapsed: Set<string>;
    toggle: (id: string) => void;
    t: TFunction;
}) {
    const key = `ch:${chapter.id}`;
    const open = !collapsed.has(key);
    return (
        <div>
            <button
                type="button"
                onClick={() => toggle(key)}
                className="flex w-full items-center gap-2 py-1.5 pl-8 pr-3 text-left hover:bg-neutral-50"
            >
                <Caret open={open} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-600">
                    {chapter.name ?? t('untitledChapter')}
                </span>
                <HeadsBadge count={chapter.headsNow} />
            </button>
            {open && chapter.slides.map((s) => <SlideRow key={s.id} slide={s} t={t} />)}
        </div>
    );
}

function ModuleRow({
    module,
    collapsed,
    toggle,
    t,
}: {
    module: ContentMapModuleNode;
    collapsed: Set<string>;
    toggle: (id: string) => void;
    t: TFunction;
}) {
    const key = `mod:${module.id}`;
    const open = !collapsed.has(key);
    return (
        <div>
            <button
                type="button"
                onClick={() => toggle(key)}
                className="flex w-full items-center gap-2 py-2 pl-4 pr-3 text-left hover:bg-neutral-50"
            >
                <Caret open={open} />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-neutral-700">
                    {module.name ?? t('untitledModule')}
                </span>
                <HeadsBadge count={module.headsNow} />
            </button>
            {open &&
                module.chapters.map((c) => (
                    <ChapterRow key={c.id} chapter={c} collapsed={collapsed} toggle={toggle} t={t} />
                ))}
        </div>
    );
}

function SubjectBlock({
    subject,
    collapsed,
    toggle,
    t,
}: {
    subject: ContentMapSubjectNode;
    collapsed: Set<string>;
    toggle: (id: string) => void;
    t: TFunction;
}) {
    const key = `subj:${subject.id}`;
    const open = !collapsed.has(key);
    return (
        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
            <button
                type="button"
                onClick={() => toggle(key)}
                className="flex w-full items-center gap-2 border-b border-neutral-100 bg-neutral-50 px-3 py-2.5 text-left"
            >
                <Caret open={open} />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-neutral-800">
                    {subject.name ?? t('untitledSubject')}
                </span>
                <HeadsBadge count={subject.headsNow} />
            </button>
            {open &&
                subject.modules.map((m) => (
                    <ModuleRow key={m.id} module={m} collapsed={collapsed} toggle={toggle} t={t} />
                ))}
        </div>
    );
}

export default function ContentMapView({ batchId, active }: { batchId: string; active: boolean }) {
    const { t } = useTranslation('studyLibraryPulseContentMapView');
    const { data, isLoading, isError, refetch, dataUpdatedAt, isFetching } = useQuery(
        pulseContentMapQueryOptions(batchId, active)
    );
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
    const toggle = (id: string) =>
        setCollapsed((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });

    const secondsSinceFetch = dataUpdatedAt
        ? Math.max(0, Math.floor((Date.now() - dataUpdatedAt) / 1000))
        : 0;

    if (isLoading) {
        return (
            <div className="flex items-center justify-center rounded-md bg-white p-10 shadow-sm">
                <DashboardLoader />
            </div>
        );
    }

    if (isError) {
        return (
            <div className="rounded-lg border border-neutral-200 bg-white shadow-sm">
                <PulseMessage
                    tone="danger"
                    title={t('loadError')}
                    action={
                        <MyButton buttonType="secondary" scale="medium" onClick={() => refetch()}>
                            {t('retry')}
                        </MyButton>
                    }
                />
            </div>
        );
    }

    const subjects = data?.subjects ?? [];

    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
                <LiveStatusLine secondsSinceFetch={secondsSinceFetch} isFetching={isFetching} />
                {data && data.totalHeads > 0 && (
                    <p className="text-xs text-neutral-400">
                        {t('summary.across', {
                            learners: t('summary.learners', { count: data.totalHeads }),
                            subjects: t('summary.subjects', { count: subjects.length }),
                        })}
                    </p>
                )}
            </div>

            {subjects.length === 0 ? (
                <div className="rounded-lg border border-neutral-200 bg-white shadow-sm">
                    <PulseMessage title={t('emptyTitle')} subtitle={t('emptySubtitle')} />
                </div>
            ) : (
                subjects.map((s) => (
                    <SubjectBlock key={s.id} subject={s} collapsed={collapsed} toggle={toggle} t={t} />
                ))
            )}
        </div>
    );
}
