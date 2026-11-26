package vacademy.io.admin_core_service.features.journey_status;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.journey_status.service.JourneyStatusConfig;

import static org.junit.jupiter.api.Assertions.*;

class JourneyStatusConfigTest {

    private static final ObjectMapper M = new ObjectMapper();

    @Test
    void absentSettingIsOffWithNrithyasSevenStatuses() {
        JourneyStatusConfig c = JourneyStatusConfig.off();
        assertFalse(c.enabled());
        assertEquals(7, c.statuses().size());
        assertEquals("learning", c.defaultStatus());
        assertEquals("temporary_break", c.statusOnPause());
        assertEquals("learning", c.statusOnResume());
        assertFalse(c.autoRisk().enabled());
        assertEquals("at_risk", c.autoRisk().status());
        assertEquals(3, c.autoRisk().missedClasses());
        assertEquals(15, c.autoRisk().feeOverdueDays());
        assertTrue(c.autoRisk().autoReturn());
    }

    @Test
    void resolvesLabelsAndKeys() {
        JourneyStatusConfig c = JourneyStatusConfig.off();
        assertEquals("temporary_break", c.resolve("Temporary Break"));
        assertEquals("re_entry", c.resolve("Re-entry"));
        assertEquals("at_risk", c.resolve("at_risk"));
        assertNull(c.resolve("Graduated"));
        assertEquals("RISK", c.kindOf("at_risk"));
        assertEquals("ACTIVE", c.kindOf(null)); // no row = the default status
        assertEquals("ACTIVE", c.kindOf("removed_status"));
    }

    @Test
    void customListKeepsKeysAndDropsInvalidEntries() throws Exception {
        JourneyStatusConfig c = JourneyStatusConfig.from(M.readTree("""
                {"enabled": true,
                 "statuses": [
                   {"key": "active", "label": "Active", "color": "#00ff00", "kind": "ACTIVE"},
                   {"key": "holiday", "label": "On holiday", "color": "red", "kind": "BREAK"},
                   {"key": "watch", "label": "Watch", "kind": "RISK"},
                   {"key": "active", "label": "Duplicate", "kind": "ACTIVE"},
                   {"key": "bad", "label": "Bad kind", "kind": "SOMETHING"}],
                 "status_on_pause": "holiday",
                 "auto_risk": {"enabled": true, "missed_classes": 0, "fee_overdue_days": 400, "auto_return": false}}
                """));
        assertTrue(c.enabled());
        assertEquals(3, c.statuses().size());
        assertEquals("active", c.defaultStatus());
        assertEquals("holiday", c.statusOnPause());
        assertEquals("active", c.statusOnResume());
        assertEquals("#6b7280", c.status("holiday").color()); // invalid colour → neutral
        assertEquals("watch", c.autoRisk().status());
        assertEquals(0, c.autoRisk().missedClasses()); // rule off
        assertEquals(365, c.autoRisk().feeOverdueDays()); // clamped
        assertFalse(c.autoRisk().autoReturn());
    }

    @Test
    void unknownRuleTargetsFallBack() throws Exception {
        JourneyStatusConfig c = JourneyStatusConfig.from(M.readTree("""
                {"enabled": true, "default_status": "nope", "status_on_pause": "nope", "auto_risk": {"status": "nope"}}
                """));
        assertEquals("learning", c.defaultStatus());
        assertEquals("temporary_break", c.statusOnPause());
        assertEquals("at_risk", c.autoRisk().status());
    }
}
