package vacademy.io.admin_core_service.features.mentorship.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.mentorship.entity.MentorStudentAssignment;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

@Repository
public interface MentorStudentAssignmentRepository extends JpaRepository<MentorStudentAssignment, String> {

    List<MentorStudentAssignment> findByInstituteIdAndStatus(String instituteId, String status);

    /** All-institute scan for the check-in nudge scheduler. */
    List<MentorStudentAssignment> findByStatus(String status);

    List<MentorStudentAssignment> findByInstituteIdAndStudentUserIdAndStatus(String instituteId, String studentUserId, String status);

    List<MentorStudentAssignment> findByInstituteIdAndMentorUserIdAndStatus(String instituteId, String mentorUserId, String status);

    Page<MentorStudentAssignment> findByInstituteIdAndMentorUserIdAndStatus(
            String instituteId, String mentorUserId, String status, Pageable pageable);

    List<MentorStudentAssignment> findByMentorIdAndStatus(String mentorId, String status);

    long countByMentorIdAndStatus(String mentorId, String status);

    Optional<MentorStudentAssignment> findByInstituteIdAndMentorIdAndStudentUserIdAndStatus(
            String instituteId, String mentorId, String studentUserId, String status);

    /**
     * Batched variants of the two lookups above, for assignment runs.
     *
     * The picker can hand over a whole batch in one request, and asking per student
     * turned an assignment into one round trip per student — 500 queries inside a
     * single transaction.
     */
    List<MentorStudentAssignment> findByInstituteIdAndMentorIdAndStudentUserIdInAndStatus(
            String instituteId, String mentorId, Collection<String> studentUserIds, String status);

    List<MentorStudentAssignment> findByInstituteIdAndStudentUserIdInAndStatus(
            String instituteId, Collection<String> studentUserIds, String status);

    Optional<MentorStudentAssignment> findByIdAndInstituteId(String id, String instituteId);
}
