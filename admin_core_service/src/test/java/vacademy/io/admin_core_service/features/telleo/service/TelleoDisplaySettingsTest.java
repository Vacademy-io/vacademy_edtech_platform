package vacademy.io.admin_core_service.features.telleo.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TelleoDisplaySettingsTest {

    @Test
    void listsOnlyTheFourPagesAndTurnsOnTheAllowList() {
        ObjectNode entry = TelleoDisplaySettings.adminEntry();
        assertEquals("ADMIN_DISPLAY_SETTINGS", entry.get("key").asText());
        assertEquals("Admin Display Settings", entry.get("name").asText());
        JsonNode data = entry.get("data");

        List<String> routes = new ArrayList<>();
        data.get("sidebar").forEach(tab -> tab.get("subTabs").forEach(s -> routes.add(s.get("route").asText())));
        assertEquals(List.of("/audience-manager/list", "/calling/dashboard", "/audience-manager/call-log",
                "/calling/ai-agents"), routes);

        assertTrue(data.get("ui").get("sidebarAllowList").asBoolean());
        assertTrue(data.get("ui").get("showAiCredits").asBoolean());
        assertEquals("/calling/dashboard", data.get("postLoginRedirectRoute").asText());

        data.get("sidebarCategories").forEach(c -> {
            if ("CRM".equals(c.get("id").asText())) {
                assertTrue(c.get("visible").asBoolean());
            } else {
                assertFalse(c.get("visible").asBoolean(), c.toString());
            }
        });
    }
}
