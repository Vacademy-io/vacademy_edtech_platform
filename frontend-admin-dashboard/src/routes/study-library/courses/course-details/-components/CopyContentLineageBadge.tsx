import { CaretDown, Info } from 'phosphor-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
    useCopyContentLineage,
    type CopyContentBatchRef,
    type CopyContentMode,
} from '@/services/study-library/course-operations/copy-content-lineage';

/**
 * (i) icon in the course structure header that exposes the batch's
 * content-copy lineage:
 *  - if this batch was seeded from another, show "Copied from <X>" + mode;
 *  - if other batches were seeded from this one, list them with each mode.
 *
 * Renders nothing when there is no lineage either way — there's no signal
 * worth surfacing for a vanilla, hand-built batch.
 */
export const CopyContentLineageBadge = ({
    packageSessionId,
}: {
    packageSessionId: string | null | undefined;
}) => {
    const { t } = useTranslation('studyLibraryCopyContentLineageBadge');
    const { data, isLoading } = useCopyContentLineage(packageSessionId);

    if (!packageSessionId || isLoading || !data) return null;

    const hasUpstream = !!data.copiedFrom;
    const hasDownstream = (data.copiedTo?.length ?? 0) > 0;
    if (!hasUpstream && !hasDownstream) return null;

    // Pick a label that hints at the contents without forcing the user to open
    // the popover — "Copy history" is the catch-all when both directions apply.
    const triggerLabel = hasUpstream && hasDownstream
        ? t('copyHistory')
        : hasUpstream
            ? t('copiedContent')
            : t('usedByBatches', { count: data.copiedTo.length });

    return (
        <Popover>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    aria-label={t('showCopyHistory')}
                    className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 transition-colors hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-200"
                >
                    <Info size={13} weight="fill" />
                    <span>{triggerLabel}</span>
                    <CaretDown size={10} weight="bold" />
                </button>
            </PopoverTrigger>
            <PopoverContent
                className="w-[340px] p-0 text-sm"
                align="start"
                sideOffset={6}
            >
                <div className="border-b bg-blue-50 px-4 py-2 text-xs font-medium uppercase tracking-wide text-blue-700">
                    {t('copyHistory')}
                </div>
                <div className="flex flex-col gap-3 px-4 py-3">
                    {hasUpstream && data.copiedFrom && (
                        <UpstreamSection
                            source={data.copiedFrom}
                            mode={data.copiedBy as CopyContentMode | null}
                            t={t}
                        />
                    )}
                    {hasDownstream && (
                        <DownstreamSection refs={data.copiedTo} t={t} />
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
};

const UpstreamSection = ({
    source,
    mode,
    t,
}: {
    source: CopyContentBatchRef;
    mode: CopyContentMode | null;
    t: TFunction;
}) => (
    <section>
        <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">
            {t('contentBroughtInFrom')}
        </div>
        <div className="mt-1 text-sm text-neutral-800">{batchLabel(source, t)}</div>
        {mode && (
            <div className="mt-0.5 text-xs">
                <ModeChip mode={mode} t={t} />
            </div>
        )}
    </section>
);

const DownstreamSection = ({ refs, t }: { refs: CopyContentBatchRef[]; t: TFunction }) => (
    <section>
        <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">
            {t('usedAsSourceBy')}{' '}
            <span className="text-neutral-700">{t('batchCount', { count: refs.length })}</span>
        </div>
        <ul className="mt-1 flex max-h-44 flex-col gap-1.5 overflow-y-auto">
            {refs.map((ref) => (
                <li
                    key={ref.packageSessionId}
                    className="flex flex-col rounded border border-neutral-200 bg-neutral-50 px-2 py-1.5"
                >
                    <span className="text-sm text-neutral-800">{batchLabel(ref, t)}</span>
                    {ref.copiedBy && (
                        <span className="mt-0.5 text-xs">
                            <ModeChip mode={ref.copiedBy} t={t} />
                        </span>
                    )}
                </li>
            ))}
        </ul>
    </section>
);

const ModeChip = ({ mode, t }: { mode: CopyContentMode; t: TFunction }) => {
    const isReference = mode === 'REFERENCE';
    return (
        <span
            className={[
                'inline-block rounded-full px-2 py-0.5 text-[11px] font-medium',
                isReference
                    ? 'bg-amber-100 text-amber-800'
                    : 'bg-blue-100 text-blue-800',
            ].join(' ')}
        >
            {isReference ? t('linkedCopy') : t('separateCopy')}
        </span>
    );
};

const batchLabel = (ref: CopyContentBatchRef, t: TFunction) => {
    const parts = [ref.courseName, ref.sessionName, ref.levelName].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : t('unknownBatch');
};
