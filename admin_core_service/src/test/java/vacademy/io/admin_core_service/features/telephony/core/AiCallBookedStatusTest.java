package vacademy.io.admin_core_service.features.telephony.core;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.audience.entity.LeadStatus;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/** A lead who agreed to a demo does not stay on New just because the catalog has no such status. */
class AiCallBookedStatusTest {

    private static LeadStatus status(String key, String label) {
        LeadStatus s = new LeadStatus();
        s.setStatusKey(key);
        s.setLabel(label);
        return s;
    }

    private final LeadStatus interested = status("INTERESTED", "Interested");
    private final LeadStatus demo = status("DEMO_BOOKED", "Demo booked");
    private final LeadStatus lead = status("LEAD", "Lead");

    @Test
    @DisplayName("an exact status wins; without one a booked demo lands on Interested")
    void bookedFallsBackToInterested() {
        assertSame(demo, AiCallOutcomeProcessor.statusForDisposition(List.of(lead, interested, demo), "Demo_Booked"));
        assertSame(interested, AiCallOutcomeProcessor.statusForDisposition(List.of(lead, interested), "Demo_Booked"));
        assertNull(AiCallOutcomeProcessor.statusForDisposition(List.of(lead), "Demo_Booked"));
    }

    @Test
    @DisplayName("other outcomes keep the exact match only")
    void othersStayExact() {
        assertSame(interested, AiCallOutcomeProcessor.statusForDisposition(List.of(lead, interested), "Interested"));
        assertNull(AiCallOutcomeProcessor.statusForDisposition(List.of(lead, interested), "Incomplete"));
        assertNull(AiCallOutcomeProcessor.statusForDisposition(List.of(lead, interested), "Not_Relevant"));
        assertNull(AiCallOutcomeProcessor.statusForDisposition(List.of(lead, interested), "Demo_Cancelled"));
    }
}
