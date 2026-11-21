package vacademy.io.admin_core_service.features.live_session.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;
import vacademy.io.admin_core_service.features.live_session.dto.LearnerDisplaySettingsFlags;

/**
 * Reads the institute-level "Live Classes" governance flags for the
 * live-class Past Sessions feature. Lives inside the learner-facing
 * {@code STUDENT_DISPLAY_SETTINGS} blob (admin Settings → Display Settings →
 * Student → Live Classes card) as an optional {@code liveClasses} block:
 *
 * <pre>{@code
 * "liveClasses": {
 *   "showPastSessions": false,
 *   "showRecordings": false,
 *   "showAttendance": false,
 *   "showActivityStats": false,
 *   "showClassMaterials": false,
 *   "showUnassignedPublicSessions": false
 * }
 * }</pre>
 *
 * See docs/LIVE_CLASS_PAST_SESSIONS_AND_CONTENT_LINKING_PLAN.md section A1.
 * All flags default to {@code false} when the setting, or the
 * {@code liveClasses} sub-object, is absent or malformed — this method
 * must never throw, since it sits directly on the gating path of a
 * learner-facing endpoint.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class LiveSessionLearnerDisplaySettingsService {

    private final InstituteSettingService instituteSettingService;
    private final ObjectMapper objectMapper;

    public LearnerDisplaySettingsFlags getFlags(String instituteId) {
        if (!StringUtils.hasText(instituteId)) {
            return LearnerDisplaySettingsFlags.allOff();
        }
        try {
            Object rawData = instituteSettingService.getSettingByInstituteIdAndKey(
                    instituteId, "STUDENT_DISPLAY_SETTINGS");
            if (rawData == null) {
                return LearnerDisplaySettingsFlags.allOff();
            }

            JsonNode root = objectMapper.valueToTree(rawData);
            JsonNode learnerDisplay = root.path("liveClasses");
            if (learnerDisplay.isMissingNode() || !learnerDisplay.isObject()) {
                return LearnerDisplaySettingsFlags.allOff();
            }

            boolean showPastSessions = learnerDisplay.path("showPastSessions").asBoolean(false);
            boolean showRecordings = learnerDisplay.path("showRecordings").asBoolean(false);
            boolean showAttendance = learnerDisplay.path("showAttendance").asBoolean(false);
            boolean showActivityStats = learnerDisplay.path("showActivityStats").asBoolean(false);
            boolean showClassMaterials = learnerDisplay.path("showClassMaterials").asBoolean(false);
            boolean showUnassignedPublicSessions = learnerDisplay.path("showUnassignedPublicSessions")
                    .asBoolean(false);

            return new LearnerDisplaySettingsFlags(showPastSessions, showRecordings, showAttendance,
                    showActivityStats, showClassMaterials, showUnassignedPublicSessions);
        } catch (Exception e) {
            log.warn("Failed to read learnerDisplay flags for institute {}: {}", instituteId, e.getMessage());
            return LearnerDisplaySettingsFlags.allOff();
        }
    }
}
