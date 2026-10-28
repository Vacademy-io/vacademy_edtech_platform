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
        return flag(instituteId, "allowEditing");
    }

    /**
     * Does a follow-up's interest level also set the lead's own interest level (tier)?
     * Applies when a follow-up is created with one, and when the lead's latest
     * follow-up has it edited.
     */
    public boolean syncInterestToLead(String instituteId) {
        return flag(instituteId, "syncInterestToLead");
    }

    private boolean flag(String instituteId, String name) {
        if (instituteId == null || instituteId.isBlank()) return false;
        try {
            String settingJson = instituteRepository.findById(instituteId)
                    .map(i -> i.getSetting())
                    .orElse(null);
            if (settingJson == null || settingJson.isBlank()) return false;
            JsonNode fields = objectMapper.readTree(settingJson)
                    .path("setting").path("LEAD_SETTING").path("data").path("followUpFields");
            return fields.path(name).asBoolean(false);
        } catch (Exception e) {
            log.warn("Failed to read follow-up settings for institute {} — {} stays off: {}",
                    instituteId, name, e.getMessage());
            return false;
        }
    }
}
