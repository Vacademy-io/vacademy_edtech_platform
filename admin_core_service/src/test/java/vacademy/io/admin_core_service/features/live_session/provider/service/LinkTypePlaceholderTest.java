package vacademy.io.admin_core_service.features.live_session.provider.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.common.meeting.enums.MeetingProvider;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * A provider-provisioned occurrence is created before its meeting link exists, so URL sniffing
 * stamps "UNKNOWN" — not null, not blank, and therefore mistaken for a deliberate choice and left
 * forever. Rows stuck on it break at both ends: the dashboards fall through to a plain participant
 * link, and MeetingProvider.fromString("UNKNOWN") throws so the server cannot resolve a strategy
 * at all. 30 live Google Meet occurrences were in exactly this state.
 */
class LinkTypePlaceholderTest {

    @Test
    @DisplayName("UNKNOWN counts as unset, in any casing")
    void unknownIsUnset() {
        assertTrue(LiveSessionProviderService.isUnsetLinkType("UNKNOWN"));
        assertTrue(LiveSessionProviderService.isUnsetLinkType("unknown"));
        assertTrue(LiveSessionProviderService.isUnsetLinkType(null));
        assertTrue(LiveSessionProviderService.isUnsetLinkType(""));
        assertTrue(LiveSessionProviderService.isUnsetLinkType("   "));
    }

    @Test
    @DisplayName("a real choice the wizard made is preserved, never overwritten")
    void realChoicesArePreserved() {
        for (String real : new String[] { "bbb", "zoom", "google meet", "youtube", "RECORDED", "CUSTOM" }) {
            assertFalse(LiveSessionProviderService.isUnsetLinkType(real), real + " must be preserved");
        }
    }

    @Test
    @DisplayName("providers map to the literals the dashboards match, not enum names")
    void mapsToFrontendLiterals() {
        assertEquals("zoom", LiveSessionProviderService.frontendLinkType("ZOOM_MEETING"));
        assertEquals("google meet", LiveSessionProviderService.frontendLinkType("GOOGLE_MEET"));
        assertEquals("bbb", LiveSessionProviderService.frontendLinkType("BBB_MEETING"));
        assertEquals("zoho", LiveSessionProviderService.frontendLinkType("ZOHO_MEETING"));
        // aliases fromString already understands
        assertEquals("google meet", LiveSessionProviderService.frontendLinkType("GMEET"));
        assertEquals("zoom", LiveSessionProviderService.frontendLinkType("zoom"));
    }

    @Test
    @DisplayName("an unrecognised provider is stored as-is rather than lost")
    void unrecognisedPassesThrough() {
        assertEquals("something-else", LiveSessionProviderService.frontendLinkType("something-else"));
        assertEquals(null, LiveSessionProviderService.frontendLinkType(null));
    }

    @Test
    @DisplayName("every literal we store round-trips back through the backend resolver")
    void literalsRoundTripOnTheServer() {
        assertEquals(MeetingProvider.ZOOM_MEETING, MeetingProvider.fromString("zoom"));
        assertEquals(MeetingProvider.GOOGLE_MEET, MeetingProvider.fromString("google meet"));
        assertEquals(MeetingProvider.BBB_MEETING, MeetingProvider.fromString("bbb"));
        assertEquals(MeetingProvider.ZOHO_MEETING, MeetingProvider.fromString("zoho"));
    }
}
