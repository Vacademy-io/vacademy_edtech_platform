package vacademy.io.assessment_service.features.assessment.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentCustomField;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentRegistrationCustomFieldRequest;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.enums.AssessmentVisibility;
import vacademy.io.assessment_service.features.assessment.enums.UserRegistrationSources;
import vacademy.io.assessment_service.features.open_evaluation.policy.ApiCandidatePolicy;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Feeds an open (PUBLIC) assessment's own lead list in admin_core: a lead per public-link
 * registration (with the registration-form answers; the first one creates the list, so a
 * PUBLIC test nobody registers for through its link gets no empty list), and marks on result
 * release. The payload is built here on the caller's thread — the entities are lazy and the
 * send runs on another thread — and every method swallows its own errors.
 */
@Slf4j
@Service
public class OpenAssessmentLeadPublisher {

    /** Sent as name / email / phone already, so never as extra lead columns. */
    private static final Set<String> IDENTITY_KEYS = Set.of("full_name", "email", "phone_number");

    @Autowired
    OpenAssessmentLeadClient client;

    /** Someone registered through the public link. The first one creates the test's list. */
    public void registered(AssessmentUserRegistration registration, Assessment assessment,
                           List<AssessmentRegistrationCustomFieldRequest> answers) {
        try {
            if (registration == null || !isOpenAssessment(assessment)
                    || !StringUtils.hasText(registration.getInstituteId())) {
                return;
            }
            Map<String, Object> body = base(assessment, registration.getInstituteId());
            putRegistrant(body, registration);
            body.put("answers", answersOf(assessment, answers));
            client.send("registration", body);
        } catch (Exception e) {
            log.warn("Open-assessment lead on registration failed for {}: {}", idOf(assessment), e.getMessage());
        }
    }

    /**
     * A result was released. {@code resultContext} is the ASSESSMENT_RESULT_RELEASED workflow
     * context, which already carries marks, totalMarks and percentage.
     */
    public void resultReleased(StudentAttempt attempt, Assessment assessment, String instituteId,
                               Map<String, Object> resultContext) {
        try {
            AssessmentUserRegistration registration = attempt != null ? attempt.getRegistration() : null;
            if (registration == null || !isOpenAssessment(assessment) || !StringUtils.hasText(instituteId)
                    || !UserRegistrationSources.OPEN_REGISTRATION.name().equals(registration.getSource())) {
                return;
            }
            Map<String, Object> body = base(assessment, instituteId);
            putRegistrant(body, registration);
            if (resultContext != null) {
                body.put("marks", resultContext.get("marks"));
                body.put("totalMarks", resultContext.get("totalMarks"));
                body.put("percentage", resultContext.get("percentage"));
            }
            client.send("result", body);
        } catch (Exception e) {
            log.warn("Open-assessment lead on result failed for {}: {}", idOf(assessment), e.getMessage());
        }
    }

    static boolean isOpenAssessment(Assessment assessment) {
        return assessment != null
                && AssessmentVisibility.PUBLIC.name().equalsIgnoreCase(assessment.getAssessmentVisibility())
                && !ApiCandidatePolicy.isApiExam(assessment);
    }

    /** Registration-form answers by field label, in form order, without name / email / phone. */
    static List<Map<String, String>> answersOf(Assessment assessment,
                                               List<AssessmentRegistrationCustomFieldRequest> answers) {
        List<Map<String, String>> out = new ArrayList<>();
        if (answers == null || answers.isEmpty()) return out;
        Map<String, AssessmentCustomField> byId = new HashMap<>();
        Map<String, AssessmentCustomField> byKey = new HashMap<>();
        if (assessment.getAssessmentCustomFields() != null) {
            for (AssessmentCustomField field : assessment.getAssessmentCustomFields()) {
                if (field.getId() != null) byId.put(field.getId(), field);
                if (field.getFieldKey() != null) byKey.put(field.getFieldKey(), field);
            }
        }
        List<AssessmentRegistrationCustomFieldRequest> sorted = new ArrayList<>(answers);
        sorted.sort(Comparator.comparing(a -> {
            AssessmentCustomField f = fieldOf(a, byId, byKey);
            return f != null && f.getFieldOrder() != null ? f.getFieldOrder() : Integer.MAX_VALUE;
        }));
        for (AssessmentRegistrationCustomFieldRequest answer : sorted) {
            if (answer == null || !StringUtils.hasText(answer.getAnswer())) continue;
            AssessmentCustomField field = fieldOf(answer, byId, byKey);
            if (field == null || !StringUtils.hasText(field.getFieldName())) continue;
            if (field.getFieldKey() != null && IDENTITY_KEYS.contains(field.getFieldKey())) continue;
            Map<String, String> row = new LinkedHashMap<>();
            row.put("fieldName", field.getFieldName());
            row.put("value", answer.getAnswer());
            out.add(row);
        }
        return out;
    }

    private static AssessmentCustomField fieldOf(AssessmentRegistrationCustomFieldRequest answer,
                                                 Map<String, AssessmentCustomField> byId,
                                                 Map<String, AssessmentCustomField> byKey) {
        if (answer == null) return null;
        AssessmentCustomField field = answer.getAssessmentCustomFieldId() != null
                ? byId.get(answer.getAssessmentCustomFieldId()) : null;
        if (field == null && answer.getAssessmentCustomFieldKey() != null) {
            field = byKey.get(answer.getAssessmentCustomFieldKey());
        }
        return field;
    }

    private static Map<String, Object> base(Assessment assessment, String instituteId) {
        Map<String, Object> body = new HashMap<>();
        body.put("instituteId", instituteId);
        body.put("assessmentId", assessment.getId());
        body.put("assessmentName", assessment.getName());
        return body;
    }

    private static void putRegistrant(Map<String, Object> body, AssessmentUserRegistration registration) {
        body.put("userId", registration.getUserId());
        body.put("fullName", registration.getParticipantName());
        body.put("email", registration.getUserEmail());
        body.put("mobileNumber", registration.getPhoneNumber());
    }

    private static String idOf(Assessment assessment) {
        return assessment != null ? assessment.getId() : null;
    }
}
