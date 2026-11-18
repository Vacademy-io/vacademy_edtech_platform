package vacademy.io.admin_core_service.features.commerce.pos.service;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.commerce.customer.CommercePhones;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderRepository;
import vacademy.io.admin_core_service.features.commerce.pos.dto.PosDtos;
import vacademy.io.admin_core_service.features.commerce.pos.repository.PosReadRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.Locale;

/**
 * The till finds a bill to return or to correct: by its invoice or order number, the buyer's
 * phone or a piece label, among the delivered orders of every channel and location (a return
 * is taken at any store). The caller is at a till (a session of theirs, or a manager's).
 * Answers carry a name and the phone's last four digits, never an address, an e-mail or a cost.
 */
@Service
public class PosSaleLookupService {

    static final int MAX_RESULTS = 10;
    static final int MAX_QUERY = 64;

    private final PosAccess access;
    private final PosReadRepository readRepository;
    private final PosReceiptService receipts;
    private final CommerceOrderRepository orderRepository;
    private final TransactionTemplate readOnly;

    public PosSaleLookupService(PosAccess access, PosReadRepository readRepository, PosReceiptService receipts,
                                CommerceOrderRepository orderRepository,
                                PlatformTransactionManager transactionManager) {
        this.access = access;
        this.readRepository = readRepository;
        this.receipts = receipts;
        this.orderRepository = orderRepository;
        this.readOnly = new TransactionTemplate(transactionManager);
        this.readOnly.setReadOnly(true);
    }

    /** {@code GET /pos/sales/lookup?sessionId=&q=}: at most 10 delivered bills, newest first. */
    public PosDtos.SalesLookup lookup(CustomUserDetails user, String instituteId, String sessionId, String q) {
        access.session(user, instituteId, sessionId);
        String query = query(q);
        String phone = phoneOf(query);
        String pieceCode = query.toUpperCase(Locale.ROOT);
        List<PosDtos.SaleRow> rows = readOnly.execute(tx -> readRepository.lookupSales(instituteId, query, phone,
                pieceCode, MAX_RESULTS));
        return new PosDtos.SalesLookup(rows == null ? List.of() : rows);
    }

    /** {@code GET /pos/sales/{orderId}?sessionId=}: the bill with the caller's next actions. */
    public PosDtos.SaleDetail detail(CustomUserDetails user, String instituteId, String orderId, String sessionId) {
        access.session(user, instituteId, sessionId);
        String id = orderId == null ? null : orderId.trim();
        Boolean found = id == null || id.isEmpty() ? Boolean.FALSE
                : readOnly.execute(tx -> orderRepository.findByIdAndInstituteId(id, instituteId).isPresent());
        if (!Boolean.TRUE.equals(found)) {
            throw new VacademyException(HttpStatus.NOT_FOUND, "ORDER_NOT_FOUND: no such order");
        }
        return receipts.saleDetail(user, instituteId, id);
    }

    /** The search text: trimmed, 1 to 64 characters. */
    static String query(String q) {
        String query = q == null ? "" : q.trim();
        if (query.isEmpty() || query.length() > MAX_QUERY) {
            throw new InvalidRequestException("VALIDATION: q is an invoice or order number, a phone or a piece code "
                    + "(1 to " + MAX_QUERY + " characters)");
        }
        return query;
    }

    /** The phone a query names, normalised; null when it is not a phone number. */
    static String phoneOf(String query) {
        try {
            return CommercePhones.normalise(query);
        } catch (RuntimeException e) {
            return null;
        }
    }
}
