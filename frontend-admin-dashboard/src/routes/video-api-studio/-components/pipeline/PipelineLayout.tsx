import { useTranslation } from 'react-i18next';
import { PipelineFlow } from './PipelineFlow';
import { PipelinePanel } from './PipelinePanel';
import type { PipelineEventLogEntry, PipelineState } from './-utils/derive-pipeline-state';

interface PipelineLayoutProps {
    state: PipelineState;
    apiKey?: string;
    /**
     * In-memory SSE event log from the live session, used by the Developer /
     * Audit drawer to show the chronological pipeline path. Absent on
     * history-loaded runs (the audit drawer synthesizes a coarse path from
     * `state` instead).
     */
    eventLog?: PipelineEventLogEntry[];
    /**
     * Cancel an in-flight production. Wired to the console's `abortRef` —
     * surfaced from the right panel only when the run is `in_production`.
     * Also clears the persisted PENDING_GENERATION_KEY so the run doesn't
     * auto-resume on next reload.
     */
    onAbort?: () => void;
    /**
     * Retry a halted production. Wired to the console's full-pipeline
     * retry handler. Surfaced when the run state is `halted`.
     */
    onRetry?: () => void;
    /**
     * Override the default "Edit" navigation in the right panel. Defaults to
     * the admin route; vim supplies a handler that navigates to `/vim/edit/$videoId`.
     */
    onEdit?: (params: {
        videoId: string;
        htmlUrl: string;
        audioUrl: string;
        wordsUrl: string;
        apiKey: string;
        orientation: string;
    }) => void;
}

/**
 * Single layout used in BOTH `consoleState === 'generating'` and `'complete'`.
 * Content updates as `state` changes; structure stays constant.
 *
 * Left 2/3 = React Flow production diagram. Right 1/3 = stages list,
 * production budget, asset URLs, actions.
 */
export function PipelineLayout({
    state,
    apiKey,
    eventLog,
    onAbort,
    onRetry,
    onEdit,
}: PipelineLayoutProps) {
    const { t } = useTranslation('videoApiStudioPipelineLayout');

    return (
        <div className="flex size-full min-h-0 flex-col gap-3 sm:gap-4 xl:min-h-[600px] xl:flex-row">{/* design-lint-ignore: no minHeight token in tailwind.config for this px value; Tailwind's default minHeight scale has no numeric steps */}
            {/* Left: flow diagram (2/3 on desktop) */}
            <div className="flex min-h-[320px] flex-1 flex-col rounded-xl border bg-card shadow-sm sm:min-h-[400px] xl:min-h-[480px] xl:basis-2/3">{/* design-lint-ignore: no minHeight token in tailwind.config for these px values */}
                <header className="flex items-start justify-between gap-2 border-b px-4 py-3">
                    <div className="min-w-0 flex-1">
                        <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                            {t('productionLabel')}
                        </p>
                        <h2 className="line-clamp-1 text-sm font-semibold text-foreground">
                            {state.prompt || t('untitledProduction')}
                        </h2>
                    </div>
                </header>
                <div className="relative min-h-[320px] flex-1 sm:min-h-[400px] xl:min-h-[480px]">{/* design-lint-ignore: no minHeight token in tailwind.config for these px values */}
                    <PipelineFlow state={state} apiKey={apiKey} />
                </div>
            </div>

            {/* Right: stages + URLs + actions (1/3 on desktop) */}
            <div className="flex shrink-0 flex-col rounded-xl border bg-card shadow-sm xl:basis-1/3">
                <PipelinePanel
                    state={state}
                    apiKey={apiKey}
                    eventLog={eventLog}
                    onAbort={onAbort}
                    onRetry={onRetry}
                    onEdit={onEdit}
                />
            </div>
        </div>
    );
}
