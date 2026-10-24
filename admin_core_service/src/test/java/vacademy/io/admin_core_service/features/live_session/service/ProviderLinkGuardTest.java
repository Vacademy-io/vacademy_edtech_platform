package vacademy.io.admin_core_service.features.live_session.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The edit path must refuse exactly one thing — re-pointing a provider-managed occurrence at a
 * different meeting of the same provider — and must keep honouring every other edit. A guard
 * that is too broad is worse than none: it swallows a legitimate change silently, and the admin
 * has no way to tell their edit was dropped.
 */
class ProviderLinkGuardTest {

    private static final String MEETING = "87925363538";

    @Test
    @DisplayName("REFUSES the weekday collision: another zoom meeting on a zoom-managed row")
    void refusesSameProviderDifferentMeeting() {
        assertTrue(Step1Service.wouldStealProviderMeeting(
                "https://us06web.zoom.us/j/81171926875?pwd=x", MEETING, "zoom"));
    }

    @Test
    @DisplayName("ALLOWS a link for this row's own meeting — same room, no harm")
    void allowsSameMeeting() {
        assertFalse(Step1Service.wouldStealProviderMeeting(
                "https://us06web.zoom.us/j/" + MEETING + "?pwd=x", MEETING, "zoom"));
    }

    @Test
    @DisplayName("ALLOWS a deliberate provider switch away from zoom")
    void allowsProviderSwitch() {
        assertFalse(Step1Service.wouldStealProviderMeeting(
                "https://meet.google.com/abc-defg-hij", MEETING, "zoom"));
        assertFalse(Step1Service.wouldStealProviderMeeting(
                "https://youtu.be/abc123", MEETING, "zoom"));
        assertFalse(Step1Service.wouldStealProviderMeeting(
                "https://example.com/recorded.mp4", MEETING, "zoom"));
    }

    @Test
    @DisplayName("ALLOWS everything on a row that is not provider-managed")
    void allowsWhenNotProviderManaged() {
        assertFalse(Step1Service.wouldStealProviderMeeting(
                "https://us06web.zoom.us/j/81171926875", null, "zoom"));
        assertFalse(Step1Service.wouldStealProviderMeeting(
                "https://us06web.zoom.us/j/81171926875", "", "zoom"));
        assertFalse(Step1Service.wouldStealProviderMeeting(
                "https://us06web.zoom.us/j/81171926875", "   ", "zoom"));
    }

    @Test
    @DisplayName("ALLOWS a blank or absent incoming link (clearing is not stealing)")
    void allowsBlankIncoming() {
        assertFalse(Step1Service.wouldStealProviderMeeting(null, MEETING, "zoom"));
        assertFalse(Step1Service.wouldStealProviderMeeting("", MEETING, "zoom"));
        assertFalse(Step1Service.wouldStealProviderMeeting("  ", MEETING, "zoom"));
    }

    @Test
    @DisplayName("matches provider case-insensitively — prod holds both 'zoom' and 'ZOOM'")
    void linkTypeCaseInsensitive() {
        assertTrue(Step1Service.wouldStealProviderMeeting(
                "https://us06web.zoom.us/j/81171926875", MEETING, "ZOOM"));
        assertTrue(Step1Service.wouldStealProviderMeeting(
                "https://meet.google.com/xyz-abcd-efg", "abc-defg-hij", "GOOGLE MEET"));
    }

    @Test
    @DisplayName("ALLOWS when the row has no linkType to compare against")
    void allowsWhenLinkTypeUnknown() {
        assertFalse(Step1Service.wouldStealProviderMeeting(
                "https://us06web.zoom.us/j/81171926875", MEETING, null));
        assertFalse(Step1Service.wouldStealProviderMeeting(
                "https://us06web.zoom.us/j/81171926875", MEETING, ""));
    }
}
