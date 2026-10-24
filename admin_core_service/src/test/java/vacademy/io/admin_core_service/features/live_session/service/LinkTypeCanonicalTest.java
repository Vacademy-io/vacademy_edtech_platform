package vacademy.io.admin_core_service.features.live_session.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.common.meeting.enums.MeetingProvider;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * The admin dashboard matches schedule linkType against StreamingPlatform literals
 * case-sensitively. When a value doesn't match, the "Start as Host" control degrades to a
 * plain participant link — the teacher joins as an attendee, never claims host role, the
 * meeting never starts and nothing records. That failure is invisible in the UI, so the
 * exact strings are pinned here.
 */
class LinkTypeCanonicalTest {

    @Test
    @DisplayName("zoom urls yield the literal the frontend matches: 'zoom', not 'ZOOM'")
    void zoomIsCanonical() {
        assertEquals("zoom", Step1Service.getLinkTypeFromUrl("https://us06web.zoom.us/j/87925363538?pwd=x"));
        assertEquals("zoom", Step1Service.getLinkTypeFromUrl("https://ACME.ZOOM.US/j/123"));
        assertEquals("zoom", Step1Service.getLinkTypeFromUrl("https://zoom.com/j/123"));
    }

    @Test
    @DisplayName("google meet urls yield 'google meet', not 'GMEET'")
    void meetIsCanonical() {
        assertEquals("google meet", Step1Service.getLinkTypeFromUrl("https://meet.google.com/abc-defg-hij"));
        assertEquals("google meet", Step1Service.getLinkTypeFromUrl("https://MEET.GOOGLE.COM/abc"));
    }

    @Test
    @DisplayName("other providers are unchanged")
    void othersUnchanged() {
        assertEquals("YOUTUBE", Step1Service.getLinkTypeFromUrl("https://youtu.be/abc"));
        assertEquals("ZOHO_MEETING", Step1Service.getLinkTypeFromUrl("https://meeting.zoho.in/x"));
        assertEquals("RECORDED", Step1Service.getLinkTypeFromUrl("https://example.com/video.mp4"));
        assertEquals("UNKNOWN", Step1Service.getLinkTypeFromUrl(""));
        assertEquals("UNKNOWN", Step1Service.getLinkTypeFromUrl(null));
    }

    @Test
    @DisplayName("the backend still resolves the canonical values, so nothing downstream breaks")
    void backendStillResolves() {
        assertEquals(MeetingProvider.ZOOM_MEETING, MeetingProvider.fromString("zoom"));
        assertEquals(MeetingProvider.ZOOM_MEETING, MeetingProvider.fromString("ZOOM"));
        assertEquals(MeetingProvider.GOOGLE_MEET, MeetingProvider.fromString("google meet"));
        assertEquals(MeetingProvider.GOOGLE_MEET, MeetingProvider.fromString("GMEET"));
    }
}
