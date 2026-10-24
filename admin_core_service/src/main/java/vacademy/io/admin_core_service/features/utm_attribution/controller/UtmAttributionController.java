package vacademy.io.admin_core_service.features.utm_attribution.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.utm_attribution.dto.UtmAttributionResponse;
import vacademy.io.admin_core_service.features.utm_attribution.dto.UtmCampaignSummaryResponse;
import vacademy.io.admin_core_service.features.utm_attribution.dto.UtmDashboardResponse;
import vacademy.io.admin_core_service.features.utm_attribution.dto.UtmFilterOptionsResponse;
import vacademy.io.admin_core_service.features.utm_attribution.service.UtmAttributionService;
import vacademy.io.admin_core_service.features.utm_attribution.service.UtmDashboardService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;

import java.util.Locale;
import java.util.Set;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;

/**
 * Read side of campaign attribution — what the admin dashboard asks.
 *
 * instituteId is a request param rather than being taken from the token because
 * an admin can belong to several institutes and the open screen already knows
 * which one it is on; every endpoint checks it against the caller's own
 * authorities so it cannot be used to read another institute's data.
 */
@RestController
@RequestMapping("/admin-core-service/v1/utm")
public class UtmAttributionController {

    @Autowired
    private UtmAttributionService service;

    @Autowired
    private InstituteAccessValidator accessValidator;

    @Autowired
    private UtmDashboardService dashboardService;

    /**
     * Every recorded touch for one learner, oldest first.
     *
     * Answers with an empty list — never a 404 — when the learner arrived
     * before this feature existed or was never on a tagged link. "No campaign
     * data" is a normal state for most learners, not an error.
     */
    @GetMapping("/user/{userId}")
    public ResponseEntity<List<UtmAttributionResponse>> forUser(
            @AuthenticationPrincipal CustomUserDetails user,
            @PathVariable String userId,
            @RequestParam String instituteId,
            @RequestParam(required = false) String email,
            @RequestParam(required = false) String mobileNumber) {
        requireStaffAccess(user, instituteId);
        return ResponseEntity.ok(service.findForUser(instituteId, userId, email, mobileNumber));
    }

    /**
     * Roles that identify a LEARNER-side caller rather than a member of staff.
     */
    private static final Set<String> LEARNER_ROLES = Set.of("STUDENT", "PARENT", "GUARDIAN");

    /**
     * Institute membership, minus the learners themselves.
     *
     * NOT {@code requireAdminAccess}: acquisition data is exactly what a
     * COUNSELLOR needs, and they are the primary audience for the learner
     * side-view this feeds. Demanding the ADMIN authority would have hidden the
     * card from counsellors and teachers while the Lead Profile card sitting
     * directly beside it — served by AudienceController, which validates
     * nothing at all — kept working, which is an inconsistency an admin would
     * read as a bug.
     *
     * NOT bare {@code validateUserAccess} either: a learner holds a real role in
     * the institute, so membership alone would let any student read their own,
     * and any classmate's, acquisition history.
     */
    private void requireStaffAccess(CustomUserDetails user, String instituteId) {
        accessValidator.validateUserAccess(user, instituteId);
        if (isLearnerOnly(user)) {
            throw new ForbiddenException("Access denied: staff role required");
        }
    }

    /** True only when EVERY role the caller holds is a learner-side one. */
    private boolean isLearnerOnly(CustomUserDetails user) {
        if (user == null || user.isRootUser()) return false;
        var authorities = user.getAuthorities();
        if (authorities == null || authorities.isEmpty()) return false;
        return authorities.stream()
                .map(a -> a.getAuthority())
                .filter(a -> a != null)
                .allMatch(a -> LEARNER_ROLES.contains(a.toUpperCase(Locale.ROOT)));
    }

    /**
     * Every distinct value each UTM dimension holds for the institute — the
     * option lists behind the campaign filter dropdowns on the list pages.
     */
    @GetMapping("/filter-options")
    public ResponseEntity<UtmFilterOptionsResponse> filterOptions(
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestParam String instituteId) {
        requireStaffAccess(user, instituteId);
        return ResponseEntity.ok(dashboardService.filterOptions(instituteId));
    }

    /**
     * The campaign-attribution dashboard: people / enrolments per source,
     * medium, campaign, content, term and capture surface, a daily trend and
     * the full campaign matrix, over an inclusive date window in the
     * institute's timezone (defaults to the last 30 days).
     */
    @GetMapping("/dashboard")
    public ResponseEntity<UtmDashboardResponse> dashboard(
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestParam String instituteId,
            @RequestParam(required = false) String fromDate,
            @RequestParam(required = false) String toDate) {
        requireStaffAccess(user, instituteId);
        return ResponseEntity.ok(dashboardService.dashboard(instituteId, fromDate, toDate));
    }

    /** Campaign roll-up over the last {@code days} days. */
    @GetMapping("/summary")
    public ResponseEntity<List<UtmCampaignSummaryResponse>> summary(
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestParam String instituteId,
            @RequestParam(defaultValue = "30") int days) {
        requireStaffAccess(user, instituteId);
        int window = Math.max(1, Math.min(days, 365));
        Instant to = Instant.now();
        Instant from = to.minus(window, ChronoUnit.DAYS);
        return ResponseEntity.ok(
                service.summarise(instituteId, Timestamp.from(from), Timestamp.from(to)));
    }
}
