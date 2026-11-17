package vacademy.io.admin_core_service.features.voomsales.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class VoomSalesDisplaySettingsTest {

    @Test
    void showsTheCrmCategoryOnlyAndLeavesItsTabsToTheDefaults() {
        ObjectNode entry = VoomSalesDisplaySettings.adminEntry();
        assertEquals("ADMIN_DISPLAY_SETTINGS", entry.get("key").asText());
        assertEquals("Admin Display Settings", entry.get("name").asText());
        JsonNode data = entry.get("data");

        // No tab list and no allow-list: every CRM tab comes from the dashboard defaults.
        assertNull(data.get("sidebar"));
        assertFalse(data.get("ui").has("sidebarAllowList"));
        assertEquals("/audience-manager/list", data.get("postLoginRedirectRoute").asText());

        List<String> visible = new ArrayList<>();
        List<String> listed = new ArrayList<>();
        data.get("sidebarCategories").forEach(c -> {
            listed.add(c.get("id").asText());
            if (c.get("visible").asBoolean()) visible.add(c.get("id").asText());
        });
        assertEquals(List.of("CRM"), visible);
        // Commerce is visible by default, so it must be listed to be hidden.
        assertTrue(listed.containsAll(List.of("LMS", "AI", "ERP", "COMMERCE")), listed.toString());
    }

    @Test
    void recognisesTheProductKey() {
        assertTrue(VoomSalesDisplaySettings.isVoomSales("voomsales"));
        assertTrue(VoomSalesDisplaySettings.isVoomSales(" VoomSales "));
        assertFalse(VoomSalesDisplaySettings.isVoomSales("telleo"));
        assertFalse(VoomSalesDisplaySettings.isVoomSales(null));
    }
}
