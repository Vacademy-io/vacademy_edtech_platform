package vacademy.io.assessment_service.features.exam_interface.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.nio.charset.StandardCharsets;
import java.util.regex.Pattern;

/**
 * The only reader and writer of {@code assessment.exam_interface} (V68).
 * <p>
 * Shape: {@code {"v":1,"preset":"<id>","layout":"<variant>","strict":true|false}}. The
 * object is stored as sent, so keys added by newer admin builds survive a save. A preset
 * of {@code "default"} (or none) is stored as NULL: the default test screen.
 * <p>
 * Writing validates and rejects bad input with a 400. Reading never throws: an
 * unreadable stored value is treated as NULL, because a learner who cannot open an
 * exam is worse than a learner who sees the default screen.
 */
@Slf4j
@Service
public class ExamInterfaceService {

    /** Largest stored value, in bytes of compact UTF-8 JSON. */
    public static final int MAX_BYTES = 4096;

    /** Preset that means "the default test screen"; stored as NULL. */
    public static final String DEFAULT_PRESET = "default";

    /** Preset and layout ids: lowercase letters, digits and dashes, 1-40 chars. */
    private static final Pattern ID = Pattern.compile("^[a-z0-9-]{1,40}$");

    private final ObjectMapper objectMapper = new ObjectMapper();

    private final AssessmentRepository assessmentRepository;

    public ExamInterfaceService(AssessmentRepository assessmentRepository) {
        this.assessmentRepository = assessmentRepository;
    }

    /**
     * Stored form of a value sent by the admin. Returns NULL to clear the column
     * (JSON null, no preset, or preset "default"). Throws a 400 VacademyException when
     * the value is malformed.
     */
    public String toStoredJson(JsonNode value) {
        if (value == null || value.isNull() || value.isMissingNode()) return null;
        if (!value.isObject()) {
            throw invalid("exam_interface must be an object or null.");
        }

        JsonNode preset = value.get("preset");
        if (preset == null || preset.isNull()) return null;
        if (!preset.isTextual() || !ID.matcher(preset.asText()).matches()) {
            throw invalid("exam_interface.preset must be 1-40 lowercase letters, digits or dashes.");
        }
        if (DEFAULT_PRESET.equals(preset.asText())) return null;

        JsonNode layout = value.get("layout");
        if (layout != null && !layout.isNull()
                && (!layout.isTextual() || !ID.matcher(layout.asText()).matches())) {
            throw invalid("exam_interface.layout must be 1-40 lowercase letters, digits or dashes.");
        }

        JsonNode strict = value.get("strict");
        if (strict != null && !strict.isNull() && !strict.isBoolean()) {
            throw invalid("exam_interface.strict must be true or false.");
        }

        JsonNode version = value.get("v");
        if (version != null && !version.isNull()
                && (!version.isIntegralNumber() || !version.canConvertToInt() || version.asInt() < 1)) {
            throw invalid("exam_interface.v must be a positive whole number.");
        }

        String json;
        try {
            json = objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            throw invalid("exam_interface could not be read.");
        }
        if (json.getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) {
            throw invalid("exam_interface is larger than " + MAX_BYTES + " bytes.");
        }
        return json;
    }

    /** Stored value as a JSON object, or null when unset or unreadable. Never throws. */
    public JsonNode parse(String stored) {
        if (!StringUtils.hasText(stored)) return null;
        try {
            JsonNode node = objectMapper.readTree(stored);
            return node != null && node.isObject() ? node : null;
        } catch (Exception e) {
            log.warn("Unreadable exam_interface, treating as default: {}", e.getMessage());
            return null;
        }
    }

    /** The assessment's exam interface, or null (default screen). Never throws. */
    public JsonNode read(Assessment assessment) {
        return assessment == null ? null : parse(assessment.getExamInterface());
    }

    /**
     * Exam interface for the learner instruction page. Unknown or blank ids give null
     * (default screen) rather than an error: the page must always be able to render.
     */
    public JsonNode forLearner(String assessmentId) {
        if (!StringUtils.hasText(assessmentId)) return null;
        try {
            return assessmentRepository.findById(assessmentId).map(this::read).orElse(null);
        } catch (Exception e) {
            log.warn("Could not load exam_interface for assessment {}: {}", assessmentId, e.getMessage());
            return null;
        }
    }

    private static VacademyException invalid(String message) {
        return new VacademyException(HttpStatus.BAD_REQUEST, message);
    }
}
