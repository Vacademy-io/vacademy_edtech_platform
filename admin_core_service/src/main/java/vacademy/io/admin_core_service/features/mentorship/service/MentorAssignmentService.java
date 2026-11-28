package vacademy.io.admin_core_service.features.mentorship.service;

import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.mentorship.dto.AssignMentorRequest;
import vacademy.io.admin_core_service.features.mentorship.dto.AssignmentResultDTO;
import vacademy.io.admin_core_service.features.mentorship.dto.BulkRoundRobinRequest;
import vacademy.io.admin_core_service.features.mentorship.dto.MenteeDTO;
import vacademy.io.admin_core_service.features.mentorship.dto.MentorDTO;
import vacademy.io.admin_core_service.features.mentorship.entity.Mentor;
import vacademy.io.admin_core_service.features.mentorship.entity.MentorStudentAssignment;
import vacademy.io.admin_core_service.features.mentorship.enums.AssignmentMethod;
import vacademy.io.admin_core_service.features.mentorship.enums.MentorStatus;
import vacademy.io.admin_core_service.features.mentorship.repository.MentorRepository;
import vacademy.io.admin_core_service.features.mentorship.repository.MentorStudentAssignmentRepository;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;
import java.util.stream.Collectors;

/**
 * Mentor↔student assignment: manual (specific students → one mentor) and bulk
 * round-robin (a set of students distributed equally across a mentor group via
 * least-loaded greedy selection, respecting existing load). Also serves the
 * mentor's "my mentees" and the student's "my mentors" reads.
 */
@Service
@RequiredArgsConstructor
public class MentorAssignmentService {

    private final MentorStudentAssignmentRepository assignmentRepository;
    private final MentorRepository mentorRepository;
    private final MentorService mentorService;
    private final AuthService authService;
    private final MentorshipNotificationService mentorshipNotificationService;

    @Transactional
    public AssignmentResultDTO assignManual(AssignMentorRequest req, CustomUserDetails user) {
        if (req.getMentorId() == null || req.getMentorId().isBlank()
                || req.getStudentUserIds() == null || req.getStudentUserIds().isEmpty()) {
            throw new VacademyException("mentorId and at least one studentUserId are required");
        }
        Mentor mentor = mentorRepository
                .findByIdAndInstituteIdAndStatusNot(req.getMentorId(), req.getInstituteId(), MentorStatus.DELETED.name())
                .orElseThrow(() -> new VacademyException("Mentor not found"));

        int assigned = 0, skipped = 0, capacityFull = 0;
        // Capacity is checked against live load and the rows queued so far, so a single
        // over-sized request can't push a mentor past max_mentees.
        int load = (int) assignmentRepository.countByMentorIdAndStatus(mentor.getId(), MentorStatus.ACTIVE.name());
        List<MentorStudentAssignment> toSave = new ArrayList<>();
        List<String> requested = distinctNonBlank(req.getStudentUserIds());
        // Who this mentor already has, read up front: the admin UI can select a whole
        // batch, and one lookup per student made that hundreds of queries in one
        // transaction.
        Set<String> alreadyMine = new HashSet<>();
        forEachIdChunk(requested, chunk -> assignmentRepository
                .findByInstituteIdAndMentorIdAndStudentUserIdInAndStatus(
                        req.getInstituteId(), mentor.getId(), chunk, MentorStatus.ACTIVE.name())
                .forEach(a -> alreadyMine.add(a.getStudentUserId())));
        for (String studentUserId : requested) {
            if (alreadyMine.contains(studentUserId)) {
                skipped++;
                continue;
            }
            if (MentorService.atCapacity(mentor.getMaxMentees(), load)) {
                capacityFull++;
                continue;
            }
            toSave.add(newAssignment(req.getInstituteId(), mentor, studentUserId,
                    AssignmentMethod.MANUAL, req.getPackageSessionId(), user));
            load++;
            assigned++;
        }
        if (!toSave.isEmpty()) {
            assignmentRepository.saveAll(toSave);
            final String instituteId = req.getInstituteId();
            final String mentorUserId = mentor.getUserId();
            final String mentorName = mentor.getDisplayName();
            final List<String> studentIds = toSave.stream()
                    .map(MentorStudentAssignment::getStudentUserId).collect(Collectors.toList());
            afterCommit(() -> studentIds.forEach(sid ->
                    mentorshipNotificationService.notifyAssignment(instituteId, sid, mentorUserId, mentorName)));
        }
        return AssignmentResultDTO.builder()
                .assigned(assigned).skipped(skipped).capacityFull(capacityFull).build();
    }

    @Transactional
    public AssignmentResultDTO bulkRoundRobin(BulkRoundRobinRequest req, CustomUserDetails user) {
        if (req.getStudentUserIds() == null || req.getStudentUserIds().isEmpty()
                || req.getMentorIds() == null || req.getMentorIds().isEmpty()) {
            throw new VacademyException("At least one student and one mentor are required");
        }
        // Load + validate the mentor group (all must belong to this institute).
        List<Mentor> mentors = new ArrayList<>();
        for (String mentorId : distinctNonBlank(req.getMentorIds())) {
            mentors.add(mentorRepository
                    .findByIdAndInstituteIdAndStatusNot(mentorId, req.getInstituteId(), MentorStatus.DELETED.name())
                    .orElseThrow(() -> new VacademyException("Mentor not found: " + mentorId)));
        }

        // Current active load per mentor (so distribution respects prior assignments).
        Map<String, Integer> load = new HashMap<>();
        for (Mentor m : mentors) {
            load.put(m.getId(),
                    (int) assignmentRepository.countByMentorIdAndStatus(m.getId(), MentorStatus.ACTIVE.name()));
        }

        // Preload existing (mentor,student) active pairs among these students so we never
        // double-assign. Read in slices rather than per student — a whole-batch bulk
        // assign is routine from the picker, and per-student was one query each.
        Set<String> pairs = new HashSet<>();
        List<String> students = distinctNonBlank(req.getStudentUserIds());
        forEachIdChunk(students, chunk -> assignmentRepository
                .findByInstituteIdAndStudentUserIdInAndStatus(
                        req.getInstituteId(), chunk, MentorStatus.ACTIVE.name())
                .forEach(a -> pairs.add(pairKey(a.getMentorId(), a.getStudentUserId()))));

        int assigned = 0, skipped = 0, capacityFull = 0;
        List<MentorStudentAssignment> toSave = new ArrayList<>();
        for (String studentUserId : students) {
            // Candidate mentors this student isn't already linked to; pick the lightest.
            // A mentor at max_mentees is out of the running entirely.
            Mentor chosen = null;
            boolean someCandidateWasFull = false;
            int best = Integer.MAX_VALUE;
            for (Mentor m : mentors) {
                if (pairs.contains(pairKey(m.getId(), studentUserId))) continue;
                int l = load.getOrDefault(m.getId(), 0);
                if (MentorService.atCapacity(m.getMaxMentees(), l)) {
                    someCandidateWasFull = true;
                    continue;
                }
                if (l < best) {
                    best = l;
                    chosen = m;
                }
            }
            if (chosen == null) {
                // Nobody could take them. Report capacity whenever it was part of the
                // reason — that's the half an admin can fix (raise a limit, add a mentor);
                // "already assigned to all of them" needs no action.
                if (someCandidateWasFull) capacityFull++;
                else skipped++;
                continue;
            }
            toSave.add(newAssignment(req.getInstituteId(), chosen, studentUserId,
                    AssignmentMethod.ROUND_ROBIN, req.getPackageSessionId(), user));
            pairs.add(pairKey(chosen.getId(), studentUserId));
            load.merge(chosen.getId(), 1, Integer::sum);
            assigned++;
        }
        if (!toSave.isEmpty()) {
            assignmentRepository.saveAll(toSave);
            final String instituteId = req.getInstituteId();
            final Map<String, String> nameByMentorUser = mentors.stream()
                    .collect(Collectors.toMap(Mentor::getUserId, Mentor::getDisplayName, (a, b) -> a));
            final List<MentorStudentAssignment> saved = new ArrayList<>(toSave);
            afterCommit(() -> saved.forEach(a ->
                    mentorshipNotificationService.notifyAssignment(instituteId, a.getStudentUserId(),
                            a.getMentorUserId(), nameByMentorUser.get(a.getMentorUserId()))));
        }
        return AssignmentResultDTO.builder()
                .assigned(assigned).skipped(skipped).capacityFull(capacityFull).build();
    }

    @Transactional
    public void unassign(String assignmentId, String instituteId) {
        MentorStudentAssignment a = assignmentRepository.findByIdAndInstituteId(assignmentId, instituteId)
                .orElseThrow(() -> new VacademyException("Assignment not found"));
        a.setStatus(MentorStatus.DELETED.name());
        assignmentRepository.save(a);
    }

    /** Students assigned to the calling mentor. */
    public List<MenteeDTO> menteesForMentor(String instituteId, String mentorUserId) {
        List<MentorStudentAssignment> rows = assignmentRepository
                .findByInstituteIdAndMentorUserIdAndStatus(instituteId, mentorUserId, MentorStatus.ACTIVE.name());
        if (rows.isEmpty()) return List.of();
        Map<String, UserDTO> users = hydrate(rows.stream()
                .map(MentorStudentAssignment::getStudentUserId).collect(Collectors.toList()));
        return rows.stream().map(a -> toMenteeDTO(a, users)).collect(Collectors.toList());
    }

    /** Paginated "my mentees"; identity hydration is per-page. */
    public Page<MenteeDTO> menteesForMentorPaged(String instituteId, String mentorUserId,
                                                 int pageNo, int pageSize) {
        Page<MentorStudentAssignment> page = assignmentRepository.findByInstituteIdAndMentorUserIdAndStatus(
                instituteId, mentorUserId, MentorStatus.ACTIVE.name(),
                PageRequest.of(Math.max(0, pageNo), Math.min(Math.max(1, pageSize), 100)));
        Map<String, UserDTO> users = hydrate(page.getContent().stream()
                .map(MentorStudentAssignment::getStudentUserId).collect(Collectors.toList()));
        return page.map(a -> toMenteeDTO(a, users));
    }

    private static MenteeDTO toMenteeDTO(MentorStudentAssignment a, Map<String, UserDTO> users) {
        UserDTO u = users.get(a.getStudentUserId());
        return MenteeDTO.builder()
                .assignmentId(a.getId())
                .mentorId(a.getMentorId())
                .studentUserId(a.getStudentUserId())
                .packageSessionId(a.getPackageSessionId())
                .assignmentMethod(a.getAssignmentMethod())
                .name(u != null ? u.getFullName() : null)
                .email(u != null ? u.getEmail() : null)
                .mobileNumber(u != null ? u.getMobileNumber() : null)
                .profilePicFileId(u != null ? u.getProfilePicFileId() : null)
                .build();
    }

    /** Mentors assigned to the calling student. */
    public List<MentorDTO> mentorsForStudent(String instituteId, String studentUserId) {
        List<MentorStudentAssignment> rows = assignmentRepository
                .findByInstituteIdAndStudentUserIdAndStatus(instituteId, studentUserId, MentorStatus.ACTIVE.name());
        if (rows.isEmpty()) return List.of();

        List<String> mentorIds = rows.stream().map(MentorStudentAssignment::getMentorId).distinct().toList();
        List<Mentor> mentors = ((List<Mentor>) mentorRepository.findAllById(mentorIds)).stream()
                .filter(m -> !MentorStatus.DELETED.name().equals(m.getStatus()))
                .collect(Collectors.toList());
        Map<String, UserDTO> users = hydrate(mentors.stream().map(Mentor::getUserId).collect(Collectors.toList()));

        return mentors.stream().map(m -> {
            UserDTO u = users.get(m.getUserId());
            return MentorDTO.builder()
                    .id(m.getId())
                    .instituteId(m.getInstituteId())
                    .userId(m.getUserId())
                    .displayName(m.getDisplayName())
                    .title(m.getTitle())
                    .profileImageFileId(m.getProfileImageFileId())
                    .bio(m.getBio())
                    // Expertise is what tells a learner WHY this mentor was matched to them.
                    // The Find-a-mentor directory has always sent it; the assigned-mentor list
                    // did not, so the tags an admin entered were invisible to the very learners
                    // they were paired with.
                    .expertiseTags(MentorService.splitTags(m.getExpertiseTags()))
                    .bookingPageId(m.getBookingPageId())
                    .bookingPageSlug(mentorService.slugFor(m.getBookingPageId()))
                    .status(m.getStatus())
                    .name(u != null ? u.getFullName() : null)
                    .email(u != null ? u.getEmail() : null)
                    .mobileNumber(u != null ? u.getMobileNumber() : null)
                    .profilePicFileId(u != null ? u.getProfilePicFileId() : null)
                    .build();
        }).collect(Collectors.toList());
    }

    // ---------- helpers ----------

    private MentorStudentAssignment newAssignment(String instituteId, Mentor mentor, String studentUserId,
                                                  AssignmentMethod method, String packageSessionId,
                                                  CustomUserDetails user) {
        return MentorStudentAssignment.builder()
                .instituteId(instituteId)
                .mentorId(mentor.getId())
                .mentorUserId(mentor.getUserId())
                .studentUserId(studentUserId)
                .packageSessionId(packageSessionId)
                .assignmentMethod(method.name())
                .assignedByUserId(user != null ? user.getUserId() : null)
                .status(MentorStatus.ACTIVE.name())
                .build();
    }

    private static String pairKey(String mentorId, String studentUserId) {
        return mentorId + "::" + studentUserId;
    }

    /**
     * Run {@code task} once the surrounding transaction has committed, so notification
     * HTTP calls never hold the assignment transaction open and a notification failure
     * can never roll back the assignment (see live-session-notify-rolls-back-slide).
     * Falls back to inline execution when there's no active transaction.
     */
    private void afterCommit(Runnable task) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    task.run();
                }
            });
        } else {
            task.run();
        }
    }

    private static List<String> distinctNonBlank(List<String> ids) {
        return ids.stream().filter(s -> s != null && !s.isBlank()).distinct().collect(Collectors.toList());
    }

    /**
     * Slice size for {@code IN (...)} id lookups.
     *
     * Postgres caps bind parameters per statement, and a driver that hits the cap
     * fails the whole assignment — so the id list is read in slices rather than as
     * one list whose length is whatever the admin selected.
     */
    private static final int ID_CHUNK = 500;

    private static void forEachIdChunk(List<String> ids, Consumer<List<String>> read) {
        for (int i = 0; i < ids.size(); i += ID_CHUNK) {
            read.accept(ids.subList(i, Math.min(ids.size(), i + ID_CHUNK)));
        }
    }

    private Map<String, UserDTO> hydrate(List<String> userIds) {
        List<String> distinct = userIds.stream().filter(id -> id != null && !id.isBlank()).distinct().toList();
        if (distinct.isEmpty()) return Map.of();
        try {
            List<UserDTO> users = authService.getUsersFromAuthServiceByUserIds(distinct);
            Map<String, UserDTO> map = new HashMap<>();
            for (UserDTO u : users) {
                if (u != null && u.getId() != null) map.put(u.getId(), u);
            }
            return map;
        } catch (Exception e) {
            // Names/emails simply go missing rather than the screen failing, so this
            // is invisible without reporting it.
            MentorshipErrorReporter.report(e, "hydrate-users", null);
            return Map.of();
        }
    }
}
