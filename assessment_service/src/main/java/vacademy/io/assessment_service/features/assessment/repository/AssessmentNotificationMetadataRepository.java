package vacademy.io.assessment_service.features.assessment.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentNotificationMetadata;

import java.util.Date;
import java.util.List;
import java.util.Optional;

public interface AssessmentNotificationMetadataRepository extends JpaRepository<AssessmentNotificationMetadata, String> {

    Optional<AssessmentNotificationMetadata> findTopByAssessmentId(String assessmentId);

    /**
     * Published assessments starting inside [from, to] whose learner reminder or live email is
     * switched on. The window is computed in Java and passed in, so it is compared in the same
     * zone bound_start_time was written in (the column has no time zone).
     */
    @Query("SELECT m FROM AssessmentNotificationMetadata m JOIN FETCH m.assessment a"
            + " WHERE a.status = :status"
            + " AND a.boundStartTime >= :from AND a.boundStartTime <= :to"
            + " AND (m.participantBeforeAssessmentGoesLive > 0 OR m.participantWhenAssessmentLive = true)")
    List<AssessmentNotificationMetadata> findLearnerNoticeCandidates(@Param("status") String status,
                                                                     @Param("from") Date from,
                                                                     @Param("to") Date to);

    /**
     * Marks the reminder as sent for this start time. Returns 1 only for the caller that flipped
     * it, so with several pods running exactly one of them sends the email.
     */
    @Transactional
    @Modifying
    @Query(value = "UPDATE assessment_notification_metadata SET participant_reminder_sent_for = :startTime"
            + " WHERE id = :id AND (participant_reminder_sent_for IS NULL OR participant_reminder_sent_for <> :startTime)",
            nativeQuery = true)
    int claimReminder(@Param("id") String id, @Param("startTime") Date startTime);

    /** Same as {@link #claimReminder} for the "assessment is live" email. */
    @Transactional
    @Modifying
    @Query(value = "UPDATE assessment_notification_metadata SET participant_live_sent_for = :startTime"
            + " WHERE id = :id AND (participant_live_sent_for IS NULL OR participant_live_sent_for <> :startTime)",
            nativeQuery = true)
    int claimLive(@Param("id") String id, @Param("startTime") Date startTime);
}
