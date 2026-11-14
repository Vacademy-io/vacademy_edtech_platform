package vacademy.io.admin_core_service.features.user_subscription.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import vacademy.io.admin_core_service.features.common.enums.StatusEnum;
import vacademy.io.admin_core_service.features.institute_learner.enums.LearnerStatusEnum;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.admin_core_service.features.user_subscription.dto.CouponVerificationRequestDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.CouponVerificationResponseDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.ReferralOptionDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.ReferralOptionSettingDTO;
import vacademy.io.admin_core_service.features.user_subscription.entity.CouponCode;
import vacademy.io.admin_core_service.features.user_subscription.entity.ReferralOption;
import vacademy.io.admin_core_service.features.user_subscription.enums.CouponCodeSource;
import vacademy.io.admin_core_service.features.user_subscription.enums.ReferralOptionSource;
import vacademy.io.admin_core_service.features.user_subscription.repository.CouponCodeRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.ReferralOptionRepository;

import java.util.List;
import java.util.Optional;

@Service
@RequiredArgsConstructor
public class ReferralOptionService {

    private final ReferralOptionRepository referralOptionRepository;
    private final CouponCodeRepository couponCodeRepository;
    private final StudentSessionInstituteGroupMappingRepository studentSessionMappingRepository;
    private final ObjectMapper objectMapper;

    public String addReferralOption(ReferralOptionDTO referralOptionDTO) {
        ReferralOption referralOption = new ReferralOption(referralOptionDTO);
        referralOptionRepository.save(referralOption);
        return "Referral option added successfully";
    }

    public String deleteReferralOptions(List<String> referralOptionIds) {
        List<ReferralOption> referralOptions = referralOptionRepository.findAllById(referralOptionIds);
        for (ReferralOption referralOption : referralOptions) {
            referralOption.setStatus(StatusEnum.DELETED.name());
        }
        referralOptionRepository.saveAll(referralOptions);
        return "Referral options deleted successfully";
    }

    public List<ReferralOptionDTO> getReferralOptions(String source, String sourceId) {
        List<ReferralOption> referralOptions = referralOptionRepository.findBySourceAndSourceIdAndStatusIn(source,
                sourceId, List.of(StatusEnum.ACTIVE.name()));
        return referralOptions.stream().map(ReferralOption::toReferralOptionDTO).toList();
    }

    public String updateReferralOption(String referralOptionId, ReferralOptionDTO referralOptionDTO) {
        ReferralOption referralOption = referralOptionRepository.findById(referralOptionId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Referral option not found"));

        if (referralOptionDTO.getName() != null) {
            referralOption.setName(referralOptionDTO.getName());
        }
        if (referralOptionDTO.getSource() != null) {
            referralOption.setSource(referralOptionDTO.getSource());
        }
        if (referralOptionDTO.getSourceId() != null) {
            referralOption.setSourceId(referralOptionDTO.getSourceId());
        }
        if (referralOptionDTO.getStatus() != null) {
            referralOption.setStatus(referralOptionDTO.getStatus());
        }
        if (referralOptionDTO.getAllowCombineOffers() != null) {
            referralOption.setAllowCombineOffers(referralOptionDTO.getAllowCombineOffers());
        }

        referralOption.setReferrerDiscountJson(referralOptionDTO.getReferrerDiscountJson());
        referralOption.setRefereeDiscountJson(referralOptionDTO.getRefereeDiscountJson());
        referralOption.setReferrerVestingDays(referralOptionDTO.getReferrerVestingDays());
        referralOption.setDescription(referralOptionDTO.getDescription());
        referralOption.setTag(referralOptionDTO.getTag());
        referralOption.setSettingJson(referralOptionDTO.getSettingJson());

        referralOptionRepository.save(referralOption);
        return "Referral option updated successfully";
    }

    public Optional<ReferralOption> getReferralOptionBySourceAndSourceIdAndTag(String source, String sourceId,
            String tag) {
        return referralOptionRepository.findFirstBySourceAndSourceIdAndTagAndStatusInOrderByCreatedAtDesc(source,
                sourceId, tag, List.of(StatusEnum.ACTIVE.name()));
    }

    public Optional<ReferralOption> findById(String id) {
        return referralOptionRepository.findById(id);
    }

    /**
     * The member's referral code, when it can be used with this referral option; empty
     * otherwise. The referrer is always the code's owner ({@code source_id}): nothing the
     * client sends decides who gets the referrer reward.
     *
     * <p>Deliberately NOT checked: {@code usage_limit} (set to 1 when the code is generated)
     * and the one-year {@code redeem_end_date}. A member shares one link with many friends
     * for as long as they are a member; enforcing either would kill the link after one use
     * or a year.
     */
    public Optional<CouponCode> findUsableReferralCode(String code, ReferralOption referralOption) {
        return Optional.ofNullable(validateCouponCode(code))
                .filter(coupon -> referralCodeProblem(coupon, referralOption) == null);
    }

    /** Why the code cannot be used with this option, or null when it can. */
    private String referralCodeProblem(CouponCode coupon, ReferralOption referralOption) {
        if (coupon.getStatus() != null && !StatusEnum.ACTIVE.name().equalsIgnoreCase(coupon.getStatus())) {
            return "This referral code is no longer active";
        }
        // The referrer must be a member of the institute running the programme.
        if (ReferralOptionSource.INSTITUTE.name().equalsIgnoreCase(referralOption.getSource())
                && referralOption.getSourceId() != null
                && !studentSessionMappingRepository.existsActiveLearnerInInstitute(
                        coupon.getSourceId(), referralOption.getSourceId())) {
            return "This referral code does not belong to a member of this institute";
        }
        return null;
    }

    public CouponVerificationResponseDTO verifyCouponCode(
            String couponCode,
            String referralOptionId,
            CouponVerificationRequestDTO request) {
        try {
            CouponCode coupon = validateCouponCode(couponCode);
            if (coupon == null) {
                return buildFailureResponse("Invalid coupon code or source type");
            }

            Optional<ReferralOption> referralOption = getReferralOption(referralOptionId);
            if (referralOption.isEmpty()) {
                return buildFailureResponse("Referral option not found");
            }

            String problem = referralCodeProblem(coupon, referralOption.get());
            if (problem != null) {
                return buildFailureResponse(problem);
            }

            ReferralOptionSettingDTO settingDTO = parseReferralOptionSettings(referralOption.get());
            if (settingDTO == null) {
                settingDTO = new ReferralOptionSettingDTO();
                settingDTO.setAllowAnyPackageSessionLearnerReferral(true);
            }

            if (settingDTO.isAllowAnyPackageSessionLearnerReferral()) {
                return buildSuccessResponse(coupon, "Coupon code verified successfully");
            }

            if (!hasValidPackageSessions(request)) {
                return buildFailureResponse("No package session IDs provided");
            }

            if (hasActiveSession(coupon.getSourceId(), request.getPackageSessionId())) {
                return buildSuccessResponse(coupon, "Coupon code verified successfully");
            }

            return buildFailureResponse("User does not have active status in any of the specified package sessions");

        } catch (Exception e) {
            return buildFailureResponse("Error verifying coupon code: " + e.getMessage());
        }
    }

    private CouponCode validateCouponCode(String couponCode) {
        Optional<CouponCode> couponCodeOpt = couponCodeRepository.findByCode(couponCode);
        if (couponCodeOpt.isEmpty())
            return null;

        CouponCode coupon = couponCodeOpt.get();
        if (!CouponCodeSource.USER.name().equals(coupon.getSourceType()))
            return null;

        return coupon;
    }

    public Optional<ReferralOption> getReferralOption(String referralOptionId) {
        return referralOptionRepository.findById(referralOptionId);
    }

    private ReferralOptionSettingDTO parseReferralOptionSettings(ReferralOption referralOption) {
        try {
            if (referralOption.getSettingJson() != null && !referralOption.getSettingJson().isEmpty()) {
                return objectMapper.readValue(referralOption.getSettingJson(), ReferralOptionSettingDTO.class);
            }
            return null;
        } catch (Exception e) {
            return null;
        }
    }

    private boolean hasValidPackageSessions(CouponVerificationRequestDTO request) {
        List<String> packageSessionIds = request.getPackageSessionId();
        return packageSessionIds != null && !packageSessionIds.isEmpty();
    }

    private boolean hasActiveSession(String learnerId, List<String> packageSessionIds) {
        return studentSessionMappingRepository
                .existsByUserIdAndStatusInAndPackageSessionIdIn(
                        learnerId,
                        List.of(LearnerStatusEnum.ACTIVE.name()),
                        packageSessionIds);
    }

    private CouponVerificationResponseDTO buildSuccessResponse(CouponCode coupon, String message) {
        return CouponVerificationResponseDTO.builder()
                .verified(true)
                .sourceType(coupon.getSourceType())
                .sourceId(coupon.getSourceId())
                .message(message)
                .build();
    }

    private CouponVerificationResponseDTO buildFailureResponse(String message) {
        return CouponVerificationResponseDTO.builder()
                .verified(false)
                .message(message)
                .build();
    }
}
