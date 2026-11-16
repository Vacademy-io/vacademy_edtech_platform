package vacademy.io.admin_core_service.features.commerce.stock.service;

import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockVariantRepository;

import java.util.UUID;

/**
 * Running numbers from {@code commerce_counter}. A number is taken
 * in a short transaction of its own, before the document's transaction, so two documents never
 * wait on each other for longer than one row update. A number whose document then fails is
 * lost: gaps are allowed for these numbers. GST document numbers do not come from here.
 */
@Service
public class CommerceCounterService {

    public static final String SCOPE_GOODS_RECEIPT = "GRN";

    private final StockVariantRepository repository;
    private final TransactionTemplate ownTransaction;

    public CommerceCounterService(StockVariantRepository repository, PlatformTransactionManager transactionManager) {
        this.repository = repository;
        this.ownTransaction = new TransactionTemplate(transactionManager);
        this.ownTransaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    /** The next value for the scope, starting at 1. */
    public long next(String instituteId, String scopeKey) {
        Long value = ownTransaction.execute(status -> {
            repository.bumpCounter(UUID.randomUUID().toString(), instituteId, scopeKey);
            return repository.readCounter(instituteId, scopeKey);
        });
        if (value == null) {
            throw new IllegalStateException("commerce counter " + scopeKey + " returned no value");
        }
        return value;
    }

    /** For example {@code GRN-000042}. */
    public String nextNumber(String instituteId, String scopeKey) {
        return scopeKey + "-" + String.format("%06d", next(instituteId, scopeKey));
    }
}
