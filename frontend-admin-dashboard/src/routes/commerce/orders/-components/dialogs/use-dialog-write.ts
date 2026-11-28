import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { OrderError } from '@/routes/commerce/orders/-shared/order-errors';
import { useOrderWrite } from '@/routes/commerce/orders/-shared/order-hooks';
import type { StaffOrderDetail } from '@/routes/commerce/orders/-shared/order-types';
import { useRequestId } from '@/routes/commerce/orders/-shared/request-id';
import { useOrderErrorHandler, useOrderErrorText } from '../order-ui';

/**
 * One order write from a dialog: the same body keeps its request id (a double
 * tap or a retry replays), the answer replaces the cached detail, and a failure
 * is handled by the contract §4 rules; what is left is shown in the dialog.
 */
export function useDialogWrite<TBody extends { client_request_id: string }>(
    write: (body: TBody) => Promise<StaffOrderDetail>,
    options: {
        open: boolean;
        onOpenChange: (open: boolean) => void;
        currency?: string;
        prefix?: string;
        /** Codes after which the dialog closes with a toast (the order was reloaded). */
        closeOn?: readonly string[];
    }
) {
    const { open, onOpenChange, currency, prefix, closeOn } = options;
    const text = useOrderErrorText();
    const { idFor, reset } = useRequestId(prefix);
    const mutation = useOrderWrite(write);
    const handle = useOrderErrorHandler();
    const [error, setError] = useState<OrderError | null>(null);

    useEffect(() => {
        if (open) setError(null);
        else reset();
    }, [open, reset]);

    const close = useCallback(() => {
        reset();
        setError(null);
        onOpenChange(false);
    }, [onOpenChange, reset]);

    /** Sends the body; resolves to the new detail, or null when it failed. */
    const submit = useCallback(
        async (payload: Omit<TBody, 'client_request_id'>): Promise<StaffOrderDetail | null> => {
            setError(null);
            const body = { ...payload, client_request_id: idFor(payload) } as TBody;
            try {
                const detail = await mutation.mutateAsync(body);
                reset();
                return detail;
            } catch (raw) {
                const left = handle(raw, { close, resetRequestId: reset, currency });
                if (left?.code && closeOn?.includes(left.code)) {
                    toast.error(text(left, currency));
                    close();
                    return null;
                }
                setError(left);
                return null;
            }
        },
        [close, closeOn, currency, handle, idFor, mutation, reset, text]
    );

    return { submit, error, setError, close, pending: mutation.isPending };
}
