package vacademy.io.admin_core_service.features.commerce.pos.service;

import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceBuyerResolver;
import vacademy.io.admin_core_service.features.commerce.pos.entity.CommercePosWalkIn;
import vacademy.io.admin_core_service.features.commerce.pos.repository.CommercePosWalkInRepository;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * The one "walk-in customer" auth user of an institute, which every counter sale without a
 * phone is written for. Found in {@code commerce_pos_walk_in}; made once through the account
 * service (a remote call, outside any transaction) with the deterministic placeholder address
 * of {@link CommerceBuyerResolver#walkInEmail}, so a race or a retry finds the same user. The
 * row never changes, so it is cached per institute for the life of the process.
 */
@Component
public class PosWalkInUsers {

    private final CommercePosWalkInRepository repository;
    private final CommerceBuyerResolver buyerResolver;
    private final TransactionTemplate ownTransaction;
    private final Map<String, String> cache = new ConcurrentHashMap<>();

    public PosWalkInUsers(CommercePosWalkInRepository repository, CommerceBuyerResolver buyerResolver,
                          PlatformTransactionManager transactionManager) {
        this.repository = repository;
        this.buyerResolver = buyerResolver;
        this.ownTransaction = new TransactionTemplate(transactionManager);
        this.ownTransaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    /** The walk-in user of the institute. Called before the sale's transaction opens. */
    public String userId(String instituteId) {
        String cached = cache.get(instituteId);
        if (cached != null) {
            return cached;
        }
        String found = read(instituteId);
        if (found == null) {
            String userId = buyerResolver.walkInAccount(instituteId);
            ownTransaction.executeWithoutResult(status -> repository.insertIfMissing(UUID.randomUUID().toString(),
                    instituteId, userId));
            found = read(instituteId);
            if (found == null) {
                throw new IllegalStateException("the walk-in row of institute " + instituteId + " is missing");
            }
        }
        cache.put(instituteId, found);
        return found;
    }

    private String read(String instituteId) {
        return ownTransaction.execute(status -> repository.findByInstituteId(instituteId)
                .map(CommercePosWalkIn::getUserId).orElse(null));
    }
}
