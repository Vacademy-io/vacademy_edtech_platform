package vacademy.io.admin_core_service.features.enroll_invite.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.enroll_invite.entity.PackageSessionLearnerInvitationToPaymentOption;
import vacademy.io.admin_core_service.features.enroll_invite.repository.PackageSessionLearnerInvitationToPaymentOptionRepository;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.common.exceptions.EnrollmentConflictException;

import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * Stops a phone-identified account that is ALREADY AN ENROLLED MEMBER of this course
 * from enrolling in it a second time.
 *
 * <p>Scope is the COURSE (the invite's package sessions), not the invite link: an
 * institute usually has several links into one batch -- monthly / quarterly / annual --
 * and a current member who filled a sibling link was handed a fresh free trial that
 * superseded their real, paid plan (twice in September 2026).
 *
 * <p>Membership means an ACTIVE mapping from a completed enrolment. These are
 * deliberately NOT blocked, because they are not members and must be able to try again:
 * <ul>
 *   <li>abandoned cart -- form filled, checkout never completed;</li>
 *   <li>payment failed -- the authorisation was refused;</li>
 *   <li>expired or cancelled -- access has already been withdrawn.</li>
 * </ul>
 *
 * <p>A member who is refused is told to sign in: their dashboard offers "Pay to
 * continue", which renews the plan they already hold. Independent of trial or payment
 * settings.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class PhoneIdentifierInviteSubmissionGuard {

    private static final String USER_IDENTIFIER_SETTING = "USER_IDENTIFIER";

    private final InstituteSettingService instituteSettingService;
    private final StudentSessionInstituteGroupMappingRepository mappingRepository;
    private final PackageSessionLearnerInvitationToPaymentOptionRepository inviteMappingRepository;

    private static final String ALREADY_ENROLLED_MESSAGE =
            "This mobile number is already registered for this course. Please sign in to continue — "
            + "you can renew or complete your payment from your dashboard.";

    public void validateNotAlreadySubmitted(EnrollInvite enrollInvite, String userId, String instituteId) {
        if (enrollInvite == null
                || !StringUtils.hasText(enrollInvite.getId())
                || !StringUtils.hasText(userId)
                || !StringUtils.hasText(instituteId)
                || !usesPhoneIdentifier(instituteId)) {
            return;
        }

        List<String> packageSessionIds = inviteMappingRepository
                .findByEnrollInviteIdAndStatusWithPackageSession(enrollInvite.getId(), List.of("ACTIVE"))
                .stream()
                .map(PackageSessionLearnerInvitationToPaymentOption::getPackageSession)
                .filter(Objects::nonNull)
                .map(ps -> ps.getId())
                .distinct()
                .toList();
        if (!packageSessionIds.isEmpty()
                && mappingRepository.existsActiveMembership(userId, packageSessionIds)) {
            log.info("Blocking enrolment: already an active member. userId={}, instituteId={}, inviteId={}, packageSessions={}",
                    userId, instituteId, enrollInvite.getId(), packageSessionIds);
            throw new EnrollmentConflictException(
                    EnrollmentConflictException.ConflictType.ALREADY_ENROLLED, ALREADY_ENROLLED_MESSAGE);
        }
    }

    /**
     * Whether the institute identifies learners by phone number
     * (USER_IDENTIFIER = PHONE). Public because the trial-reuse rule needs the same answer,
     * and two copies of "how do we identify a person here" is how they drift apart.
     */
    public boolean usesPhoneIdentifier(String instituteId) {
        Object setting = instituteSettingService.getSettingByInstituteIdAndKey(
                instituteId, USER_IDENTIFIER_SETTING);
        if (setting instanceof Map<?, ?> map) {
            Object value = map.containsKey("userIdentifier")
                    ? map.get("userIdentifier")
                    : map.containsKey("user_identifier")
                            ? map.get("user_identifier")
                            : map.get("value");
            return value != null && "PHONE".equalsIgnoreCase(value.toString());
        }
        return setting != null && "PHONE".equalsIgnoreCase(setting.toString());
    }
}
