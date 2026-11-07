import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CaretDown, CaretRight } from '@phosphor-icons/react';
import { Checkbox } from '@/components/ui/checkbox';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import type { KbTopic } from '../../-types/paper';

interface TopicPickerProps {
    topics: KbTopic[];
    /** Subtopic ids (and ids of topics that have no subtopics) currently chosen. */
    selectedLeafIds: Set<string>;
    onChange: (next: Set<string>) => void;
    /** Search box + Expand all / Collapse all above the tree (the wizard's syllabus step). */
    toolbar?: boolean;
    /**
     * Per-chapter weightage in percent, keyed by topic id. When given, a
     * selected chapter shows a "% weightage" field and the total is tracked
     * above the tree. Optional and partial by design — what is left blank the
     * planner balances itself.
     */
    weightage?: Record<string, number>;
    onWeightageChange?: (next: Record<string, number>) => void;
}

/** Leaves a topic contributes: its subtopics, or itself if it has none. */
const leavesOf = (topic: KbTopic): string[] =>
    topic.subtopics?.length ? topic.subtopics.map((s) => s.id) : [topic.id];

/**
 * Convert the leaf selection into the node ids the planner should see.
 *
 * A fully-selected topic collapses to just its own id — the backend treats a
 * selected topic as implying all of its subtopics, so sending the parent keeps
 * the request small and lets the planner see the topic as one coherent unit
 * rather than a bag of fragments.
 */
export const toSelectedNodeIds = (topics: KbTopic[], selectedLeafIds: Set<string>): string[] => {
    const ids: string[] = [];
    topics.forEach((topic) => {
        const leaves = leavesOf(topic);
        const chosen = leaves.filter((id) => selectedLeafIds.has(id));
        if (chosen.length === 0) return;
        if (chosen.length === leaves.length) ids.push(topic.id);
        else ids.push(...chosen);
    });
    return ids;
};

/**
 * Two-level topic chooser.
 *
 * Replaces a flat list of the per-source summary sections, which on a set of
 * past papers offered things like "…Questions, p. 1-4" and "Answer Keys, p. 13"
 * — page artifacts, not subjects. Ticking a topic selects all its subtopics, so
 * the common case is one click and the detail is there only if wanted.
 */
export const TopicPicker = ({
    topics,
    selectedLeafIds,
    onChange,
    toolbar = false,
    weightage,
    onWeightageChange,
}: TopicPickerProps) => {
    const { t } = useTranslation('knowledgeBaseTopicPicker');
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [query, setQuery] = useState('');

    const allLeaves = useMemo(() => topics.flatMap(leavesOf), [topics]);
    const allSelected = allLeaves.length > 0 && allLeaves.every((id) => selectedLeafIds.has(id));

    // A search narrows the tree to matching chapters/subtopics and opens the
    // chapters whose subtopics matched, so the hit is visible without a click.
    const needle = query.trim().toLowerCase();
    const visible = useMemo(() => {
        if (!needle) return topics;
        return topics
            .map((topic) => {
                const subs = (topic.subtopics ?? []).filter(
                    (sub) =>
                        sub.title.toLowerCase().includes(needle) ||
                        sub.keywords.some((k) => k.toLowerCase().includes(needle))
                );
                if (topic.title.toLowerCase().includes(needle)) return topic;
                if (subs.length) return { ...topic, subtopics: subs };
                return null;
            })
            .filter((t): t is KbTopic => t !== null);
    }, [topics, needle]);
    useEffect(() => {
        if (needle)
            setExpanded(new Set(visible.filter((v) => v.subtopics?.length).map((v) => v.id)));
    }, [needle, visible]);

    const allOpen = topics.every((topic) => !topic.subtopics?.length || expanded.has(topic.id));
    // Only chapters that are still selected count towards the total: a
    // weightage typed and then unticked must not keep inflating the bar.
    const totalWeight = topics.reduce((sum, topic) => {
        const pct = Number(weightage?.[topic.id] ?? 0) || 0;
        const selected = leavesOf(topic).some((leaf) => selectedLeafIds.has(leaf));
        return selected ? sum + pct : sum;
    }, 0);

    const setLeaves = (ids: string[], on: boolean) => {
        const next = new Set(selectedLeafIds);
        ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
        onChange(next);
    };

    const toggleTopic = (topic: KbTopic) => {
        const leaves = leavesOf(topic);
        const fully = leaves.every((id) => selectedLeafIds.has(id));
        setLeaves(leaves, !fully);
        // Reveal the detail the moment a topic is chosen, so it is obvious the
        // subtopics came along and can be narrowed.
        if (!fully && topic.subtopics?.length) {
            setExpanded((prev) => new Set(prev).add(topic.id));
        }
    };

    const toggleExpanded = (topicId: string) => {
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(topicId)) next.delete(topicId);
            else next.add(topicId);
            return next;
        });
    };

    if (topics.length === 0) return null;

    return (
        <div className="flex flex-col gap-2">
            {toolbar && (
                <MyInput
                    label=""
                    inputType="text"
                    input={query}
                    onChangeFunction={(e) => setQuery(e.target.value)}
                    inputPlaceholder={t('searchPlaceholder')}
                    className="w-full sm:w-full"
                />
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-caption text-neutral-500">
                    {selectedLeafIds.size === 0
                        ? t('emptySelection')
                        : t('selectedCount', {
                              count: selectedLeafIds.size,
                              total: allLeaves.length,
                          })}
                </p>
                <div className="flex items-center gap-1">
                    {toolbar && (
                        <>
                            <MyButton
                                buttonType="text"
                                scale="medium"
                                onClick={() => setLeaves(allLeaves, true)}
                                disable={allSelected}
                            >
                                {t('actions.selectAll')}
                            </MyButton>
                            <MyButton
                                buttonType="text"
                                scale="medium"
                                onClick={() => setLeaves(allLeaves, false)}
                                disable={selectedLeafIds.size === 0}
                            >
                                {t('actions.clearAll')}
                            </MyButton>
                            <MyButton
                                buttonType="text"
                                scale="medium"
                                onClick={() =>
                                    setExpanded(
                                        allOpen
                                            ? new Set()
                                            : new Set(
                                                  topics
                                                      .filter((x) => x.subtopics?.length)
                                                      .map((x) => x.id)
                                              )
                                    )
                                }
                            >
                                {allOpen ? t('actions.collapseAll') : t('actions.expandAll')}
                            </MyButton>
                        </>
                    )}
                    {!toolbar && (
                        <MyButton
                            buttonType="text"
                            scale="medium"
                            onClick={() => setLeaves(allLeaves, !allSelected)}
                        >
                            {allSelected ? t('actions.clearAll') : t('actions.selectAll')}
                        </MyButton>
                    )}
                </div>
            </div>
            {weightage && onWeightageChange && (
                <div className="flex items-center gap-3">
                    <Progress
                        value={Math.min(100, totalWeight)}
                        className={cn('h-1.5 flex-1', totalWeight > 100 && '[&>div]:bg-danger-500')}
                    />
                    <span className="text-caption text-neutral-500">
                        {t('weightage.total', { percent: Math.round(totalWeight) })}
                    </span>
                </div>
            )}

            <div className="flex max-h-96 flex-col divide-y divide-neutral-100 overflow-y-auto rounded-md border border-neutral-200">
                {visible.length === 0 && (
                    <p className="p-4 text-caption text-neutral-500">{t('noMatches')}</p>
                )}
                {visible.map((topic) => {
                    const leaves = leavesOf(topic);
                    const chosen = leaves.filter((id) => selectedLeafIds.has(id));
                    const fully = chosen.length === leaves.length;
                    const partial = chosen.length > 0 && !fully;
                    const isOpen = expanded.has(topic.id);
                    const hasSubs = Boolean(topic.subtopics?.length);

                    return (
                        <div key={topic.id} className="bg-white">
                            <div className="flex items-start gap-2 p-3">
                                <Checkbox
                                    checked={fully ? true : partial ? 'indeterminate' : false}
                                    onCheckedChange={() => toggleTopic(topic)}
                                    aria-label={t('selectTopicAriaLabel', { title: topic.title })}
                                    className="mt-0.5"
                                />
                                <button
                                    type="button"
                                    onClick={() =>
                                        hasSubs ? toggleExpanded(topic.id) : toggleTopic(topic)
                                    }
                                    className="flex min-w-0 flex-1 items-start gap-2 text-left"
                                >
                                    {hasSubs &&
                                        (isOpen ? (
                                            <CaretDown className="mt-1 size-3.5 shrink-0 text-neutral-400" />
                                        ) : (
                                            <CaretRight className="mt-1 size-3.5 shrink-0 text-neutral-400" />
                                        ))}
                                    <span className="min-w-0">
                                        <span className="block break-words text-body font-medium text-neutral-700">
                                            {topic.title}
                                        </span>
                                        {topic.summary && (
                                            <span className="mt-0.5 block break-words text-caption text-neutral-500">
                                                {topic.summary}
                                            </span>
                                        )}
                                        {hasSubs && (
                                            <span className="mt-0.5 block text-caption text-neutral-400">
                                                {chosen.length > 0 && !fully
                                                    ? t('subtopicsPartial', {
                                                          count: chosen.length,
                                                          total: leaves.length,
                                                      })
                                                    : t('subtopicsTotal', {
                                                          count: leaves.length,
                                                      })}
                                            </span>
                                        )}
                                    </span>
                                </button>
                                {weightage && onWeightageChange && chosen.length > 0 && (
                                    <label className="flex shrink-0 items-center gap-1 text-caption text-neutral-500">
                                        <input
                                            type="number"
                                            min={0}
                                            max={100}
                                            value={weightage[topic.id] ?? ''}
                                            placeholder={t('weightage.placeholder')}
                                            onChange={(e) => {
                                                const next = { ...weightage };
                                                const v = e.target.value;
                                                if (v === '') delete next[topic.id];
                                                else
                                                    next[topic.id] = Math.max(
                                                        0,
                                                        Math.min(100, Number(v))
                                                    );
                                                onWeightageChange(next);
                                            }}
                                            aria-label={t('weightage.ariaLabel', {
                                                title: topic.title,
                                            })}
                                            className="w-14 rounded-md border border-neutral-200 px-1.5 py-1 text-right text-caption text-neutral-700 focus:border-primary-500 focus:outline-none"
                                        />
                                        %
                                    </label>
                                )}
                            </div>

                            {isOpen && hasSubs && (
                                <div className="flex flex-col gap-1 border-t border-neutral-100 bg-neutral-50 px-3 py-2 pl-10">
                                    {topic.subtopics?.map((sub) => (
                                        <label
                                            key={sub.id}
                                            className="flex cursor-pointer items-start gap-2 rounded p-1 hover:bg-white"
                                        >
                                            <Checkbox
                                                checked={selectedLeafIds.has(sub.id)}
                                                onCheckedChange={(on) =>
                                                    setLeaves([sub.id], Boolean(on))
                                                }
                                                className="mt-0.5"
                                            />
                                            <span className="min-w-0">
                                                <span className="block break-words text-body text-neutral-600">
                                                    {sub.title}
                                                </span>
                                                {sub.keywords.length > 0 && (
                                                    <span className="block break-words text-caption text-neutral-400">
                                                        {sub.keywords.slice(0, 6).join(' · ')}
                                                    </span>
                                                )}
                                            </span>
                                        </label>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
