package vacademy.io.admin_core_service.features.user_subscription.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.enroll_invite.repository.EnrollInviteRepository;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.admin_core_service.features.learner.service.LearnerCouponService;
import vacademy.io.admin_core_service.features.learner.service.LearnerInvitationLinkService;
import vacademy.io.admin_core_service.features.shortlink.service.ShortLinkIntegrationService;
import vacademy.io.admin_core_service.features.shortlink.service.ShortUrlManagementService;
import vacademy.io.admin_core_service.features.user_subscription.dto.MemberReferralDTO;
import vacademy.io.admin_core_service.features.user_subscription.entity.CouponCode;
import vacademy.io.admin_core_service.features.user_subscription.entity.ReferralMapping;
import vacademy.io.admin_core_service.features.user_subscription.entity.ReferralRewardCredit;
import vacademy.io.admin_core_service.features.user_subscription.enums.CouponSourceType;
import vacademy.io.admin_core_service.features.user_subscription.enums.ReferralBenefitLogsBeneficiary;
import vacademy.io.admin_core_service.features.user_subscription.enums.ReferralStatusEnum;
import vacademy.io.admin_core_service.features.user_subscription.repository.ReferralMappingRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.ReferralRewardCreditRepository;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.exceptions.VacademyException;

import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Members' personal referral links, for sending them out in bulk (an announcement over
 * WhatsApp, say). Every member gets a code when they enrol, but members who joined before
 * codes existed, or through a path that never generated one, have none: {@link #backfill}
 * fills those in, and {@link #linksFor} generates any still missing on the fly.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ReferralLinkService {

    /** Per call: each new code costs two short-link round trips. */
    public static final int MAX_BATCH = 500;

    private static final String SOURCE_USER = "USER";

    /**
     * Short-link source for the link shown on the admin student profile. Kept apart from
     * REFERRAL_LINK, which announcements create one row per send for: get-or-create matches
     * on (source, sourceId) and needs exactly one row to reuse.
     */
    private static final String SOURCE_PROFILE_LINK = "REFERRAL_PROFILE_LINK";

    private final StudentSessionInstituteGroupMappingRepository mappingRepository;
    private final LearnerCouponService learnerCouponService;
    private final CouponCodeService couponCodeService;
    private final LearnerInvitationLinkService learnerInvitationLinkService;
    private final ShortUrlManagementService shortUrlManagementService;
    private final EnrollInviteRepository enrollInviteRepository;
    private final ShortLinkIntegrationService shortLinkIntegrationService;
    private final ReferralMappingRepository referralMappingRepository;
    private final ReferralRewardCreditRepository creditRepository;
    private final AuthService authService;

    /**
     * Creates a referral code for up to {@code limit} ACTIVE members of the institute who
     * have none. The stored link opens {@code enrollInviteId} when given, else the invite the
     * member last enrolled through. A member with neither is skipped ({@code no_invite}): a
     * link with an empty invite code opens "Enroll Invite Not Found". Idempotent: call again
     * until {@code remaining} is 0.
     */
    public Map<String, Integer> backfill(String instituteId, String enrollInviteId, Integer limit) {
        int max = limit == null || limit <= 0 ? MAX_BATCH : Math.min(limit, MAX_BATCH);
        Optional<EnrollInvite> chosen = resolveInvite(enrollInviteId, instituteId);
        List<String> members = mappingRepository.findDistinctUserIdsByInstituteAndStatus(
                instituteId, List.of("ACTIVE"));
        int existing = 0;
        int created = 0;
        int remaining = 0;
        int noInvite = 0;
        for (String userId : members) {
            if (couponCodeService.hasExistingCouponCode(userId, CouponSourceType.USER)) {
                existing++;
            } else if (created < max) {
                Optional<EnrollInvite> invite = inviteFor(userId, instituteId, chosen);
                if (invite.isEmpty()) {
                    noInvite++;
                    continue;
                }
                learnerCouponService.generateCouponCodeForLearner(userId, instituteId, invite.get().getInviteCode());
                created++;
            } else {
                remaining++;
            }
        }
        log.info("Referral backfill for institute {}: {} created, {} already had a code, {} without an invite, "
                + "{} remaining", instituteId, created, existing, noInvite, remaining);
        Map<String, Integer> result = new LinkedHashMap<>();
        result.put("members", members.size());
        result.put("created", created);
        result.put("existing", existing);
        result.put("no_invite", noInvite);
        result.put("remaining", remaining);
        return result;
    }

    /**
     * {@code userId -> {referral_code, short_referral_link, referral_link}} for members of the
     * institute. With an enroll invite the link opens THAT invite (the trial a friend should
     * join); without one, the invite the member last enrolled through. The member's stored
     * short link is deliberately not used: older ones were built with an empty invite code and
     * open "Enroll Invite Not Found". Members with no usable invite or code are left out, so
     * the sender keeps the placeholder as before.
     */
    public Map<String, Map<String, String>> linksFor(String instituteId, Collection<String> userIds,
                                                     String enrollInviteId) {
        if (userIds == null || userIds.isEmpty()) {
            return Map.of();
        }
        if (userIds.size() > MAX_BATCH) {
            throw new VacademyException("At most " + MAX_BATCH + " users per request");
        }
        Optional<EnrollInvite> invite = resolveInvite(enrollInviteId, instituteId);
        // Only the institute's own members: never mint links for someone else's learners.
        List<String> members = mappingRepository.findUserIdsInInstitute(instituteId, userIds);
        Map<String, Map<String, String>> out = new LinkedHashMap<>();
        for (String userId : members) {
            try {
                Optional<EnrollInvite> memberInvite = inviteFor(userId, instituteId, invite);
                if (memberInvite.isEmpty()) {
                    continue;
                }
                Optional<CouponCode> coupon = codeFor(userId, instituteId, memberInvite.get());
                if (coupon.isEmpty()) {
                    continue;
                }
                String longLink = learnerInvitationLinkService.generateLearnerInvitationResponseLink(
                        instituteId, memberInvite.get(), userId);
                String code = shortUrlManagementService.createShortUrl(longLink, "REFERRAL_LINK",
                        userId + "_" + memberInvite.get().getId(), instituteId);
                String shortLink = code != null
                        ? shortUrlManagementService.getAbsoluteShortUrl(instituteId, code) : longLink;
                Map<String, String> link = new LinkedHashMap<>();
                link.put("referral_code", coupon.get().getCode());
                link.put("short_referral_link", shortLink);
                link.put("referral_link", longLink);
                out.put(userId, link);
            } catch (Exception e) {
                log.warn("Referral link for user {} at institute {} failed: {}", userId, instituteId, e.getMessage());
            }
        }
        return out;
    }

    /**
     * One member's referral details for the admin student profile, available only when a
     * course the member is actively enrolled in is sold through an invite with a referral
     * programme ({@code NO_REFERRAL_COURSE} otherwise, and no code is created). The link opens
     * {@code enrollInviteId} when it is one of those invites; otherwise the one the member
     * enrolled through when it is, else the newest. A member with no code gets one here, as
     * they would on the next announcement. Unlike {@link #linksFor}, the short link is reused
     * across views instead of minted per call.
     */
    public MemberReferralDTO memberReferral(String instituteId, String userId, String enrollInviteId) {
        MemberReferralDTO dto = new MemberReferralDTO();
        List<EnrollInvite> referralInvites =
                enrollInviteRepository.findReferralInvitesForLearnerCourses(instituteId, userId);
        if (referralInvites.isEmpty()) {
            dto.setUnavailableReason("NO_REFERRAL_COURSE");
            return dto;
        }
        referralInvites.forEach(i -> dto.getInvites().add(new MemberReferralDTO.InviteOption(i.getId(), i.getName())));

        Optional<EnrollInvite> requested = referralInvites.stream()
                .filter(i -> i.getId().equals(enrollInviteId)).findFirst();
        Optional<EnrollInvite> own = requested.isPresent() ? Optional.empty()
                : enrollInviteRepository.findLatestActiveInviteForLearner(userId, instituteId)
                        .filter(o -> referralInvites.stream().anyMatch(i -> i.getId().equals(o.getId())));
        EnrollInvite chosen = requested.or(() -> own).orElse(referralInvites.get(0));

        Optional<CouponCode> coupon = codeFor(userId, instituteId, chosen);
        if (coupon.isPresent()) {
            String longLink = learnerInvitationLinkService.generateLearnerInvitationResponseLink(
                    instituteId, chosen, userId);
            String shortLink = shortLinkIntegrationService.getOrCreateShortLink(
                    SOURCE_PROFILE_LINK, userId + "_" + chosen.getId(), longLink, instituteId);
            dto.setReferralCode(coupon.get().getCode());
            dto.setReferralLink(longLink);
            dto.setShortReferralLink(shortLink != null ? shortLink : longLink);
            dto.setInviteId(chosen.getId());
            dto.setInviteName(chosen.getName());
        }

        addReferrals(dto, userId, instituteId);
        addRewards(dto, userId, instituteId);
        return dto;
    }

    private void addReferrals(MemberReferralDTO dto, String userId, String instituteId) {
        List<ReferralMapping> mappings = referralMappingRepository.findReferralsMadeAtSource(userId, instituteId,
                List.of(ReferralStatusEnum.PENDING.name(), ReferralStatusEnum.ACTIVE.name()));
        if (mappings.isEmpty()) {
            return;
        }
        Map<String, UserDTO> friends = authService.getUsersFromAuthServiceByUserIds(
                        mappings.stream().map(ReferralMapping::getRefereeUserId).distinct().toList())
                .stream()
                .collect(Collectors.toMap(UserDTO::getId, Function.identity(), (a, b) -> a));
        for (ReferralMapping mapping : mappings) {
            MemberReferralDTO.ReferredFriend friend = new MemberReferralDTO.ReferredFriend();
            friend.setUserId(mapping.getRefereeUserId());
            UserDTO user = friends.get(mapping.getRefereeUserId());
            if (user != null) {
                friend.setFullName(user.getFullName());
                friend.setEmail(user.getEmail());
                friend.setMobileNumber(user.getMobileNumber());
            }
            friend.setStatus(mapping.getStatus());
            friend.setReferredAt(mapping.getCreatedAt());
            dto.getReferrals().add(friend);
        }
    }

    private void addRewards(MemberReferralDTO dto, String userId, String instituteId) {
        for (ReferralRewardCredit credit : creditRepository.findByUserIdAndInstituteIdOrderByCreatedAtDesc(userId, instituteId)) {
            if (credit.getStatus() == null
                    || !ReferralBenefitLogsBeneficiary.REFERRER.name().equals(credit.getBeneficiary())) {
                continue;
            }
            switch (credit.getStatus()) {
                case ReferralRewardCredit.STATUS_PENDING -> dto.setRewardsPending(dto.getRewardsPending() + 1);
                case ReferralRewardCredit.STATUS_AVAILABLE, ReferralRewardCredit.STATUS_RESERVED ->
                        dto.setRewardsReady(dto.getRewardsReady() + 1);
                case ReferralRewardCredit.STATUS_CONSUMED -> dto.setRewardsUsed(dto.getRewardsUsed() + 1);
                default -> { }
            }
        }
    }

    /** The member's referral code, creating it (with a link to {@code invite}) when they have none. */
    private Optional<CouponCode> codeFor(String userId, String instituteId, EnrollInvite invite) {
        Optional<CouponCode> coupon = couponCodeService.getCouponCodeBySource(userId, SOURCE_USER);
        if (coupon.isEmpty()) {
            learnerCouponService.generateCouponCodeForLearner(userId, instituteId, invite.getInviteCode());
            coupon = couponCodeService.getCouponCodeBySource(userId, SOURCE_USER);
        }
        return coupon;
    }

    /** The admin's chosen invite, else the one the member last enrolled through at the institute. */
    private Optional<EnrollInvite> inviteFor(String userId, String instituteId, Optional<EnrollInvite> chosen) {
        return chosen.isPresent() ? chosen : enrollInviteRepository.findLatestActiveInviteForLearner(userId, instituteId);
    }

    private Optional<EnrollInvite> resolveInvite(String enrollInviteId, String instituteId) {
        if (!StringUtils.hasText(enrollInviteId)) {
            return Optional.empty();
        }
        EnrollInvite invite = enrollInviteRepository.findById(enrollInviteId)
                .orElseThrow(() -> new VacademyException("Enroll invite not found: " + enrollInviteId));
        if (!instituteId.equals(invite.getInstituteId())) {
            throw new VacademyException("Enroll invite does not belong to this institute");
        }
        return Optional.of(invite);
    }
}
