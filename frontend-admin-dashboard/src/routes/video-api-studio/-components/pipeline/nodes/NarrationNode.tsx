import { memo } from 'react';
import { NodeProps } from 'reactflow';
import { useTranslation } from 'react-i18next';
import { CircleNotch as Loader2, Microphone as Mic } from '@phosphor-icons/react';
import { BaseNodeShell } from './BaseNodeShell';
import { buildActiveSubStatus } from '../-utils/stage-vocab';
import type { PipelineNodeData } from '../-utils/build-pipeline-graph';

function NarrationNodeInner({ data }: NodeProps<PipelineNodeData>) {
    const { t } = useTranslation('videoApiStudioStageVocab');
    const slot = data.state.narration;

    if (slot.state !== 'wrapped') {
        return (
            <BaseNodeShell kind="narration" state={slot.state}>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {slot.state === 'in_production' ? (
                        <>
                            <Loader2 className="size-3.5 animate-spin text-blue-600" />
                            {buildActiveSubStatus(t).narration}
                        </>
                    ) : (
                        <>
                            <Mic className="size-3.5 text-muted-foreground/60" />
                            Voice booth not yet open
                        </>
                    )}
                </div>
            </BaseNodeShell>
        );
    }

    const audioUrl = slot.data.audioUrl;
    return (
        <BaseNodeShell kind="narration" state={slot.state}>
            {audioUrl ? (
                <div className="space-y-1.5">
                    {/* Compact pseudo-player — actual <audio> control lives in
                        the detail sheet so it can't overflow the node width.
                        Click anywhere on the node to open the full player. */}
                    <div className="flex items-center gap-2 rounded-md border bg-white px-2 py-1.5">
                        <Mic className="size-3.5 shrink-0 text-blue-600" />
                        <span className="truncate text-2xs font-medium text-foreground">
                            Voiceover ready
                        </span>
                        <span className="ml-auto shrink-0 text-2xs text-muted-foreground">
                            ▶ Open
                        </span>
                    </div>
                    <p className="truncate text-2xs text-muted-foreground">
                        {slot.data.wordsUrl ? 'Audio + word timings sealed' : 'Audio sealed'}
                    </p>
                </div>
            ) : (
                <div className="text-2xs text-muted-foreground">Audio sealed</div>
            )}
        </BaseNodeShell>
    );
}

export const NarrationNode = memo(NarrationNodeInner);
