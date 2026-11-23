import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type OrderError, readOrderError } from '@/routes/commerce/orders/-shared/order-errors';
import { invalidateOrders } from '@/routes/commerce/orders/-shared/order-hooks';
import { useRequestId } from '@/routes/commerce/orders/-shared/request-id';
import { useOrderErrorHandler } from '../order-ui';

/**
 * A write from a dialog whose answer is not the order detail (a return, a
 * refund). Same rules as `useDialogWrite`: one request id per body, the
 * contract §4 reactions, what is left is shown inline. On success the orders
 * are refetched (lists, counts and the detail) and `onAnswer` gets the answer.
 */
export function useAnswerWrite<TBody extends { client_request_id: string }, TAnswer>(
    write: (body: TBody) => Promise<TAnswer>,
    options: {
        open: boolean;
        onOpenChange: (open: boolean) => void;
        currency?: string;
        prefix?: string;
        onAnswer?: (answer: TAnswer) => void;
    }
) {
    const { open, onOpenChange, currency, prefix, onAnswer } = options;
    const queryClient = useQueryClient();
    const { idFor, reset } = useRequestId(prefix);
    const handle = useOrderErrorHandler();
    const [error, setError] = useState<OrderError | null>(null);
    const mutation = useMutation({
        mutationFn: write,
        onSuccess: (answer) => {
            onAnswer?.(answer);
            void invalidateOrders(queryClient);
        },
        onError: (raw) => {
            const status = readOrderError(raw).status;
            if (status === 409 || status === 403) void invalidateOrders(queryClient);
        },
    });

    useEffect(() => {
        if (open) setError(null);
        else reset();
    }, [open, reset]);

    const close = useCallback(() => {
        reset();
        setError(null);
        onOpenChange(false);
    }, [onOpenChange, reset]);

    const submit = useCallback(
        async (payload: Omit<TBody, 'client_request_id'>): Promise<TAnswer | null> => {
            setError(null);
            const body = { ...payload, client_request_id: idFor(payload) } as TBody;
            try {
                const answer = await mutation.mutateAsync(body);
                reset();
                return answer;
            } catch (raw) {
                setError(handle(raw, { close, resetRequestId: reset, currency }));
                return null;
            }
        },
        [close, currency, handle, idFor, mutation, reset]
    );

    return { submit, error, setError, close, pending: mutation.isPending };
}
