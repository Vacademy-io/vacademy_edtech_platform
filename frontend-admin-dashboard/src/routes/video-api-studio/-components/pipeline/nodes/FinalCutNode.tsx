import { memo, useState } from 'react';
import { NodeProps } from 'reactflow';
import { useTranslation } from 'react-i18next';
import { CircleNotch as Loader2, ArrowsOut as Maximize2, FilmStrip as Film } from '@phosphor-icons/react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { AIContentPlayer } from '@/components/ai-video-player/AIContentPlayer';
import { BaseNodeShell } from './BaseNodeShell';
import { buildActiveSubStatus } from '../-utils/stage-vocab';
import type { PipelineNodeData } from '../-utils/build-pipeline-graph';

const PLAYER_W = 460;
const PLAYER_H_LANDSCAPE = 258; // 16:9 of 460
const PLAYER_H_PORTRAIT = 460 * (16 / 9); // 818 — far too tall, so we cap

function FinalCutNodeInner({ data }: NodeProps<PipelineNodeData>) {
    const { t } = useTranslation('videoApiStudioStageVocab');
    const slot = data.state.finalCut;
    const [fullscreenOpen, setFullscreenOpen] = useState(false);

    if (slot.state === 'cut') {
        return (
            <BaseNodeShell kind="finalCut" state={slot.state} emphasized clickable={false}>
                <p className="text-sm text-red-700">{slot.error}</p>
            </BaseNodeShell>
        );
    }

    if (slot.state !== 'wrapped') {
        // Live "Now in production" placeholder. Keep visual weight similar to
        // the wrapped state so the layout doesn't shift when the player mounts.
        return (
            <BaseNodeShell kind="finalCut" state={slot.state} emphasized clickable={false}>
                <div
                    className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-blue-200 bg-gradient-to-br from-blue-50 via-white to-indigo-50 px-4 py-8 text-center"
                    style={{ minHeight: PLAYER_H_LANDSCAPE - 16 }}
                >
                    <div className="rounded-full bg-blue-100 p-3">
                        {slot.state === 'in_production' ? (
                            <Loader2 className="size-7 animate-spin text-blue-600" />
                        ) : (
                            <Film className="size-7 text-muted-foreground/60" />
                        )}
                    </div>
                    <div className="space-y-0.5">
                        <p className="text-sm font-semibold text-foreground">
                            {slot.state === 'in_production' ? 'In production' : 'Pre-production'}
                        </p>
                        <p className="text-2xs text-muted-foreground">
                            {buildActiveSubStatus(t).finalCut}
                        </p>
                    </div>
                </div>
            </BaseNodeShell>
        );
    }

    const isPortrait = slot.data.orientation === 'portrait';
    const playerHeight = isPortrait ? Math.min(PLAYER_H_PORTRAIT, 380) : PLAYER_H_LANDSCAPE;
    const fullPlayerWidth = isPortrait ? 540 : 1280;
    const fullPlayerHeight = isPortrait ? 960 : 720;

    return (
        <BaseNodeShell
            kind="finalCut"
            state={slot.state}
            label="Final Cut"
            headerMeta="Wrapped"
            emphasized
            clickable={false}
        >
            <div className="space-y-2">
                <div
                    className="overflow-hidden rounded-md border-2 border-black/10 bg-black"
                    style={{
                        width: PLAYER_W,
                        height: playerHeight,
                    }}
                >
                    <AIContentPlayer
                        timelineUrl={slot.data.timelineUrl}
                        audioUrl={slot.data.audioUrl}
                        wordsUrl={slot.data.wordsUrl}
                        width={isPortrait ? 1080 : 1920}
                        height={isPortrait ? 1920 : 1080}
                    />
                </div>
                <button
                    onClick={() => setFullscreenOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-white px-2 py-1 text-2xs font-medium text-foreground shadow-sm transition-colors hover:bg-muted"
                    type="button"
                >
                    <Maximize2 className="size-3" />
                    Watch fullscreen
                </button>
            </div>

            <Dialog open={fullscreenOpen} onOpenChange={setFullscreenOpen}>
                <DialogContent className="w-dialog-xl p-0">
                    <DialogTitle className="sr-only">Final Cut preview</DialogTitle>
                    <div
                        className="bg-black"
                        style={{
                            aspectRatio: isPortrait ? '9/16' : '16/9',
                            maxHeight: 'calc(95vh - 40px)',
                        }}
                    >
                        <AIContentPlayer
                            timelineUrl={slot.data.timelineUrl}
                            audioUrl={slot.data.audioUrl}
                            wordsUrl={slot.data.wordsUrl}
                            width={fullPlayerWidth}
                            height={fullPlayerHeight}
                        />
                    </div>
                </DialogContent>
            </Dialog>
        </BaseNodeShell>
    );
}

export const FinalCutNode = memo(FinalCutNodeInner);
