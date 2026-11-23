package vacademy.io.admin_core_service.features.suborg.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.enroll_invite.enums.SubOrgRoles;
import vacademy.io.admin_core_service.features.enroll_invite.repository.EnrollInviteRepository;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute_learner.entity.Student;
import vacademy.io.admin_core_service.features.institute_learner.entity.StudentSessionInstituteGroupMapping;
import vacademy.io.admin_core_service.features.institute_learner.entity.StudentSubOrg;
import vacademy.io.admin_core_service.features.institute_learner.enums.LearnerSessionStatusEnum;
import vacademy.io.admin_core_service.features.institute_learner.enums.StudentSubOrgLinkType;
import vacademy.io.admin_core_service.features.institute_learner.repository.InstituteStudentRepository;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionRepository;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSubOrgRepository;
import vacademy.io.admin_core_service.features.suborg.dto.SeatUsageDTO;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.repository.UserPlanRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * Moves a learner's existing ACTIVE enrollment in one batch into a sub-organization.
 *
 * <p>Adding an already-enrolled learner through add-member creates a SECOND active
 * enrollment and a second user plan, because add-member only dedupes against the same
 * sub-org. Moving re-uses the enrollment the learner already has instead: the mapping is
 * stamped with the sub-org (as a LEARNER), the student_sub_org link that drives the learner
 * app's sub-org branding is created, and a link to a sub-org the learner no longer belongs to
 * is removed.
 *
 * <p>The learner's user plan is never touched: payments, renewals, expiry and access dates
 * keep running off it exactly as before. That is also why a learner whose plan belongs to
 * another sub-org (they joined through its link or its add-member) is refused: the seat
 * count and roster would keep counting them there too.
 *
 * <p>Sub-org admins are never moved: their enrollment carries their admin access.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class SubOrgMemberMoveService {

    public enum Outcome { MOVED, ALREADY_MEMBER }

    private static final String ACTIVE = LearnerSessionStatusEnum.ACTIVE.name();

    private final StudentSessionRepository studentSessionRepository;
    private final StudentSubOrgRepository studentSubOrgRepository;
    private final InstituteStudentRepository instituteStudentRepository;
    private final InstituteRepository instituteRepository;
    private final UserPlanRepository userPlanRepository;
    private final EnrollInviteRepository enrollInviteRepository;
    private final SubOrgSubscriptionService subOrgSubscriptionService;
    private final SubOrgAccessScopeService subOrgAccessScopeService;

    /** Whether the learner has an ACTIVE enrollment in this batch of this institute. */
    @Transactional(readOnly = true)
    public boolean hasActiveEnrollment(String userId, String packageSessionId, String instituteId) {
        return !activeRows(userId, packageSessionId, instituteId).isEmpty();
    }

    /**
     * Moves the learner's ACTIVE enrollment in {@code packageSessionId} into
     * {@code targetSubOrgId}. Throws a {@link VacademyException} with a message fit for the
     * admin when the learner cannot be moved (not enrolled, a sub-org admin, a plan that
     * belongs to another sub-org, no free seat, or a sub-org the caller may not manage).
     * A learner already in the sub-org is left exactly as they are.
     */
    @Transactional
    public Outcome moveActiveEnrollment(String userId, String packageSessionId, String instituteId,
                                        String targetSubOrgId, CustomUserDetails caller) {
        List<StudentSessionInstituteGroupMapping> active = activeRows(userId, packageSessionId, instituteId);
        if (active.isEmpty()) {
            throw new VacademyException("Not actively enrolled in this batch, so there is nothing to move");
        }
        for (StudentSessionInstituteGroupMapping row : active) {
            if (isAdminRole(row.getCommaSeparatedOrgRoles())) {
                throw new VacademyException("Is an admin of a sub-organization in this batch; admins cannot be moved");
            }
        }

        boolean alreadyCounted = false;
        List<RowToMove> toMove = new java.util.ArrayList<>();
        for (StudentSessionInstituteGroupMapping row : active) {
            String stamped = row.getSubOrg() != null ? row.getSubOrg().getId() : null;
            if (targetSubOrgId.equals(stamped)) {
                alreadyCounted = true;
                continue;
            }
            String planSubOrg = planSubOrgId(row);
            if (planSubOrg != null && !targetSubOrgId.equals(planSubOrg)) {
                String name = subOrgName(planSubOrg);
                throw new VacademyException("Joined through " + name + " and their plan belongs to it, so they "
                        + "cannot be moved. Remove them from " + name + " first, then add them here.");
            }
            if (stamped == null && targetSubOrgId.equals(planSubOrg)) {
                // Joined through this sub-org's own link: already a member, counted by its invite.
                alreadyCounted = true;
                continue;
            }
            toMove.add(new RowToMove(row, stamped));
        }

        if (toMove.isEmpty()) {
            return Outcome.ALREADY_MEMBER;
        }

        Institute target = instituteRepository.findById(targetSubOrgId)
                .orElseThrow(() -> new VacademyException("Sub-organization not found"));
        for (RowToMove move : toMove) {
            if (move.fromSubOrgId() != null) {
                // Taking a learner out of a sub-org is a change to that sub-org too.
                subOrgAccessScopeService.assertCanAccessSubOrg(caller, move.fromSubOrgId(), instituteId);
            }
        }
        if (!alreadyCounted) {
            assertSeatAvailable(targetSubOrgId, instituteId, packageSessionId);
        }

        Set<String> leftSubOrgIds = new LinkedHashSet<>();
        for (RowToMove move : toMove) {
            StudentSessionInstituteGroupMapping row = move.row();
            row.setSubOrg(target);
            row.setCommaSeparatedOrgRoles(SubOrgRoles.LEARNER.name());
            studentSessionRepository.save(row);
            if (move.fromSubOrgId() != null) {
                leftSubOrgIds.add(move.fromSubOrgId());
            }
        }
        ensureStudentSubOrg(userId, target);
        for (String left : leftSubOrgIds) {
            dropStudentSubOrgIfNoLongerMember(userId, left);
        }

        log.info("Moved learner={} batch={} into sub-org={} (from {})",
                userId, packageSessionId, targetSubOrgId, leftSubOrgIds.isEmpty() ? "no sub-org" : leftSubOrgIds);
        return Outcome.MOVED;
    }

    /** One enrollment to stamp, and the sub-org stamped on it before (null = none). */
    private record RowToMove(StudentSessionInstituteGroupMapping row, String fromSubOrgId) {
    }

    private List<StudentSessionInstituteGroupMapping> activeRows(String userId, String packageSessionId,
                                                                  String instituteId) {
        return studentSessionRepository.findByUserIdAndPackageSession_IdAndStatus(userId, packageSessionId, ACTIVE)
                .stream()
                .filter(row -> row.getInstitute() != null && instituteId.equals(row.getInstitute().getId()))
                .toList();
    }

    /**
     * The sub-org the enrollment's user plan belongs to, whoever owns the plan: its own
     * sub_org_id, else the sub-org of the invite it was bought through. The seat count and the
     * roster count a learner in that sub-org through it, even when the row is not stamped.
     */
    private String planSubOrgId(StudentSessionInstituteGroupMapping row) {
        if (!StringUtils.hasText(row.getUserPlanId())) {
            return null;
        }
        UserPlan plan = userPlanRepository.findById(row.getUserPlanId()).orElse(null);
        if (plan == null) {
            return null;
        }
        if (StringUtils.hasText(plan.getSubOrgId())) {
            return plan.getSubOrgId();
        }
        if (!StringUtils.hasText(plan.getEnrollInviteId())) {
            return null;
        }
        return enrollInviteRepository.findById(plan.getEnrollInviteId())
                .map(EnrollInvite::getSubOrgId)
                .filter(StringUtils::hasText)
                .orElse(null);
    }

    private String subOrgName(String subOrgId) {
        return instituteRepository.findById(subOrgId)
                .map(Institute::getInstituteName)
                .filter(StringUtils::hasText)
                .orElse("another sub-organization");
    }

    private void assertSeatAvailable(String subOrgId, String instituteId, String packageSessionId) {
        SeatUsageDTO usage = subOrgSubscriptionService.getSeatUsage(subOrgId, instituteId, packageSessionId);
        Integer limit = usage.getTotalSeats();
        if (limit != null && usage.getUsedSeats() >= limit) {
            throw new VacademyException(String.format(
                    "Seat limit reached: %d of %d seats are in use. Increase the seat limit (Edit Sub-Org), then try again.",
                    usage.getUsedSeats(), limit));
        }
    }

    /** The link the learner app reads for sub-org branding; created, or re-activated. */
    private void ensureStudentSubOrg(String userId, Institute subOrg) {
        Optional<StudentSubOrg> existing = studentSubOrgRepository.findByUserIdAndSubOrgId(userId, subOrg.getId());
        if (existing.isPresent()) {
            StudentSubOrg link = existing.get();
            if (!ACTIVE.equals(link.getStatus())) {
                link.setStatus(ACTIVE);
                studentSubOrgRepository.save(link);
            }
            return;
        }
        String studentId = instituteStudentRepository.findTopByUserIdOrderByCreatedAtDesc(userId)
                .map(Student::getId)
                .orElse(userId);
        studentSubOrgRepository.save(
                new StudentSubOrg(studentId, userId, subOrg, StudentSubOrgLinkType.DIRECT.name()));
    }

    /** Removes the old sub-org link once no ACTIVE enrollment of the learner is stamped with it. */
    private void dropStudentSubOrgIfNoLongerMember(String userId, String subOrgId) {
        long stillMember = studentSessionRepository.countByUserIdAndSubOrg_IdAndStatus(userId, subOrgId, ACTIVE);
        if (stillMember > 0) {
            return;
        }
        studentSubOrgRepository.findByUserIdAndSubOrgId(userId, subOrgId)
                .ifPresent(studentSubOrgRepository::delete);
    }

    private static boolean isAdminRole(String commaSeparatedOrgRoles) {
        if (!StringUtils.hasText(commaSeparatedOrgRoles)) {
            return false;
        }
        String upper = commaSeparatedOrgRoles.toUpperCase();
        return upper.contains(SubOrgRoles.ADMIN.name()) || upper.contains(SubOrgRoles.ROOT_ADMIN.name());
    }
}
