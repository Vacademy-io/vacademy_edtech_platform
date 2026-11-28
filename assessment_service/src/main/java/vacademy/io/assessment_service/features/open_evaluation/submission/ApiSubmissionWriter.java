package vacademy.io.assessment_service.features.open_evaluation.submission;

import org.springframework.stereotype.Component;
import vacademy.io.assessment_service.features.assessment.dto.offline_entry.OfflineQuestionResponse;
import vacademy.io.assessment_service.features.assessment.dto.offline_entry.OfflineResponseSubmitRequest;
import vacademy.io.assessment_service.features.assessment.dto.offline_entry.OfflineSectionResponse;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.manager.AdminOfflineDataEntryManager;
import vacademy.io.common.core.utils.PlainText;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Writes a partner's typed answers onto an attempt through the dashboard's own offline
 * path (spec 7.6 typed): {@code AdminOfflineDataEntryManager.applyResponses} builds
 * attempt_data with {@code buildAttemptDataJson} and runs the marks calculation, so
 * objective answers are scored exactly as a learner's submit would score them and written
 * answers are held for the AI ({@code awaitsAiGrading}). The response type is the
 * question's type from the database, and the marking lookup stays keyed
 * {@code questionId|sectionId}. No analytics and no workflow event: the calculation runs
 * with {@code endSource = null} on an attempt that is already ENDED.
 *
 * <p>A long answer is stored {@link PlainText#escape escaped} (spec 7.0, principle 8): the
 * partner sends plain text, but the stored answer is read as the player's rich-text HTML
 * by ai_service ({@code typed_answers.answer_text}: {@code <br>} to a newline, tags dropped,
 * entities decoded) and rendered by the dashboard. Escaped, "x < 5 and y > 3" reaches the
 * grader (and comes back as {@code extracted_answer}) exactly as typed, and markup is shown
 * literally. One-word answers stay raw: they are scored by exact match against the raw key.
 */
@Component
public class ApiSubmissionWriter {

    private final AdminOfflineDataEntryManager offlineEntry;

    public ApiSubmissionWriter(AdminOfflineDataEntryManager offlineEntry) {
        this.offlineEntry = offlineEntry;
    }

    public StudentAttempt writeTyped(StudentAttempt attempt, Assessment assessment, List<TypedAnswers.Resolved> answers) {
        return offlineEntry.applyResponses(attempt, assessment, request(answers));
    }

    /** What lands in {@code responseData.answer}: long answers escaped, one-word answers as sent. */
    static String storedAnswer(TypedAnswers.Resolved a) {
        return a.isLongAnswer() ? PlainText.escape(a.text()) : a.text();
    }

    /** One section entry per section, in paper order; answers keep their paper order. */
    static OfflineResponseSubmitRequest request(List<TypedAnswers.Resolved> answers) {
        Map<String, List<OfflineQuestionResponse>> bySection = new LinkedHashMap<>();
        for (TypedAnswers.Resolved a : answers) {
            OfflineQuestionResponse response = OfflineQuestionResponse.builder()
                    .questionId(a.question().id())
                    .type(a.internalType())
                    .optionIds(a.optionIds() != null ? new ArrayList<>(a.optionIds()) : new ArrayList<>())
                    .answer(storedAnswer(a))
                    .validAnswer(a.numeric())
                    .build();
            bySection.computeIfAbsent(a.question().section().getId(), k -> new ArrayList<>()).add(response);
        }
        List<OfflineSectionResponse> sections = new ArrayList<>();
        bySection.forEach((sectionId, questions) -> sections.add(OfflineSectionResponse.builder()
                .sectionId(sectionId)
                .questions(questions)
                .build()));
        return OfflineResponseSubmitRequest.builder().sections(sections).build();
    }
}
