package vacademy.io.admin_core_service.features.learner_management.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.CollectionUtils;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;
import vacademy.io.admin_core_service.features.institute_learner.entity.StudentSessionInstituteGroupMapping;
import vacademy.io.admin_core_service.features.institute_learner.enums.LearnerSessionStatusEnum;
import vacademy.io.admin_core_service.features.institute_learner.manager.LearnerTerminationWorkflowHelper;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionRepository;
import vacademy.io.admin_core_service.features.learner_management.dto.*;
import vacademy.io.admin_core_service.features.packages.service.PackageSessionService;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentDeletionService;
import vacademy.io.admin_core_service.features.user_subscription.service.UserPlanService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.exceptions.VacademyException;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Orchestrates the bulk de-assignment of N users × M package sessions.
 * <p>
 * For each (user, packageSession) pair:
 * 1. Finds the active StudentSessionInstituteGroupMapping
 * 2. Determines the UserPlan
 * 3. Cancels the UserPlan (SOFT or HARD)
 * 4. Reports per-item results, including shared UserPlan warnings
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class BulkDeassignmentService {

    private final StudentSessionRepository studentSessionRepository;
    private final UserPlanService userPlanService;
    private final AuthService authService;
    private final PackageSessionService packageSessionService;
    private final LearnerTerminationWorkflowHelper learnerTerminationWorkflowHelper;
    private final InstituteSettingService instituteSettingService;
    private final PaymentDeletionService paymentDeletionService;
    private final CourseRemovalHistoryService courseRemovalHistoryService;

    private static final String MODE_SOFT = "SOFT";
    private static final String MODE_HARD = "HARD";

    /** Institute setting {@code {enabled, required}} for the HARD-terminate reason box. */
    private static final String TERMINATION_REASON_SETTING = "LEARNER_TERMINATION_REASON";
    private static final int MAX_REASON_LENGTH = 1000;

    /**
     * Main entry point for bulk de-assignment.
     */
    public BulkDeassignResponseDTO bulkDeassign(BulkDeassignRequestDTO request, String adminUserId) {
        validateRequest(request);

        DeassignOptionsDTO options = request.getOptions() != null
                ? request.getOptions()
                : DeassignOptionsDTO.builder().build();

        boolean dryRun = options.isDryRun();
        String mode = StringUtils.hasText(options.getMode())
                ? options.getMode()
                : MODE_SOFT;

        if (MODE_HARD.equals(mode)) {
            validateTerminationReason(request.getInstituteId(), options.getReason());
        }

        // HARD-only. Checked up front (dry run too) so a role without the permission is told
        // before anything is terminated.
        boolean deleteHistory = MODE_HARD.equals(mode) && options.isDeletePaymentHistory();
        if (deleteHistory && !paymentDeletionService.canDelete(adminUserId, request.getInstituteId())) {
            throw new VacademyException("Deleting payment history is turned off for your role. An admin can "
                    + "turn on payment deletion under Settings → Display Settings → Learner Management.");
        }

        // SOFT-only "last access date" override. HARD ignores it (access is revoked now).
        Date accessTillDate = MODE_HARD.equals(mode)
                ? null
                : parseAccessTillDate(options.getAccessTillDate());

        // 1. Resolve all user IDs
        Set<String> allUserIds = resolveUserIds(request);
        if (allUserIds.isEmpty()) {
            throw new VacademyException("No users to de-assign. Provide user_ids or user_filter.");
        }

        // 2. Fetch user details
        Map<String, UserDTO> userMap = fetchUserDetails(allUserIds);

        // 3. Process each (user × packageSession) pair
        List<BulkDeassignResponseDTO.DeassignResultItemDTO> results = new ArrayList<>();

        // Track real (non-dry-run) successful de-assignments so we can fire the
        // LEARNER_TERMINATION workflow once the writes are durable. Grouped by user
        // so the helper resolves each user from auth-service only once.
        //
        // Only HARD terminations are collected here: SOFT is a cancel (access
        // continues to expiry), so it must NOT fire the access-revoked
        // LEARNER_TERMINATION workflow. The soft-cancel's own SUBSCRIPTION_CANCELLED
        // workflow is fired inside UserPlanService.cancelUserPlan.
        Map<String, List<String>> terminatedPackageSessionsByUser = new LinkedHashMap<>();

        // Deleting payment history removes all of a learner's selected courses together, so their
        // enrolments are looked up before any of them is touched.
        Map<String, LearnerHistory> historyByUser = new HashMap<>();
        if (deleteHistory) {
            for (String userId : allUserIds) {
                historyByUser.put(userId, resolveSelection(userId, request.getPackageSessionIds(),
                        request.getInstituteId()));
            }
        }

        for (String packageSessionId : request.getPackageSessionIds()) {
            for (String userId : allUserIds) {
                BulkDeassignResponseDTO.DeassignResultItemDTO result = processDeassignment(userId, userMap,
                        packageSessionId,
                        request.getInstituteId(), mode, accessTillDate, dryRun, historyByUser.get(userId),
                        adminUserId);
                results.add(result);

                if (!dryRun && MODE_HARD.equals(mode) && "SUCCESS".equals(result.getStatus())) {
                    terminatedPackageSessionsByUser
                            .computeIfAbsent(userId, k -> new ArrayList<>())
                            .add(packageSessionId);
                }
            }
        }

        // 4. Fire LEARNER_TERMINATION workflows for the real HARD de-assignments,
        //    scoped by eventId=packageSessionId + instituteId.
        fireTerminationWorkflows(terminatedPackageSessionsByUser, request.getInstituteId(), adminUserId);

        // 5. Build response
        return buildResponse(dryRun, results);
    }

    /**
     * Fire the LEARNER_TERMINATION workflow for each user that was actually
     * de-assigned — one trigger per package session (eventId = packageSessionId),
     * scoped to the institute.
     *
     * <p>Delegates to the {@code @Async} helper bean so firing runs off the request
     * thread (a separate bean is required for Spring's async proxy to apply). Skipped
     * for dry runs (no rows are collected). Best-effort: the de-assignment writes have
     * already committed, so a workflow failure must never affect the API response —
     * the helper swallows per-trigger errors internally.
     */
    private void fireTerminationWorkflows(Map<String, List<String>> terminatedPackageSessionsByUser,
                                          String instituteId, String adminUserId) {
        terminatedPackageSessionsByUser.forEach((userId, packageSessionIds) ->
                learnerTerminationWorkflowHelper.fireTerminationWorkflows(
                        userId, packageSessionIds, instituteId, adminUserId));
    }

    // ========================= PRIVATE METHODS =========================

    /**
     * One learner's courses picked for "delete payment history". Courses tied together (an
     * admission package, a shared receipt — {@link PaymentDeletionService#linkedPlans}) are removed
     * together, in one transaction: the first of them processed deletes the group and the rest
     * report its outcome. Every other course is removed on its own, as before.
     */
    private static final class LearnerHistory {
        final Map<String, StudentSessionInstituteGroupMapping> mappingBySession = new HashMap<>();
        /** plan → the selected plans removed with it (it included) */
        Map<String, List<String>> groups;
        Map<String, PaymentDeletionService.PlanHistory> previews;
        final Map<String, Map<String, Object>> deleted = new HashMap<>();
        final Map<String, String> errors = new HashMap<>();
        final Set<String> reportedPlans = new HashSet<>();
        /** Sessions already processed: a repeated one finds no active enrolment, as a fresh lookup would. */
        final Set<String> usedSessions = new HashSet<>();

        List<String> planIds() {
            return mappingBySession.values().stream().map(StudentSessionInstituteGroupMapping::getUserPlanId)
                    .filter(StringUtils::hasText).distinct().toList();
        }
    }

    private List<String> groupOf(LearnerHistory history, String userPlanId) {
        if (history.groups == null) {
            // Built in full before it is kept, so a failed lookup is retried rather than left half done.
            Map<String, List<String>> groups = new HashMap<>();
            Set<String> selected = new LinkedHashSet<>(history.planIds());
            for (String planId : selected) {
                if (groups.containsKey(planId)) continue;
                List<String> group = new ArrayList<>();
                Deque<String> todo = new ArrayDeque<>(List.of(planId));
                while (!todo.isEmpty()) {
                    String next = todo.pop();
                    if (group.contains(next)) continue;
                    group.add(next);
                    for (String linked : paymentDeletionService.linkedPlans(next)) {
                        // A linked course that is not selected stays out: the preview refuses the group.
                        if (selected.contains(linked) && !group.contains(linked)) todo.push(linked);
                    }
                }
                group.forEach(member -> groups.put(member, group));
            }
            history.groups = groups;
        }
        return history.groups.get(userPlanId);
    }

    private LearnerHistory resolveSelection(String userId, List<String> packageSessionIds, String instituteId) {
        LearnerHistory history = new LearnerHistory();
        for (String packageSessionId : packageSessionIds) {
            studentSessionRepository.findTopByPackageSessionIdAndUserIdAndStatusIn(packageSessionId, instituteId,
                            userId, List.of(LearnerSessionStatusEnum.ACTIVE.name()))
                    .ifPresent(mapping -> history.mappingBySession.put(packageSessionId, mapping));
        }
        return history;
    }

    /** Why this course's history cannot be deleted, or null. A refused course holds back its group. */
    private String historyBlocker(LearnerHistory history, String userPlanId, String instituteId) {
        if (history.previews == null) {
            Map<String, PaymentDeletionService.PlanHistory> previews = new HashMap<>();
            for (String planId : history.planIds()) {
                previews.put(planId,
                        paymentDeletionService.previewPlanHistory(planId, instituteId, groupOf(history, planId)));
            }
            history.previews = previews;
        }
        String own = history.previews.get(userPlanId).blocker();
        if (own != null) return own;
        boolean otherRefused = groupOf(history, userPlanId).stream()
                .anyMatch(planId -> history.previews.get(planId).blocker() != null);
        return otherRefused
                ? "Not removed: this course shares its package or receipts with another selected course whose "
                        + "payment history cannot be deleted (see its row), and they can only be removed together."
                : null;
    }

    /**
     * Parse the SOFT-mode "last access date" the frontend sends. Accepts either a
     * bare {@code yyyy-MM-dd} (calendar day → end-of-day access) or a full ISO-8601
     * instant. Returns null on blank/unparseable input so callers fall back to the
     * plan's own expiry (a bad date must never silently revoke access).
     */
    private Date parseAccessTillDate(String raw) {
        if (!StringUtils.hasText(raw)) {
            return null;
        }
        String value = raw.trim();
        try {
            // Bare calendar date → keep access through the end of that day.
            if (value.length() == 10 && value.charAt(4) == '-') {
                LocalDate day = LocalDate.parse(value);
                return Date.from(day.atTime(LocalTime.MAX).atZone(ZoneOffset.UTC).toInstant());
            }
            // Full ISO-8601 instant (e.g. from Date.toISOString()).
            return Date.from(Instant.parse(value));
        } catch (DateTimeParseException e) {
            log.warn("Ignoring unparseable access_till_date '{}': {}", raw, e.getMessage());
            return null;
        }
    }

    /**
     * Back-dated soft cancel: when the admin sets the last access date to today or earlier,
     * the access window has already closed, so the mapping must not stay ACTIVE. Moving the
     * expiry alone is not enough — every learner/product list filters on
     * {@code ssigm.status}, with no expiry check, so an ACTIVE row with a past expiry keeps
     * rendering the product as live.
     *
     * <p>INACTIVE rather than TERMINATED on purpose. It is the established "access lapsed but
     * the learner stays on the roster" state (see {@code RenewalChargeService.deactivateMappings},
     * which {@code RenewalPaymentService} reverses back to ACTIVE when payment resumes), it is
     * denied by the ACTIVE-only content gates, and — unlike TERMINATED — it is present in the
     * institute's {@code studentStatuses} roster, so the learner remains visible and filterable
     * in Manage Students instead of vanishing from the list.
     *
     * <p>A future access date leaves the mapping ACTIVE: access genuinely continues until then,
     * and the expiry sweep retires it on the day.
     */
    private void deactivateIfAccessAlreadyEnded(StudentSessionInstituteGroupMapping mapping,
                                                Date accessTillDate) {
        if (mapping == null || accessTillDate == null) {
            return;
        }
        if (accessTillDate.toInstant().isAfter(Instant.now())) {
            return;
        }
        mapping.setStatus(LearnerSessionStatusEnum.INACTIVE.name());
        log.info("Soft-cancel with a past access date — marking mapping {} INACTIVE (accessTill={})",
                mapping.getId(), accessTillDate);
    }

    /**
     * Enforces the institute's LEARNER_TERMINATION_REASON setting server-side, so a
     * "required" reason cannot be skipped by calling the API directly. Checked on the
     * dry run too, so the preview step already fails instead of the final confirm.
     */
    private void validateTerminationReason(String instituteId, String reason) {
        if (StringUtils.hasText(reason) && reason.trim().length() > MAX_REASON_LENGTH) {
            throw new VacademyException("Reason cannot be longer than " + MAX_REASON_LENGTH + " characters");
        }
        if (!StringUtils.hasText(reason) && isTerminationReasonRequired(instituteId)) {
            throw new VacademyException("A reason is required to terminate a learner from a course");
        }
    }

    /** Required only when the setting is enabled and marked required; absent setting = optional. */
    private boolean isTerminationReasonRequired(String instituteId) {
        try {
            Object setting = instituteSettingService.getSettingByInstituteIdAndKey(
                    instituteId, TERMINATION_REASON_SETTING);
            if (setting instanceof Map<?, ?> map) {
                return !Boolean.FALSE.equals(map.get("enabled"))
                        && Boolean.TRUE.equals(map.get("required"));
            }
        } catch (Exception e) {
            log.warn("Could not read {} for institute {}: {}", TERMINATION_REASON_SETTING, instituteId,
                    e.getMessage());
        }
        return false;
    }

    private void validateRequest(BulkDeassignRequestDTO request) {
        if (!StringUtils.hasText(request.getInstituteId())) {
            throw new VacademyException("institute_id is required");
        }
        if (CollectionUtils.isEmpty(request.getPackageSessionIds())) {
            throw new VacademyException("package_session_ids cannot be empty");
        }
    }

    private Set<String> resolveUserIds(BulkDeassignRequestDTO request) {
        Set<String> userIds = new LinkedHashSet<>();

        if (!CollectionUtils.isEmpty(request.getUserIds())) {
            userIds.addAll(request.getUserIds());
        }

        UserFilterDTO filter = request.getUserFilter();
        if (filter != null && StringUtils.hasText(filter.getSourcePackageSessionId())) {
            List<String> statuses = CollectionUtils.isEmpty(filter.getStatuses())
                    ? List.of(LearnerSessionStatusEnum.ACTIVE.name())
                    : filter.getStatuses();

            List<String> filteredIds = studentSessionRepository
                    .findDistinctUserIdsByPackageSessionAndStatus(
                            filter.getSourcePackageSessionId(), statuses);
            userIds.addAll(filteredIds);
        }

        return userIds;
    }

    private Map<String, UserDTO> fetchUserDetails(Set<String> userIds) {
        try {
            List<UserDTO> users = authService.getUsersFromAuthServiceByUserIds(
                    new ArrayList<>(userIds));
            return users.stream()
                    .collect(Collectors.toMap(UserDTO::getId, u -> u, (a, b) -> a));
        } catch (Exception e) {
            log.warn("Failed to fetch user details: {}", e.getMessage());
            return Collections.emptyMap();
        }
    }

    /**
     * Process a single (user, packageSession) de-assignment.
     */
    private BulkDeassignResponseDTO.DeassignResultItemDTO processDeassignment(
            String userId,
            Map<String, UserDTO> userMap,
            String packageSessionId,
            String instituteId,
            String mode,
            Date accessTillDate,
            boolean dryRun,
            LearnerHistory history,
            String adminUserId) {

        String userEmail = userMap.containsKey(userId) ? userMap.get(userId).getEmail() : null;
        // Set only when the payment history is deleted too (HARD + permission checked up front).
        boolean deleteHistory = history != null;

        try {
            // Find active mapping for this user + packageSession. With delete-history it was looked
            // up before anything ran: an earlier course of this learner may have removed it already.
            Optional<StudentSessionInstituteGroupMapping> mappingOpt = deleteHistory
                    ? (history.usedSessions.add(packageSessionId)
                            ? Optional.ofNullable(history.mappingBySession.get(packageSessionId))
                            : Optional.empty())
                    : studentSessionRepository.findTopByPackageSessionIdAndUserIdAndStatusIn(
                            packageSessionId, instituteId, userId,
                            List.of(LearnerSessionStatusEnum.ACTIVE.name()));

            if (mappingOpt.isEmpty()) {
                return BulkDeassignResponseDTO.DeassignResultItemDTO.builder()
                        .userId(userId).userEmail(userEmail)
                        .packageSessionId(packageSessionId)
                        .status("SKIPPED").actionTaken("NONE")
                        .message("No active enrollment found")
                        .build();
            }

            StudentSessionInstituteGroupMapping mapping = mappingOpt.get();
            String userPlanId = mapping.getUserPlanId();
            String warning = null;

            // Check if UserPlan is shared across multiple package sessions
            if (StringUtils.hasText(userPlanId)) {
                List<StudentSessionInstituteGroupMapping> planMappings = studentSessionRepository
                        .findAllByUserPlanIdAndStatusIn(
                                userPlanId,
                                List.of(LearnerSessionStatusEnum.ACTIVE.name()));

                if (planMappings.size() > 1) {
                    long otherCount = planMappings.stream()
                            .filter(m -> !m.getPackageSession().getId().equals(packageSessionId))
                            .count();
                    if (otherCount > 0) {
                        warning = "UserPlan " + userPlanId + " is shared across "
                                + planMappings.size() + " package sessions. "
                                + "Canceling this plan will affect other enrollments.";
                    }
                }
            }

            if (dryRun) {
                String actionDesc = MODE_HARD.equals(mode)
                        ? "HARD_TERMINATED"
                        : "SOFT_CANCELED";
                String softMessage;
                if (accessTillDate == null) {
                    softMessage = "soft-cancel (access until plan expiry)";
                } else if (accessTillDate.toInstant().isAfter(Instant.now())) {
                    softMessage = "soft-cancel (access until " + accessTillDate + ")";
                } else {
                    // Back-dated: the access window has already closed, so this deactivates now.
                    softMessage = "soft-cancel (access already ended " + accessTillDate
                            + " — learner will be marked INACTIVE for this course)";
                }
                String message = "Would " + (MODE_HARD.equals(mode)
                        ? "terminate immediately"
                        : softMessage);
                if (deleteHistory && StringUtils.hasText(userPlanId)) {
                    String blocker = historyBlocker(history, userPlanId, instituteId);
                    if (blocker != null) {
                        return BulkDeassignResponseDTO.DeassignResultItemDTO.builder()
                                .userId(userId).userEmail(userEmail)
                                .packageSessionId(packageSessionId)
                                .status("FAILED").actionTaken("NONE")
                                .userPlanId(userPlanId)
                                .message(blocker)
                                .warning(warning)
                                .build();
                    }
                    PaymentDeletionService.PlanHistory preview = history.previews.get(userPlanId);
                    message += " and permanently delete its payment history: " + preview.payments()
                            + " payment(s) worth " + preview.paidAmount().stripTrailingZeros().toPlainString()
                            + ", " + preview.installments() + " installment(s), " + preview.invoices()
                            + " invoice(s)";
                }
                return BulkDeassignResponseDTO.DeassignResultItemDTO.builder()
                        .userId(userId).userEmail(userEmail)
                        .packageSessionId(packageSessionId)
                        .status("SUCCESS").actionTaken(actionDesc)
                        .userPlanId(userPlanId)
                        .message(message)
                        .warning(warning)
                        .build();
            }

            // Actually perform the cancellation
            boolean hard = MODE_HARD.equals(mode);
            boolean slotFreed = false;
            String historyMessage = null;
            if (StringUtils.hasText(userPlanId)) {
                if (hard && deleteHistory) {
                    // Another selected course on the same plan already removed it, and this enrolment
                    // with it — reported as before, when it was looked up afresh.
                    if (history.reportedPlans.contains(userPlanId)) {
                        return BulkDeassignResponseDTO.DeassignResultItemDTO.builder()
                                .userId(userId).userEmail(userEmail)
                                .packageSessionId(packageSessionId)
                                .status("SKIPPED").actionTaken("NONE")
                                .message("No active enrollment found")
                                .build();
                    }
                    // The first course of a group removes the whole group; the rest report the outcome.
                    if (!history.deleted.containsKey(userPlanId) && !history.errors.containsKey(userPlanId)) {
                        List<String> group = groupOf(history, userPlanId);
                        try {
                            history.deleted.putAll(courseRemovalHistoryService
                                    .terminateAndDeleteHistory(group, instituteId, adminUserId));
                        } catch (Exception e) {
                            String reason = e.getMessage() != null ? e.getMessage() : "Payment history could not be deleted";
                            // A group shares one outcome; say so, since the reason may be another course's.
                            String error = group.size() > 1
                                    ? "Not removed: this course shares its package or receipts with other selected "
                                            + "courses, which are removed together, and one of them was refused — " + reason
                                    : reason;
                            group.forEach(planId -> history.errors.put(planId, error));
                        }
                    }
                    if (history.errors.containsKey(userPlanId)) {
                        throw new VacademyException(history.errors.get(userPlanId));
                    }
                    history.reportedPlans.add(userPlanId);
                    Map<String, Object> deleted = history.deleted.get(userPlanId);
                    historyMessage = "Payment history deleted: " + deleted.get("payments_deleted")
                            + " payment(s), " + deleted.get("installments_deleted") + " installment(s)";
                } else {
                    userPlanService.cancelUserPlan(userPlanId, hard);
                }
                slotFreed = hard; // Only hard terminate actually frees the slot
                // SOFT keeps the ACTIVE mapping (cancelUserPlan leaves it untouched).
                // When the admin picked a "last access date", override the mapping's
                // expiry so access ends on that date instead of the plan's own expiry.
                if (!hard && accessTillDate != null) {
                    mapping.setExpiryDate(accessTillDate);
                    deactivateIfAccessAlreadyEnded(mapping, accessTillDate);
                    studentSessionRepository.save(mapping);
                }
                log.info("De-assigned: userId={}, packageSession={}, userPlan={}, mode={}, accessTill={}",
                        userId, packageSessionId, userPlanId, mode, accessTillDate);
            } else {
                // No UserPlan linked — update the mapping directly.
                if (hard) {
                    // HARD: revoke access now.
                    mapping.setStatus(LearnerSessionStatusEnum.TERMINATED.name());
                    slotFreed = true; // seat freed immediately
                } else {
                    // SOFT: keep the learner ACTIVE so access continues. Only the
                    // "last access date" (if given) moves the expiry forward/back;
                    // otherwise the existing expiry is preserved. The seat is NOT
                    // freed — the learner still occupies it until they actually expire.
                    if (accessTillDate != null) {
                        mapping.setExpiryDate(accessTillDate);
                        deactivateIfAccessAlreadyEnded(mapping, accessTillDate);
                    }
                }
                studentSessionRepository.save(mapping);
                log.info("De-assigned (no userPlan): userId={}, packageSession={}, mode={}, accessTill={}",
                        userId, packageSessionId, mode, accessTillDate);
            }

            // Only increment inventory when the slot is actually freed
            if (slotFreed) {
                packageSessionService.incrementAvailability(packageSessionId, 1);
            }

            String actionTaken = MODE_HARD.equals(mode)
                    ? "HARD_TERMINATED"
                    : "SOFT_CANCELED";

            return BulkDeassignResponseDTO.DeassignResultItemDTO.builder()
                    .userId(userId).userEmail(userEmail)
                    .packageSessionId(packageSessionId)
                    .status("SUCCESS").actionTaken(actionTaken)
                    .userPlanId(userPlanId)
                    .message(historyMessage)
                    .warning(warning)
                    .build();

        } catch (Exception e) {
            log.error("Error de-assigning userId={}, packageSession={}: {}",
                    userId, packageSessionId, e.getMessage(), e);
            return BulkDeassignResponseDTO.DeassignResultItemDTO.builder()
                    .userId(userId).userEmail(userEmail)
                    .packageSessionId(packageSessionId)
                    .status("FAILED").actionTaken("NONE")
                    .message(e.getMessage())
                    .build();
        }
    }

    private BulkDeassignResponseDTO buildResponse(
            boolean dryRun,
            List<BulkDeassignResponseDTO.DeassignResultItemDTO> results) {

        int successful = 0, failed = 0, skipped = 0;
        for (BulkDeassignResponseDTO.DeassignResultItemDTO r : results) {
            switch (r.getStatus()) {
                case "SUCCESS" -> successful++;
                case "FAILED" -> failed++;
                case "SKIPPED" -> skipped++;
            }
        }

        return BulkDeassignResponseDTO.builder()
                .dryRun(dryRun)
                .summary(BulkDeassignResponseDTO.SummaryDTO.builder()
                        .totalRequested(results.size())
                        .successful(successful)
                        .failed(failed)
                        .skipped(skipped)
                        .build())
                .results(results)
                .build();
    }
}
