package vacademy.io.admin_core_service.features.audience.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;

/**
 * The follow-up behaviour switches an institute sets in Lead settings →
 * Follow-up fields:
 *
 * <pre>
 * institute.setting → setting → LEAD_SETTING → data → followUpFields → {
 *     allowEditing: false, ...
 * }
 * </pre>
 *
 * Off unless the institute turned it on, and off means the old behaviour. Not
 * cached: it is read only when someone edits a follow-up, and a switch flipped
 * in Settings has to take effect on the next save, on every pod.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class LeadFollowupSettingService {

    private final InstituteRepository instituteRepository;
    private final ObjectMapper objectMapper;

    /** May a closed follow-up's note, closing note and interest level be edited? */
    public boolean allowEditing(String instituteId) {
        if (instituteId == null || instituteId.isBlank()) return false;
        try {
            String settingJson = instituteRepository.findById(instituteId)
                    .map(i -> i.getSetting())
                    .orElse(null);
            if (settingJson == null || settingJson.isBlank()) return false;
            JsonNode fields = objectMapper.readTree(settingJson)
                    .path("setting").path("LEAD_SETTING").path("data").path("followUpFields");
            return fields.path("allowEditing").asBoolean(false);
        } catch (Exception e) {
            log.warn("Failed to read follow-up settings for institute {} — editing stays off: {}",
                    instituteId, e.getMessage());
            return false;
        }
    }
}
