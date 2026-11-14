package vacademy.io.assessment_service.features.assessment.service.batch_pending;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.util.CollectionUtils;
import vacademy.io.assessment_service.features.assessment.dto.AssessmentUserFilter;
import vacademy.io.assessment_service.features.assessment.dto.batch_pending.EnrolledLearnerDto;
import vacademy.io.assessment_service.features.assessment.dto.batch_pending.NotAttemptedParticipants;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentBatchRegistrationRepository;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentUserRegistrationRepository;
import vacademy.io.assessment_service.features.client.AdminCoreServiceClient;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

import static vacademy.io.common.auth.enums.CompanyStatus.ACTIVE;

/**
 * Who was set this assessment through a batch but never attempted it.
 *
 * <p>Single owner of that question, because two screens ask it — the Pending tab and its
 * CSV export — and they must never disagree. A learner missing from the CSV that the tab
 * shows (or vice versa) is worse than either being wrong on its own: the admin chases the
 * wrong people and has no way to tell which view lied.
 *
 * <p>The set cannot be queried from this database. A batch-enrolled learner gets no
 * {@code assessment_user_registration} row until they actually start, so "never attempted"
 * only exists as (batch enrollment, owned by admin_core) minus (learners with an attempt,
 * owned here).
 */
@Service
@RequiredArgsConstructor
public class NotAttemptedLearnerService {

    private final AssessmentBatchRegistrationRepository assessmentBatchRegistrationRepository;
    private final AssessmentUserRegistrationRepository assessmentUserRegistrationRepository;
    private final AdminCoreServiceClient adminCoreServiceClient;

    /**
     * Every batch-enrolled learner with no attempt, already name-filtered and ordered the
     * same way the tab orders them. Unpaged — the caller pages it (tab) or writes it out
     * whole (export).
     *
     * <p>Returns empty without any cross-service call when the assessment has no batch
     * registrations, or when the requested batches aren't among them.
     */
    public List<EnrolledLearnerDto> findNotAttempted(String assessmentId, String instituteId,
                                                     AssessmentUserFilter filter) {
        List<String> batchIds = resolveBatchIds(assessmentId, instituteId, filter);
        if (CollectionUtils.isEmpty(batchIds)) {
            return List.of();
        }

        List<EnrolledLearnerDto> enrolled = adminCoreServiceClient
                .getEnrolledLearnersForBatches(instituteId, batchIds);
        if (CollectionUtils.isEmpty(enrolled)) {
            return List.of();
        }

        Set<String> attempted = new HashSet<>(assessmentUserRegistrationRepository
                .findAttemptedUserIdsForBatchAssessment(assessmentId, instituteId));

        return NotAttemptedParticipants.filterAndSortLearners(
                enrolled, attempted, filter == null ? null : filter.getName());
    }

    /**
     * The assessment's assigned batches, narrowed to the filter chips. Public so the
     * export can resolve batch display names for exactly the batches in the sheet.
     */
    public List<String> resolveBatchIds(String assessmentId, String instituteId, AssessmentUserFilter filter) {
        return NotAttemptedParticipants.resolveBatchIds(
                assessmentBatchRegistrationRepository.findBatchIdsByAssessmentAndInstitute(
                        assessmentId, instituteId, List.of(ACTIVE.name())),
                filter == null ? null : filter.getBatches());
    }
}
