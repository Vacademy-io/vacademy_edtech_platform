package vacademy.io.admin_core_service.features.booking.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.booking.dto.BookingInstanceDTO;
import vacademy.io.admin_core_service.features.booking.dto.BookingPageDTO;
import vacademy.io.admin_core_service.features.booking.dto.MeetingBookingRequestDTO;
import vacademy.io.admin_core_service.features.booking.service.BookingPageService;
import vacademy.io.admin_core_service.features.booking.service.MeetingBookingService;
import vacademy.io.admin_core_service.features.booking.service.TeamScopeService;
import vacademy.io.admin_core_service.features.booking.service.UserGoogleAccountService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * CRM → Meetings. Booking-page (shareable Calendly-style config) CRUD,
 * admin create-on-behalf booking, and My Schedule / Team Meetings feeds.
 * Every endpoint is institute-scoped via {@link InstituteAccessValidator}.
 */
@RestController
@RequestMapping("/admin-core-service/v1/meetings")
@RequiredArgsConstructor
public class MeetingsController {

    private final BookingPageService bookingPageService;
    private final MeetingBookingService meetingBookingService;
    private final TeamScopeService teamScopeService;
    private final UserGoogleAccountService userGoogleAccountService;
    private final InstituteAccessValidator instituteAccessValidator;

    // ==================== MY GOOGLE ACCOUNT ====================

    /** The caller's own Google connection (connected flag + email) for the My Schedule card. */
    @GetMapping("/my-google")
    public ResponseEntity<Map<String, Object>> myGoogle(
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.validateUserAccess(user, instituteId);
        return ResponseEntity.ok(userGoogleAccountService.status(instituteId, user.getUserId()));
    }

    /** Start the caller's own Google connect — returns the consent URL; the callback lands back on My Schedule. */
    @PostMapping("/my-google/initiate")
    public ResponseEntity<Map<String, String>> initiateMyGoogle(
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.validateUserAccess(user, instituteId);
        return ResponseEntity.ok(userGoogleAccountService.initiate(instituteId, user, "/meetings/my-schedule"));
    }

    @DeleteMapping("/my-google")
    public ResponseEntity<Void> disconnectMyGoogle(
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.validateUserAccess(user, instituteId);
        userGoogleAccountService.disconnect(instituteId, user.getUserId());
        return ResponseEntity.noContent().build();
    }

    // ==================== BOOKING PAGE CRUD ====================

    @PostMapping("/booking-page")
    @Auditable(entityType = "BOOKING_PAGE", action = "CREATE",
            entityIdExpr = "#result?.body?.id",
            descriptionExpr = "'created booking page ' + (#dto?.title ?: '')")
    public ResponseEntity<BookingPageDTO> createBookingPage(
            @RequestBody BookingPageDTO dto,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.validateUserAccess(user, dto.getInstituteId());
        return ResponseEntity.ok(bookingPageService.create(dto, user));
    }

    @PutMapping("/booking-page/{id}")
    @Auditable(entityType = "BOOKING_PAGE", action = "UPDATE",
            entityIdExpr = "#id",
            descriptionExpr = "'updated booking page'")
    public ResponseEntity<BookingPageDTO> updateBookingPage(
            @PathVariable("id") String id,
            @RequestParam("instituteId") String instituteId,
            @RequestBody BookingPageDTO dto,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.validateUserAccess(user, instituteId);
        return ResponseEntity.ok(bookingPageService.update(id, instituteId, dto, user));
    }

    @GetMapping("/booking-page/{id}")
    public ResponseEntity<BookingPageDTO> getBookingPage(
            @PathVariable("id") String id,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.validateUserAccess(user, instituteId);
        return ResponseEntity.ok(bookingPageService.getById(id, instituteId));
    }

    @GetMapping("/booking-pages")
    public ResponseEntity<List<BookingPageDTO>> listBookingPages(
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "audienceId", required = false) String audienceId,
            @RequestParam(value = "hostUserId", required = false) String hostUserId,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.validateUserAccess(user, instituteId);
        return ResponseEntity.ok(bookingPageService.list(instituteId, audienceId, hostUserId));
    }

    @DeleteMapping("/booking-page/{id}")
    @Auditable(entityType = "BOOKING_PAGE", action = "DELETE",
            entityIdExpr = "#id",
            descriptionExpr = "'deleted booking page'")
    public ResponseEntity<String> deleteBookingPage(
            @PathVariable("id") String id,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.validateUserAccess(user, instituteId);
        bookingPageService.delete(id, instituteId);
        return ResponseEntity.ok("Booking page deleted");
    }

    // ==================== CREATE BOOKING (on behalf) ====================

    @PostMapping("/book")
    @Auditable(entityType = "BOOKING_INSTANCE", action = "CREATE",
            entityIdExpr = "#result?.body?.id",
            descriptionExpr = "'booked meeting ' + (#request?.title ?: '')")
    public ResponseEntity<BookingInstanceDTO> createBooking(
            @RequestBody MeetingBookingRequestDTO request,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.validateUserAccess(user, request.getInstituteId());
        return ResponseEntity.ok(meetingBookingService.createBooking(request, user));
    }

    // ==================== MY SCHEDULE ====================

    @GetMapping("/my-calendar")
    public ResponseEntity<List<BookingInstanceDTO>> myCalendar(
            @RequestParam("instituteId") String instituteId,
            @RequestParam("startDate") String startDate,
            @RequestParam("endDate") String endDate,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.validateUserAccess(user, instituteId);
        return ResponseEntity.ok(meetingBookingService.listForHosts(
                instituteId, List.of(user.getUserId()),
                windowStart(startDate), windowEnd(endDate)));
    }

    // ==================== TEAM MEETINGS ====================

    /**
     * Bookings of the caller's team: admins get the institute-wide view;
     * everyone else gets themselves + everyone reporting up to them (any role)
     * through the org-team hierarchy.
     */
    @GetMapping("/team-calendar")
    public ResponseEntity<List<BookingInstanceDTO>> teamCalendar(
            @RequestParam("instituteId") String instituteId,
            @RequestParam("startDate") String startDate,
            @RequestParam("endDate") String endDate,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.validateUserAccess(user, instituteId);
        Timestamp start = windowStart(startDate);
        Timestamp end = windowEnd(endDate);
        if (teamScopeService.hasAdminRole(user, instituteId)) {
            return ResponseEntity.ok(meetingBookingService.listForInstitute(instituteId, start, end));
        }
        List<String> hostIds = teamScopeService.scopedTeamUserIds(user.getUserId());
        return ResponseEntity.ok(meetingBookingService.listForHosts(instituteId, hostIds, start, end));
    }

    // ==================== LEAD VIEW ====================

    /**
     * A lead's meetings for the CRM lead detail view — matched by
     * audience_response id, the lead's platform user id, and/or email.
     */
    @GetMapping("/by-lead")
    public ResponseEntity<List<BookingInstanceDTO>> byLead(
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "audienceResponseId", required = false) String audienceResponseId,
            @RequestParam(value = "inviteeUserId", required = false) String inviteeUserId,
            @RequestParam(value = "inviteeEmail", required = false) String inviteeEmail,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.validateUserAccess(user, instituteId);
        return ResponseEntity.ok(meetingBookingService.listForLead(
                instituteId, audienceResponseId, inviteeUserId, inviteeEmail));
    }

    /** FE gating: whether to render the Team Meetings tab for this caller. */
    @GetMapping("/scope")
    public ResponseEntity<Map<String, Object>> scope(
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.validateUserAccess(user, instituteId);
        List<String> teamUserIds = teamScopeService.scopedTeamUserIds(user.getUserId());
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("is_admin", teamScopeService.hasAdminRole(user, instituteId));
        out.put("is_team_manager", teamUserIds.size() > 1);
        out.put("team_user_ids", teamUserIds);
        return ResponseEntity.ok(out);
    }

    // ---------- helpers ----------

    /**
     * Window bounds accept either an ISO offset datetime (preferred — the FE
     * sends the exact local week boundary as an instant) or a bare yyyy-MM-dd
     * (interpreted as a UTC day, back-compat).
     */
    private static Timestamp windowStart(String value) {
        return parseBoundary(value, false);
    }

    private static Timestamp windowEnd(String value) {
        return parseBoundary(value, true);
    }

    private static Timestamp parseBoundary(String value, boolean endOfDay) {
        if (value == null || value.isBlank()) {
            throw new VacademyException("startDate/endDate are required");
        }
        try {
            return Timestamp.from(OffsetDateTime.parse(value).toInstant());
        } catch (Exception ignored) {
            // fall through to date-only parsing
        }
        try {
            LocalDate day = LocalDate.parse(value);
            return Timestamp.valueOf(endOfDay ? day.plusDays(1).atStartOfDay() : day.atStartOfDay());
        } catch (Exception e) {
            throw new VacademyException("Invalid date '" + value + "': use ISO-8601 offset datetime or yyyy-MM-dd");
        }
    }
}
