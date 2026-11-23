import type { StaffOrderDetail } from '@/routes/commerce/orders/-shared/order-types';

/** Props every order dialog takes: it is opened for one order detail. */
export interface OrderDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    detail: StaffOrderDetail;
}
