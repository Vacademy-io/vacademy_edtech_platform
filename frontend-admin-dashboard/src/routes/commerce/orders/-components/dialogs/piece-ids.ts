import { scanCode } from '@/routes/commerce/orders/-shared/order-api';

/**
 * Piece ids for piece codes. RTO receive, return receive and line cancel name
 * pieces by id; the detail answers codes, and ids only with B1. Without them
 * each code is looked up with the scan route (contract §5.4.3 fallback).
 * Throws `PIECE_LOOKUP_FAILED` when a code cannot be resolved.
 */
export async function resolvePieceIds(
    codes: readonly string[],
    allCodes: readonly string[],
    allIds: readonly string[] | undefined
): Promise<string[]> {
    if (allIds && allIds.length === allCodes.length) {
        return codes.map((code) => {
            const index = allCodes.indexOf(code);
            const id = index >= 0 ? allIds[index] : undefined;
            if (!id) throw new Error('PIECE_LOOKUP_FAILED');
            return id;
        });
    }
    const ids: string[] = [];
    for (const code of codes) {
        const found = await scanCode(code);
        if (!found?.piece?.id) throw new Error('PIECE_LOOKUP_FAILED');
        ids.push(found.piece.id);
    }
    return ids;
}
