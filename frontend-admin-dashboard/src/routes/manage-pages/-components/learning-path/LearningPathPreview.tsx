import React from 'react';
import axios from 'axios';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Path, ShoppingCartSimple } from '@phosphor-icons/react';
import { PRODUCT_PAGE_OPEN_URL } from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { cn } from '@/lib/utils';
import { folderTreeQueryKey, getFolderTree, nodeLabel } from '../../-services/folder-library-service';
import type { LearningPathProps } from '../../-types/editor-types';
import { collectPathLeaves, pathSteps, pathTotal, versionLabels, type PathMapping } from './learning-path-utils';

/**
 * Canvas preview of a Learning Path section. One path: the product page's
 * courses as numbered steps, read live from the same anonymous endpoint the
 * site uses (and the Product Page Offer preview — they share the cache). A
 * list of paths: the product pages of the chosen folder library as cards.
 * Interactive bits (cart, "View path") are inert here.
 */

interface P {
    props: LearningPathProps;
}

const Shell: React.FC<{ props: LearningPathProps; children: React.ReactNode }> = ({ props, children }) => (
    <section
        className="catalogue-section"
        style={props.backgroundColor ? { backgroundColor: props.backgroundColor } : undefined} // design-lint-ignore: admin-chosen section colour
    >
        <div className="catalogue-shell">
            {(props.title || props.subtitle) && (
                <div className="catalogue-section-header text-start">
                    {props.title && <h2 className="catalogue-h2 text-catalogue-text-primary">{props.title}</h2>}
                    {props.subtitle && <p className="catalogue-lead text-catalogue-text-muted">{props.subtitle}</p>}
                </div>
            )}
            {children}
        </div>
    </section>
);

const Note: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="rounded-catalogue-lg border border-dashed border-catalogue-border p-8 text-center text-sm text-catalogue-text-muted">
        {children}
    </div>
);

const formatMoney = (amount: number, currency: string | null) =>
    amount === 0 ? 'Free' : `${currency ? `${currency} ` : ''}${amount}`;

const SinglePath: React.FC<P> = ({ props }) => {
    const instituteId = getCurrentInstituteId();
    const code: string = props.productPageCode || '';
    const { data, isLoading, isError } = useQuery({
        queryKey: ['PP_OFFER_PREVIEW', code, instituteId],
        queryFn: async () =>
            (
                await axios.get(
                    `${PRODUCT_PAGE_OPEN_URL}/by-code?code=${encodeURIComponent(code)}&instituteId=${encodeURIComponent(instituteId || '')}`
                )
            ).data,
        enabled: !!code && !!instituteId,
        staleTime: 60_000,
    });

    if (!code) return <Note>Pick the product page that holds this path in the section&apos;s properties.</Note>;
    if (isLoading) return <div className="p-6 text-center text-sm text-catalogue-text-muted">Loading the path…</div>;
    if (isError) return <Note>This product page could not be loaded — it may have been deleted. Pick another.</Note>;

    const steps = pathSteps((data?.mappings || []) as PathMapping[]);
    if (!steps.length) return <Note>{props.emptyText || 'This product page has no courses yet.'}</Note>;
    const total = props.showTotal !== false ? pathTotal(steps) : null;
    const numbered = props.showStepNumbers !== false;

    return (
        <div className="space-y-4">
            <ol className="space-y-3">
                {steps.map((step, i) => {
                    const versions = versionLabels(step);
                    return (
                        <li
                            key={step.courseId}
                            className="catalogue-card-elevated flex items-center gap-4 p-4 text-start"
                        >
                            {numbered && (
                                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-50 text-sm font-bold text-catalogue-brand-ink ring-1 ring-primary-100">
                                    {i + 1}
                                </span>
                            )}
                            <div className="min-w-0 flex-1">
                                <p className="line-clamp-2 text-base font-semibold text-catalogue-text-primary">
                                    {step.title || `Course ${i + 1}`}
                                </p>
                                {versions.length > 0 && (
                                    <div className="mt-1 flex flex-wrap gap-1.5">
                                        {versions.map((v) => (
                                            <span
                                                key={v}
                                                className="rounded-full bg-catalogue-bg-muted px-2 py-0.5 text-xs text-catalogue-text-secondary"
                                            >
                                                {v}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                            {typeof step.price === 'number' && (
                                <span className="shrink-0 text-sm font-bold text-catalogue-text-primary">
                                    {formatMoney(step.price, step.currency)}
                                </span>
                            )}
                        </li>
                    );
                })}
            </ol>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-catalogue-lg border border-catalogue-border bg-catalogue-bg-elevated px-4 py-3">
                <div className="text-sm text-catalogue-text-secondary">
                    {steps.length} step{steps.length === 1 ? '' : 's'}
                    {total && (
                        <>
                            {' · '}
                            <span className="font-bold text-catalogue-text-primary">
                                {formatMoney(total.total, total.currency)}
                            </span>
                        </>
                    )}
                </div>
                <span className="catalogue-btn catalogue-btn-primary catalogue-btn-sm justify-center gap-1.5">
                    <ShoppingCartSimple className="size-3.5" weight="bold" />
                    {props.addAllLabel || 'Add whole path to cart'}
                </span>
            </div>
            <p className="text-center text-2xs text-catalogue-text-muted">
                Without a site cart the button reads &ldquo;{props.enrolLabel || 'Enrol in this path'}&rdquo; and opens
                the product page&apos;s checkout with every step selected.
            </p>
        </div>
    );
};

const PathList: React.FC<P> = ({ props }) => {
    const instituteId = getCurrentInstituteId();
    const libraryId: string = props.libraryId || '';
    const { data: tree, isLoading, isError } = useQuery({
        queryKey: folderTreeQueryKey(instituteId, libraryId),
        queryFn: () => getFolderTree(instituteId!, libraryId),
        enabled: !!instituteId && !!libraryId,
        staleTime: 30_000,
    });

    if (!libraryId) return <Note>Pick the folder library that holds your paths in the section&apos;s properties.</Note>;
    if (isLoading) {
        return (
            <div className="grid grid-cols-3 gap-4">
                {[0, 1, 2].map((i) => (
                    <div key={i} className="h-32 animate-pulse rounded-catalogue-lg bg-catalogue-bg-muted" />
                ))}
            </div>
        );
    }
    if (isError || !tree || !Array.isArray(tree.roots)) {
        return <Note>This folder library could not be loaded — it may have been deleted.</Note>;
    }

    const leaves = collectPathLeaves(tree.roots, props.folderId || null);
    if (!leaves.length) {
        return (
            <Note>
                {props.emptyText ||
                    'No live product pages in this library yet. Add product pages under your stream folders in the folder manager.'}
            </Note>
        );
    }

    return (
        <div className="space-y-3">
            <div className="grid grid-cols-3 gap-4">
                {leaves.map(({ node, stream }) => (
                    <div key={node.id} className="catalogue-card-elevated flex flex-col p-4 text-start">
                        {stream && (
                            <p className="catalogue-eyebrow mb-1 truncate text-catalogue-text-muted">{nodeLabel(stream)}</p>
                        )}
                        <div className="mb-2 flex items-center gap-2">
                            <Path className="size-4 shrink-0 text-catalogue-brand-ink" weight="bold" />
                            <p className="line-clamp-2 text-base font-semibold text-catalogue-text-primary">
                                {nodeLabel(node)}
                            </p>
                        </div>
                        {node.description && (
                            <p className="mb-3 line-clamp-2 text-sm text-catalogue-text-muted">{node.description}</p>
                        )}
                        <span className={cn('catalogue-btn catalogue-btn-secondary catalogue-btn-sm mt-auto justify-center gap-1')}>
                            {props.viewPathLabel || 'View path'} <ArrowRight className="size-3.5" />
                        </span>
                    </div>
                ))}
            </div>
            {props.streamFromUrl && (
                <p className="text-center text-2xs text-catalogue-text-muted">
                    On a stream tab (?stream=…) only that stream&apos;s paths show. The canvas shows every path here.
                </p>
            )}
        </div>
    );
};

export const LearningPathPreview: React.FC<P> = ({ props }) => (
    <Shell props={props}>{props.mode === 'list' ? <PathList props={props} /> : <SinglePath props={props} />}</Shell>
);
