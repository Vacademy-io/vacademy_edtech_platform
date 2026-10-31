package vacademy.io.assessment_service.features.proctoring.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.proctoring.dto.ProctoringConfigDTO;

/**
 * The only reader and writer of {@code assessment.proctoring_config}.
 * <p>
 * Reading never throws: a malformed or unknown value is treated as "off", because
 * the alternative -- a learner unable to open an exam over a config typo -- is
 * worse than an exam running unproctored and the admin seeing the tier reset.
 */
@Slf4j
@Service
public class ProctoringConfigService {

    private final ObjectMapper objectMapper = new ObjectMapper();

    /** Effective config for the assessment: stored value + tier defaults, or off. */
    public ProctoringConfigDTO effectiveConfig(Assessment assessment) {
        if (assessment == null) return ProctoringConfigDTO.off();
        return parse(assessment.getProctoringConfig()).withDefaults();
    }

    public ProctoringConfigDTO parse(String json) {
        if (!StringUtils.hasText(json)) return ProctoringConfigDTO.off();
        try {
            ProctoringConfigDTO dto = objectMapper.readValue(json, ProctoringConfigDTO.class);
            return dto == null ? ProctoringConfigDTO.off() : dto;
        } catch (Exception e) {
            log.warn("Unreadable proctoring_config, treating as off: {}", e.getMessage());
            return ProctoringConfigDTO.off();
        }
    }

    /**
     * Stored form. NONE is stored as NULL, not as {"tier":"NONE"}, so an assessment
     * switched off again is indistinguishable from one that never had proctoring --
     * that is what every "is this on" query (and the storage bill) should see.
     */
    public String serialize(ProctoringConfigDTO dto) {
        if (dto == null || !dto.isEnabled()) return null;
        try {
            return objectMapper.writeValueAsString(dto.withDefaults());
        } catch (Exception e) {
            log.warn("Could not serialize proctoring_config, leaving it unchanged: {}", e.getMessage());
            return null;
        }
    }
}
