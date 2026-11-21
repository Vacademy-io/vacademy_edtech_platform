import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { FolderNode } from '../../-services/folder-library-service';
import { folderCourseTag, nodeLabel } from '../../-services/folder-library-service';
import type { LearningPathGoal, LearningPathProps } from '../../-types/editor-types';
import type { ProductPageResponse } from '../../product-pages/-types/product-page-types';
import { TextField, Toggle } from './learning-path-fields';

/**
 * The featured list layout (listLayout: "featured"): which parts the section
 * shows, the goal chips, the featured path and its badge, and the "More
 * learning paths" heading. Shown only for a section that already uses the
 * layout. Goals and the featured path go through `patchShared`, which also
 * copies them to sibling sections that list the same library.
 */

interface LearningPathFeaturedFieldsProps {
    props: LearningPathProps;
    /** The library's folders (top-level ones are the streams goals pick from). */
    folders: { node: FolderNode; depth: number }[];
    /** Whether `folders` is the library's real list: none chosen, loading or failed say so instead. */
    foldersState?: 'ready' | 'noLibrary' | 'loading' | 'error';
    onRetryFolders?: () => void;
    /** Product page codes in the library, or null while its tree loads. */
    libraryCodes: Set<string> | null;
    pages: Pick<ProductPageResponse, 'id' | 'code' | 'name' | 'status'>[];
    pagesLoading: boolean;
    patch: (next: Partial<LearningPathProps>) => void;
    /** `keys` names what to copy when it is less than `next` (e.g. 'featured.badge'). */
    patchShared: (next: Partial<LearningPathProps>, keys?: string[]) => void;
    /** Other sections that keep a copy of the goals and featured path. */
    siblingCount: number;
    /** Parts a sibling holds differently: the first edit here replaces its copy. */
    siblingDiffers: ('goals' | 'featured')[];
    /** The section `sharedWith` names, when it exists: goals and featured path are edited there. */
    sharedFrom: { title: string; position: number; select: () => void } | null;
}

/** The tag a goal matches a stream folder by (as the site reads it). */
const folderTag = (node: FolderNode) => folderCourseTag(node).toLowerCase();

const newGoalKey = (goals: LearningPathGoal[]) => {
    const used = new Set(goals.map((g) => g.key));
    let n = goals.length + 1;
    while (used.has(`goal-${n}`)) n += 1;
    return `goal-${n}`;
};

export const LearningPathFeaturedFields = ({
    props,
    folders,
    foldersState = 'ready',
    onRetryFolders,
    libraryCodes,
    pages,
    pagesLoading,
    patch,
    patchShared,
    siblingCount,
    siblingDiffers,
    sharedFrom,
}: LearningPathFeaturedFieldsProps) => {
    const { t } = useTranslation('managePagesLearningPath');
    const uid = useId();
    const showGoals = props.showGoals !== false;
    const showGrid = props.showGrid !== false;
    const featured = props.featured && typeof props.featured === 'object' ? props.featured : {};
    const goals: LearningPathGoal[] = Array.isArray(props.goals) ? props.goals : [];

    const code = (featured.code || '').trim();
    const options = libraryCodes ? pages.filter((p) => libraryCodes.has(p.code)) : pages;
    const known = options.some((p) => p.code === code);
    // Only once the library is known: the site then features its first path instead.
    const outside = !!code && !known && !pagesLoading && !!libraryCodes;
    const pickFeatured = (next: string) => {
        const { code: _drop, ...rest } = featured;
        patchShared({ featured: next ? { ...rest, code: next } : rest }, ['featured.code']);
    };
    const statusLabel = (status: string) =>
        status === 'DRAFT'
            ? t('featured.statusDraft')
            : status === 'INACTIVE'
              ? t('featured.statusInactive')
              : String(status).toLowerCase();

    const streams = folders.filter((f) => f.depth === 0 && folderTag(f.node)).map((f) => f.node);
    const setGoal = (index: number, next: Partial<LearningPathGoal>) =>
        patchShared({ goals: goals.map((g, i) => (i === index ? { ...g, ...next } : g)) });
    const toggleTag = (index: number, tag: string) => {
        const tags = Array.isArray(goals[index]?.tags) ? goals[index]!.tags! : [];
        setGoal(index, { tags: tags.includes(tag) ? tags.filter((x) => x !== tag) : [...tags, tag] });
    };

    return (
        <div className="space-y-3 border-t border-neutral-100 pt-4">
            <p className="text-sm font-semibold text-neutral-700">{t('featured.title')}</p>
            <p className="text-caption text-neutral-500">{t('featured.hint')}</p>
            <Toggle label={t('featured.showGoals')} checked={showGoals} onChange={(v) => patch({ showGoals: v })} />
            <Toggle
                label={t('featured.showFeatured')}
                checked={props.showFeatured !== false}
                onChange={(v) => patch({ showFeatured: v })}
            />
            <Toggle
                label={t('featured.showGrid')}
                hint={t('featured.showGridHint')}
                checked={showGrid}
                onChange={(v) => patch({ showGrid: v })}
            />

            {sharedFrom ? (
                <div className="space-y-2 rounded border border-neutral-200 bg-neutral-50 p-2 text-caption text-neutral-600">
                    <p>
                        {t('featured.sharedFrom', {
                            name: sharedFrom.title || t('featured.sectionNumber', { n: sharedFrom.position }),
                        })}
                    </p>
                    <MyButton buttonType="secondary" scale="small" onClick={sharedFrom.select}>
                        {t('featured.sharedFromOpen')}
                    </MyButton>
                </div>
            ) : (
                <>
                    {siblingCount > 0 && (
                        <p className="rounded border border-primary-100 bg-primary-50 p-2 text-caption text-neutral-600">
                            {t('featured.syncNote', { count: siblingCount })}
                        </p>
                    )}
                    {siblingDiffers.includes('featured') && (
                        <p className="text-caption text-warning-600">{t('featured.differsFeatured')}</p>
                    )}
                    {siblingDiffers.includes('goals') && (
                        <p className="text-caption text-warning-600">{t('featured.differsGoals')}</p>
                    )}

                    <div className="space-y-2">
                        <Label htmlFor={`${uid}-featured`} className="text-xs">
                            {t('featured.path')}
                        </Label>
                        <select
                            id={`${uid}-featured`}
                            className="w-full rounded border px-2 py-1.5 text-xs"
                            value={code}
                            onChange={(e) => pickFeatured(e.target.value)}
                        >
                            <option value="">{pagesLoading ? t('featured.pathLoading') : t('featured.pathFirst')}</option>
                            {code && !known && (
                                <option value={code}>{t('featured.pathOutside', { value: code })}</option>
                            )}
                            {options.map((p) => (
                                <option key={p.id} value={p.code}>
                                    {p.name}
                                    {p.status !== 'ACTIVE' ? ` (${statusLabel(p.status)})` : ''}
                                </option>
                            ))}
                        </select>
                        {outside && <p className="text-caption text-warning-600">{t('featured.pathOutsideWarning')}</p>}
                        <TextField
                            label={t('featured.badge')}
                            value={featured.badge || ''}
                            placeholder={t('featured.badgePlaceholder')}
                            onChange={(v) => patchShared({ featured: { ...featured, badge: v } }, ['featured.badge'])}
                        />
                    </div>

                    <div className="space-y-2">
                        <p className="text-xs font-semibold text-neutral-700">{t('goals.title')}</p>
                        <p className="text-caption text-neutral-500">{t('goals.hint')}</p>
                        <TextField
                            label={t('goals.allLabel')}
                            value={props.allGoalsLabel || ''}
                            placeholder={t('goals.allPlaceholder')}
                            onChange={(v) => patchShared({ allGoalsLabel: v })}
                        />
                        {goals.map((goal, index) => {
                            const tags = Array.isArray(goal.tags) ? goal.tags : [];
                            const unknown = tags.filter((tag) => !streams.some((s) => folderTag(s) === tag));
                            // The site leaves out a goal without chip text or link key.
                            const hidden = !(goal.label || '').trim() || !(goal.key || '').trim();
                            return (
                                <div key={index} className="space-y-2 rounded border border-neutral-200 p-2">
                                    {hidden && <p className="text-caption text-warning-600">{t('goals.hiddenUntilFilled')}</p>}
                                    <TextField
                                        label={t('goals.label')}
                                        value={goal.label || ''}
                                        onChange={(v) => setGoal(index, { label: v })}
                                    />
                                    <TextField
                                        label={t('goals.key')}
                                        value={goal.key || ''}
                                        hint={t('goals.keyHint')}
                                        onChange={(v) => setGoal(index, { key: v.replace(/[^\w-]/g, '') })}
                                    />
                                    <div role="group" aria-label={t('goals.streams')}>
                                        <Label className="text-xs">{t('goals.streams')}</Label>
                                        <div className="mt-1 flex flex-wrap gap-1">
                                            {streams.map((s) => {
                                                const tag = folderTag(s);
                                                const on = tags.includes(tag);
                                                return (
                                                    <button
                                                        key={s.id}
                                                        type="button"
                                                        aria-pressed={on}
                                                        onClick={() => toggleTag(index, tag)}
                                                        className={cn(
                                                            'rounded px-2 py-0.5 text-caption',
                                                            on ? 'bg-primary-100 text-primary-500' : 'bg-neutral-100 text-neutral-600'
                                                        )}
                                                    >
                                                        {nodeLabel(s)}
                                                    </button>
                                                );
                                            })}
                                            {unknown.map((tag) => (
                                                <button
                                                    key={tag}
                                                    type="button"
                                                    aria-pressed
                                                    onClick={() => toggleTag(index, tag)}
                                                    className="rounded bg-primary-100 px-2 py-0.5 text-caption text-primary-500"
                                                >
                                                    {/* "Custom" only once the library's streams are known. */}
                                                    {foldersState === 'ready' ? t('goals.customTag', { value: tag }) : tag}
                                                </button>
                                            ))}
                                        </div>
                                        {foldersState === 'loading' && (
                                            <p role="status" className="mt-1 text-caption text-neutral-500">
                                                {t('goals.foldersLoading')}
                                            </p>
                                        )}
                                        {foldersState === 'error' && (
                                            <p role="alert" className="mt-1 text-caption text-danger-600">
                                                {t('goals.foldersFailed')}{' '}
                                                {onRetryFolders && (
                                                    <button type="button" className="underline" onClick={onRetryFolders}>
                                                        {t('goals.retry')}
                                                    </button>
                                                )}
                                            </p>
                                        )}
                                        {foldersState === 'noLibrary' && (
                                            <p className="mt-1 text-caption text-neutral-500">{t('goals.noLibrary')}</p>
                                        )}
                                        {foldersState === 'ready' && !streams.length && (
                                            <p className="mt-1 text-caption text-neutral-500">{t('goals.noStreams')}</p>
                                        )}
                                    </div>
                                    <MyButton
                                        buttonType="text"
                                        scale="small"
                                        // Names the goal: every goal has a Remove button.
                                        aria-label={`${t('goals.remove')}: ${(goal.label || '').trim() || index + 1}`}
                                        onClick={() => patchShared({ goals: goals.filter((_, i) => i !== index) })}
                                    >
                                        <Trash className="size-4" /> {t('goals.remove')}
                                    </MyButton>
                                </div>
                            );
                        })}
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            onClick={() => patchShared({ goals: [...goals, { key: newGoalKey(goals), label: '', tags: [] }] })}
                        >
                            <Plus className="size-4" /> {t('goals.add')}
                        </MyButton>
                    </div>
                </>
            )}

            {showGrid && (
                <div className="space-y-2">
                    <TextField
                        label={t('more.title')}
                        value={props.moreTitle || ''}
                        placeholder={t('more.titlePlaceholder')}
                        onChange={(v) => patch({ moreTitle: v })}
                    />
                    <TextField
                        label={t('more.note')}
                        value={props.moreNote || ''}
                        onChange={(v) => patch({ moreNote: v })}
                    />
                </div>
            )}
        </div>
    );
};
