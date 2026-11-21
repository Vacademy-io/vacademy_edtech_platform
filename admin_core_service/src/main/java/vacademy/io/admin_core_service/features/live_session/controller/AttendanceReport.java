package vacademy.io.admin_core_service.features.live_session.controller;


import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.common.dto.CustomFieldDTO;
import vacademy.io.admin_core_service.features.live_session.dto.*;
import vacademy.io.admin_core_service.features.live_session.service.AttendanceReportService;
import vacademy.io.admin_core_service.features.live_session.service.LearnerLiveSessionService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/admin-core-service/live-session-report")
@RequiredArgsConstructor
public class AttendanceReport {

    private final AttendanceReportService attendanceReportService;
    private final LearnerLiveSessionService learnerLiveSessionService;

    @GetMapping("/by-session-id")
    ResponseEntity<List<AttendanceReportDTO>> getReportBySessionIds(@RequestParam("sessionId") String sessionId , @RequestParam("scheduleId") String scheduleId , @RequestParam("accessType") String accessType , @RequestAttribute("user") CustomUserDetails user){
        return ResponseEntity.ok(attendanceReportService.generateReport(sessionId , scheduleId , accessType));
    }

    @GetMapping("/by-batch-session")
    public ResponseEntity<List<StudentAttendanceDTO>> getAttendanceReportByBatchSessionId(
            @RequestParam("batchSessionId") String batchSessionId , @RequestParam("startDate") LocalDate start, @RequestParam("endDate") LocalDate end
    ) {
        List<StudentAttendanceDTO> report = attendanceReportService.getGroupedAttendanceReport(batchSessionId , start , end);
        return ResponseEntity.ok(report);
    }
    @PostMapping("/all-attendance")
    public ResponseEntity<Page<StudentAttendanceDTO>> getAttendanceFilterRequest(@RequestBody AttendanceFilterRequest attendanceFilterRequest, @RequestParam(defaultValue = "0") int page,
                                                                 @RequestParam(defaultValue = "10") int size) {
        Pageable pageable = PageRequest.of(page, size); // page 0, size 10
        return  new ResponseEntity<>(attendanceReportService.getAllByAttendanceFilterRequest(attendanceFilterRequest, pageable), HttpStatus.OK);

    }

    @GetMapping("/public-registration")
    public ResponseEntity<Map<String, List<CustomFieldDTO>>> getPublicRegisteredData(@RequestParam("SessionId") String sessionId){
        return ResponseEntity.ok(attendanceReportService.getGuestWiseCustomFields(sessionId));
    }

    @GetMapping("/student-report")
    public ResponseEntity<StudentAttendanceReportDTO> getStudentReport(@RequestParam("userId") String userId , @RequestParam("batchId") String batchId , @RequestParam("startDate") LocalDate start, @RequestParam("endDate") LocalDate end){
        return ResponseEntity.ok(attendanceReportService.getStudentReport(userId , batchId , start ,end));
    }

    /**
     * Learner-profile Live Sessions tab: one learner's already-started classes in the range,
     * across all their batches (or just {@code batchId}), with attendance, attended minutes and a
     * concentration score.
     */
    @GetMapping("/learner-live-sessions")
    public ResponseEntity<LearnerLiveSessionsResponseDTO> getLearnerLiveSessions(
            @RequestParam("userId") String userId,
            @RequestParam("startDate") LocalDate start,
            @RequestParam("endDate") LocalDate end,
            @RequestParam(value = "batchId", required = false) String batchId,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(learnerLiveSessionService.getLearnerLiveSessions(userId, batchId, start, end));
    }

    /** The learner's next (or in-progress) classes, soonest first, with their meeting links. */
    @GetMapping("/learner-upcoming-sessions")
    public ResponseEntity<List<LearnerUpcomingClassDTO>> getLearnerUpcomingSessions(
            @RequestParam("userId") String userId,
            @RequestParam(value = "limit", defaultValue = "5") int limit,
            @RequestParam(value = "batchId", required = false) String batchId,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(learnerLiveSessionService.getLearnerUpcomingClasses(userId, batchId, limit));
    }

    @PostMapping("/feedback/search")
    public ResponseEntity<Page<LiveClassFeedbackProjection>> searchFeedback(
            @RequestBody LiveClassFeedbackSearchRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        int page = request.getPage() != null ? request.getPage() : 0;
        int size = request.getSize() != null ? request.getSize() : 20;
        Pageable pageable = PageRequest.of(page, size);
        return ResponseEntity.ok(attendanceReportService.searchFeedback(request, pageable));
    }

    @GetMapping("/feedback/subjects")
    public ResponseEntity<List<String>> feedbackSubjects(
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "batchIds", required = false) List<String> batchIds,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(attendanceReportService.getDistinctSubjects(instituteId, batchIds));
    }

}
