package vacademy.io.admin_core_service.features.workflow.service;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.notify.CommerceNotificationTrigger;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceOrderEvents;
import vacademy.io.admin_core_service.features.workflow.enums.WorkflowTriggerEvent;

import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** The nine shop order events are workflow trigger events, named as the buyer-message triggers are. */
class WorkflowTriggerEventCommerceTest {

    static final List<String> COMMERCE = List.of("ORDER_CONFIRMED", "COD_CONFIRMATION_NEEDED", "ORDER_SHIPPED",
            "ORDER_DELIVERED", "ORDER_CANCELLED", "ORDER_RTO", "RETURN_APPROVED", "REFUND_PROCESSED",
            "POS_BILL_ISSUED");

    @Test
    void theNineCommerceNamesArePresent() {
        Set<String> names = Arrays.stream(WorkflowTriggerEvent.values()).map(Enum::name).collect(Collectors.toSet());
        for (String name : COMMERCE) {
            assertTrue(names.contains(name), name);
            assertEquals(name, WorkflowTriggerEvent.valueOf(name).name());
        }
    }

    @Test
    void theyAreExactlyTheBuyerMessageTriggersAndTheOrderEventTypes() {
        assertEquals(COMMERCE, Arrays.stream(CommerceNotificationTrigger.values()).map(Enum::name).toList());
        for (String name : COMMERCE) {
            assertEquals(name, CommerceNotificationTrigger.of(name).name());
        }
        assertEquals(Set.copyOf(COMMERCE), Set.of(CommerceOrderEvents.ORDER_CONFIRMED,
                CommerceOrderEvents.COD_CONFIRMATION_NEEDED, CommerceOrderEvents.ORDER_SHIPPED,
                CommerceOrderEvents.ORDER_DELIVERED, CommerceOrderEvents.ORDER_CANCELLED, CommerceOrderEvents.ORDER_RTO,
                CommerceOrderEvents.RETURN_APPROVED, CommerceOrderEvents.REFUND_PROCESSED,
                CommerceOrderEvents.POS_BILL_ISSUED));
    }
}
