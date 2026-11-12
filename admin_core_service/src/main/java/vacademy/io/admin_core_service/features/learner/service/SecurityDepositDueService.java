package vacademy.io.admin_core_service.features.learner.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.course.enums.CourseTypeEnum;
import vacademy.io.admin_core_service.features.enroll_invite.service.PhoneIdentifierInviteSubmissionGuard;
import vacademy.io.admin_core_service.features.institute_learner.entity.Student;
import vacademy.io.admin_core_service.features.institute_learner.repository.InstituteStudentRepository;
import vacademy.io.admin_core_service.features.packages.enums.ChargePackageType;
import vacademy.io.admin_core_service.features.user_subscription.enums.UserPlanStatusEnum;
import vacademy.io.admin_core_service.features.user_subscription.repository.UserPlanRepository;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.payment.enums.PaymentStatusEnum;

import java.util.List;

/**
 * Is a once-per-user rent charge (ReadOnRent's refundable security deposit) due from a person?
 *
 * <p><b>Rule:</b> due unless the person ever held, at this institute, a successfully paid or
 * granted plan on a SECURITY_DEPOSIT package or on a MEMBERSHIP package (memberships sold before
 * the deposit became its own line had it built into their price, and every first membership
 * after launch comes with the deposit, so any membership covers both). A plan is on such a
 * package only when its invite links nothing else (for the plan's payment option): a plan on an
 * invite shared with a book could be the book, so it never waives the deposit
 * (UserPlanRepository.existsGrantedPlanOnPackageTypes).
 *
 * <p><b>Paid or granted</b> = the plan's status is ACTIVE (paid, free or admin-granted), PENDING
 * (paid or granted and queued behind another plan) or EXPIRED (it ran), or a PAID payment log is
 * recorded on it — which keeps a plan cancelled, terminated or refunded after payment counting,
 * so a refund never makes the deposit due again. PENDING_FOR_PAYMENT, PAYMENT_FAILED and a
 * CANCELED / TERMINATED plan nobody paid for (an abandoned checkout an admin cleaned up) do not
 * count.
 *
 * <p><b>The person</b> is resolved without creating anyone: a known user id, plus — at an
 * institute that identifies learners by phone (USER_IDENTIFIER = PHONE) — every account whose
 * student record carries the same last ten digits, since one number can front several accounts
 * and the enrolment may land on any of them. Elsewhere a guest is looked up by email, as the
 * enrolment does. Nobody found = due.
 *
 * <p>The checkout ({@link AdditionalChargeValidator}) and the learner status endpoint both end in
 * {@link #isDue(Person, String)}, so the cart and the server never disagree about the same person.
 */
@Slf4j
@Service
public class SecurityDepositDueService {

    static final List<String> DUE_RULE_PACKAGE_TYPES = List.of(
            ChargePackageType.SECURITY_DEPOSIT.name(), CourseTypeEnum.MEMBERSHIP.name());

    static final List<String> GRANTED_STATUSES = List.of(
            UserPlanStatusEnum.ACTIVE.name(),
            UserPlanStatusEnum.PENDING.name(),
            UserPlanStatusEnum.EXPIRED.name());

    static final List<String> PAID_STATUSES = List.of(PaymentStatusEnum.PAID.name());

    /** Who the due rule is asked about; blank fields are unknown. */
    public record Person(String userId, String phone10) {
        static final Person NOBODY = new Person("", "");

        boolean isUnknown() {
            return !StringUtils.hasText(userId) && !StringUtils.hasText(phone10);
        }
    }

    @Autowired
    private UserPlanRepository userPlanRepository;

    @Autowired
    private InstituteStudentRepository instituteStudentRepository;

    @Autowired
    private PhoneIdentifierInviteSubmissionGuard phoneIdentifierGuard;

    @Autowired
    private AuthService authService;

    /** THE due rule; every caller resolves a {@link Person} and asks this. */
    public boolean isDue(Person person, String instituteId) {
        if (person == null || person.isUnknown() || !StringUtils.hasText(instituteId)) {
            return true;
        }
        boolean hadOne = userPlanRepository.existsGrantedPlanOnPackageTypes(
                blankIfNull(person.userId()), blankIfNull(person.phone10()), instituteId,
                DUE_RULE_PACKAGE_TYPES, GRANTED_STATUSES, PAID_STATUSES);
        return !hadOne;
    }

    /**
     * The checkout's buyer, as the enrolment will resolve them: their id when the order carries
     * one; at a phone-identified institute, their phone number; otherwise (or with no phone) the
     * account with their email. Never creates a user.
     *
     * @throws vacademy.io.common.exceptions.VacademyException when auth_service cannot answer an
     *         email lookup ("could not ask" must not read as "nobody", which would charge again)
     */
    public Person buyer(UserDTO buyer, String instituteId) {
        if (buyer == null) {
            return Person.NOBODY;
        }
        String userId = blankIfNull(buyer.getId());
        boolean phoneIdentity = StringUtils.hasText(instituteId)
                && phoneIdentifierGuard.usesPhoneIdentifier(instituteId);
        if (phoneIdentity && StringUtils.hasText(buyer.getMobileNumber())) {
            // The enrolment resolves a phone-identified learner by phone alone (auth_service).
            return new Person(userId, lastTenDigits(buyer.getMobileNumber()));
        }
        if (!StringUtils.hasText(userId) && StringUtils.hasText(buyer.getEmail())) {
            userId = authService.findUserByEmailStrict(buyer.getEmail())
                    .map(UserDTO::getId)
                    .map(SecurityDepositDueService::blankIfNull)
                    .orElse("");
        }
        return new Person(userId, "");
    }

    /** A signed-in learner: their id, plus their own phone at a phone-identified institute. */
    public Person signedInUser(String userId, String instituteId) {
        if (!StringUtils.hasText(userId)) {
            return Person.NOBODY;
        }
        String phone10 = "";
        if (StringUtils.hasText(instituteId) && phoneIdentifierGuard.usesPhoneIdentifier(instituteId)) {
            phone10 = instituteStudentRepository.findTopByUserIdOrderByCreatedAtDesc(userId)
                    .map(Student::getMobileNumber)
                    .map(SecurityDepositDueService::lastTenDigits)
                    .orElse("");
        }
        return new Person(userId, phone10);
    }

    /** The last ten digits of a phone number, or "" when it has fewer (matches nothing). */
    static String lastTenDigits(String mobileNumber) {
        if (mobileNumber == null) {
            return "";
        }
        String digits = mobileNumber.replaceAll("[^0-9]", "");
        return digits.length() >= 10 ? digits.substring(digits.length() - 10) : "";
    }

    private static String blankIfNull(String value) {
        return value != null ? value.trim() : "";
    }
}
