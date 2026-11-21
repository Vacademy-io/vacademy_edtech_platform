package vacademy.io.admin_core_service.features.workflow.service;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.workflow.controller.WorkflowCatalogController;

import java.util.HashSet;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The keys a workflow of each shop order event may read (§2.2): the keys every order message
 * carries, plus the event's own; the validator then accepts #ctx references to them.
 */
class TriggerContextKeyRegistryCommerceTest {

    private static final Set<String> COMMON = Set.of("orderId", "orderNumber", "trigger", "locale", "customerName",
            "customerPhone", "customerEmail", "userId", "orderTotal", "orderLink", "shopName");

    private static final Map<String, Set<String>> OWN = Map.of(
            "ORDER_CONFIRMED", Set.of(),
            "COD_CONFIRMATION_NEEDED", Set.of(),
            "ORDER_SHIPPED", Set.of("shipmentId", "courier", "trackingNumber", "amountDue"),
            "ORDER_DELIVERED", Set.of("shipmentId"),
            "ORDER_CANCELLED", Set.of("cancelReason"),
            "ORDER_RTO", Set.of("shipmentId"),
            "RETURN_APPROVED", Set.of("returnId", "returnNumber"),
            "REFUND_PROCESSED", Set.of("refundId", "refundAmount", "refundMethod"),
            "POS_BILL_ISSUED", Set.of());

    private final TriggerContextKeyRegistry registry = new TriggerContextKeyRegistry(new WorkflowCatalogController());

    @Test
    void everyCommerceEventHasTheCommonKeysAndItsOwn() {
        assertEquals(Set.copyOf(WorkflowTriggerEventCommerceTest.COMMERCE), OWN.keySet());
        for (Map.Entry<String, Set<String>> e : OWN.entrySet()) {
            Set<String> expected = new HashSet<>(COMMON);
            expected.addAll(e.getValue());
            assertEquals(expected, registry.emittedKeys(e.getKey()), e.getKey());
            Optional<Set<String>> known = registry.knownKeys(e.getKey());
            assertTrue(known.isPresent(), e.getKey());
            assertTrue(known.get().containsAll(expected), e.getKey());
            assertTrue(known.get().containsAll(TriggerContextKeyRegistry.ENGINE_KEYS), e.getKey());
            assertTrue(registry.allKnown().containsKey(e.getKey()), e.getKey());
        }
    }

    @Test
    void aKeyOfAnotherEventIsNotOffered() {
        assertTrue(!registry.emittedKeys("ORDER_CONFIRMED").contains("trackingNumber"));
        assertTrue(!registry.emittedKeys("ORDER_SHIPPED").contains("refundAmount"));
        assertTrue(!registry.emittedKeys("REFUND_PROCESSED").contains("returnNumber"));
    }
}
