package vacademy.io.admin_core_service.features.marketing.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AdSpendSyncPathTest {

    @Test
    @DisplayName("Meta insights request names archived and deleted campaigns so their spend is included")
    void insightsPathIncludesArchivedAndDeleted() {
        String path = AdSpendSyncService.metaInsightsPath("act_123", LocalDate.of(2026, 7, 1), LocalDate.of(2026, 7, 31));

        assertTrue(path.startsWith("act_123/insights?level=campaign&time_increment=1"));
        String filtering = null;
        for (String part : path.substring(path.indexOf('?') + 1).split("&")) {
            if (part.startsWith("filtering=")) {
                filtering = URLDecoder.decode(part.substring("filtering=".length()), StandardCharsets.UTF_8);
            }
        }
        assertEquals("[{\"field\":\"campaign.effective_status\",\"operator\":\"IN\",\"value\":"
                + "[\"ACTIVE\",\"PAUSED\",\"ARCHIVED\",\"DELETED\",\"IN_PROCESS\",\"WITH_ISSUES\"]}]", filtering);
    }
}
