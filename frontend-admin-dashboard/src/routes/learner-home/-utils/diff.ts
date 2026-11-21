/** "3 blocks changed, 1 added" for the publish dialog. */
import type { HomeBlock } from '../-types/learner-home-types';
import { blockPayload } from './payload';

export interface BlockDiff {
    added: number;
    removed: number;
    changed: number;
    moved: number;
}

export function diffBlocks(before: HomeBlock[], after: HomeBlock[]): BlockDiff {
    const prev = new Map(
        before.map((b, i) => [b.block_key, { i, json: JSON.stringify(blockPayload(b)) }])
    );
    const nextKeys = new Set(after.map((b) => b.block_key));
    let added = 0;
    let changed = 0;
    let moved = 0;
    // Relative order of the blocks both versions share.
    const sharedBefore = before.filter((b) => nextKeys.has(b.block_key)).map((b) => b.block_key);
    const sharedAfter = after.filter((b) => prev.has(b.block_key)).map((b) => b.block_key);
    after.forEach((b) => {
        const old = prev.get(b.block_key);
        if (!old) {
            added += 1;
            return;
        }
        if (old.json !== JSON.stringify(blockPayload(b))) changed += 1;
    });
    sharedAfter.forEach((key, i) => {
        if (sharedBefore[i] !== key) moved += 1;
    });
    const removed = before.filter((b) => !nextKeys.has(b.block_key)).length;
    return { added, removed, changed, moved };
}

export const isEmptyDiff = (d: BlockDiff) => d.added + d.removed + d.changed + d.moved === 0;
