import { useCallback, useRef, useState } from 'react';
import { scanCode } from '@/routes/commerce/orders/-shared/order-api';
import type { ScanResult } from '@/routes/commerce/orders/-shared/order-types';
import { buzz, useScanInput } from '@/routes/commerce/orders/-shared/use-scan-input';

/**
 * Scanning on the inventory screens (contract §7.2, §7.4): the shared
 * keyboard-wedge hook (which also reads a label's QR link as its code) and the
 * shared `GET /scan/{code}` lookup, so the till, the pack station, new order
 * lines and inventory read a label the same way. The caller decides what the
 * item means for its screen and calls `refuse()` to buzz.
 */
export type StockScan =
    | { kind: 'PIECE'; code: string; result: ScanResult }
    | { kind: 'VARIANT'; code: string; result: ScanResult }
    | { kind: 'NOT_FOUND'; code: string }
    | { kind: 'ERROR'; code: string; error: unknown };

export function useStockScan(
    onResult: (scan: StockScan) => void,
    options: { paused?: boolean; autoFocus?: boolean } = {}
) {
    const handler = useRef(onResult);
    handler.current = onResult;
    const [busy, setBusy] = useState(false);

    const lookup = useCallback(async (code: string) => {
        setBusy(true);
        try {
            const result = await scanCode(code);
            if (!result) {
                buzz();
                handler.current({ kind: 'NOT_FOUND', code });
            } else {
                handler.current({ kind: result.kind, code, result });
            }
        } catch (error) {
            buzz();
            handler.current({ kind: 'ERROR', code, error });
        } finally {
            setBusy(false);
        }
    }, []);

    const scan = useScanInput((code) => void lookup(code), {
        paused: options.paused,
        autoFocus: options.autoFocus ?? true,
    });
    const refuse = useCallback(() => buzz(), []);
    return { ...scan, busy, refuse };
}
