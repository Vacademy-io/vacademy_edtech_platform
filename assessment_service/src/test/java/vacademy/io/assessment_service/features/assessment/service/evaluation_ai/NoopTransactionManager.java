package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.SimpleTransactionStatus;

import java.util.ArrayList;
import java.util.List;

/** Runs TransactionTemplate callbacks inline and records each transaction's propagation. */
class NoopTransactionManager implements PlatformTransactionManager {

        final List<Integer> propagations = new ArrayList<>();
        /** Transactions open right now (callbacks run inline, so 0 = outside any). */
        int open;

        @Override
        public TransactionStatus getTransaction(TransactionDefinition definition) {
                open++;
                propagations.add(definition == null ? TransactionDefinition.PROPAGATION_REQUIRED
                                : definition.getPropagationBehavior());
                return new SimpleTransactionStatus();
        }

        @Override
        public void commit(TransactionStatus status) {
                open--;
        }

        @Override
        public void rollback(TransactionStatus status) {
                open--;
        }
}
