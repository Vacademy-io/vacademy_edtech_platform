package vacademy.io.admin_core_service.features.institute_learner.manager;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import vacademy.io.admin_core_service.features.institute_learner.dto.StudentStatusUpdateRequest;
import vacademy.io.admin_core_service.features.learner_access.enums.LearnerAccessSourceEnum;
import vacademy.io.admin_core_service.features.learner_access.service.LearnerAccessService;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionRepository;
import vacademy.io.admin_core_service.features.suborg.service.SubOrgExitService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;

@Service
@Slf4j
public class StudentSessionManager {

    @Autowired
    private StudentSessionRepository studentSessionRepository;

    @Autowired
    private LearnerTerminationWorkflowHelper learnerTerminationWorkflowHelper;

    @Autowired
    private LearnerAccessService learnerAccessService;

    @Autowired
    private SubOrgExitService subOrgExitService;

    @Transactional
    public void updateStudentStatus(List<StudentStatusUpdateRequest> requests, String operation,
                                    CustomUserDetails adminDetails) {
        String adminUserId = adminDetails != null ? adminDetails.getUserId() : null;

        // MAKE_INACTIVE terminations to fire workflows for, collected during the
        // loop and fired only AFTER the transaction commits (see below).
        List<TerminationFiring> terminations = new ArrayList<>();
        // Sub-org memberships these operations are about to end, read before the UPDATE.
        List<SubOrgExit> subOrgExits = new ArrayList<>();
        List<String> failures = new ArrayList<>();

        for (StudentStatusUpdateRequest request : requests) {
            try {
                switch (operation) {
                    case "UPDATE_BATCH":
                        studentSessionRepository.updatePackageSessionId(request.getUserId(), request.getCurrentPackageSessionId(), request.getInstituteId(), request.getNewState());
                        break;
                    case "ADD_EXPIRY":
                        SimpleDateFormat dateFormat = new SimpleDateFormat("dd-MM-yyyy");
                        Date expiryDate = dateFormat.parse(request.getNewState());
                        // Snapshot before the native UPDATE: it bypasses the persistence
                        // context, so once it has run the previous window is gone and the
                        // change could not be logged truthfully. Without this the row-menu
                        // "Extend Session" would leave a hole in the learner's access
                        // history that the Manage Access dialog writes into.
                        List<StudentSessionRepository.AccessWindowSnapshot> beforeExpiryChange =
                                studentSessionRepository.findAccessWindowSnapshots(
                                        request.getUserId(), request.getCurrentPackageSessionId(),
                                        request.getInstituteId());
                        studentSessionRepository.updateExpiryDate(request.getUserId(), request.getCurrentPackageSessionId(), request.getInstituteId(), expiryDate);
                        recordExpiryChanges(beforeExpiryChange, expiryDate, request.getInstituteId(), adminDetails);
                        break;
                    case "MAKE_INACTIVE":
                        captureSubOrgExits(request, subOrgExits);
                        handleMakeInactive(request, terminations);
                        break;
                    case "MAKE_ACTIVE":
                        studentSessionRepository.updateStatus(request.getUserId(), request.getCurrentPackageSessionId(), request.getInstituteId(), "ACTIVE");
                        break;
                    case "UPDATE_STATUS":
                        studentSessionRepository.updateStatus(request.getUserId(), request.getCurrentPackageSessionId(), request.getInstituteId(), request.getNewState());
                        break;
                    case "TERMINATE":
                        captureSubOrgExits(request, subOrgExits);
                        studentSessionRepository.updateStatus(request.getUserId(), request.getCurrentPackageSessionId(), request.getInstituteId(), "TERMINATED");
                        break;
                    default:
                        throw new IllegalArgumentException("Invalid operation: " + operation);
                }
            } catch (Exception e) {
                // Do NOT swallow silently: record the failure so it surfaces to the
                // caller (and rolls back the transaction) instead of returning 200.
                log.error("Failed '{}' for userId={}, packageSessionId={}: {}",
                        operation, request.getUserId(), request.getCurrentPackageSessionId(), e.getMessage(), e);
                failures.add(request.getUserId() + ":" + e.getMessage());
            }
        }

        if (!failures.isEmpty()) {
            // Rolls back the whole transaction (and skips workflow firing below,
            // since the afterCommit callback was never registered).
            throw new VacademyException("Failed to update status for " + failures.size()
                    + " learner(s): " + String.join("; ", failures));
        }

        fireTerminationWorkflowsAfterCommit(terminations, subOrgExits, adminUserId);
    }

    /**
     * Logs an ADD_EXPIRY into the learner access history, one row per affected mapping,
     * so an extension made from the learner row menu appears in the same timeline as one
     * made from the Manage Access dialog.
     */
    private void recordExpiryChanges(List<StudentSessionRepository.AccessWindowSnapshot> affected,
                                     Date newExpiry,
                                     String instituteId,
                                     CustomUserDetails adminDetails) {
        if (affected == null || affected.isEmpty()) {
            return;
        }
        String actorId = adminDetails != null ? adminDetails.getUserId() : null;
        String actorName = adminDetails != null ? adminDetails.getFullName() : null;

        for (StudentSessionRepository.AccessWindowSnapshot snapshot : affected) {
            learnerAccessService.recordGrant(
                    LearnerAccessSourceEnum.ADMIN_EXTENSION,
                    instituteId,
                    snapshot.getUserId(),
                    snapshot.getPackageSessionId(),
                    snapshot.getId(),
                    snapshot.getExpiryDate(),
                    newExpiry,
                    null,
                    snapshot.getUserPlanId(),
                    null,
                    null,
                    "Expiry date set from learner list",
                    actorId,
                    actorName);
        }
    }

    private void handleMakeInactive(StudentStatusUpdateRequest request, List<TerminationFiring> terminations) {
        List<String> packageSessionIds = request.getPackageSessionIds();
        if (packageSessionIds != null && !packageSessionIds.isEmpty()) {
            // Approach B: one atomic UPDATE across every chosen package session.
            studentSessionRepository.updateStatusForPackageSessions(
                    request.getUserId(), packageSessionIds, request.getInstituteId(), request.getNewState());
            terminations.add(new TerminationFiring(request.getUserId(),
                    new ArrayList<>(packageSessionIds), request.getInstituteId()));
        } else {
            // Back-compat: callers that still send a single currentPackageSessionId.
            studentSessionRepository.updateStatus(
                    request.getUserId(), request.getCurrentPackageSessionId(), request.getInstituteId(), request.getNewState());
            if (request.getCurrentPackageSessionId() != null) {
                terminations.add(new TerminationFiring(request.getUserId(),
                        List.of(request.getCurrentPackageSessionId()), request.getInstituteId()));
            }
        }
    }

    /**
     * Fire LEARNER_TERMINATION workflows after the status UPDATE commits, so the
     * workflow's QUERY nodes see the now-INACTIVE rows. The helper method is
     * {@code @Async}, so firing also runs off the request thread. Falls back to a
     * direct (still async) call when there's no active transaction.
     */
    private void fireTerminationWorkflowsAfterCommit(List<TerminationFiring> terminations,
                                                     List<SubOrgExit> subOrgExits, String adminUserId) {
        if (terminations.isEmpty() && subOrgExits.isEmpty()) {
            return;
        }
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    for (TerminationFiring t : terminations) {
                        learnerTerminationWorkflowHelper.fireTerminationWorkflows(
                                t.userId(), t.packageSessionIds(), t.instituteId(), adminUserId);
                    }
                    fireSubOrgExits(subOrgExits, adminUserId);
                }
            });
        } else {
            for (TerminationFiring t : terminations) {
                learnerTerminationWorkflowHelper.fireTerminationWorkflows(
                        t.userId(), t.packageSessionIds(), t.instituteId(), adminUserId);
            }
            fireSubOrgExits(subOrgExits, adminUserId);
        }
    }

    private void captureSubOrgExits(StudentStatusUpdateRequest request, List<SubOrgExit> subOrgExits) {
        List<String> packageSessionIds = request.getPackageSessionIds() != null
                && !request.getPackageSessionIds().isEmpty()
                ? request.getPackageSessionIds()
                : request.getCurrentPackageSessionId() != null
                        ? List.of(request.getCurrentPackageSessionId())
                        : List.of();
        for (String packageSessionId : packageSessionIds) {
            subOrgExitService.captureMembership(request.getUserId(), packageSessionId, request.getInstituteId())
                    .ifPresent(membership -> subOrgExits.add(new SubOrgExit(request.getUserId(), packageSessionId,
                            request.getInstituteId(), membership)));
        }
    }

    private void fireSubOrgExits(List<SubOrgExit> subOrgExits, String adminUserId) {
        for (SubOrgExit exit : subOrgExits) {
            subOrgExitService.onHardExit(exit.userId(), exit.packageSessionId(), exit.instituteId(), adminUserId,
                    exit.membership());
        }
    }

    private record TerminationFiring(String userId, List<String> packageSessionIds, String instituteId) {
    }

    private record SubOrgExit(String userId, String packageSessionId, String instituteId,
                              SubOrgExitService.Membership membership) {
    }
}
