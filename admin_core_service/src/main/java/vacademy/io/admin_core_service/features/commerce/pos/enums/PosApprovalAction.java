package vacademy.io.admin_core_service.features.commerce.pos.enums;

/**
 * {@code commerce_approval.action} of the counter: what a cashier needs a manager's PIN for.
 * A manager or an institute ADMIN acting needs no PIN.
 */
public enum PosApprovalAction {
    /** Line and bill discounts above the cashier's percent of the bill. */
    POS_DISCOUNT,
    /** Every void by a cashier. */
    POS_VOID,
    /** Every change of a payment mode by a cashier. */
    POS_TENDER_CHANGE,
    /** Every paper bill keyed in by a cashier. */
    POS_BILL_BOOK,
    /**
     * A refund above the cashier's refund limit, whatever the method (CASH, UPI, BANK_TRANSFER):
     * a counter return's refund, or an exchange's remainder paid back.
     */
    POS_CASH_REFUND,
    /**
     * A counter return with return-policy warnings, or of a bill not sold at a counter of this
     * location (an online or desk order, another location's counter bill).
     */
    POS_RETURN_OVERRIDE,
    /** A close whose cash difference is above the cashier's limit. */
    POS_VARIANCE,
    /** Spending the credit of a return that was not taken at the counter in the cashier's own session. */
    POS_EXCHANGE
}
