package vacademy.io.admin_core_service.features.mentorship.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.mentorship.dto.AssignMentorRequest;
import vacademy.io.admin_core_service.features.mentorship.dto.AssignmentResultDTO;
import vacademy.io.admin_core_service.features.mentorship.dto.BulkRoundRobinRequest;
import vacademy.io.admin_core_service.features.mentorship.entity.Mentor;
import vacademy.io.admin_core_service.features.mentorship.entity.MentorStudentAssignment;
import vacademy.io.admin_core_service.features.mentorship.repository.MentorRepository;
import vacademy.io.admin_core_service.features.mentorship.repository.MentorStudentAssignmentRepository;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Capacity ({@code mentor.max_mentees}) is the guard that keeps assignment fair:
 * a mentor with a cap must never be pushed past it, by either path, and the caller
 * has to be able to tell "already assigned" apart from "no room left".
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class MentorAssignmentCapacityTest {

    private static final String INSTITUTE = "inst-1";

    @Mock private MentorStudentAssignmentRepository assignmentRepository;
    @Mock private MentorRepository mentorRepository;
    @Mock private MentorService mentorService;
    @Mock private AuthService authService;
    @Mock private MentorshipNotificationService notificationService;

    @InjectMocks private MentorAssignmentService service;

    private Mentor mentor(String id, Integer maxMentees) {
        Mentor m = Mentor.builder()
                .id(id).instituteId(INSTITUTE).userId("user-" + id)
                .displayName("Mentor " + id).status("ACTIVE").maxMentees(maxMentees).build();
        when(mentorRepository.findByIdAndInstituteIdAndStatusNot(eq(id), eq(INSTITUTE), anyString()))
                .thenReturn(Optional.of(m));
        return m;
    }

    @SuppressWarnings("unchecked")
    private List<MentorStudentAssignment> captureSaved() {
        ArgumentCaptor<List<MentorStudentAssignment>> captor = ArgumentCaptor.forClass(List.class);
        verify(assignmentRepository).saveAll(captor.capture());
        return captor.getValue();
    }

    @Test
    @DisplayName("manual assign fills a mentor to their cap and reports the rest as capacity-blocked")
    void manualAssignStopsAtCapacity() {
        mentor("m1", 3);
        when(assignmentRepository.countByMentorIdAndStatus(eq("m1"), anyString())).thenReturn(1L);
        when(assignmentRepository.findByInstituteIdAndMentorIdAndStudentUserIdInAndStatus(
                anyString(), anyString(), any(), anyString())).thenReturn(List.of());

        AssignmentResultDTO result = service.assignManual(AssignMentorRequest.builder()
                .instituteId(INSTITUTE).mentorId("m1")
                .studentUserIds(List.of("s1", "s2", "s3", "s4")).build(), null);

        // Cap 3 with 1 already on the roster leaves room for exactly 2.
        assertEquals(2, result.getAssigned());
        assertEquals(2, result.getCapacityFull());
        assertEquals(0, result.getSkipped());
        assertEquals(2, captureSaved().size());
    }

    @Test
    @DisplayName("an uncapped mentor takes every student")
    void uncappedMentorTakesEveryone() {
        mentor("m1", null);
        when(assignmentRepository.countByMentorIdAndStatus(eq("m1"), anyString())).thenReturn(500L);
        when(assignmentRepository.findByInstituteIdAndMentorIdAndStudentUserIdInAndStatus(
                anyString(), anyString(), any(), anyString())).thenReturn(List.of());

        AssignmentResultDTO result = service.assignManual(AssignMentorRequest.builder()
                .instituteId(INSTITUTE).mentorId("m1")
                .studentUserIds(List.of("s1", "s2", "s3")).build(), null);

        assertEquals(3, result.getAssigned());
        assertEquals(0, result.getCapacityFull());
    }

    @Test
    @DisplayName("already-assigned students count as skipped, not capacity-blocked")
    void duplicatesAreSkippedNotCapacityBlocked() {
        mentor("m1", 10);
        when(assignmentRepository.countByMentorIdAndStatus(eq("m1"), anyString())).thenReturn(0L);
        when(assignmentRepository.findByInstituteIdAndMentorIdAndStudentUserIdInAndStatus(
                eq(INSTITUTE), eq("m1"), any(), anyString()))
                .thenReturn(List.of(MentorStudentAssignment.builder()
                        .mentorId("m1").studentUserId("s1").build()));

        AssignmentResultDTO result = service.assignManual(AssignMentorRequest.builder()
                .instituteId(INSTITUTE).mentorId("m1")
                .studentUserIds(List.of("s1", "s2")).build(), null);

        assertEquals(1, result.getAssigned());
        assertEquals(1, result.getSkipped());
        assertEquals(0, result.getCapacityFull());
    }

    @Test
    @DisplayName("round-robin routes around a full mentor instead of overloading them")
    void roundRobinSkipsFullMentors() {
        mentor("full", 1);
        mentor("open", null);
        when(assignmentRepository.countByMentorIdAndStatus(eq("full"), anyString())).thenReturn(1L);
        when(assignmentRepository.countByMentorIdAndStatus(eq("open"), anyString())).thenReturn(0L);
        when(assignmentRepository.findByInstituteIdAndStudentUserIdInAndStatus(anyString(), any(), anyString()))
                .thenReturn(List.of());

        AssignmentResultDTO result = service.bulkRoundRobin(BulkRoundRobinRequest.builder()
                .instituteId(INSTITUTE)
                .mentorIds(List.of("full", "open"))
                .studentUserIds(List.of("s1", "s2", "s3")).build(), null);

        assertEquals(3, result.getAssigned());
        assertEquals(0, result.getCapacityFull());
        assertTrue(captureSaved().stream().allMatch(a -> "open".equals(a.getMentorId())),
                "every student should land on the mentor with room");
    }

    @Test
    @DisplayName("round-robin reports capacity-blocked students when the whole group is full")
    void roundRobinReportsWhenEveryMentorIsFull() {
        mentor("m1", 2);
        mentor("m2", 1);
        when(assignmentRepository.countByMentorIdAndStatus(eq("m1"), anyString())).thenReturn(2L);
        when(assignmentRepository.countByMentorIdAndStatus(eq("m2"), anyString())).thenReturn(1L);
        when(assignmentRepository.findByInstituteIdAndStudentUserIdInAndStatus(anyString(), any(), anyString()))
                .thenReturn(List.of());

        AssignmentResultDTO result = service.bulkRoundRobin(BulkRoundRobinRequest.builder()
                .instituteId(INSTITUTE)
                .mentorIds(List.of("m1", "m2"))
                .studentUserIds(List.of("s1", "s2")).build(), null);

        assertEquals(0, result.getAssigned());
        assertEquals(2, result.getCapacityFull());
        verify(assignmentRepository, never()).saveAll(any());
        verify(notificationService, never()).notifyAssignment(anyString(), anyString(), anyString(), any());
    }

    @Test
    @DisplayName("every student is accounted for: assigned + skipped + capacityFull covers the input")
    void everyStudentIsAccountedFor() {
        // The admin's toast is built from these three numbers, so a student that falls
        // through all of them would silently disappear from the report.
        mentor("full", 1);
        mentor("open", 2);
        when(assignmentRepository.countByMentorIdAndStatus(eq("full"), anyString())).thenReturn(1L);
        when(assignmentRepository.countByMentorIdAndStatus(eq("open"), anyString())).thenReturn(0L);
        // s1 is already paired with the only mentor that has room.
        when(assignmentRepository.findByInstituteIdAndStudentUserIdInAndStatus(
                eq(INSTITUTE), any(), anyString()))
                .thenReturn(List.of(MentorStudentAssignment.builder()
                        .mentorId("open").studentUserId("s1").build()));

        List<String> students = List.of("s1", "s2", "s3", "s4");
        AssignmentResultDTO result = service.bulkRoundRobin(BulkRoundRobinRequest.builder()
                .instituteId(INSTITUTE)
                .mentorIds(List.of("full", "open"))
                .studentUserIds(students).build(), null);

        int total = result.getAssigned() + result.getSkipped() + result.getCapacityFull();
        assertEquals(students.size(), total,
                "assigned + skipped + capacityFull must equal the students submitted");
    }

    @Test
    @DisplayName("manual assign also accounts for every student submitted")
    void manualAssignAccountsForEveryStudent() {
        mentor("m1", 2);
        when(assignmentRepository.countByMentorIdAndStatus(eq("m1"), anyString())).thenReturn(1L);
        when(assignmentRepository.findByInstituteIdAndMentorIdAndStudentUserIdInAndStatus(
                eq(INSTITUTE), eq("m1"), any(), anyString()))
                .thenReturn(List.of(MentorStudentAssignment.builder()
                        .mentorId("m1").studentUserId("s1").build()));

        List<String> students = List.of("s1", "s2", "s3");
        AssignmentResultDTO result = service.assignManual(AssignMentorRequest.builder()
                .instituteId(INSTITUTE).mentorId("m1").studentUserIds(students).build(), null);

        // 1 already assigned, 1 fits the remaining slot, 1 blocked by the cap.
        assertEquals(1, result.getAssigned());
        assertEquals(1, result.getSkipped());
        assertEquals(1, result.getCapacityFull());
        assertEquals(students.size(),
                result.getAssigned() + result.getSkipped() + result.getCapacityFull());
    }

    @Test
    @DisplayName("round-robin spreads load evenly while each mentor still has room")
    void roundRobinBalancesWithinCapacity() {
        mentor("m1", 2);
        mentor("m2", 2);
        when(assignmentRepository.countByMentorIdAndStatus(eq("m1"), anyString())).thenReturn(0L);
        when(assignmentRepository.countByMentorIdAndStatus(eq("m2"), anyString())).thenReturn(0L);
        when(assignmentRepository.findByInstituteIdAndStudentUserIdInAndStatus(anyString(), any(), anyString()))
                .thenReturn(List.of());

        AssignmentResultDTO result = service.bulkRoundRobin(BulkRoundRobinRequest.builder()
                .instituteId(INSTITUTE)
                .mentorIds(List.of("m1", "m2"))
                .studentUserIds(List.of("s1", "s2", "s3", "s4", "s5")).build(), null);

        assertEquals(4, result.getAssigned());
        assertEquals(1, result.getCapacityFull());
        List<MentorStudentAssignment> saved = captureSaved();
        assertEquals(2, saved.stream().filter(a -> "m1".equals(a.getMentorId())).count());
        assertEquals(2, saved.stream().filter(a -> "m2".equals(a.getMentorId())).count());
    }

    @Test
    @DisplayName("existing assignments are read in one batched query, not one per student")
    void existingAssignmentsAreReadInOneQuery() {
        // The picker can hand over a whole batch at once. Asking per student put a
        // round trip per student inside the assignment transaction.
        mentor("m1", null);
        when(assignmentRepository.countByMentorIdAndStatus(eq("m1"), anyString())).thenReturn(0L);
        when(assignmentRepository.findByInstituteIdAndMentorIdAndStudentUserIdInAndStatus(
                anyString(), anyString(), any(), anyString())).thenReturn(List.of());

        service.assignManual(AssignMentorRequest.builder()
                .instituteId(INSTITUTE).mentorId("m1")
                .studentUserIds(List.of("s1", "s2", "s3", "s4", "s5")).build(), null);

        verify(assignmentRepository, times(1)).findByInstituteIdAndMentorIdAndStudentUserIdInAndStatus(
                eq(INSTITUTE), eq("m1"), any(), anyString());
    }
}
