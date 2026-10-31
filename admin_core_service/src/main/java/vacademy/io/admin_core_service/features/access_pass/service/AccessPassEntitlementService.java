package vacademy.io.admin_core_service.features.access_pass.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.access_pass.entity.AccessPass;
import vacademy.io.admin_core_service.features.access_pass.entity.AccessPassGrant;
import vacademy.io.admin_core_service.features.access_pass.enums.AccessPassEnums.GrantStatus;
import vacademy.io.admin_core_service.features.access_pass.enums.AccessPassEnums.GrantType;
import vacademy.io.admin_core_service.features.access_pass.enums.AccessPassEnums.ItemRemovalPolicy;
import vacademy.io.admin_core_service.features.access_pass.repository.AccessPassGrantRepository;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.institute_learner.dto.InstituteStudentDetails;
import vacademy.io.admin_core_service.features.institute_learner.entity.Student;
import vacademy.io.admin_core_service.features.institute_learner.entity.StudentSessionInstituteGroupMapping;
import vacademy.io.admin_core_service.features.institute_learner.enums.LearnerSessionStatusEnum;
import vacademy.io.admin_core_service.features.institute_learner.enums.LearnerSessionTypeEnum;
import vacademy.io.admin_core_service.features.institute_learner.manager.LearnerTerminationWorkflowHelper;
import vacademy.io.admin_core_service.features.institute_learner.manager.StudentRegistrationManager;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import vacademy.io.admin_core_service.features.institute_learner.repository.InstituteStudentRepository;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionRepository;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.enums.UserPlanStatusEnum;
import vacademy.io.admin_core_service.features.user_subscription.repository.UserPlanRepository;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.exceptions.VacademyException;

import java.sql.Timestamp;
import java.util.*;

/**
 * Brings ONE holder plan in line with its pass: every included course is held (granted on
 * the holder's plan, or COVERED by a membership the learner already has), and under the
 * REVOKE policy a course the pass no longer includes is taken back — but only where the
 * pass granted it. Idempotent: running it on an up-to-date plan changes nothing.
 *
 * <p>Each plan runs in its own transaction (REQUIRES_NEW), so one learner's failure — a
 * re-enrollment policy that refuses, a missing student record — rolls back only that
 * learner and is retried on the next sync.
 */
@Slf4j
@Service
public class AccessPassEntitlementService {

    @Autowired
    private UserPlanRepository userPlanRepository;

    @Autowired
    private AccessPassGrantRepository grantRepository;

    @Autowired
    private StudentSessionInstituteGroupMappingRepository membershipRepository;

    @Autowired
    private StudentSessionRepository studentSessionRepository;

    @Autowired
    private InstituteStudentRepository instituteStudentRepository;

    @Autowired
    private StudentRegistrationManager studentRegistrationManager;

    @Autowired
    private AuthService authService;

    @Autowired
    private LearnerTerminationWorkflowHelper terminationWorkflowHelper;

    /** What one reconcile did, for the sync report. */
    public record PlanResult(int granted, int covered, int recorded, int revoked) {
        static final PlanResult NOTHING = new PlanResult(0, 0, 0, 0);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public PlanResult reconcilePlan(AccessPass pass, List<String> includedPackageSessionIds, String userPlanId) {
        UserPlan plan = userPlanRepository.findById(userPlanId).orElse(null);
        if (plan == null || !isCurrentHolder(plan, pass)) {
            return PlanResult.NOTHING;
        }
        String userId = plan.getUserId();

        Map<String, AccessPassGrant> grantsByCourse = new HashMap<>();
        for (AccessPassGrant g : grantRepository.findByUserPlanId(plan.getId())) {
            grantsByCourse.put(g.getPackageSessionId(), g);
        }

        Set<String> lookup = new HashSet<>(includedPackageSessionIds);
        lookup.addAll(grantsByCourse.keySet());
        Map<String, List<StudentSessionInstituteGroupMapping>> liveByCourse = new HashMap<>();
        if (!lookup.isEmpty()) {
            for (StudentSessionInstituteGroupMapping m : membershipRepository
                    .findActiveMembershipsForUserInPackageSessions(userId, new ArrayList<>(lookup))) {
                if (m.getPackageSession() != null) {
                    liveByCourse.computeIfAbsent(m.getPackageSession().getId(), k -> new ArrayList<>()).add(m);
                }
            }
        }

        int granted = 0;
        int covered = 0;
        int recorded = 0;
        int revoked = 0;

        for (String courseId : includedPackageSessionIds) {
            AccessPassGrant existing = grantsByCourse.get(courseId);
            List<StudentSessionInstituteGroupMapping> live = liveByCourse.getOrDefault(courseId, List.of());

            if (existing != null && GrantStatus.ACTIVE.name().equals(existing.getStatus())) {
                if (GrantType.GRANTED.name().equals(existing.getGrantType())) {
                    continue; // the pass's own access row: renewal / expiry keep it in step
                }
                boolean coverStillLive = live.stream().anyMatch(m -> m.getId().equals(existing.getSsigmId()));
                if (coverStillLive) {
                    continue;
                }
                // The membership that covered this course lapsed while the pass is still
                // current: fall through and let the pass grant it on its own plan.
            }

            Optional<StudentSessionInstituteGroupMapping> onThisPlan = live.stream()
                    .filter(m -> plan.getId().equals(m.getUserPlanId()))
                    .findFirst();
            if (onThisPlan.isPresent()) {
                // Checkout (or renewal) already gave this course on the holder's plan;
                // the ledger just catches up.
                upsertGrant(existing, pass, plan, courseId, onThisPlan.get().getId(), GrantType.GRANTED);
                recorded++;
                continue;
            }
            Optional<StudentSessionInstituteGroupMapping> elsewhere = live.stream()
                    .filter(m -> !plan.getId().equals(m.getUserPlanId()))
                    .findFirst();
            if (elsewhere.isPresent()) {
                // Held through a separate purchase: leave that row exactly as it is, so a
                // later pass cancel or course removal can never take it away.
                upsertGrant(existing, pass, plan, courseId, elsewhere.get().getId(), GrantType.COVERED);
                covered++;
                continue;
            }

            String ssigmId = grantCourse(pass, plan, courseId);
            upsertGrant(existing, pass, plan, courseId, ssigmId, GrantType.GRANTED);
            granted++;
        }

        if (ItemRemovalPolicy.REVOKE.name().equals(pass.getOnItemRemoved())) {
            Set<String> included = new HashSet<>(includedPackageSessionIds);
            for (AccessPassGrant g : grantsByCourse.values()) {
                if (included.contains(g.getPackageSessionId())
                        || !GrantStatus.ACTIVE.name().equals(g.getStatus())) {
                    continue;
                }
                if (GrantType.GRANTED.name().equals(g.getGrantType())) {
                    revokeCourse(pass, plan, g);
                    revoked++;
                } else {
                    // COVERED: the pass never owned that access. Close the ledger row only.
                    closeGrant(g, "Course removed from pass (covered elsewhere, not touched)");
                }
            }
        }

        if (granted + covered + recorded + revoked > 0) {
            log.info("[access-pass] pass={} plan={} user={}: granted={} covered={} recorded={} revoked={}",
                    pass.getId(), plan.getId(), userId, granted, covered, recorded, revoked);
        }
        return new PlanResult(granted, covered, recorded, revoked);
    }

    /** Same "current" rule as AccessPassRepository.findHolderPlanIdsNeedingSync. */
    private boolean isCurrentHolder(UserPlan plan, AccessPass pass) {
        if (pass.getEnrollInviteId() == null || !pass.getEnrollInviteId().equals(plan.getEnrollInviteId())) {
            return false;
        }
        boolean liveStatus = UserPlanStatusEnum.ACTIVE.name().equals(plan.getStatus())
                || UserPlanStatusEnum.CANCELED.name().equals(plan.getStatus());
        return liveStatus && (plan.getEndDate() == null || plan.getEndDate().after(new Date()));
    }

    /**
     * Gives the learner an ACTIVE membership in {@code courseId} on the holder's plan,
     * expiring with the plan. Goes through the normal linkStudentToInstitute path (so an
     * old row is revived rather than duplicated, and the access log records it), then pins
     * the plan id / status / expiry, because a revived row keeps whatever it had.
     */
    private String grantCourse(AccessPass pass, UserPlan plan, String courseId) {
        Student student = instituteStudentRepository.findTopByUserId(plan.getUserId())
                .orElseThrow(() -> new VacademyException("No student record for user " + plan.getUserId()));

        InstituteStudentDetails details = new InstituteStudentDetails();
        details.setInstituteId(pass.getInstituteId());
        details.setPackageSessionId(courseId);
        details.setEnrollmentStatus(LearnerSessionStatusEnum.ACTIVE.name());
        details.setEnrollmentDate(new Date());
        details.setUserPlanId(plan.getId());
        details.setType(LearnerSessionTypeEnum.PACKAGE_SESSION.name());
        Integer accessDays = daysUntil(plan.getEndDate());
        if (accessDays != null) {
            details.setAccessDays(String.valueOf(accessDays));
        }

        String ssigmId = studentRegistrationManager.linkStudentToInstitute(student, details);

        StudentSessionInstituteGroupMapping mapping = studentSessionRepository.findById(ssigmId)
                .orElseThrow(() -> new VacademyException("Access row " + ssigmId + " vanished after grant"));
        mapping.setStatus(LearnerSessionStatusEnum.ACTIVE.name());
        mapping.setUserPlanId(plan.getId());
        mapping.setType(LearnerSessionTypeEnum.PACKAGE_SESSION.name());
        mapping.setExpiryDate(plan.getEndDate());
        studentSessionRepository.save(mapping);

        // Same member experience as a checkout: welcome message, LMS provisioning, class
        // links. The workflow itself is deferred until this transaction commits.
        try {
            UserDTO user = authService.getUsersFromAuthServiceWithPasswordByUserId(plan.getUserId());
            studentRegistrationManager.triggerEnrollmentWorkflow(pass.getInstituteId(), user, courseId,
                    null, plan.getId());
        } catch (Exception e) {
            log.error("[access-pass] granted {} to user {} (plan {}) but the enrollment workflow failed: {}",
                    courseId, plan.getUserId(), plan.getId(), e.getMessage());
        }
        return ssigmId;
    }

    /** REVOKE policy: deactivate a course the pass granted, if that row is still the pass's. */
    private void revokeCourse(AccessPass pass, UserPlan plan, AccessPassGrant grant) {
        if (StringUtils.hasText(grant.getSsigmId())) {
            studentSessionRepository.findById(grant.getSsigmId()).ifPresent(m -> {
                // Only touch the row while it still hangs off this plan: if it was since
                // re-pointed (stacked renewal, separate purchase), it is no longer ours.
                if (plan.getId().equals(m.getUserPlanId())
                        && LearnerSessionStatusEnum.ACTIVE.name().equals(m.getStatus())) {
                    // INACTIVE is what the admin "make inactive" operation writes: the course
                    // leaves the learner's lists (and shows under Past), and it is the status
                    // the LEARNER_TERMINATION workflows below expect to find.
                    m.setStatus(LearnerSessionStatusEnum.INACTIVE.name());
                    m.setExpiryDate(new Date());
                    studentSessionRepository.save(m);
                    fireTerminationAfterCommit(plan.getUserId(), grant.getPackageSessionId(),
                            pass.getInstituteId());
                }
            });
        }
        closeGrant(grant, "Course removed from pass (REVOKE policy)");
    }

    /**
     * Same un-enroll signal as the admin MAKE_INACTIVE operation: LEARNER_TERMINATION
     * workflows (LMS de-provisioning, notices) for this course. Fired only once this
     * plan's transaction commits, so the workflow sees the INACTIVE row; the helper is
     * @Async and never throws.
     */
    private void fireTerminationAfterCommit(String userId, String packageSessionId, String instituteId) {
        Runnable fire = () -> terminationWorkflowHelper.fireTerminationWorkflows(
                userId, List.of(packageSessionId), instituteId, null);
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    fire.run();
                }
            });
        } else {
            fire.run();
        }
    }

    private void closeGrant(AccessPassGrant grant, String reason) {
        grant.setStatus(GrantStatus.REVOKED.name());
        grant.setRevokedAt(new Timestamp(System.currentTimeMillis()));
        grant.setRevokeReason(reason);
        grantRepository.save(grant);
    }

    private void upsertGrant(AccessPassGrant existing, AccessPass pass, UserPlan plan, String courseId,
                             String ssigmId, GrantType type) {
        upsertGrant(existing, pass, plan.getId(), plan.getUserId(), courseId, ssigmId, type);
    }

    private void upsertGrant(AccessPassGrant existing, AccessPass pass, String ledgerPlanId, String userId,
                             String courseId, String ssigmId, GrantType type) {
        AccessPassGrant g = existing != null ? existing : new AccessPassGrant();
        g.setAccessPassId(pass.getId());
        g.setUserPlanId(ledgerPlanId);
        g.setUserId(userId);
        g.setPackageSessionId(courseId);
        g.setSsigmId(ssigmId);
        g.setGrantType(type.name());
        g.setStatus(GrantStatus.ACTIVE.name());
        g.setGrantedAt(new Timestamp(System.currentTimeMillis()));
        g.setRevokedAt(null);
        g.setRevokeReason(null);
        grantRepository.save(g);
    }

    /**
     * B2B: bring ONE member of a sub-org holding the pass in line with the pass's courses.
     * The member's newest live row in the sub-org is the template: a newly added course
     * gets a row with the same plan, sub-org stamp, org roles and expiry, so it behaves
     * exactly like the courses the member already has there (seat counting, renewal and
     * the sub-org rosters all read those columns). Ledger rows are keyed on the template's
     * plan, or on "SUB_ORG:&lt;subOrgId&gt;:&lt;userId&gt;" for a row without one.
     * Never revokes: the sub-org model has no course removal.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public PlanResult reconcileSubOrgMember(AccessPass pass, String subOrgId, String templateRowId,
                                            List<String> includedPackageSessionIds) {
        StudentSessionInstituteGroupMapping template = studentSessionRepository.findById(templateRowId).orElse(null);
        if (template == null || !LearnerSessionStatusEnum.ACTIVE.name().equals(template.getStatus())) {
            return PlanResult.NOTHING;
        }
        String userId = template.getUserId();
        String ledgerPlanId = StringUtils.hasText(template.getUserPlanId())
                ? template.getUserPlanId()
                : "SUB_ORG:" + subOrgId + ":" + userId;

        Map<String, AccessPassGrant> grantsByCourse = new HashMap<>();
        for (AccessPassGrant g : grantRepository.findByUserPlanId(ledgerPlanId)) {
            grantsByCourse.put(g.getPackageSessionId(), g);
        }
        Map<String, List<StudentSessionInstituteGroupMapping>> liveByCourse = new HashMap<>();
        for (StudentSessionInstituteGroupMapping m : membershipRepository
                .findActiveMembershipsForUserInPackageSessions(userId, includedPackageSessionIds)) {
            if (m.getPackageSession() != null) {
                liveByCourse.computeIfAbsent(m.getPackageSession().getId(), k -> new ArrayList<>()).add(m);
            }
        }

        int granted = 0, covered = 0, recorded = 0;
        for (String courseId : includedPackageSessionIds) {
            AccessPassGrant existing = grantsByCourse.get(courseId);
            List<StudentSessionInstituteGroupMapping> live = liveByCourse.getOrDefault(courseId, List.of());
            if (existing != null && GrantStatus.ACTIVE.name().equals(existing.getStatus())) {
                if (GrantType.GRANTED.name().equals(existing.getGrantType())
                        || live.stream().anyMatch(m -> m.getId().equals(existing.getSsigmId()))) {
                    continue;
                }
            }
            Optional<StudentSessionInstituteGroupMapping> sameMembership = live.stream()
                    .filter(m -> sameSubOrgMembership(m, template, subOrgId))
                    .findFirst();
            if (sameMembership.isPresent()) {
                upsertGrant(existing, pass, ledgerPlanId, userId, courseId, sameMembership.get().getId(),
                        GrantType.GRANTED);
                recorded++;
                continue;
            }
            if (!live.isEmpty()) {
                upsertGrant(existing, pass, ledgerPlanId, userId, courseId, live.get(0).getId(), GrantType.COVERED);
                covered++;
                continue;
            }
            String ssigmId = grantSubOrgCourse(pass, template, subOrgId, courseId);
            upsertGrant(existing, pass, ledgerPlanId, userId, courseId, ssigmId, GrantType.GRANTED);
            granted++;
        }
        if (granted + covered + recorded > 0) {
            log.info("[access-pass] B2B pass={} sub-org={} user={}: granted={} covered={} recorded={}",
                    pass.getId(), subOrgId, userId, granted, covered, recorded);
        }
        return new PlanResult(granted, covered, recorded, 0);
    }

    /** A live row belongs to the same sub-org membership as the template. */
    private static boolean sameSubOrgMembership(StudentSessionInstituteGroupMapping m,
                                                StudentSessionInstituteGroupMapping template, String subOrgId) {
        if (StringUtils.hasText(template.getUserPlanId())) {
            return template.getUserPlanId().equals(m.getUserPlanId());
        }
        return m.getSubOrg() != null && subOrgId.equals(m.getSubOrg().getId());
    }

    private String grantSubOrgCourse(AccessPass pass, StudentSessionInstituteGroupMapping template, String subOrgId,
                                     String courseId) {
        Student student = instituteStudentRepository.findTopByUserId(template.getUserId())
                .orElseThrow(() -> new VacademyException("No student record for user " + template.getUserId()));
        boolean stamped = template.getSubOrg() != null;

        InstituteStudentDetails details = new InstituteStudentDetails();
        details.setInstituteId(pass.getInstituteId());
        details.setPackageSessionId(courseId);
        details.setEnrollmentStatus(LearnerSessionStatusEnum.ACTIVE.name());
        details.setEnrollmentDate(new Date());
        details.setUserPlanId(template.getUserPlanId());
        details.setType(LearnerSessionTypeEnum.PACKAGE_SESSION.name());
        if (stamped) {
            details.setSubOrgId(subOrgId);
            details.setCommaSeparatedOrgRoles(template.getCommaSeparatedOrgRoles());
        }
        Integer accessDays = daysUntil(template.getExpiryDate());
        if (accessDays != null) {
            details.setAccessDays(String.valueOf(accessDays));
        }
        String ssigmId = studentRegistrationManager.linkStudentToInstitute(student, details);

        StudentSessionInstituteGroupMapping mapping = studentSessionRepository.findById(ssigmId)
                .orElseThrow(() -> new VacademyException("Access row " + ssigmId + " vanished after grant"));
        mapping.setStatus(LearnerSessionStatusEnum.ACTIVE.name());
        mapping.setUserPlanId(template.getUserPlanId());
        mapping.setType(LearnerSessionTypeEnum.PACKAGE_SESSION.name());
        mapping.setExpiryDate(template.getExpiryDate());
        if (stamped) {
            mapping.setSubOrg(template.getSubOrg());
            mapping.setCommaSeparatedOrgRoles(template.getCommaSeparatedOrgRoles());
        }
        studentSessionRepository.save(mapping);

        try {
            UserDTO user = authService.getUsersFromAuthServiceWithPasswordByUserId(template.getUserId());
            studentRegistrationManager.triggerEnrollmentWorkflow(pass.getInstituteId(), user, courseId,
                    template.getSubOrg(), template.getUserPlanId());
        } catch (Exception e) {
            log.error("[access-pass] granted {} to sub-org member {} but the enrollment workflow failed: {}",
                    courseId, template.getUserId(), e.getMessage());
        }
        return ssigmId;
    }

    /** Whole days of access left on a plan (rounded up), or null for a plan with no end. */
    static Integer daysUntil(Date end) {
        if (end == null) {
            return null;
        }
        long ms = end.getTime() - System.currentTimeMillis();
        return (int) Math.max(1, (ms + 86_399_999L) / 86_400_000L);
    }
}
