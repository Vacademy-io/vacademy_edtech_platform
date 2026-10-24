package vacademy.io.admin_core_service.features.invoice.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Builder;
import lombok.Getter;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.common.entity.CustomFieldValues;
import vacademy.io.admin_core_service.features.common.entity.CustomFields;
import vacademy.io.admin_core_service.features.common.repository.CustomFieldRepository;
import vacademy.io.admin_core_service.features.common.repository.CustomFieldValuesRepository;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;
import vacademy.io.admin_core_service.features.institute_learner.entity.StudentSessionInstituteGroupMapping;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionRepository;
import vacademy.io.admin_core_service.features.invoice.dto.InvoiceNumberConfig;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * The learner field that picks an invoice numbering series (INVOICE_SETTING.numberingSeries),
 * asked once per enrolment.
 *
 * <p>The value is pinned on the enrolment (a custom field value on its
 * student-session mappings) by the first recorded payment, so every later installment of that
 * course numbers from the same series without asking again, whoever records it. Off for every
 * institute until INVOICE_SETTING.numberingSeriesPolicy.askOnFirstPayment is set.
 */
@Slf4j
@Service
public class NumberingFieldService {

    static final String ENROLMENT_SOURCE = "STUDENT_SESSION_INSTITUTE_GROUP_MAPPING";
    static final String USER_SOURCE = "USER";
    private static final List<String> ENROLMENT_STATUSES =
            List.of("ACTIVE", "INVITED", "ABANDONED_CART", "DETAILS_FILLED");
    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Autowired
    private InstituteRepository instituteRepository;
    @Autowired
    private InstituteSettingService instituteSettingService;
    @Autowired
    private CustomFieldRepository customFieldRepository;
    @Autowired
    private CustomFieldValuesRepository customFieldValuesRepository;
    @Autowired
    private StudentSessionRepository studentSessionRepository;

    /** What a record-payment dialog shows for this enrolment. */
    @Getter
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Info {
        /** Show the field: the institute asks for it and this enrolment has no value yet. */
        private final boolean ask;
        private final boolean required;
        private final String fieldId;
        private final String label;
        private final List<String> options;
        /** The value already pinned on the enrolment (then nothing is asked). */
        private final String value;
        /** The learner's own value (profile, else latest lead), to preselect. */
        private final String suggested;

        static Info off() {
            return Info.builder().ask(false).required(false).options(List.of()).build();
        }
    }

    public Info describe(String instituteId, String userPlanId, String userId) {
        InvoiceNumberConfig config = loadConfig(instituteId);
        if (config == null || !config.asksOnFirstPayment()) {
            return Info.off();
        }
        String fieldId = config.askFieldId();
        CustomFields field = customFieldRepository.findById(fieldId).orElse(null);
        if (field == null) {
            log.warn("Numbering series field {} of institute {} does not exist", fieldId, instituteId);
            return Info.off();
        }
        String pinned = StringUtils.hasText(userPlanId)
                ? customFieldValuesRepository.findLatestValueForEnrollment(fieldId, userPlanId) : null;
        String suggested = StringUtils.hasText(userId)
                ? customFieldValuesRepository.findLatestValueForUser(fieldId, userId) : null;
        return Info.builder()
                .ask(pinned == null)
                .required(config.getSeriesPolicy().isRequired())
                .fieldId(fieldId)
                .label(field.getFieldName())
                .options(optionsOf(field))
                .value(pinned)
                .suggested(suggested)
                .build();
    }

    /**
     * Checks a value picked in a record-payment dialog against the field's options.
     * Returns it canonicalised (option spelling), or null when nothing applies.
     */
    public String validate(String instituteId, String value) {
        if (!StringUtils.hasText(value)) {
            return null;
        }
        InvoiceNumberConfig config = loadConfig(instituteId);
        if (config == null || !config.asksOnFirstPayment()) {
            return null;
        }
        CustomFields field = customFieldRepository.findById(config.askFieldId()).orElse(null);
        if (field == null) {
            return null;
        }
        String v = value.trim();
        List<String> options = optionsOf(field);
        if (options.isEmpty()) {
            return v.length() > 255 ? v.substring(0, 255) : v;
        }
        return options.stream().filter(o -> o.equalsIgnoreCase(v)).findFirst()
                .orElseThrow(() -> new VacademyException(
                        "\"" + v + "\" is not a choice for " + field.getFieldName()));
    }

    /**
     * Pins the picked value on the enrolment of {@code userPlanId} unless it already has one
     * (a pinned value never changes here), and on the learner's profile when that is empty.
     * Validates first, so call it before anything is written.
     */
    public void pin(String instituteId, String userPlanId, String userId, String value) {
        String canonical = validate(instituteId, value);
        if (canonical == null) {
            return;
        }
        String fieldId = loadConfig(instituteId).askFieldId();
        if (StringUtils.hasText(userPlanId)
                && customFieldValuesRepository.findLatestValueForEnrollment(fieldId, userPlanId) == null) {
            List<StudentSessionInstituteGroupMapping> mappings =
                    studentSessionRepository.findAllByUserPlanIdAndStatusIn(userPlanId, ENROLMENT_STATUSES);
            for (StudentSessionInstituteGroupMapping m : mappings == null ? List.<StudentSessionInstituteGroupMapping>of() : mappings) {
                customFieldValuesRepository.saveAndFlush(CustomFieldValues.builder()
                        .customFieldId(fieldId).sourceType(ENROLMENT_SOURCE).sourceId(m.getId())
                        .value(canonical).build());
            }
        }
        if (StringUtils.hasText(userId) && customFieldValuesRepository.findLatestValueForUser(fieldId, userId) == null) {
            customFieldValuesRepository.saveAndFlush(CustomFieldValues.builder()
                    .customFieldId(fieldId).sourceType(USER_SOURCE).sourceId(userId)
                    .value(canonical).build());
        }
    }

    @SuppressWarnings("unchecked")
    private InvoiceNumberConfig loadConfig(String instituteId) {
        if (!StringUtils.hasText(instituteId)) {
            return null;
        }
        try {
            Institute institute = instituteRepository.findById(instituteId).orElse(null);
            if (institute == null) return null;
            Object data = instituteSettingService.getSettingData(institute, "INVOICE_SETTING");
            return InvoiceNumberConfig.fromInvoiceSettings(data instanceof Map ? (Map<String, Object>) data : null);
        } catch (Exception e) {
            log.warn("Could not read invoice settings of institute {}: {}", instituteId, e.getMessage());
            return null;
        }
    }

    /**
     * Option labels of a choice field. The config is stored in three shapes: a JSON array of
     * {value,label}, an object holding {@code options}, or comma-separated text (two spellings).
     */
    static List<String> optionsOf(CustomFields field) {
        List<String> out = new ArrayList<>();
        String config = field.getConfig();
        if (!StringUtils.hasText(config)) {
            return out;
        }
        try {
            JsonNode root = MAPPER.readTree(config.trim());
            JsonNode list = root.isArray() ? root : root.path("options");
            if (list.isArray()) {
                for (JsonNode o : list) {
                    String v = o.isTextual() ? o.asText()
                            : o.hasNonNull("value") ? o.get("value").asText() : o.path("label").asText("");
                    if (StringUtils.hasText(v) && !out.contains(v.trim())) out.add(v.trim());
                }
                if (!out.isEmpty()) return out;
            }
            for (String key : List.of("commaSeparatedOptions", "coommaSepartedOptions")) {
                if (root.hasNonNull(key)) {
                    for (String v : root.get(key).asText().split(",")) {
                        if (StringUtils.hasText(v) && !out.contains(v.trim())) out.add(v.trim());
                    }
                }
            }
        } catch (Exception e) {
            for (String v : config.split(",")) {
                if (StringUtils.hasText(v) && !out.contains(v.trim())) out.add(v.trim());
            }
        }
        return out;
    }
}
