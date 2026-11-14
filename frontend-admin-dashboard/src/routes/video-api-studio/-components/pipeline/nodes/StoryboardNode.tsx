import { memo } from 'react';
import { NodeProps } from 'reactflow';
import { useTranslation } from 'react-i18next';
import { CircleNotch, Stack } from '@phosphor-icons/react';
import { BaseNodeShell } from './BaseNodeShell';
import { buildActiveSubStatus } from '../-utils/stage-vocab';
import type { PipelineNodeData } from '../-utils/build-pipeline-graph';

const PREVIEW_SCENES = 4;

function StoryboardNodeInner({ data }: NodeProps<PipelineNodeData>) {
    const { t } = useTranslation('videoApiStudioStageVocab');
    const slot = data.state.storyboard;

    if (slot.state !== 'wrapped') {
        return (
            <BaseNodeShell kind="storyboard" state={slot.state}>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {slot.state === 'in_production' ? (
                        <>
                            <CircleNotch className="size-3.5 animate-spin text-blue-600" />
                            {buildActiveSubStatus(t).storyboard}
                        </>
                    ) : (
                        <>
                            <Stack className="size-3.5 text-muted-foreground/60" />
                            Director hasn&apos;t arrived on set
                        </>
                    )}
                </div>
            </BaseNodeShell>
        );
    }

    const scenes = slot.data.scenes;
    const total = scenes.length;
    const visible = scenes.slice(0, PREVIEW_SCENES);

    return (
        <BaseNodeShell
            kind="storyboard"
            state={slot.state}
            headerMeta={total > 0 ? `${total} scene${total === 1 ? '' : 's'}` : undefined}
        >
            {total === 0 ? (
                <div className="text-2xs text-muted-foreground">Shot plan ready</div>
            ) : (
                <ol className="space-y-1">
                    {visible.map((s) => (
                        <li key={s.index} className="flex items-baseline gap-1.5 text-2xs">
                            <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                                {String(s.index + 1).padStart(2, '0')}
                            </span>
                            <span className="shrink-0 rounded bg-muted px-1 text-2xs font-medium text-muted-foreground">
                                {s.shotType.replace(/_/g, ' ')}
                            </span>
                            <span className="tabular-nums text-muted-foreground/70">
                                {s.durationS.toFixed(1)}s
                            </span>
                            {s.narrationExcerpt && (
                                <span className="min-w-0 truncate italic text-foreground/70">
                                    &ldquo;{s.narrationExcerpt}&rdquo;
                                </span>
                            )}
                        </li>
                    ))}
                    {total > PREVIEW_SCENES && (
                        <li className="text-2xs text-muted-foreground">
                            +{total - PREVIEW_SCENES} more scene
                            {total - PREVIEW_SCENES === 1 ? '' : 's'}
                        </li>
                    )}
                </ol>
            )}
        </BaseNodeShell>
    );
}

export const StoryboardNode = memo(StoryboardNodeInner);
