package vacademy.io.admin_core_service.features.live_session.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.common.dto.CustomFieldDTO;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.admin_core_service.features.live_session.dto.*;
import vacademy.io.admin_core_service.features.live_session.repository.LiveSessionParticipantRepository;
import vacademy.io.admin_core_service.features.live_session.repository.SessionGuestRegistrationRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.time.LocalDate;
import java.util.*;
import java.util.stream.Collectors;

@Service
public class AttendanceReportService {
    @Autowired
    private LiveSessionParticipantRepository liveSessionParticipantRepository;

    @Autowired
    private SessionGuestRegistrationRepository sessionGuestRegistrationRepository;

    public Map<String, List<CustomFieldDTO>> getGuestWiseCustomFields(String sessionId) {
        List<GuestSessionCustomFieldDTO> projections = sessionGuestRegistrationRepository.findGuestCustomFieldsBySessionId(sessionId);

        Map<String, List<CustomFieldDTO>> groupedByGuest = new HashMap<>();

        for (GuestSessionCustomFieldDTO projection : projections) {
            String guestId = projection.getGuestId();

            CustomFieldDTO dto = new CustomFieldDTO();
            dto.setId(projection.getCustomFieldId());
            dto.setFieldKey(projection.getFieldKey());
            dto.setFieldName(projection.getFieldName());
            dto.setFieldType(projection.getFieldType());
            dto.setDefaultValue(projection.getDefaultValue());
            dto.setConfig(projection.getConfig());
            dto.setFormOrder(projection.getFormOrder());
            dto.setIsMandatory(projection.getIsMandatory());
            dto.setIsFilter(projection.getIsFilter());
            dto.setIsSortable(projection.getIsSortable());
            dto.setCreatedAt(projection.getCreatedAt());
            dto.setUpdatedAt(projection.getUpdatedAt());
            dto.setSessionId(projection.getLiveSessionId());
            dto.setLiveSessionId(projection.getLiveSessionId());
            dto.setCustomFieldValue(projection.getCustomFieldValue());
            dto.setGuestId(guestId);

            groupedByGuest.computeIfAbsent(guestId, k -> new ArrayList<>()).add(dto);
        }

        return groupedByGuest;
    }

    public StudentAttendanceReportDTO getStudentReport(String userId, String batchId, LocalDate start, LocalDate end) {
        // Fetch attendance data for both USER and BATCH
        List<ScheduleAttendanceProjection> attendanceData = liveSessionParticipantRepository
                .findAttendanceForUser(userId, batchId, start, end);

        List<ScheduleDetailDTO> scheduleDetails = new ArrayList<>();
        int presentCount = 0;

        for (ScheduleAttendanceProjection projection : attendanceData) {
            ScheduleDetailDTO dto = new ScheduleDetailDTO();
            dto.setScheduleId(projection.getScheduleId());
            dto.setMeetingDate(projection.getMeetingDate());
            dto.setStartTime(projection.getStartTime());
            dto.setLastEntryTime(projection.getLastEntryTime());
            dto.setSessionId(projection.getSessionId());
            dto.setSessionTitle(projection.getSessionTitle());
            dto.setSubject(projection.getSubject());
            dto.setSessionStatus(projection.getSessionStatus());
            dto.setAccessLevel(projection.getAccessLevel());

            String attendanceStatus = projection.getAttendanceStatus();
            dto.setAttendanceStatus(attendanceStatus);
            dto.setDurationMinutes(projection.getDurationMinutes());

            if("PRESENT".equals(attendanceStatus)) {
                presentCount++;
            }

            scheduleDetails.add(dto);
        }

        //double attendancePercentage = liveSessionParticipantRepository.getAttendancePercentage(batchId, userId, start, end);
        double attendancePercentage=0.0;
        if(presentCount!=0 && scheduleDetails.size()!=0)
             attendancePercentage=((double)presentCount/scheduleDetails.size())*100;
        StudentAttendanceReportDTO report = new StudentAttendanceReportDTO();
        report.setUserId(userId);
        report.setAttendancePercentage(attendancePercentage);
        report.setSchedules(scheduleDetails);

        return report;
    }



    public List<AttendanceReportDTO> generateReport(String sessionId , String scheduleId , String accessType) {
        if(Objects.equals(accessType, "private")) {
            return liveSessionParticipantRepository.getAttendanceReportBySessionIds(sessionId , scheduleId);
        } else {
            // For public access, combine both regular participants and guest attendees
            List<AttendanceReportDTO> regularParticipants = liveSessionParticipantRepository.getAttendanceReportBySessionIds(sessionId , scheduleId);
            List<GuestAttendanceDTO> guests = sessionGuestRegistrationRepository.findGuestAttendanceBySessionAndSchedule(sessionId, scheduleId);
            List<AttendanceReportDTO> guestReports = guests.stream()
                    .map(AttendanceMapper::convertGuestToAttendanceReport)
                    .collect(Collectors.toList());
            
            // Combine both lists
            List<AttendanceReportDTO> combinedResults = new ArrayList<>();
            combinedResults.addAll(regularParticipants);
            combinedResults.addAll(guestReports);
            
            return combinedResults;
        }
    }
    public Page<StudentAttendanceDTO> getAllByAttendanceFilterRequest(AttendanceFilterRequest filter, Pageable pageable) {
        // Fail closed: batch_ids/live_session_ids are both optional ("all"), so instituteId is
        // the only thing keeping this report inside one institute. Without it the query used to
        // return every learner on the platform.
        String instituteId = filter.getInstituteId() != null ? filter.getInstituteId().trim() : null;
        if (instituteId == null || instituteId.isEmpty()) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "institute_id is required");
        }

        String name = (filter.getName() != null && !filter.getName().trim().isEmpty())
                ? filter.getName().trim()
                : null;

        List<String> batchIds = filter.getBatchIds() != null ? filter.getBatchIds() : Collections.emptyList();
        List<String> liveSessionIds = filter.getLiveSessionIds() != null ? filter.getLiveSessionIds() : Collections.emptyList();
        Page<String> studentIdsPage = liveSessionParticipantRepository.findDistinctStudentIdsWithFilters(
                instituteId,
                name,
                filter.getStartDate(),
                filter.getEndDate(),
                batchIds,
                batchIds.size(),
                liveSessionIds,
                liveSessionIds.size(),
                pageable
        );
        if (studentIdsPage.isEmpty()) {
            return new PageImpl<>(Collections.emptyList(), pageable, 0);
        }
        List<AttendanceReportProjection> attendanceRecords = liveSessionParticipantRepository.getAttendanceReportForStudentIds(
                instituteId,
                studentIdsPage.getContent(),
                filter.getStartDate(),
                filter.getEndDate(),
                batchIds,
                batchIds.size(),
                liveSessionIds,
                liveSessionIds.size()
        );
        Map<String, StudentAttendanceDTO> groupedData = new LinkedHashMap<>();
        for (AttendanceReportProjection record : attendanceRecords) {
            groupedData.computeIfAbsent(record.getStudentId(), id -> {
                StudentAttendanceDTO student = new StudentAttendanceDTO();
                student.setStudentId(id);
                student.setFullName(record.getFullName());
                student.setEmail(record.getEmail());
                student.setMobileNumber(record.getMobileNumber());
                student.setGender(record.getGender());
                student.setDateOfBirth(record.getDateOfBirth());
                student.setInstituteEnrollmentNumber(record.getInstituteEnrollmentNumber());
                student.setEnrollmentStatus(record.getEnrollmentStatus());
                student.setPackageSessionId(record.getPackageSessionId());
                student.setSessions(new ArrayList<>());
                return student;
            });

            AttendanceDetailsDTO details = new AttendanceDetailsDTO();
            details.setSessionId(record.getSessionId());
            details.setScheduleId(record.getScheduleId());
            details.setTitle(record.getTitle());
            details.setMeetingDate(record.getMeetingDate());
            details.setStartTime(record.getStartTime());
            details.setLastEntryTime(record.getLastEntryTime());
            details.setAttendanceStatus(record.getAttendanceStatus());
            details.setAttendanceDetails(record.getAttendanceDetails());
            details.setAttendanceTimestamp(record.getAttendanceTimestamp());
            details.setDailyAttendance(record.getDailyAttendance());
            details.setDurationMinutes(record.getProviderTotalDurationMinutes());
            details.setEngagementData(record.getEngagementData());

            groupedData.get(record.getStudentId()).getSessions().add(details);
        }

        // Calculate attendance percentage for each student
        for (StudentAttendanceDTO student : groupedData.values()) {
            double attendancePercentage = calculateAttendancePercentage(student.getSessions());
            student.setAttendancePercentage(attendancePercentage);
        }

        return new PageImpl<>(
                new ArrayList<>(groupedData.values()),
                pageable,
                studentIdsPage.getTotalElements()
        );
    }
    /**
     * Cross-session learner feedback search for the admin "Live Class Feedback"
     * page. Returns the raw projection page (feedbackDetails/feedbackConfigJson are
     * parsed on the frontend); empty batch/subject lists mean "all".
     */
    public Page<LiveClassFeedbackProjection> searchFeedback(LiveClassFeedbackSearchRequest request, Pageable pageable) {
        List<String> batchIds = request.getBatchIds() != null ? request.getBatchIds() : Collections.emptyList();
        List<String> subjects = request.getSubjects() != null ? request.getSubjects() : Collections.emptyList();
        String search = (request.getSearchQuery() != null && !request.getSearchQuery().trim().isEmpty())
                ? request.getSearchQuery().trim()
                : null;
        // Flag + value pair (not a nullable numeric) — Postgres cannot infer the
        // type of a null bind in ":param IS NULL", so the query would fail with 42P18.
        boolean hasRatingBelow = request.getRatingBelow() != null;
        double ratingBelow = hasRatingBelow ? request.getRatingBelow() : 0d;

        return liveSessionParticipantRepository.searchFeedback(
                request.getInstituteId(),
                request.getStartDate(),
                request.getEndDate(),
                batchIds,
                batchIds.size(),
                subjects,
                subjects.size(),
                search,
                hasRatingBelow ? 1 : 0,
                ratingBelow,
                pageable
        );
    }

    /**
     * Distinct live-class subjects for the feedback page's subject filter,
     * optionally narrowed to the given batches.
     */
    public List<String> getDistinctSubjects(String instituteId, List<String> batchIds) {
        List<String> safeBatchIds = batchIds != null ? batchIds : Collections.emptyList();
        return liveSessionParticipantRepository.findDistinctSubjects(instituteId, safeBatchIds, safeBatchIds.size());
    }

    public List<StudentAttendanceDTO> getGroupedAttendanceReport(String batchSessionId , LocalDate startDate , LocalDate endDate) {
        List<AttendanceReportProjection> flatData =
                liveSessionParticipantRepository.getAttendanceReportWithinDateRange(batchSessionId , startDate , endDate);

        Map<String, StudentAttendanceDTO> groupedData = new LinkedHashMap<>();

        for (AttendanceReportProjection record : flatData) {
            String studentId = record.getStudentId();

            // Create student record if not already
            groupedData.computeIfAbsent(studentId, id -> {
                StudentAttendanceDTO student = new StudentAttendanceDTO();
                student.setStudentId(id);
                student.setFullName(record.getFullName());
                student.setEmail(record.getEmail());
                student.setMobileNumber(record.getMobileNumber());
                student.setGender(record.getGender());
                student.setDateOfBirth(record.getDateOfBirth());
                student.setInstituteEnrollmentNumber(record.getInstituteEnrollmentNumber());
                student.setEnrollmentStatus(record.getEnrollmentStatus());
                student.setSessions(new ArrayList<>());
                return student;
            });

            // Add session/schedule/attendance data
            AttendanceDetailsDTO details = new AttendanceDetailsDTO();
            details.setSessionId(record.getSessionId());
            details.setScheduleId(record.getScheduleId());
            details.setTitle(record.getTitle());
            details.setMeetingDate(record.getMeetingDate());
            details.setStartTime(record.getStartTime());
            details.setLastEntryTime(record.getLastEntryTime());
            details.setAttendanceStatus(record.getAttendanceStatus());
            details.setAttendanceDetails(record.getAttendanceDetails());
            details.setAttendanceTimestamp(record.getAttendanceTimestamp());
            details.setDailyAttendance(record.getDailyAttendance());
            details.setDurationMinutes(record.getProviderTotalDurationMinutes());
            details.setEngagementData(record.getEngagementData());

            groupedData.get(studentId).getSessions().add(details);
        }

        // Calculate attendance percentage for each student
        for (StudentAttendanceDTO student : groupedData.values()) {
            double attendancePercentage = calculateAttendancePercentage(student.getSessions());
            student.setAttendancePercentage(attendancePercentage);
        }

        return new ArrayList<>(groupedData.values());
    }

    public class AttendanceMapper {

        public static AttendanceReportDTO convertGuestToAttendanceReport(GuestAttendanceDTO guestDto) {
            return AttendanceReportDTOImpl.builder()
                    .studentId(guestDto.getGuestId())
                    .fullName(guestDto.getGuestName())
                    .email(guestDto.getGuestEmail())
                    .mobileNumber(guestDto.getMobileNumber())
                    .gender(null)
                    .dateOfBirth(null)
                    .instituteEnrollmentNumber(null)
                    .enrollmentStatus(null)
                    .attendanceStatus(guestDto.getAttendanceStatus())
                    .attendanceDetails(guestDto.getAttendanceDetails())
                    .attendanceTimestamp(guestDto.getAttendanceTimestamp())
                    .sourceType(guestDto.getSourceType())
                    .statusType(guestDto.getStatusType())
                    .engagementData(guestDto.getEngagementData())
                    .providerTotalDurationMinutes(guestDto.getProviderTotalDurationMinutes())
                    .providerTotalDurationSeconds(guestDto.getProviderTotalDurationSeconds())
                    .feedbackDetails(null)
                    .batchName(null)
                    .registeredAt(guestDto.getRegisteredAt())
                    .build();
        }
    }

    /**
     * Calculates attendance percentage based on daily_attendance field logic.
     * 
     * Business Rules:
     * 1. Group sessions by meeting date
     * 2. For each date group:
     *    - If any session has daily_attendance = true: count all schedules as attendance units,
     *      and if student attended ANY schedule on that date, mark ALL schedules as attended
     *    - If all sessions have daily_attendance = false: count each session individually
     * 3. A student is considered "attended" if they have any attendance record for that session
     * 
     * @param sessions List of attendance details for the student
     * @return Attendance percentage (0.0 to 100.0), rounded to 2 decimal places
     */
    private double calculateAttendancePercentage(List<AttendanceDetailsDTO> sessions) {
        if (sessions == null || sessions.isEmpty()) {
            return 0.0;
        }
        
        // Group sessions by meeting date
        Map<LocalDate, List<AttendanceDetailsDTO>> sessionsByDate = sessions.stream()
                .filter(session -> session.getMeetingDate() != null)
                .collect(Collectors.groupingBy(AttendanceDetailsDTO::getMeetingDate));
        
        if (sessionsByDate.isEmpty()) {
            return 0.0;
        }
        
        int totalAttendanceUnits = 0;
        int attendedUnits = 0;
        
        for (Map.Entry<LocalDate, List<AttendanceDetailsDTO>> dateEntry : sessionsByDate.entrySet()) {
            List<AttendanceDetailsDTO> dateSessions = dateEntry.getValue();
            
            // Check if any session in this date has daily_attendance = true
            boolean hasDailyAttendance = dateSessions.stream()
                    .anyMatch(session -> Boolean.TRUE.equals(session.getDailyAttendance()));
            
            if (hasDailyAttendance) {
                // If any session has daily_attendance = true, count all schedules as units
                int scheduleCount = dateSessions.size();
                totalAttendanceUnits += scheduleCount;
                
                // Check if student attended any session on this date
                boolean attendedThisDate = dateSessions.stream()
                        .anyMatch(session -> "PRESENT".equals(session.getAttendanceStatus()));

                // If attended any schedule, mark all schedules for that date as attended
                if (attendedThisDate) {
                    attendedUnits += scheduleCount;
                }
            } else {
                // If all sessions have daily_attendance = false, count each session individually
                for (AttendanceDetailsDTO session : dateSessions) {
                    totalAttendanceUnits += 1;

                    if ("PRESENT".equals(session.getAttendanceStatus())) {
                        attendedUnits += 1;
                    }
                }
            }
        }
        
        if (totalAttendanceUnits == 0) {
            return 0.0;
        }
        
        // Calculate percentage and round to 2 decimal places
        double percentage = (attendedUnits * 100.0) / totalAttendanceUnits;
        return Math.round(percentage * 100.0) / 100.0;
    }

}
