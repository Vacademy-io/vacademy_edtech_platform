package vacademy.io.admin_core_service.features.commerce.accounts;

/**
 * Audit kinds of the purchases and accounts work ({@code commerce_audit.kind}, at most 32
 * characters). One spelling for every package that writes them.
 */
public final class AccountsAuditKinds {

    public static final String SUPPLIER_CREATE = "SUPPLIER_CREATE";
    public static final String SUPPLIER_EDIT = "SUPPLIER_EDIT";
    public static final String SUPPLIER_SENSITIVE_VIEW = "SUPPLIER_SENSITIVE_VIEW";
    public static final String PURCHASE_BILL_POST = "PURCHASE_BILL_POST";
    public static final String PURCHASE_BILL_AMEND = "PURCHASE_BILL_AMEND";
    public static final String PURCHASE_BILL_CANCEL = "PURCHASE_BILL_CANCEL";
    public static final String PURCHASE_BILL_META = "PURCHASE_BILL_META";
    public static final String BILL_RECEIPT_LINK = "BILL_RECEIPT_LINK";
    public static final String RECEIPT_NO_BILL = "RECEIPT_NO_BILL";
    public static final String PURCHASE_RETURN_POST = "PURCHASE_RETURN_POST";
    public static final String PURCHASE_RETURN_CANCEL = "PURCHASE_RETURN_CANCEL";
    public static final String SUPPLIER_PAYMENT_POST = "SUPPLIER_PAYMENT_POST";
    public static final String SUPPLIER_PAYMENT_CANCEL = "SUPPLIER_PAYMENT_CANCEL";
    public static final String ALLOCATION_CHANGE = "ALLOCATION_CHANGE";
    public static final String SETTLEMENT_DISCOUNT = "SETTLEMENT_DISCOUNT";
    public static final String SET_OFF = "SET_OFF";
    public static final String EXPENSE_POST = "EXPENSE_POST";
    public static final String EXPENSE_CANCEL = "EXPENSE_CANCEL";
    public static final String MONEY_VOUCHER_POST = "MONEY_VOUCHER_POST";
    public static final String MONEY_VOUCHER_CANCEL = "MONEY_VOUCHER_CANCEL";
    public static final String MONEY_TRANSFER = "MONEY_TRANSFER";
    public static final String RETAG = "RETAG";
    public static final String ENTRY_REVIEWED = "ENTRY_REVIEWED";
    public static final String CLEARED_DATE_SET = "CLEARED_DATE_SET";
    public static final String MONEY_ACCOUNT_EDIT = "MONEY_ACCOUNT_EDIT";
    public static final String RECEIPT_COST_SET = "RECEIPT_COST_SET";
    public static final String STANDARD_COST_SET = "STANDARD_COST_SET";
    public static final String PERIOD_LOCK = "PERIOD_LOCK";
    public static final String PERIOD_UNLOCK = "PERIOD_UNLOCK";
    public static final String ACCOUNTS_IMPORT = "ACCOUNTS_IMPORT";
    public static final String TDS_EXPORT = "TDS_EXPORT";
    public static final String TAX_CODE_EDIT = "TAX_CODE_EDIT";
    public static final String LIMIT_EDIT = "LIMIT_EDIT";
    public static final String STAFF_SCOPE_EDIT = "STAFF_SCOPE_EDIT";
    /** Create or edit of an account head (old and new). */
    public static final String ACCOUNT_HEAD_EDIT = "ACCOUNT_HEAD_EDIT";
    /** The starter heads were inserted for an institute ({@code inserted: n}). */
    public static final String ACCOUNT_HEADS_SEED = "ACCOUNT_HEADS_SEED";

    /** Reference types the accounts audit rows use. */
    public static final String REF_SUPPLIER = "SUPPLIER";
    public static final String REF_PERIOD_LOCK = "PERIOD_LOCK";
    public static final String REF_STAFF = "STAFF";
    public static final String REF_ACCOUNT_HEAD = "ACCOUNT_HEAD";

    private AccountsAuditKinds() {
    }
}
