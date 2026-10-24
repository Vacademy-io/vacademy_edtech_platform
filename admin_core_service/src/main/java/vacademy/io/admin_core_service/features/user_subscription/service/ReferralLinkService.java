package vacademy.io.admin_core_service.features.user_subscription.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.enroll_invite.repository.EnrollInviteRepository;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.admin_core_service.features.learner.service.LearnerCouponService;
import vacademy.io.admin_core_service.features.learner.service.LearnerInvitationLinkService;
import vacademy.io.admin_core_service.features.shortlink.service.ShortUrlManagementService;
import vacademy.io.admin_core_service.features.user_subscription.entity.CouponCode;
import vacademy.io.admin_core_service.features.user_subscription.enums.CouponSourceType;
import vacademy.io.common.exceptions.VacademyException;

import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

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

    private final StudentSessionInstituteGroupMappingRepository mappingRepository;
    private final LearnerCouponService learnerCouponService;
    private final CouponCodeService couponCodeService;
    private final LearnerInvitationLinkService learnerInvitationLinkService;
    private final ShortUrlManagementService shortUrlManagementService;
    private final EnrollInviteRepository enrollInviteRepository;

    /**
     * Creates a referral code for up to {@code limit} ACTIVE members of the institute who
     * have none. Idempotent: call again until {@code remaining} is 0.
     */
    public Map<String, Integer> backfill(String instituteId, String enrollInviteId, Integer limit) {
        int max = limit == null || limit <= 0 ? MAX_BATCH : Math.min(limit, MAX_BATCH);
        String inviteCode = resolveInvite(enrollInviteId, instituteId).map(EnrollInvite::getInviteCode).orElse(null);
        List<String> members = mappingRepository.findDistinctUserIdsByInstituteAndStatus(
                instituteId, List.of("ACTIVE"));
        int existing = 0;
        int created = 0;
        int remaining = 0;
        for (String userId : members) {
            if (couponCodeService.hasExistingCouponCode(userId, CouponSourceType.USER)) {
                existing++;
            } else if (created < max) {
                learnerCouponService.generateCouponCodeForLearner(userId, instituteId, inviteCode);
                created++;
            } else {
                remaining++;
            }
        }
        log.info("Referral backfill for institute {}: {} created, {} already had a code, {} remaining",
                instituteId, created, existing, remaining);
        Map<String, Integer> result = new LinkedHashMap<>();
        result.put("members", members.size());
        result.put("created", created);
        result.put("existing", existing);
        result.put("remaining", remaining);
        return result;
    }

    /**
     * {@code userId -> {referral_code, short_referral_link, referral_link}} for members of the
     * institute. With an enroll invite the link opens THAT invite (the trial a friend should
     * join); without one it is the member's stored link, which opens whichever invite they
     * enrolled through. Users with no code who cannot get one are left out.
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
                Optional<CouponCode> coupon = couponCodeService.getCouponCodeBySource(userId, SOURCE_USER);
                if (coupon.isEmpty()) {
                    learnerCouponService.generateCouponCodeForLearner(userId, instituteId,
                            invite.map(EnrollInvite::getInviteCode).orElse(null));
                    coupon = couponCodeService.getCouponCodeBySource(userId, SOURCE_USER);
                }
                if (coupon.isEmpty()) {
                    continue;
                }
                String longLink;
                String shortLink;
                if (invite.isPresent()) {
                    longLink = learnerInvitationLinkService.generateLearnerInvitationResponseLink(
                            instituteId, invite.get(), userId);
                    String code = shortUrlManagementService.createShortUrl(longLink, "REFERRAL_LINK",
                            userId + "_" + invite.get().getId(), instituteId);
                    shortLink = code != null ? shortUrlManagementService.getAbsoluteShortUrl(instituteId, code) : longLink;
                } else {
                    longLink = learnerInvitationLinkService.generateLearnerInvitationResponseLink(
                            instituteId, null, userId);
                    String code = couponCodeService.getOrGenerateShortUrl(coupon.get(), instituteId);
                    shortLink = code != null ? shortUrlManagementService.getAbsoluteShortUrl(instituteId, code) : longLink;
                }
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
