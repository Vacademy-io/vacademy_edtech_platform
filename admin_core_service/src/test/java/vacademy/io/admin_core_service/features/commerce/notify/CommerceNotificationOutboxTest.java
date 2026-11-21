package vacademy.io.admin_core_service.features.commerce.notify;

import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.ConnectionHolder;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.orm.jpa.JpaTransactionManager;
import org.springframework.test.util.ReflectionTestUtils;
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
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * The outbox row of an order event: inside the caller's transaction it is one insert on the
 * transaction's own connection behind a JDBC savepoint, so it commits with the order change; a
 * failing insert is rolled back to the savepoint, leaves the order change alone and is written
 * after the commit; no row when the buyer is not to be told or the event is no trigger; its own
 * short transaction when there is none; a missing ref is ''.
 */
class CommerceNotificationOutboxTest {

    private static final String INST = "inst-1";
    private static final String ORDER = "order-1";

    private DataSource dataSource;
    private Connection connection;
    private Connection ownConnection;
    private Savepoint savepoint;
    private DataSourceTransactionManager transactionManager;
    private CommerceNotificationStore store;
    private ApplicationEventPublisher publisher;
    private CommerceOrderEvents events;

    @BeforeEach
    void setUp() throws SQLException {
        dataSource = mock(DataSource.class);
        connection = mock(Connection.class, "orderConnection");
        ownConnection = mock(Connection.class, "ownConnection");
        savepoint = mock(Savepoint.class);
        when(dataSource.getConnection()).thenReturn(connection, ownConnection);
        when(connection.setSavepoint()).thenReturn(savepoint);
        // A real JDBC transaction manager over a mocked connection: it binds the connection to the
        // thread exactly as it does in production.
        transactionManager = new DataSourceTransactionManager(dataSource);
        store = mock(CommerceNotificationStore.class);
        publisher = mock(ApplicationEventPublisher.class);
        events = new CommerceOrderEvents(publisher);
        events.setOutbox(new CommerceNotificationOutbox(store, transactionManager));
    }

    @AfterEach
    void tearDown() {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.clear();
        }
        TransactionSynchronizationManager.setActualTransactionActive(false);
    }

    private static CommerceOrderEvents.OrderEvent event(String type, boolean notify, String refId) {
        return new CommerceOrderEvents.OrderEvent(type, INST, ORDER, "SH-000123", null, notify, refId);
    }

    private void inOrderChange(Runnable work) {
        new TransactionTemplate(transactionManager).executeWithoutResult(status -> work.run());
    }

    @Test
    void insideATransactionTheRowIsWrittenOnItsConnectionBehindASavepoint() throws SQLException {
        inOrderChange(() -> events.afterCommit(event("ORDER_CONFIRMED", true, null)));

        InOrder order = inOrder(connection, store, publisher);
        order.verify(connection).setSavepoint();
        order.verify(store).insertEvent(INST, ORDER, "ORDER_CONFIRMED", "");
        order.verify(connection).releaseSavepoint(savepoint);
        order.verify(connection).commit();
        // The Spring event goes out only after the commit.
        order.verify(publisher).publishEvent(any(CommerceOrderEvents.OrderEvent.class));
        verify(connection, never()).rollback(any(Savepoint.class));
        verify(connection, never()).rollback();
        verify(dataSource, times(1)).getConnection();
        verifyNoInteractions(ownConnection);
    }

    @Test
    void aFailingInsertIsRolledBackToItsSavepointAndWrittenAfterTheCommit() throws SQLException {
        when(store.insertEvent(anyString(), anyString(), anyString(), anyString()))
                .thenThrow(new IllegalStateException("insert failed"))
                .thenReturn(1);
        try (LogCapture logs = LogCapture.of(LogCapture.COMMERCE)) {
            inOrderChange(() -> events.afterCommit(event("ORDER_SHIPPED", true, "ship-1")));

            InOrder order = inOrder(connection, ownConnection, store, publisher);
            order.verify(connection).setSavepoint();
            order.verify(store).insertEvent(INST, ORDER, "ORDER_SHIPPED", "ship-1");
            order.verify(connection).rollback(savepoint);
            // The order change itself commits.
            order.verify(connection).commit();
            // Then the row is written in a short transaction of its own.
            order.verify(store).insertEvent(INST, ORDER, "ORDER_SHIPPED", "ship-1");
            order.verify(ownConnection).commit();
            verify(connection, never()).rollback();
            verify(publisher).publishEvent(any(CommerceOrderEvents.OrderEvent.class));
            assertTrue(logs.events().stream().anyMatch(e -> e.getLevel() == ch.qos.logback.classic.Level.WARN
                    && e.getFormattedMessage().contains("outbox insert failed inside the transaction")
                    && e.getFormattedMessage().contains("order=" + ORDER)
                    && e.getFormattedMessage().contains("ORDER_SHIPPED")
                    && !e.getFormattedMessage().contains("insert failed (")), logs.messages().toString());
        }
    }

    @Test
    void aRolledBackOrderChangeLeavesNoRowAndNoLateWrite() throws SQLException {
        when(store.insertEvent(anyString(), anyString(), anyString(), anyString()))
                .thenThrow(new IllegalStateException("insert failed"));
        TransactionTemplate template = new TransactionTemplate(transactionManager);
        template.executeWithoutResult(status -> {
            events.afterCommit(event("ORDER_CONFIRMED", true, ""));
            status.setRollbackOnly();
        });
        verify(store, times(1)).insertEvent(anyString(), anyString(), anyString(), anyString());
        verify(connection).rollback();
        verifyNoInteractions(publisher, ownConnection);
    }

    @Test
    void noRowWhenTheBuyerIsNotToBeToldOrTheEventIsNoTrigger() {
        inOrderChange(() -> {
            events.afterCommit(event("ORDER_SHIPPED", false, "ship-1"));
            events.afterCommit(event("SOMETHING_ELSE", true, ""));
            events.afterCommit(new CommerceOrderEvents.OrderEvent("ORDER_CONFIRMED", null, ORDER, "SH-1", null, true));
        });
        events.afterCommit(event("ORDER_DELIVERED", false, "ship-1"));
        verifyNoInteractions(store);
        // Published as before.
        verify(publisher, times(4)).publishEvent(any(CommerceOrderEvents.OrderEvent.class));
        assertFalse(CommerceNotificationOutbox.wanted(null));
        assertFalse(CommerceNotificationOutbox.wanted(event("ORDER_SHIPPED", false, "s")));
        assertFalse(CommerceNotificationOutbox.wanted(event("order_shipped", true, "s")));
        assertTrue(CommerceNotificationOutbox.wanted(event("POS_BILL_ISSUED", true, null)));
    }

    @Test
    void withoutATransactionTheRowGetsAShortTransactionOfItsOwn() throws SQLException {
        events.afterCommit(event("REFUND_PROCESSED", true, "refund-1"));
        verify(store).insertEvent(INST, ORDER, "REFUND_PROCESSED", "refund-1");
        verify(connection).commit();
        verify(connection, never()).setSavepoint();
        verify(publisher).publishEvent(any(CommerceOrderEvents.OrderEvent.class));

        FakeTransactions own = new FakeTransactions();
        new CommerceNotificationOutbox(store, own).record(event("ORDER_RTO", true, "ship-9"));
        assertEquals(1, own.committed);
        assertEquals(TransactionDefinition.PROPAGATION_REQUIRES_NEW,
                own.definitions.get(0).getPropagationBehavior());
    }

    @Test
    void aMissingRefIsStoredAsEmpty() {
        assertEquals("", event("ORDER_CONFIRMED", true, null).refId());
        assertEquals("ship-1", new CommerceOrderEvents.OrderEvent("ORDER_SHIPPED", INST, ORDER, "SH-1", "ship-1", true)
                .refId(), "the six-field form takes the shipment as the ref");
        assertEquals("", new CommerceOrderEvents.OrderEvent("ORDER_CONFIRMED", INST, ORDER, "SH-1", null, true)
                .refId());

        events.afterCommit(event("ORDER_CONFIRMED", true, null));
        verify(store).insertEvent(INST, ORDER, "ORDER_CONFIRMED", "");

        // And the SQL itself never binds a null ref.
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        new CommerceNotificationStore(jdbc).insertEvent(INST, ORDER, "ORDER_CONFIRMED", null);
        org.mockito.invocation.Invocation update = org.mockito.Mockito.mockingDetails(jdbc).getInvocations()
                .iterator().next();
        assertEquals("update", update.getMethod().getName());
        String sql = (String) update.getRawArguments()[0];
        Object[] bound = (Object[]) update.getRawArguments()[1];
        assertTrue(sql.contains("ON CONFLICT (institute_id, order_id, trigger_code, ref_id) DO NOTHING"), sql);
        assertEquals(List.of(INST, ORDER, "ORDER_CONFIRMED", ""), List.of(bound).subList(1, 5));
    }

    @Test
    void underTheJpaTransactionManagerTheSavepointIsTakenOnItsJdbcConnection() throws SQLException {
        JpaTransactionManager jpa = mock(JpaTransactionManager.class);
        when(jpa.getDataSource()).thenReturn(dataSource);
        CommerceNotificationOutbox outbox = new CommerceNotificationOutbox(store, jpa);
        EntityManager entityManager = mock(EntityManager.class);
        when(entityManager.isJoinedToTransaction()).thenReturn(true);
        ReflectionTestUtils.setField(outbox, "entityManager", entityManager);

        TransactionSynchronizationManager.initSynchronization();
        TransactionSynchronizationManager.setActualTransactionActive(true);
        TransactionSynchronizationManager.bindResource(dataSource, new ConnectionHolder(connection));
        try {
            outbox.record(event("RETURN_APPROVED", true, "return-1"));
        } finally {
            TransactionSynchronizationManager.unbindResource(dataSource);
        }
        InOrder order = inOrder(entityManager, connection, store);
        order.verify(entityManager).flush();
        order.verify(connection).setSavepoint();
        order.verify(store).insertEvent(INST, ORDER, "RETURN_APPROVED", "return-1");
        order.verify(connection).releaseSavepoint(savepoint);
        assertTrue(TransactionSynchronizationManager.getSynchronizations().isEmpty(), "nothing left for later");
    }

    @Test
    void aTransactionThatExposesNoConnectionGetsTheRowAfterItsCommit() {
        FakeTransactions noJdbc = new FakeTransactions();
        CommerceNotificationOutbox outbox = new CommerceNotificationOutbox(store, noJdbc);
        new TransactionTemplate(noJdbc).executeWithoutResult(status -> {
            outbox.record(event("ORDER_CANCELLED", true, ""));
            verify(store, never()).insertEvent(anyString(), anyString(), anyString(), anyString());
            List<TransactionSynchronization> later = TransactionSynchronizationManager.getSynchronizations();
            assertEquals(1, later.size());
        });
        verify(store).insertEvent(eq(INST), eq(ORDER), eq("ORDER_CANCELLED"), eq(""));
        assertEquals(2, noJdbc.committed, "the order change, then the row's own transaction");
    }
}
