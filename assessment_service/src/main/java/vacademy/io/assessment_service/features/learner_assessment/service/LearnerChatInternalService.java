package vacademy.io.assessment_service.features.learner_assessment.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response.StudentReportDto;
import vacademy.io.assessment_service.features.assessment.enums.AssessmentModeEnum;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.assessment_service.features.learner_assessment.dto.AllStudentAssessmentResponse;
import vacademy.io.assessment_service.features.learner_assessment.dto.StudentAssessmentFilter;
import vacademy.io.assessment_service.features.learner_assessment.dto.StudentBasicAssessmentListItemDto;
import vacademy.io.assessment_service.features.learner_assessment.dto.internal.AssessmentHistoryItemDto;
import vacademy.io.assessment_service.features.learner_assessment.dto.internal.LearnerChatAssessmentsResponse;
import vacademy.io.assessment_service.features.learner_assessment.dto.internal.LearnerChatResultsResponse;
import vacademy.io.assessment_service.features.learner_assessment.manager.LearnerAssessmentGetManager;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Read-only views of a learner's tests for the learner AI chatbot (ai_service, HMAC).
 *
 * <p>Both reuse the learner app's own code paths so the chatbot never shows more than the app:
 * the examination list ({@link LearnerAssessmentGetManager#assessmentListFilter}) and the report
 * list query with its release gating ({@code findAssessmentForUserWithFilter}, the same call
 * {@code LearnerReportService.getStudentReportList} makes).
 */
@Slf4j
@Service
public class LearnerChatInternalService {

    static final int MAX_LISTED = 10;
    static final int MAX_RESULTS = 5;
    /** ENDED attempts scanned to split released vs awaiting release. */
    private static final int SCAN_ATTEMPTS = 100;

    @Autowired
    private LearnerAssessmentGetManager learnerAssessmentGetManager;

    @Autowired
    private StudentAttemptRepository studentAttemptRepository;

    @Autowired
    private StudentAnalysisInternalService studentAnalysisInternalService;

    public LearnerChatAssessmentsResponse listAssessments(String userId, String instituteId, List<String> batchIds) {
        return LearnerChatAssessmentsResponse.builder()
                .live(list(userId, instituteId, batchIds, true))
                .upcoming(list(userId, instituteId, batchIds, false))
                .build();
    }

    private List<StudentBasicAssessmentListItemDto> list(String userId, String instituteId,
                                                         List<String> batchIds, boolean live) {
        // The same filter the learner app's examination page sends (useFetchAssessment.ts).
        StudentAssessmentFilter filter = new StudentAssessmentFilter();
        filter.setBatchIds(batchIds == null ? new ArrayList<>() : new ArrayList<>(batchIds));
        filter.setUserIds(new ArrayList<>(List.of(userId)));
        filter.setInstituteIds(new ArrayList<>(List.of(instituteId)));
        filter.setAssessmentTypes(new ArrayList<>(List.of("ASSESSMENT")));
        filter.setGetLiveAssessments(live);
        filter.setGetUpcomingAssessments(!live);
        filter.setGetPassedAssessments(false);
        AllStudentAssessmentResponse page = learnerAssessmentGetManager
                .assessmentListFilter(null, filter, instituteId, 0, MAX_LISTED)
                .getBody();
        if (page == null || page.getContent() == null) {
            return Collections.emptyList();
        }
        List<StudentBasicAssessmentListItemDto> items = new ArrayList<>(page.getContent());
        items.removeIf(i -> AssessmentModeEnum.SURVEY.name().equals(i.getPlayMode()));
        // Soonest first: ends soonest for open tests, starts soonest for upcoming ones.
        items.sort((a, b) -> {
            java.util.Date x = live ? a.getBoundEndTime() : a.getBoundStartTime();
            java.util.Date y = live ? b.getBoundEndTime() : b.getBoundStartTime();
            if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
            return x.compareTo(y);
        });
        return items;
    }

    public LearnerChatResultsResponse listResults(String userId, String instituteId, Integer limit) {
        int max = Math.max(1, Math.min(limit == null ? MAX_RESULTS : limit, MAX_RESULTS));
        List<StudentReportDto> attempts = studentAttemptRepository
                .findLatestEndedAttemptsForLearnerChat(userId, instituteId, SCAN_ATTEMPTS);

        List<AssessmentHistoryItemDto> results = new ArrayList<>();
        List<LearnerChatResultsResponse.AwaitingResult> awaiting = new ArrayList<>();
        for (StudentReportDto row : attempts) {
            if (AssessmentModeEnum.SURVEY.name().equals(row.getPlayMode())) {
                continue;
            }
            // The learner app's report list shows RELEASED attempts only (its default filter).
            if ("RELEASED".equals(row.getReportReleaseStatus())) {
                if (results.size() < max) {
                    results.add(studentAnalysisInternalService.buildHistoryItemFromReport(row, userId, instituteId));
                }
            } else if (awaiting.size() < MAX_LISTED) {
                awaiting.add(LearnerChatResultsResponse.AwaitingResult.builder()
                        .assessmentId(row.getAssessmentId())
                        .assessmentName(row.getAssessmentName())
                        .attemptDate(row.getAttemptDate())
                        .build());
            }
        }
        return LearnerChatResultsResponse.builder().results(results).awaitingRelease(awaiting).build();
    }
}
