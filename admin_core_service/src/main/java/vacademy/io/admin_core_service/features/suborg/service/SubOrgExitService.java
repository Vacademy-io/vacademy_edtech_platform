package vacademy.io.admin_core_service.features.suborg.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;
import vacademy.io.admin_core_service.features.institute_learner.manager.LearnerTerminationWorkflowHelper;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.admin_core_service.features.learner_management.dto.BulkDeassignResponseDTO;
import vacademy.io.admin_core_service.features.learner_management.service.BulkDeassignmentService;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.suborg.entity.SubOrgMemberCascade;
import vacademy.io.admin_core_service.features.suborg.repository.SubOrgMemberCascadeRepository;
import vacademy.io.admin_core_service.features.workflow.enums.WorkflowTriggerEvent;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.institute.entity.Institute;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * What happens when someone leaves a sub-org because a person ended their access: fires the event
 * that says who left and why, and, when the institute has {@value #CASCADE_SETTING_KEY} switched
 * on, queues the rest of the sub-org to leave with its admin.
 *
 * <p>Expiry and lapses never come through here. Its callers are the admin actions only, because
 * the mails these events drive say the membership was cancelled.
 *
 * <p>Membership has to be captured BEFORE the termination: a hard terminate on a plan deletes the
 * mapping and writes an INVITED row, so afterwards the sub-org and the admin role are gone.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class SubOrgExitService {

    /** Institute setting {@code {enabled}}. Absent = off. */
    public static final String CASCADE_SETTING_KEY = "SUB_ORG_ADMIN_EXIT_CASCADE";

    private static final int MAX_ATTEMPTS = 3;
    /** Slack when comparing the stored cut-off with the admin's current one. */
    private static final long REINSTATE_TOLERANCE_MS = 60_000L;

    private final StudentSessionInstituteGroupMappingRepository mappingRepository;
    private final SubOrgMemberCascadeRepository cascadeRepository;
    private final InstituteSettingService instituteSettingService;
    private final InstituteRepository instituteRepository;
    private final PackageSessionRepository packageSessionRepository;
    private final WorkflowTriggerService workflowTriggerService;
    private final LearnerTerminationWorkflowHelper learnerTerminationWorkflowHelper;
    private final AuthService authService;

    // Lazy: BulkDeassignmentService calls back into this service for admin-initiated removals.
    @Autowired
    @Lazy
    private BulkDeassignmentService bulkDeassignmentService;

    /** A person's place in a sub-org for one course, read before their access is ended. */
    public record Membership(String subOrgId, boolean admin, Date accessEnd) {
    }

    /** Empty when the person holds no active sub-org membership in this course. */
    public Optional<Membership> captureMembership(String userId, String packageSessionId, String instituteId) {
        return mappingRepository.findActiveSubOrgMembership(userId, packageSessionId, instituteId)
                .map(m -> new Membership(m.getSubOrgId(),
                        m.getOrgRoles() != null && m.getOrgRoles().contains("ADMIN"),
                        m.getAccessEnd()));
    }

    /** Access ended now. Call after the write has committed. Never throws to the caller. */
    @Async
    public void onHardExit(String userId, String packageSessionId, String instituteId, String actorUserId,
                           Membership membership) {
        try {
            if (!membership.admin()) {
                publish(WorkflowTriggerEvent.SUB_ORG_STAFF_REMOVED, fetchUsers(List.of(userId)), packageSessionId,
                        instituteId, membership.subOrgId(), actorUserId);
                return;
            }
            publish(WorkflowTriggerEvent.SUB_ORG_ADMIN_TERMINATED, fetchUsers(List.of(userId)), packageSessionId,
                    instituteId, membership.subOrgId(), actorUserId);
            cascadeRepository.supersedePending(membership.subOrgId(), packageSessionId, userId);
            if (isCascadeEnabled(instituteId)) {
                cascadeRepository.save(SubOrgMemberCascade.builder()
                        .instituteId(instituteId)
                        .subOrgId(membership.subOrgId())
                        .packageSessionId(packageSessionId)
                        .adminUserId(userId)
                        .actorUserId(actorUserId)
                        .effectiveAt(Timestamp.from(Instant.now()))
                        .terminateAdmin(false)
                        .adminNotified(true)
                        .build());
            }
        } catch (Exception e) {
            log.error("Sub-org hard exit handling failed for user={} packageSession={}: {}",
                    userId, packageSessionId, e.getMessage(), e);
        }
    }

    /**
     * Access ends on a later date. When the switch is on and an admin is leaving, the admin and their
     * staff stay until that date and the job ends both then. Nothing else happens today.
     *
     * <p>Async because callers run this after commit: a write on that thread would join the finished
     * transaction and never reach the database.
     */
    @Async
    public void onSoftCancel(String userId, String packageSessionId, String instituteId, String actorUserId,
                             Membership membership, Date accessTill) {
        try {
            if (!membership.admin() || !isCascadeEnabled(instituteId)) {
                return;
            }
            Date effective = accessTill != null ? accessTill : membership.accessEnd();
            if (effective == null) {
                log.warn("Soft cancel of sub-org admin {} on {} has no end date; staff not scheduled",
                        userId, packageSessionId);
                return;
            }
            cascadeRepository.supersedePending(membership.subOrgId(), packageSessionId, userId);
            cascadeRepository.save(SubOrgMemberCascade.builder()
                    .instituteId(instituteId)
                    .subOrgId(membership.subOrgId())
                    .packageSessionId(packageSessionId)
                    .adminUserId(userId)
                    .actorUserId(actorUserId)
                    .effectiveAt(new Timestamp(effective.getTime()))
                    .terminateAdmin(true)
                    .adminNotified(false)
                    .build());
        } catch (Exception e) {
            log.error("Could not schedule sub-org staff exit for admin={} packageSession={}: {}",
                    userId, packageSessionId, e.getMessage(), e);
        }
    }

    /** Works everything due. Called by SubOrgMemberCascadeJob. */
    public void processDue() {
        for (SubOrgMemberCascade row : cascadeRepository.findDue(Timestamp.from(Instant.now()))) {
            try {
                process(row);
            } catch (Exception e) {
                log.error("Sub-org staff cascade {} failed: {}", row.getId(), e.getMessage(), e);
                recordFailure(row, e.getMessage());
            }
        }
    }

    private void process(SubOrgMemberCascade row) {
        String subOrgId = row.getSubOrgId();
        String packageSessionId = row.getPackageSessionId();
        String instituteId = row.getInstituteId();

        if (row.isTerminateAdmin() && !finishAdminExit(row)) {
            return;
        }

        // Another admin still runs this sub-org, so a co-admin leaving does not close it.
        if (mappingRepository.countOtherActiveSubOrgAdmins(subOrgId, packageSessionId, row.getAdminUserId()) > 0) {
            close(row, SubOrgMemberCascade.STATUS_OTHER_ADMIN);
            return;
        }

        List<String> staff = mappingRepository.findActiveNonAdminUserIdsOfSubOrg(subOrgId, packageSessionId,
                instituteId);
        List<String> terminated = new ArrayList<>();
        int failed = 0;
        for (BulkDeassignResponseDTO.DeassignResultItemDTO result : bulkDeassignmentService
                .terminateForSubOrgExit(staff, packageSessionId, instituteId, row.getActorUserId())) {
            if ("SUCCESS".equals(result.getStatus())) {
                terminated.add(result.getUserId());
            } else if ("FAILED".equals(result.getStatus())) {
                failed++;
            }
        }
        if (!terminated.isEmpty()) {
            publish(WorkflowTriggerEvent.SUB_ORG_STAFF_CASCADE_TERMINATED, fetchUsers(terminated), packageSessionId,
                    instituteId, subOrgId, row.getActorUserId());
        }
        row.setTerminatedCount(row.getTerminatedCount() + terminated.size());
        log.info("Sub-org staff cascade {}: subOrg={} packageSession={} terminated={} failed={}",
                row.getId(), subOrgId, packageSessionId, terminated.size(), failed);

        if (failed > 0) {
            recordFailure(row, failed + " staff member(s) could not be terminated");
        } else {
            close(row, SubOrgMemberCascade.STATUS_DONE);
        }
    }

    /** The soft-cancel date arrived. Returns false when the row is closed and staff must stay. */
    private boolean finishAdminExit(SubOrgMemberCascade row) {
        String adminId = row.getAdminUserId();
        String packageSessionId = row.getPackageSessionId();
        String instituteId = row.getInstituteId();

        if (row.isAdminNotified()) {
            return true;
        }
        if (!isCascadeEnabled(instituteId)) {
            close(row, SubOrgMemberCascade.STATUS_SETTING_OFF);
            return false;
        }
        Optional<Membership> current = captureMembership(adminId, packageSessionId, instituteId);
        if (current.isPresent() && current.get().accessEnd() != null
                && current.get().accessEnd().getTime() > row.getEffectiveAt().getTime() + REINSTATE_TOLERANCE_MS) {
            close(row, SubOrgMemberCascade.STATUS_REINSTATED);
            return false;
        }
        if (current.isPresent()) {
            bulkDeassignmentService.terminateForSubOrgExit(List.of(adminId), packageSessionId, instituteId,
                    row.getActorUserId());
        } else {
            // A back-dated cancel already made the mapping INACTIVE without firing the LMS block.
            learnerTerminationWorkflowHelper.fireTerminationWorkflows(adminId, List.of(packageSessionId),
                    instituteId, row.getActorUserId());
        }
        publish(WorkflowTriggerEvent.SUB_ORG_ADMIN_TERMINATED, fetchUsers(List.of(adminId)), packageSessionId,
                instituteId, row.getSubOrgId(), row.getActorUserId());
        row.setAdminNotified(true);
        cascadeRepository.save(row);
        return true;
    }

    private void close(SubOrgMemberCascade row, String status) {
        row.setStatus(status);
        row.setErrorMessage(null);
        row.setProcessedAt(Timestamp.from(Instant.now()));
        cascadeRepository.save(row);
    }

    private void recordFailure(SubOrgMemberCascade row, String message) {
        row.setAttempts(row.getAttempts() + 1);
        row.setErrorMessage(message);
        if (row.getAttempts() >= MAX_ATTEMPTS) {
            row.setStatus(SubOrgMemberCascade.STATUS_FAILED);
            row.setProcessedAt(Timestamp.from(Instant.now()));
        }
        cascadeRepository.save(row);
    }

    private boolean isCascadeEnabled(String instituteId) {
        Object setting = instituteSettingService.getSettingByInstituteIdAndKey(instituteId, CASCADE_SETTING_KEY);
        return setting instanceof Map<?, ?> map && Boolean.TRUE.equals(map.get("enabled"));
    }

    private List<UserDTO> fetchUsers(List<String> userIds) {
        return authService.getUsersFromAuthServiceByUserIds(userIds);
    }

    /** One trigger per person, scoped to the course like the other termination events. */
    private void publish(WorkflowTriggerEvent event, List<UserDTO> users, String packageSessionId,
                         String instituteId, String subOrgId, String actorUserId) {
        String practiceName = instituteRepository.findById(subOrgId).map(Institute::getInstituteName).orElse("");
        String packageId = packageSessionRepository.findById(packageSessionId)
                .map(ps -> ps.getPackageEntity() != null ? ps.getPackageEntity().getId() : null)
                .orElse(null);
        UserDTO actor = null;
        if (StringUtils.hasText(actorUserId)) {
            List<UserDTO> actors = fetchUsers(List.of(actorUserId));
            actor = actors.isEmpty() ? null : actors.get(0);
        }
        for (UserDTO user : users) {
            try {
                Map<String, Object> context = new HashMap<>();
                context.put("member", user);
                context.put("user", user);
                context.put("admin", actor);
                context.put("packageSessionIds", packageSessionId);
                context.put("packageId", packageId);
                context.put("subOrgId", subOrgId);
                context.put("practice_name", practiceName);
                workflowTriggerService.handleTriggerEvents(event.name(), packageSessionId, instituteId, context);
            } catch (Exception e) {
                log.error("Failed to fire {} for user={} packageSession={}: {}",
                        event, user.getId(), packageSessionId, e.getMessage(), e);
            }
        }
    }
}
