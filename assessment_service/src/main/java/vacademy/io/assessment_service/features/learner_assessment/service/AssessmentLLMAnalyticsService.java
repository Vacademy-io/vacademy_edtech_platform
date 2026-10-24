package vacademy.io.assessment_service.features.learner_assessment.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.client.AdminCoreServiceClient;

import java.util.Map;

/**
 * Service to prepare and send assessment data to Admin Core Service for LLM
 * analytics
 * This service transforms StudentAttempt data into the format expected by the
 * LLM analytics pipeline
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class AssessmentLLMAnalyticsService {

    private final AdminCoreServiceClient adminCoreServiceClient;
    private final AssessmentDataEnrichmentService enrichmentService;

    /**
     * Send assessment submission data to admin core service for LLM analysis.
     * Truly async since 2026-08-27 (it was named Async but ran on the Tomcat
     * thread; at the 1000-VU load test that serialized the submit wave).
     * Fire-and-forget - failures won't impact the assessment submission flow.
     * Safe off-thread: the entity's registration/assessment relations are
     * EAGER (already hydrated), everything else is fresh repository queries.
     *
     * @param studentAttempt  The student's completed attempt
     * @param assessmentId    The assessment ID
     * @param assessmentName  The assessment name
     * @param assessmentType  The assessment type
     * @param durationMinutes The assessment duration
     * @param totalMarks      The total marks for the assessment
     */
    @Async("assessmentAnalyticsExecutor")
    public void sendAssessmentDataForAnalysisAsync(
            StudentAttempt studentAttempt,
            String assessmentId,
            String assessmentName,
            String assessmentType,
            Integer durationMinutes,
            Integer totalMarks) {

        try {
            // Derive instituteId from registration
            String instituteId = studentAttempt.getRegistration() != null
                    ? studentAttempt.getRegistration().getInstituteId() : null;

            // Use enrichment service to build data with full text content + comparison context
            Map<String, Object> assessmentData = enrichmentService.buildEnrichedAssessmentData(
                    studentAttempt, assessmentId, assessmentName, assessmentType, durationMinutes, totalMarks,
                    instituteId);

            // Synchronous call to admin core service
            adminCoreServiceClient.saveAssessmentRawDataAsync(assessmentData);

        } catch (Exception e) {
            log.error("Error sending assessment data for LLM analysis - this will not affect submission", e);
            // Don't throw - we don't want to impact the assessment flow
        }
    }
}
