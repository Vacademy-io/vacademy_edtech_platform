package vacademy.io.assessment_service.features.assessment.service.export;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.common.core.utils.DateUtil;
import vacademy.io.assessment_service.features.assessment.dto.ClosedAssessmentParticipantsResponse;
import vacademy.io.assessment_service.features.assessment.dto.ParticipantsDetailsDto;
import vacademy.io.assessment_service.features.assessment.dto.export.zip.ReportZipInitiateRequest;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentReportExportItem;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentReportExportJob;
import vacademy.io.assessment_service.features.assessment.enums.ReportExportItemStatus;
import vacademy.io.assessment_service.features.assessment.enums.ReportExportJobStatus;
import vacademy.io.assessment_service.features.assessment.manager.AssessmentParticipantsManager;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentReportExportItemRepository;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentReportExportJobRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * Resolves the export selection (explicit attempt ids OR the existing
 * submissions filter — plan §7 "all matching current filter" must not
 * require the frontend to page through ids), validates it against the cap,
 * and inserts the job + item rows in one transaction.
 */
@Slf4j
@Service
public class ReportExportJobFactory {

    @Autowired
    private AssessmentReportExportJobRepository jobRepository;

    @Autowired
    private AssessmentReportExportItemRepository itemRepository;

    @Autowired
    private AssessmentParticipantsManager assessmentParticipantsManager;

    @Autowired
    private ReportExportProperties properties;

    @Transactional
    public AssessmentReportExportJob createJob(CustomUserDetails user, ReportZipInitiateRequest req, String userId, String requestJson) {
        List<ParticipantsDetailsDto> selection = resolveSelection(user, req);
        if (selection.isEmpty()) {
            throw new VacademyException("No submissions match the export selection");
        }
        if (selection.size() > properties.getMaxAttempts()) {
            throw new VacademyException("Selection of " + selection.size()
                    + " exceeds the export cap of " + properties.getMaxAttempts()
                    + ". Narrow the filter or select fewer submissions.");
        }

        AssessmentReportExportJob job = AssessmentReportExportJob.builder()
                .assessmentId(req.getAssessmentId())
                .instituteId(req.getInstituteId())
                .createdByUserId(userId)
                .status(ReportExportJobStatus.PENDING.name())
                .totalCount(selection.size())
                .regenerate(req.isRegenerate())
                .requestJson(requestJson)
                // updated_at is NOT NULL and deliberately insertable/updatable on
                // the entity (stale detection + finalize write it), so unlike
                // created_at the DB default never applies — it must be set here.
                .updatedAt(DateUtil.getCurrentUtcTime())
                .build();
        job = jobRepository.save(job);

        List<AssessmentReportExportItem> items = new ArrayList<>();
        for (ParticipantsDetailsDto p : selection) {
            items.add(AssessmentReportExportItem.builder()
                    .jobId(job.getId())
                    .attemptId(p.getAttemptId())
                    .userId(p.getUserId())
                    .studentName(p.getStudentName())
                    .status(ReportExportItemStatus.PENDING.name())
                    .build());
        }
        itemRepository.saveAll(items);

        return job;
    }

    private List<ParticipantsDetailsDto> resolveSelection(CustomUserDetails user, ReportZipInitiateRequest req) {
        if (req.getAttemptIds() != null && !req.getAttemptIds().isEmpty()) {
            // Explicit ids — dedupe, preserve order, cap-check happens on the caller.
            Set<String> ids = new LinkedHashSet<>(req.getAttemptIds());
            List<ParticipantsDetailsDto> out = new ArrayList<>();
            for (String id : ids) {
                out.add(new ExplicitSelectionDto(id));
            }
            return out;
        }

        if (req.getFilter() == null) {
            throw new VacademyException("Provide either attempt_ids or a filter");
        }

        // Fetch up to maxAttempts+1 so an over-cap selection is detectable
        // without paging through the whole result set.
        int pageSize = properties.getMaxAttempts() + 1;
        ClosedAssessmentParticipantsResponse response = assessmentParticipantsManager
                .getAllParticipantsForAssessment(user, req.getInstituteId(), req.getAssessmentId(),
                        req.getFilter(), 0, pageSize)
                .getBody();
        if (response == null || response.getContent() == null) {
            return List.of();
        }
        return response.getContent().stream()
                .filter(p -> p.getAttemptId() != null)
                .toList();
    }

    /** Minimal ParticipantsDetailsDto implementation for the explicit-ids path (no name/userId lookup — cheap and sufficient; the worker resolves the rest from the attempt itself). */
    private record ExplicitSelectionDto(String attemptId) implements ParticipantsDetailsDto {
        @Override public String getRegistrationId() { return null; }
        @Override public String getAttemptId() { return attemptId; }
        @Override public String getStudentName() { return null; }
        @Override public java.util.Date getAttemptDate() { return null; }
        @Override public java.util.Date getEndTime() { return null; }
        @Override public Long getDuration() { return null; }
        @Override public Double getScore() { return null; }
        @Override public String getUserId() { return null; }
        @Override public String getBatchId() { return null; }
        @Override public String getEvaluationStatus() { return null; }
        @Override public String getReportReleaseResultStatus() { return null; }
        @Override public java.util.Date getLastReportReleaseDate() { return null; }
        @Override public String getUserEmail() { return null; }
        @Override public String getPhoneNumber() { return null; }
        @Override public String getUsername() { return null; }
    }
}
