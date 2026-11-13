package vacademy.io.admin_core_service.features.audience.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.audience.config.OpenAssessmentLeadExecutorConfig;
import vacademy.io.admin_core_service.features.audience.dto.OpenAssessmentLeadEventDTO;
import vacademy.io.admin_core_service.features.audience.entity.Audience;
import vacademy.io.admin_core_service.features.audience.entity.AudienceResponse;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.audience.repository.AutoListLeadLookupRepository;
import vacademy.io.admin_core_service.features.common.entity.CustomFieldValues;
import vacademy.io.admin_core_service.features.common.repository.CustomFieldValuesRepository;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Every open (public-link) assessment gets its own lead list, "&lt;Test title&gt; - Open
 * Assessment" (campaign type "Open Assessment"), the same way every public live session does.
 *
 * <ul>
 *   <li>First public-link registration → the list is created (a PUBLIC test nobody registers
 *       for through its link gets no empty list).</li>
 *   <li>Registration → the registrant becomes a lead in it, with every registration-form
 *       answer as a column and Test Status = Registered. Someone who registers and never
 *       sits the test is still a lead.</li>
 *   <li>Result release → the same lead gets Marks Scored, Percentage and
 *       Test Status = Completed.</li>
 * </ul>
 *
 * <p>Called by assessment_service through {@code /internal/open-assessment-leads}. All of it is
 * best-effort: a failure is logged and never reaches the learner's registration or result.
 */
@Service
public class OpenAssessmentLeadService {

    private static final Logger logger = LoggerFactory.getLogger(OpenAssessmentLeadService.class);

    static final String SOURCE_TYPE = "OPEN_ASSESSMENT";
    static final String FIELD_TEST_STATUS = "Test Status";
    static final String FIELD_MARKS = "Marks Scored";
    static final String FIELD_PERCENTAGE = "Percentage";
    static final String STATUS_REGISTERED = "Registered";
    static final String STATUS_COMPLETED = "Completed";

    /** Identity fields come through name / email / phone, never as extra columns. */
    private static final List<String> IDENTITY_FIELD_NAMES = List.of(
            "full name", "name", "email", "email address", "phone", "phone number", "mobile",
            "mobile number");

    /** Base identity columns occupy 0..2 on a lead form; extras start after them. */
    private static final int FIRST_EXTRA_ORDER = 3;

    @Autowired
    private AutoLeadListProvisioner provisioner;

    @Autowired
    private AudienceService audienceService;

    @Autowired
    private AudienceResponseRepository audienceResponseRepository;

    @Autowired
    private CustomFieldValuesRepository customFieldValuesRepository;

    @Autowired
    private AutoListLeadLookupRepository leadLookupRepository;

    @Async(OpenAssessmentLeadExecutorConfig.EXECUTOR)
    public void captureRegistrationAsync(OpenAssessmentLeadEventDTO event) {
        try {
            captureRegistration(event);
        } catch (Exception e) {
            logger.warn("Open assessment {}: lead capture failed for {}: {}",
                    event.getAssessmentId(), event.getEmail(), e.getMessage(), e);
        }
    }

    @Async(OpenAssessmentLeadExecutorConfig.EXECUTOR)
    public void recordResultAsync(OpenAssessmentLeadEventDTO event) {
        try {
            recordResult(event);
        } catch (Exception e) {
            logger.warn("Open assessment {}: result update failed for {}: {}",
                    event.getAssessmentId(), event.getEmail(), e.getMessage(), e);
        }
    }

    /** @return the lead id, or null when no lead was created (blank email, paused list, dedup). */
    String captureRegistration(OpenAssessmentLeadEventDTO event) {
        Audience list = activeList(event);
        if (list == null || !StringUtils.hasText(event.getEmail())) return null;

        Map<String, String> values = new LinkedHashMap<>();
        int order = FIRST_EXTRA_ORDER;
        if (event.getAnswers() != null) {
            for (OpenAssessmentLeadEventDTO.Answer answer : event.getAnswers()) {
                if (answer == null || !StringUtils.hasText(answer.getFieldName())
                        || !StringUtils.hasText(answer.getValue())
                        || isIdentityField(answer.getFieldName())) {
                    continue;
                }
                try {
                    String fieldId = provisioner.ensureField(list.getInstituteId(), list.getId(),
                            answer.getFieldName(), order++);
                    if (fieldId != null) values.put(fieldId, answer.getValue().trim());
                } catch (Exception e) {
                    logger.warn("Open assessment {}: field '{}' not added to list {}: {}",
                            event.getAssessmentId(), answer.getFieldName(), list.getId(), e.getMessage());
                }
            }
        }
        String statusFieldId = provisioner.ensureField(list.getInstituteId(), list.getId(), FIELD_TEST_STATUS, order);
        if (statusFieldId != null) values.put(statusFieldId, STATUS_REGISTERED);

        String result = audienceService.submitLeadToAutoList(list, event.getFullName(), event.getEmail(),
                event.getMobileNumber(), values, SOURCE_TYPE, event.getAssessmentId());
        logger.info("Open assessment {}: registration of {} → list {}: {}",
                event.getAssessmentId(), event.getEmail(), list.getId(), result);
        return result;
    }

    void recordResult(OpenAssessmentLeadEventDTO event) {
        Audience list = activeList(event);
        if (list == null) return;

        AudienceResponse lead = findLead(list, event).orElse(null);
        if (lead == null && !hadLeadInList(list, event)) {
            // Registered before this feature went live, or the registration call was lost:
            // create the lead now so the marks still reach the counsellors. A lead the admin
            // deleted from this list is NOT brought back by a result.
            captureRegistration(event);
            lead = findLead(list, event).orElse(null);
        }
        if (lead == null) {
            logger.info("Open assessment {}: no lead for {} in list {} — marks not recorded",
                    event.getAssessmentId(), event.getEmail(), list.getId());
            return;
        }

        String instituteId = list.getInstituteId();
        int order = FIRST_EXTRA_ORDER + 50; // after the registration-form columns
        String marks = marksText(event.getMarks(), event.getTotalMarks());
        if (marks != null) {
            upsert(lead.getId(), provisioner.ensureField(instituteId, list.getId(), FIELD_MARKS, order++), marks);
        }
        String percentage = number(event.getPercentage());
        if (percentage != null) {
            upsert(lead.getId(), provisioner.ensureField(instituteId, list.getId(), FIELD_PERCENTAGE, order++),
                    percentage);
        }
        upsert(lead.getId(), provisioner.ensureField(instituteId, list.getId(), FIELD_TEST_STATUS, order),
                STATUS_COMPLETED);
    }

    private Audience activeList(OpenAssessmentLeadEventDTO event) {
        if (!hasTest(event)) return null;
        Audience list = provisioner.getOrCreate(event.getInstituteId(), AutoLeadListProvisioner.OPEN_ASSESSMENT,
                event.getAssessmentId(), event.getAssessmentName());
        if (StringUtils.hasText(list.getStatus()) && !"ACTIVE".equalsIgnoreCase(list.getStatus())) {
            logger.info("Open assessment {}: list {} is {} — skipped",
                    event.getAssessmentId(), list.getId(), list.getStatus());
            return null;
        }
        return list;
    }

    /**
     * The registrant's lead in this list: by email first — the one thing that is theirs
     * alone (a lead created through phone dedup can carry a sibling's user id) — then by
     * user id. Never by phone: siblings share a parent's number.
     */
    private Optional<AudienceResponse> findLead(Audience list, OpenAssessmentLeadEventDTO event) {
        String email = event.getEmail() != null ? event.getEmail().trim() : null;
        if (StringUtils.hasText(email)) {
            Optional<AudienceResponse> byEmail = leadLookupRepository.findFirstInListByEmail(list.getId(), email);
            if (byEmail.isPresent()) return byEmail;
        }
        if (StringUtils.hasText(event.getUserId())) {
            List<AudienceResponse> byUser = audienceResponseRepository
                    .findByAudienceIdAndUserIdAndAudienceStatus(list.getId(), event.getUserId(), "ACTIVE");
            if (!byUser.isEmpty()) return Optional.of(byUser.get(0));
        }
        return Optional.empty();
    }

    /** Whether this person was ever a lead in the list, deleted ones included. */
    private boolean hadLeadInList(Audience list, OpenAssessmentLeadEventDTO event) {
        String email = event.getEmail() != null ? event.getEmail().trim() : null;
        if (StringUtils.hasText(email) && leadLookupRepository.existsInListByEmailAnyStatus(list.getId(), email)) {
            return true;
        }
        return StringUtils.hasText(event.getUserId())
                && audienceResponseRepository.existsByAudienceIdAndUserId(list.getId(), event.getUserId());
    }

    /** No-op when {@code customFieldId} is null (the admin removed that column from the list). */
    private void upsert(String leadId, String customFieldId, String value) {
        if (customFieldId == null) return;
        CustomFieldValues row = customFieldValuesRepository
                .findTopByCustomFieldIdAndSourceTypeAndSourceIdOrderByCreatedAtDesc(
                        customFieldId, "AUDIENCE_RESPONSE", leadId)
                .orElseGet(() -> CustomFieldValues.builder()
                        .customFieldId(customFieldId)
                        .sourceType("AUDIENCE_RESPONSE")
                        .sourceId(leadId)
                        .build());
        row.setValue(value);
        customFieldValuesRepository.save(row);
    }

    private static boolean hasTest(OpenAssessmentLeadEventDTO event) {
        return event != null && StringUtils.hasText(event.getInstituteId())
                && StringUtils.hasText(event.getAssessmentId());
    }

    static boolean isIdentityField(String fieldName) {
        String normalized = fieldName.trim().toLowerCase().replace('_', ' ').replaceAll("\\s+", " ");
        return IDENTITY_FIELD_NAMES.contains(normalized);
    }

    /** "56/100", or just "56" when the total is unknown. */
    static String marksText(Double marks, Double total) {
        String m = number(marks);
        if (m == null) return null;
        String t = number(total);
        return t != null ? m + "/" + t : m;
    }

    /** 56.0 → "56", 56.456 → "56.46". */
    static String number(Double value) {
        if (value == null || value.isNaN() || value.isInfinite()) return null;
        return BigDecimal.valueOf(value).setScale(2, RoundingMode.HALF_UP).stripTrailingZeros().toPlainString();
    }
}
