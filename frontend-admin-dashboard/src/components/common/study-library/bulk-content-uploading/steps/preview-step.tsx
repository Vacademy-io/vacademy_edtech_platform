// Bulk Content Uploading — step 2: preview tree + issues, confirm before commit.

import { useMemo } from 'react';
import { ArrowLeft, Info, Warning, XCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Switch } from '@/components/ui/switch';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { formatBytes } from '../conventions';
import { PreviewTree } from '../preview-tree';
import {
    selectCreatedNodes,
    selectMultiReadiness,
    selectSectionsOrdered,
    selectUnresolvedNodes,
    useBulkContentUploadingStore,
} from '../use-bulk-content-uploading-store';
import type { NodeKind } from '../types';
import { CourseSectionCard } from './course-section-card';
import { CsvPreview } from './csv-preview';
import type { SectionCallbacks } from '../bulk-content-uploading-wizard';

interface PreviewStepProps {
    onConfirm: () => void;
    sectionCallbacks?: SectionCallbacks;
}

const TERM_FOR_KIND: Record<NodeKind, { key: string; fallback: string }> = {
    subject: { key: ContentTerms.Subject, fallback: SystemTerms.Subject },
    module: { key: ContentTerms.Module, fallback: SystemTerms.Module },
    chapter: { key: ContentTerms.Chapter, fallback: SystemTerms.Chapter },
};

/** "1 module and 3 chapters", institute naming applied. Empty when nothing is new. */
const describeCreatable = (counts: Record<NodeKind, number>): string => {
    const parts = (Object.keys(TERM_FOR_KIND) as NodeKind[])
        .filter((kind) => counts[kind] > 0)
        .map((kind) => {
            const { key, fallback } = TERM_FOR_KIND[kind];
            const term =
                counts[kind] === 1
                    ? getTerminology(key, fallback)
                    : getTerminologyPlural(key, fallback);
            return `${counts[kind]} ${term.toLowerCase()}`;
        });
    if (parts.length === 0) return '';
    if (parts.length === 1) return parts[0]!;
    return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
};

const MultiCoursePreview = ({
    onConfirm,
    sectionCallbacks,
}: {
    onConfirm: () => void;
    sectionCallbacks: SectionCallbacks;
}) => {
    const courseSections = useBulkContentUploadingStore((state) => state.courseSections);
    const sectionSnapshots = useBulkContentUploadingStore((state) => state.sectionSnapshots);
    const items = useBulkContentUploadingStore((state) => state.items);
    const nodes = useBulkContentUploadingStore((state) => state.nodes);
    const issues = useBulkContentUploadingStore((state) => state.issues);
    const fatalErrors = useBulkContentUploadingStore((state) => state.fatalErrors);
    const zipFileName = useBulkContentUploadingStore((state) => state.zipFileName);
    const zipTotalBytes = useBulkContentUploadingStore((state) => state.zipTotalBytes);
    const options = useBulkContentUploadingStore((state) => state.options);
    const resetForNewZip = useBulkContentUploadingStore((state) => state.resetForNewZip);

    const sections = useMemo(() => selectSectionsOrdered(courseSections), [courseSections]);
    const readiness = useMemo(
        () =>
            selectMultiReadiness({
                courseSections,
                sectionSnapshots,
                items,
                nodes,
                fatalErrors,
                options,
            }),
        // `options` belongs here — toggling createMissing changes the gate.
        [courseSections, sectionSnapshots, items, nodes, fatalErrors, options]
    );
    const totalItems = useMemo(() => {
        const readyIds = new Set(sections.filter((s) => s.status === 'ready').map((s) => s.id));
        return Object.values(items).filter((i) => i.sectionId && readyIds.has(i.sectionId)).length;
    }, [items, sections]);

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-subtitle font-semibold text-neutral-700">{zipFileName}</span>
                <span className="text-caption text-neutral-500">{formatBytes(zipTotalBytes)}</span>
                <span className="ml-auto text-caption text-neutral-500">
                    {sections.length}{' '}
                    {getTerminologyPlural(ContentTerms.Course, SystemTerms.Course).toLowerCase()}{' '}
                    folder{sections.length === 1 ? '' : 's'}
                </span>
            </div>

            {fatalErrors.length > 0 && (
                <div className="flex flex-col gap-2 rounded-lg border border-danger-200 bg-danger-50 p-4">
                    {fatalErrors.map((message) => (
                        <div key={message} className="flex items-start gap-2">
                            <XCircle className="mt-0.5 size-4 shrink-0 text-danger-600" />
                            <p className="text-subtitle text-danger-700">{message}</p>
                        </div>
                    ))}
                </div>
            )}

            {issues.length > 0 && (
                <ul className="max-h-32 divide-y divide-neutral-100 overflow-y-auto rounded-lg border border-neutral-200 bg-white">
                    {issues.map((issue, index) => (
                        <li
                            key={`${issue.path}-${index}`}
                            className="flex items-start gap-2 px-4 py-2"
                        >
                            {issue.level === 'error' ? (
                                <XCircle className="size-4 shrink-0 text-danger-500" />
                            ) : issue.level === 'warning' ? (
                                <Warning className="size-4 shrink-0 text-warning-600" />
                            ) : (
                                <Info className="size-4 shrink-0 text-neutral-400" />
                            )}
                            <span className="text-caption text-neutral-600">
                                <span className="font-medium text-neutral-700">{issue.path}</span> —{' '}
                                {issue.message}
                            </span>
                        </li>
                    ))}
                </ul>
            )}

            {sections.map((section) => (
                <CourseSectionCard
                    key={section.id}
                    section={section}
                    callbacks={sectionCallbacks}
                />
            ))}

            <div className="flex flex-wrap items-center justify-between gap-2">
                <MyButton buttonType="secondary" onClick={resetForNewZip}>
                    <ArrowLeft className="size-4" />
                    Choose another zip
                </MyButton>
                <div className="flex items-center gap-3">
                    <span className="text-caption text-neutral-500">
                        {!readiness.ready
                            ? readiness.reason
                            : options.publish
                              ? `${getTerminologyPlural(ContentTerms.Slide, SystemTerms.Slide)} will be published`
                              : `${getTerminologyPlural(ContentTerms.Slide, SystemTerms.Slide)} will be drafts`}
                    </span>
                    <MyButton buttonType="primary" onClick={onConfirm} disable={!readiness.ready}>
                        Upload {totalItems}{' '}
                        {getTerminologyPlural(ContentTerms.Slide, SystemTerms.Slide).toLowerCase()}
                    </MyButton>
                </div>
            </div>
        </div>
    );
};

export const PreviewStep = ({ onConfirm, sectionCallbacks }: PreviewStepProps) => {
    const mode = useBulkContentUploadingStore((state) => state.mode);
    if (mode === 'csv') {
        return <CsvPreview onConfirm={onConfirm} />;
    }
    if (mode === 'multi' && sectionCallbacks) {
        return <MultiCoursePreview onConfirm={onConfirm} sectionCallbacks={sectionCallbacks} />;
    }
    return <SingleCoursePreview onConfirm={onConfirm} />;
};

const SingleCoursePreview = ({ onConfirm }: { onConfirm: () => void }) => {
    const nodes = useBulkContentUploadingStore((state) => state.nodes);
    const items = useBulkContentUploadingStore((state) => state.items);
    const issues = useBulkContentUploadingStore((state) => state.issues);
    const fatalErrors = useBulkContentUploadingStore((state) => state.fatalErrors);
    const zipFileName = useBulkContentUploadingStore((state) => state.zipFileName);
    const zipTotalBytes = useBulkContentUploadingStore((state) => state.zipTotalBytes);
    const options = useBulkContentUploadingStore((state) => state.options);
    const setOptions = useBulkContentUploadingStore((state) => state.setOptions);
    const resetForNewZip = useBulkContentUploadingStore((state) => state.resetForNewZip);

    const stats = useMemo(() => {
        const nodeList = Object.values(nodes);
        const itemList = Object.values(items);
        const count = (kind: string) =>
            nodeList.filter((n) => n.kind === kind && n.mapping.action !== 'skip').length;
        // selectCreatedNodes drops the synthetic root and anything under a
        // skipped ancestor, so "(N new)" only promises what Phase 1 will do.
        const creatable = selectCreatedNodes(nodes);
        const toCreate = (kind: string) => creatable.filter((n) => n.kind === kind).length;
        return {
            subjects: count('subject'),
            subjectsToCreate: toCreate('subject'),
            modules: count('module'),
            modulesToCreate: toCreate('module'),
            chapters: count('chapter'),
            chaptersToCreate: toCreate('chapter'),
            slides: itemList.length,
        };
    }, [nodes, items]);

    const issueIcon = (level: 'error' | 'warning' | 'info') =>
        level === 'error' ? (
            <XCircle className="size-4 shrink-0 text-danger-500" />
        ) : level === 'warning' ? (
            <Warning className="size-4 shrink-0 text-warning-600" />
        ) : (
            <Info className="size-4 shrink-0 text-neutral-400" />
        );

    // options.createMissing MUST stay in the deps — without it, unticking the
    // switch would leave a stale [] here and the Upload button wrongly enabled.
    const unresolved = useMemo(
        () => selectUnresolvedNodes(nodes, undefined, options.createMissing),
        [nodes, options.createMissing]
    );

    const createSummary = useMemo(
        () =>
            describeCreatable({
                subject: stats.subjectsToCreate,
                module: stats.modulesToCreate,
                chapter: stats.chaptersToCreate,
            }),
        [stats.subjectsToCreate, stats.modulesToCreate, stats.chaptersToCreate]
    );

    const statChip = (label: string, total: number, toCreate: number) =>
        total > 0 && (
            <span className="rounded-md bg-neutral-50 px-3 py-1.5 text-caption text-neutral-600">
                <span className="font-semibold text-neutral-700">{total}</span> {label}
                {toCreate > 0 &&
                    (options.createMissing ? (
                        <span className="text-primary-600"> ({toCreate} new)</span>
                    ) : (
                        <span className="text-warning-700"> ({toCreate} unmatched)</span>
                    ))}
            </span>
        );

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-subtitle font-semibold text-neutral-700">{zipFileName}</span>
                <span className="text-caption text-neutral-500">{formatBytes(zipTotalBytes)}</span>
                <span className="ml-auto flex flex-wrap gap-2">
                    {statChip(
                        getTerminologyPlural(
                            ContentTerms.Subject,
                            SystemTerms.Subject
                        ).toLowerCase(),
                        stats.subjects,
                        stats.subjectsToCreate
                    )}
                    {statChip(
                        getTerminologyPlural(ContentTerms.Module, SystemTerms.Module).toLowerCase(),
                        stats.modules,
                        stats.modulesToCreate
                    )}
                    {statChip(
                        getTerminologyPlural(
                            ContentTerms.Chapter,
                            SystemTerms.Chapter
                        ).toLowerCase(),
                        stats.chapters,
                        stats.chaptersToCreate
                    )}
                    {statChip(
                        getTerminologyPlural(ContentTerms.Slide, SystemTerms.Slide).toLowerCase(),
                        stats.slides,
                        0
                    )}
                </span>
            </div>

            {fatalErrors.length > 0 && (
                <div className="flex flex-col gap-2 rounded-lg border border-danger-200 bg-danger-50 p-4">
                    {fatalErrors.map((message) => (
                        <div key={message} className="flex items-start gap-2">
                            <XCircle className="mt-0.5 size-4 shrink-0 text-danger-600" />
                            <p className="text-subtitle text-danger-700">{message}</p>
                        </div>
                    ))}
                </div>
            )}

            <PreviewTree />

            {issues.length > 0 && (
                <div className="rounded-lg border border-neutral-200 bg-white">
                    <div className="border-b border-neutral-100 px-4 py-2 text-subtitle font-semibold text-neutral-700">
                        Issues ({issues.length})
                    </div>
                    <ul className="max-h-44 divide-y divide-neutral-100 overflow-y-auto">
                        {issues.map((issue, index) => (
                            <li
                                key={`${issue.path}-${index}`}
                                className="flex items-start gap-2 px-4 py-2"
                            >
                                {issueIcon(issue.level)}
                                <span className="text-caption text-neutral-600">
                                    <span className="font-medium text-neutral-700">
                                        {issue.path}
                                    </span>{' '}
                                    — {issue.message}
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Unmatched folders only become visible after parsing, so the switch
                is repeated here — going back a step to flip it would lose the zip. */}
            {createSummary && (
                <label className="flex items-center justify-between gap-4 rounded-lg border border-neutral-200 bg-white p-3">
                    <span className="flex flex-col">
                        <span className="text-subtitle text-neutral-700">
                            Create missing folders
                        </span>
                        <span className="text-caption text-neutral-500">
                            {options.createMissing
                                ? `${createSummary} will be created`
                                : `${createSummary} have no match — map or skip each one below to continue`}
                        </span>
                    </span>
                    <Switch
                        checked={options.createMissing}
                        onCheckedChange={(checked) => setOptions({ createMissing: checked })}
                    />
                </label>
            )}

            <div className="flex items-center justify-between gap-2">
                <MyButton buttonType="secondary" onClick={resetForNewZip}>
                    <ArrowLeft className="size-4" />
                    Choose another zip
                </MyButton>
                <div className="flex items-center gap-3">
                    <span className="text-caption text-neutral-500">
                        {unresolved.length > 0
                            ? `Match or skip the folder “${unresolved[0]!.displayName}”.`
                            : options.publish
                              ? `${getTerminologyPlural(ContentTerms.Slide, SystemTerms.Slide)} will be published`
                              : `${getTerminologyPlural(ContentTerms.Slide, SystemTerms.Slide)} will be drafts`}
                    </span>
                    <MyButton
                        buttonType="primary"
                        onClick={onConfirm}
                        disable={
                            fatalErrors.length > 0 || stats.slides === 0 || unresolved.length > 0
                        }
                    >
                        Upload {stats.slides}{' '}
                        {getTerminologyPlural(ContentTerms.Slide, SystemTerms.Slide).toLowerCase()}
                    </MyButton>
                </div>
            </div>
        </div>
    );
};
