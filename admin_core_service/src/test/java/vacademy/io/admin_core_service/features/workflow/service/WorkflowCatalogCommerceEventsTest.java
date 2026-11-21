package vacademy.io.admin_core_service.features.workflow.service;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.workflow.controller.WorkflowCatalogController;
import vacademy.io.admin_core_service.features.workflow.dto.CatalogItemDTO;

import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** The trigger catalog lists the nine shop order events under "Shop", applied to the institute. */
class WorkflowCatalogCommerceEventsTest {

    @Test
    void theNineShopEventsAreCataloguedUnderShopForTheInstitute() {
        List<CatalogItemDTO> events = new WorkflowCatalogController().getTriggerEvents().getBody();
        assertNotNull(events);
        Map<String, CatalogItemDTO> byKey = events.stream()
                .collect(Collectors.toMap(CatalogItemDTO::getKey, Function.identity()));
        for (String name : WorkflowTriggerEventCommerceTest.COMMERCE) {
            CatalogItemDTO item = byKey.get(name);
            assertNotNull(item, name);
            assertEquals("Shop", item.getCategory(), name);
            assertEquals("INSTITUTE", item.getEventAppliedType(), name);
            assertTrue(item.getLabel().startsWith("Shop "), name + ": " + item.getLabel());
            assertFalse(item.getDescription().isBlank(), name);
            assertTrue(item.getRequiredParams().isEmpty(), name);
        }
        assertEquals(9, events.stream().filter(e -> "Shop".equals(e.getCategory())).count());
        // Labels are distinct, so the picker never shows two alike.
        assertEquals(9, events.stream().filter(e -> "Shop".equals(e.getCategory())).map(CatalogItemDTO::getLabel)
                .distinct().count());
    }
}
