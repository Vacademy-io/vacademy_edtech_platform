package vacademy.io.admin_core_service.features.commerce.order.cod;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.commerce.customer.repository.CommerceCustomerRepository;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CheckoutException;
import vacademy.io.admin_core_service.features.commerce.order.checkout.VerifiedPhones;
import vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSettings;

import java.math.BigDecimal;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * The rules of placing a cash-on-delivery order online (WP-31), apart from the price:
 * <ol>
 *   <li><b>Phone proof:</b> a verified-phone token of an OTP for this shop and this phone, of
 *       purpose CHECKOUT or COD. A shopper session never counts. Without it: 403
 *       {@code phone_verification_required}, details {@code {param: phone_token, reason: cod}}.</li>
 *   <li><b>Limits per phone:</b> fewer open unpaid COD orders than {@code cod.maxOpenOrdersPerPhone}
 *       (else 409 {@code payment_method_not_available}, reason {@code OPEN_COD_ORDERS}) and fewer
 *       refusals than {@code cod.maxRefusals} (reason {@code COD_REFUSALS}). Checked once early
 *       and again inside the order transaction under a lock on the customer row of the phone.</li>
 *   <li><b>The token is spent</b> in the order transaction: a rollback leaves it unspent, and a
 *       token can place one order.</li>
 *   <li><b>Staff confirmation:</b> a total above {@code cod.staffConfirmThreshold} is placed as
 *       COD_PENDING_CONFIRMATION, due within {@code cod.confirmWithinHours}.</li>
 * </ol>
 */
@Component
public class CommerceCodPlacementRules {

    public static final String REASON_COD_NOT_AVAILABLE = "COD_NOT_AVAILABLE";
    public static final String REASON_OPEN_COD_ORDERS = CodEligibility.OPEN_COD_ORDERS;
    public static final String REASON_COD_REFUSALS = "COD_REFUSALS";

    private final VerifiedPhones verifiedPhones;
    private final CommerceCustomerRepository customerRepository;
    /** Not read-only: a read-only transaction would read the replica. */
    private final TransactionTemplate primary;

    public CommerceCodPlacementRules(VerifiedPhones verifiedPhones, CommerceCustomerRepository customerRepository,
                                     PlatformTransactionManager transactionManager) {
        this.verifiedPhones = verifiedPhones;
        this.customerRepository = customerRepository;
        this.primary = new TransactionTemplate(transactionManager);
    }

    /** What the order writer needs to place a COD order. */
    public record Terms(boolean staffConfirmation, Date confirmDueAt) {
    }

    /** True when {@code token} proves {@code phone} for COD in this shop. Reads; spends nothing. */
    public boolean proved(String instituteId, String token, String phone) {
        if (token == null || phone == null) {
            return false;
        }
        return phone.equals(verifiedPhones.phoneOf(instituteId, token, VerifiedPhones.PURPOSE_CHECKOUT))
                || phone.equals(verifiedPhones.phoneOf(instituteId, token, VerifiedPhones.PURPOSE_COD));
    }

    /** 403 for a COD request whose phone is not proved; nothing has been written. */
    public static CheckoutException phoneNotProved() {
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("param", "phone_token");
        details.put("reason", "cod");
        return new CheckoutException(HttpStatus.FORBIDDEN, CheckoutException.PHONE_VERIFICATION_REQUIRED,
                "Verify your phone number to pay on delivery.", details);
    }

    /** 409 {@code payment_method_not_available} with the reason the storefront reads. */
    public static CheckoutException notAvailable(String reason, String message) {
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("reason", reason == null ? REASON_COD_NOT_AVAILABLE : reason);
        return new CheckoutException(HttpStatus.CONFLICT, CheckoutException.PAYMENT_METHOD_NOT_AVAILABLE, message,
                details);
    }

    /** The early check of the limits per phone, before any remote call; no lock is taken. */
    public void requireUnderLimits(String instituteId, String phone, StorefrontSettings.Cod cod) {
        Long open = primary.execute(status -> customerRepository.countOpenCodOrders(instituteId, phone));
        Integer refusals = primary.execute(status -> customerRepository.findCodRefusalsByPhone(instituteId, phone));
        check(cod, open == null ? 0 : open, refusals == null ? 0 : refusals);
    }

    /**
     * Inside the order transaction: spends the token, then locks the customer row of the phone
     * (made with the phone alone when the shop has not seen it) and checks the limits again.
     * Any refusal rolls the transaction back, the spent token included.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void spendAndLock(String instituteId, String token, String phone, StorefrontSettings.Cod cod) {
        if (!verifiedPhones.spendForCod(instituteId, token, phone)) {
            throw phoneNotProved();
        }
        customerRepository.insertIfAbsent(UUID.randomUUID().toString(), instituteId, phone);
        Integer refusals = customerRepository.lockCodRefusalsByPhone(instituteId, phone);
        long open = customerRepository.countOpenCodOrders(instituteId, phone);
        check(cod, open, refusals == null ? 0 : refusals);
    }

    static void check(StorefrontSettings.Cod cod, long openOrders, int refusals) {
        if (openOrders >= cod.maxOpenOrdersPerPhone()) {
            throw notAvailable(REASON_OPEN_COD_ORDERS,
                    "Cash on delivery is not available while another COD order is on its way.");
        }
        // maxRefusals = 0 blocks every phone: kept fail-closed.
        if (refusals >= cod.maxRefusals()) {
            throw notAvailable(REASON_COD_REFUSALS, "Cash on delivery is not available for this number.");
        }
    }

    /** Above the confirmation amount the order waits for staff, at most {@code confirmWithinHours}. */
    public static Terms terms(StorefrontSettings.Cod cod, BigDecimal total, Date now) {
        boolean confirm = total != null && cod.staffConfirmThreshold() != null
                && total.compareTo(cod.staffConfirmThreshold()) > 0;
        Date due = confirm ? new Date(now.getTime() + cod.confirmWithinHours() * 3_600_000L) : null;
        return new Terms(confirm, due);
    }
}
