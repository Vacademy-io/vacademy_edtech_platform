package vacademy.io.admin_core_service.features.live_session.provider.manager;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.live_session.provider.dto.google.GoogleAccount;
import vacademy.io.admin_core_service.features.live_session.provider.manager.GoogleMeetManager.SpaceFeature;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Google fails the whole spaces.create when one optional feature isn't on the institute's plan,
 * so the config builder and the "which feature did Google refuse" lookup decide whether a class
 * gets a link at all.
 */
class GoogleMeetSpaceConfigTest {

    private static GoogleAccount account(boolean recording) {
        return GoogleAccount.builder().recordingEnabled(recording).defaultAccessType("OPEN").build();
    }

    @Test
    @DisplayName("no per-class config: account default decides recording, nothing else is sent")
    void accountDefaults() {
        Map<String, Object> on = GoogleMeetManager.buildSpaceConfig(account(true), null);
        assertEquals(Map.of("recordingConfig", Map.of("autoRecordingGeneration", "ON")), on.get("artifactConfig"));
        assertFalse(on.containsKey("moderation"));
        assertFalse(on.containsKey("attendanceReportGenerationType"));

        Map<String, Object> off = GoogleMeetManager.buildSpaceConfig(account(false), null);
        assertFalse(off.containsKey("artifactConfig"));
        assertEquals("OPEN", off.get("accessType"));
    }

    @Test
    @DisplayName("per-class choices override the account and turn on every feature asked for")
    void perClassFeatures() {
        Map<String, Object> cfg = new HashMap<>();
        cfg.put("recording", false);
        cfg.put("transcription", true);
        cfg.put("smartNotes", true);
        cfg.put("attendanceReport", true);
        cfg.put("accessType", "trusted");
        cfg.put("hostManagement", true);
        cfg.put("chatRestriction", "NO_RESTRICTION");
        cfg.put("presentRestriction", "hosts_only");
        cfg.put("reactionRestriction", "bogus");
        cfg.put("joinAsViewer", true);

        Map<String, Object> c = GoogleMeetManager.buildSpaceConfig(account(true), cfg);

        assertEquals("TRUSTED", c.get("accessType"));
        assertEquals(Map.of(
                "transcriptionConfig", Map.of("autoTranscriptionGeneration", "ON"),
                "smartNotesConfig", Map.of("autoSmartNotesGeneration", "ON")), c.get("artifactConfig"));
        assertEquals("GENERATE_REPORT", c.get("attendanceReportGenerationType"));
        assertEquals("ON", c.get("moderation"));
        assertEquals(Map.of(
                "chatRestriction", "NO_RESTRICTION",
                "presentRestriction", "HOSTS_ONLY",
                "defaultJoinAsViewerType", "ON"), c.get("moderationRestrictions"));
    }

    @Test
    @DisplayName("restrictions are ignored unless host management is on")
    void restrictionsNeedHostManagement() {
        Map<String, Object> c = GoogleMeetManager.buildSpaceConfig(account(false),
                Map.of("chatRestriction", "HOSTS_ONLY", "joinAsViewer", true));
        assertFalse(c.containsKey("moderation"));
        assertFalse(c.containsKey("moderationRestrictions"));
    }

    @Test
    @DisplayName("Google's error names the refused feature; removing it leaves the others")
    void blameAndRemove() {
        Map<String, Object> c = GoogleMeetManager.buildSpaceConfig(account(true),
                Map.of("transcription", true, "attendanceReport", true, "hostManagement", true));
        List<SpaceFeature> present = SpaceFeature.presentIn(c);
        assertEquals(List.of(SpaceFeature.RECORDING, SpaceFeature.TRANSCRIPTION,
                SpaceFeature.ATTENDANCE_REPORT, SpaceFeature.HOST_MANAGEMENT), present);

        String body = "{\"error\":{\"code\":403,\"message\":\"updateAutoRecordingGeneration is not available to the user\"}}";
        SpaceFeature blamed = SpaceFeature.blamedBy(body, present);
        assertEquals(SpaceFeature.RECORDING, blamed);
        blamed.removeFrom(c);
        assertEquals(Map.of("transcriptionConfig", Map.of("autoTranscriptionGeneration", "ON")), c.get("artifactConfig"));

        assertEquals(SpaceFeature.TRANSCRIPTION, SpaceFeature.blamedBy(
                "updateAutoTranscriptionGeneration is not available", SpaceFeature.presentIn(c)));
        SpaceFeature.TRANSCRIPTION.removeFrom(c);
        assertFalse(c.containsKey("artifactConfig"));

        assertEquals(SpaceFeature.HOST_MANAGEMENT, SpaceFeature.blamedBy(
                "moderation_restrictions.present_restriction is not allowed", SpaceFeature.presentIn(c)));
        SpaceFeature.HOST_MANAGEMENT.removeFrom(c);
        assertFalse(c.containsKey("moderation"));
        assertTrue(c.containsKey("attendanceReportGenerationType"));
    }

    @Test
    @DisplayName("an error that names no feature (or one not sent) blames nothing")
    void blameNothing() {
        List<SpaceFeature> present = List.of(SpaceFeature.SMART_NOTES);
        assertNull(SpaceFeature.blamedBy("Request contains an invalid argument.", present));
        assertNull(SpaceFeature.blamedBy("updateAutoRecordingGeneration is not available", present));
        assertNull(SpaceFeature.blamedBy(null, present));
        // A message that only mentions "recording" doesn't blame recording.
        assertNull(SpaceFeature.blamedBy("Transcription requires recording to be allowed",
                List.of(SpaceFeature.RECORDING, SpaceFeature.TRANSCRIPTION)));
        assertEquals(SpaceFeature.SMART_NOTES,
                SpaceFeature.blamedBy("updateAutoSmartNotesGeneration is not available", present));
    }
}
