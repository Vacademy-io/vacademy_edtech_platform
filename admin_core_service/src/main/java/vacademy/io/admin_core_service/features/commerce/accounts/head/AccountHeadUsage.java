package vacademy.io.admin_core_service.features.commerce.accounts.head;

/**
 * Tells whether an account head is used by a document of some package (bills, expenses, money
 * vouchers). A used head keeps its nature. Every bean of this type is asked; none means unused.
 */
public interface AccountHeadUsage {

    boolean isUsed(String instituteId, String headId);
}
