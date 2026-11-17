package vacademy.io.admin_core_service.features.commerce.notify;

import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.AbstractPlatformTransactionManager;
import org.springframework.transaction.support.DefaultTransactionStatus;

import java.util.ArrayList;
import java.util.List;

/**
 * A transaction manager that really opens transactions on the thread (so
 * {@code TransactionSynchronizationManager.isActualTransactionActive()} is true inside one and
 * synchronizations run), without a database. Counts what it did.
 */
public class FakeTransactions extends AbstractPlatformTransactionManager {

    public int begun;
    public int committed;
    public int rolledBack;
    public final List<TransactionDefinition> definitions = new ArrayList<>();

    @Override
    protected Object doGetTransaction() {
        return new Object();
    }

    @Override
    protected void doBegin(Object transaction, TransactionDefinition definition) {
        begun++;
        definitions.add(definition);
    }

    @Override
    protected void doCommit(DefaultTransactionStatus status) {
        committed++;
    }

    @Override
    protected void doRollback(DefaultTransactionStatus status) {
        rolledBack++;
    }
}
