package vacademy.io.admin_core_service.features.commerce.notify;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.datasource.ConnectionHolder;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.orm.jpa.JpaTransactionManager;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.commerce.notify.repository.CommerceNotificationStore;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceOrderEvents;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Savepoint;

/**
 * Writes the outbox row of an order event. Inside the caller's transaction it is one insert on
 * the same connection, behind a savepoint: it commits with the order change or not at all, and
 * a failure of the insert is rolled back to the savepoint and written again after the commit,
 * so the order change is never failed by it. Ids only; no personal data.
 *
 * <p>The savepoint is a JDBC savepoint on the connection the transaction exposes, not
 * {@code PROPAGATION_NESTED}: the JPA transaction manager with Hibernate does not support nested
 * transactions (its transaction data is no {@code SavepointManager}), so a nested template there
 * always fails and every row would be written only after the commit.
 */
@Slf4j
@Component
public class CommerceNotificationOutbox {

    private final CommerceNotificationStore store;
    private final PlatformTransactionManager transactionManager;
    private final TransactionTemplate own;

    @PersistenceContext
    private EntityManager entityManager;

    public CommerceNotificationOutbox(CommerceNotificationStore store, PlatformTransactionManager transactionManager) {
        this.store = store;
        this.transactionManager = transactionManager;
        this.own = new TransactionTemplate(transactionManager);
        this.own.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    /** Whether an event of this type and choice gets a row: a trigger, and the buyer is to be told. */
    public static boolean wanted(CommerceOrderEvents.OrderEvent event) {
        return event != null && event.notifyCustomer() && CommerceNotificationTrigger.of(event.type()) != null
                && event.instituteId() != null && event.orderId() != null;
    }

    /** The row, in the caller's transaction when there is one, else in a short one of its own. */
    public void record(CommerceOrderEvents.OrderEvent event) {
        if (!wanted(event)) {
            return;
        }
        if (TransactionSynchronizationManager.isActualTransactionActive()) {
            recordInside(event);
        } else {
            recordOwn(event);
        }
        // recordInside throws only from the flush of the caller's changes; nothing else escapes.
    }

    /**
     * In the caller's transaction, behind a savepoint. Pending entity changes are flushed first
     * (the row names the order, which may be new). Any failure of the insert: back to the
     * savepoint, a WARN, and the row is written after the commit.
     */
    public void recordInside(CommerceOrderEvents.OrderEvent event) {
        if (entityManager != null && entityManager.isJoinedToTransaction()) {
            entityManager.flush();
        }
        try {
            insertBehindSavepoint(event);
        } catch (RuntimeException e) {
            log.warn("COMMERCE_NOTIFY outbox insert failed inside the transaction: order={} trigger={} ({}); "
                    + "written after the commit", event.orderId(), event.type(), e.getClass().getSimpleName());
            if (TransactionSynchronizationManager.isSynchronizationActive()) {
                TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                    @Override
                    public void afterCommit() {
                        recordOwn(event);
                    }
                });
            }
        }
    }

    /**
     * The insert on the transaction's own JDBC connection, between a savepoint and its release; a
     * failure rolls back to the savepoint (the transaction stays usable) and is rethrown. No
     * exposed connection (another kind of transaction manager): refused, so the caller writes the
     * row after the commit instead of on some other connection.
     */
    private void insertBehindSavepoint(CommerceOrderEvents.OrderEvent event) {
        DataSource dataSource = transactionManager instanceof JpaTransactionManager jpa ? jpa.getDataSource()
                : transactionManager instanceof DataSourceTransactionManager jdbc ? jdbc.getDataSource() : null;
        Object resource = dataSource == null ? null : TransactionSynchronizationManager.getResource(dataSource);
        if (!(resource instanceof ConnectionHolder holder) || holder.getConnectionHandle() == null) {
            throw new IllegalStateException("the transaction exposes no JDBC connection");
        }
        Connection connection = holder.getConnection();
        Savepoint savepoint;
        try {
            savepoint = connection.setSavepoint();
        } catch (SQLException e) {
            throw new IllegalStateException("no savepoint", e);
        }
        try {
            store.insertEvent(event.instituteId(), event.orderId(), event.type(), event.refId());
        } catch (RuntimeException e) {
            try {
                connection.rollback(savepoint);
            } catch (SQLException rollback) {
                e.addSuppressed(rollback);
            }
            throw e;
        }
        try {
            connection.releaseSavepoint(savepoint);
        } catch (SQLException ignored) {
            // The savepoint ends with the transaction anyway.
        }
    }

    /** In a short transaction of its own. Never throws. */
    public void recordOwn(CommerceOrderEvents.OrderEvent event) {
        try {
            own.executeWithoutResult(status -> store.insertEvent(event.instituteId(), event.orderId(), event.type(),
                    event.refId()));
        } catch (RuntimeException e) {
            log.warn("COMMERCE_NOTIFY outbox insert failed: order={} trigger={} ({})", event.orderId(), event.type(),
                    e.getClass().getSimpleName());
        }
    }
}
