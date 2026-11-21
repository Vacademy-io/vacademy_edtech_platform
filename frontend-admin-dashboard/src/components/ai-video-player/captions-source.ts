/**
 * Where an AI video's word timings live, given its timeline URL.
 *
 * The pipeline uploads both next to each other:
 *   ai-videos/<id>/timeline/time_based_frame.json
 *   ai-videos/<id>/words/narration.words.json
 * Players that are only handed the timeline (the course slide preview) use
 * this to show captions. Anything else returns undefined.
 */
export function wordsUrlForTimeline(timelineUrl?: string | null): string | undefined {
    if (!timelineUrl) return undefined;
    const m = timelineUrl.match(/^(.*\/ai-videos\/[^/]+\/)timeline\/time_based_frame\.json(\?.*)?$/);
    return m ? `${m[1]}words/narration.words.json` : undefined;
}
