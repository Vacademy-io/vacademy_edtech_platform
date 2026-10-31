package vacademy.io.admin_core_service.features.user_subscription.service.coupon;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.user_subscription.dto.coupon.AppliedDiscountInputDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.coupon.CouponCreateRequestDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.coupon.CouponDetailResponseDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.coupon.CouponSummaryDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.coupon.CouponUpdateRequestDTO;
import vacademy.io.admin_core_service.features.user_subscription.entity.AppliedCouponDiscount;
import vacademy.io.admin_core_service.features.user_subscription.entity.CouponCode;
import vacademy.io.admin_core_service.features.user_subscription.entity.CouponEnrollInvite;
import vacademy.io.admin_core_service.features.user_subscription.entity.CouponPackageSession;
import vacademy.io.admin_core_service.features.user_subscription.enums.CouponSourceType;
import vacademy.io.admin_core_service.features.user_subscription.repository.AppliedCouponDiscountRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.CouponCodeRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.CouponEnrollInviteRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.CouponPackageSessionRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Optional;

/**
 * Admin-side CRUD for institute-scoped coupons. Persists the paired
 * CouponCode + AppliedCouponDiscount row (mirroring ProductPageService's
 * pattern) plus optional scope bridge rows. Edit rules are enforced based
 * on whether the coupon has been redeemed: see {@link #applyUpdate}.
 *
 * The atomic decrement and the learner validate path live in
 * CouponRedemptionService and CouponValidationService respectively.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class CouponManagementService {

    private static final String STATUS_ACTIVE = "ACTIVE";
    private static final String STATUS_DELETED = "DELETED";
    private static final String DISCOUNT_SOURCE_COUPON_CODE = "COUPON_CODE";

    private final CouponCodeRepository couponCodeRepository;
    private final AppliedCouponDiscountRepository appliedCouponDiscountRepository;
    private final CouponPackageSessionRepository couponPackageSessionRepository;
    private final CouponEnrollInviteRepository couponEnrollInviteRepository;

    // ---------------------------------------------------------------------
    // Create
    // ---------------------------------------------------------------------

    @Transactional
    public CouponDetailResponseDTO create(String instituteId, CouponCreateRequestDTO request) {
        if (instituteId == null || instituteId.isBlank()) {
            throw new VacademyException("instituteId is required");
        }
        String code = request.getCode().trim().toUpperCase();
        // Status-aware existence check — mirrors the V318 partial unique index
        // (institute_id, code) WHERE status <> 'DELETED'. Without the status
        // filter a previously soft-deleted coupon with the same code blocked
        // re-creation and the admin got a misleading "already exists" error.
        if (couponCodeRepository
                .findByInstituteIdAndCodeAndStatusNot(instituteId, code, STATUS_DELETED)
                .isPresent()) {
            throw new VacademyException("A coupon with this code already exists in this institute");
        }
        validateDiscountInput(request.getAppliedDiscount());
        if (request.getRedeemStartDate() != null && request.getRedeemEndDate() != null
                && request.getRedeemEndDate().before(request.getRedeemStartDate())) {
            throw new VacademyException("redeemEndDate must be on or after redeemStartDate");
        }

        CouponCode coupon = new CouponCode();
        coupon.setCode(code);
        coupon.setStatus(request.getStatus() == null || request.getStatus().isBlank()
                ? STATUS_ACTIVE : request.getStatus().toUpperCase());
        coupon.setSourceType(CouponSourceType.INSTITUTE.getValue());
        coupon.setSourceId(instituteId);
        coupon.setInstituteId(instituteId);
        coupon.setRedeemStartDate(request.getRedeemStartDate());
        coupon.setRedeemEndDate(request.getRedeemEndDate());
        coupon.setUsageLimit(request.getUsageLimit());
        coupon.setEmailRestricted(request.isEmailRestricted());
        coupon.setAllowedEmailIds(request.getAllowedEmailIds());
        coupon.setGenerationDate(new Date());
        coupon.setCanBeAdded(true);
        // The check above is best-effort: under concurrent creates two callers
        // can both pass it. The composite (institute_id, code) unique
        // constraint catches the loser at flush time — rethrow as a clean
        // VacademyException so the controller returns a proper error, not 500.
        try {
            coupon = couponCodeRepository.saveAndFlush(coupon);
        } catch (DataIntegrityViolationException e) {
            throw new VacademyException("A coupon with this code already exists in this institute");
        }

        AppliedCouponDiscount discount = persistDiscount(coupon, request.getAppliedDiscount());

        replaceScope(coupon.getId(),
                request.getApplicablePackageSessionIds(),
                request.getApplicableEnrollInviteIds());

        log.info("Created coupon {} ({}) for institute {}", coupon.getCode(), coupon.getId(), instituteId);
        return toDetail(coupon, discount,
                request.getApplicablePackageSessionIds(),
                request.getApplicableEnrollInviteIds());
    }

    // ---------------------------------------------------------------------
    // Update
    // ---------------------------------------------------------------------

    @Transactional
    public CouponDetailResponseDTO update(String instituteId, String couponId, CouponUpdateRequestDTO request) {
        CouponCode coupon = loadOwned(instituteId, couponId);
        long redemptions = couponCodeRepository.countRedemptions(couponId);
        applyUpdate(coupon, request, redemptions);
        coupon = couponCodeRepository.save(coupon);

        AppliedCouponDiscount discount = appliedCouponDiscountRepository
                .findFirstByCouponCode_IdAndStatusOrderByCreatedAtDesc(couponId, STATUS_ACTIVE)
                .orElse(null);

        if (request.getAppliedDiscount() != null) {
            if (redemptions > 0) {
                throw new VacademyException(
                        "Discount fields are frozen after the first redemption");
            }
            validateDiscountInput(request.getAppliedDiscount());
            if (discount != null) {
                discount.setStatus(STATUS_DELETED);
                appliedCouponDiscountRepository.save(discount);
            }
            discount = persistDiscount(coupon, request.getAppliedDiscount());
        }

        boolean scopeBeingChanged = request.getApplicablePackageSessionIds() != null
                || request.getApplicableEnrollInviteIds() != null;
        if (scopeBeingChanged) {
            if (redemptions > 0) {
                throw new VacademyException("Scope is frozen after the first redemption");
            }
            replaceScope(couponId,
                    request.getApplicablePackageSessionIds(),
                    request.getApplicableEnrollInviteIds());
        }

        List<String> psIds = listPackageSessionScope(couponId);
        List<String> inviteIds = listEnrollInviteScope(couponId);
        return toDetail(coupon, discount, psIds, inviteIds);
    }

    // ---------------------------------------------------------------------
    // Read
    // ---------------------------------------------------------------------

    public CouponDetailResponseDTO get(String instituteId, String couponId) {
        CouponCode coupon = loadOwned(instituteId, couponId);
        AppliedCouponDiscount discount = appliedCouponDiscountRepository
                .findFirstByCouponCode_IdAndStatusOrderByCreatedAtDesc(couponId, STATUS_ACTIVE)
                .orElse(null);
        return toDetail(coupon, discount,
                listPackageSessionScope(couponId),
                listEnrollInviteScope(couponId));
    }

    public Page<CouponSummaryDTO> list(String instituteId, List<String> statuses, String search,
                                       int page, int size) {
        if (instituteId == null || instituteId.isBlank()) {
            throw new VacademyException("instituteId is required");
        }
        Pageable pageable = PageRequest.of(Math.max(0, page), Math.max(1, size),
                Sort.by(Sort.Direction.DESC, "createdAt"));
        List<String> statusFilter = (statuses == null || statuses.isEmpty()) ? null : statuses;
        // Always non-null so Hibernate binds it as a typed string parameter.
        // Postgres otherwise infers `bytea` for a null inside LOWER(CONCAT(...)).
        String normalizedSearch = (search == null || search.isBlank()) ? "" : search.trim();

        return couponCodeRepository.findForAdminList(instituteId, statusFilter, normalizedSearch, pageable)
                .map(this::toSummary);
    }

    // ---------------------------------------------------------------------
    // Soft delete
    // ---------------------------------------------------------------------

    @Transactional
    public void softDelete(String instituteId, String couponId) {
        CouponCode coupon = loadOwned(instituteId, couponId);
        coupon.setStatus(STATUS_DELETED);
        couponCodeRepository.save(coupon);
        log.info("Soft-deleted coupon {} ({}) for institute {}", coupon.getCode(), couponId, instituteId);
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    private CouponCode loadOwned(String instituteId, String couponId) {
        CouponCode coupon = couponCodeRepository.findById(couponId)
                .orElseThrow(() -> new VacademyException("Coupon not found: " + couponId));
        if (coupon.getInstituteId() == null || !coupon.getInstituteId().equals(instituteId)) {
            throw new VacademyException("Coupon does not belong to this institute");
        }
        return coupon;
    }

    private void applyUpdate(CouponCode coupon, CouponUpdateRequestDTO request, long redemptions) {
        if (request.getStatus() != null) {
            coupon.setStatus(request.getStatus().toUpperCase());
        }
        if (request.getRedeemStartDate() != null) {
            if (redemptions > 0) {
                throw new VacademyException("redeemStartDate is frozen after the first redemption");
            }
            coupon.setRedeemStartDate(request.getRedeemStartDate());
        }
        if (request.getRedeemEndDate() != null) {
            // End date may only be extended after the first redemption.
            if (redemptions > 0 && coupon.getRedeemEndDate() != null
                    && request.getRedeemEndDate().before(coupon.getRedeemEndDate())) {
                throw new VacademyException("redeemEndDate may only be extended after the first redemption");
            }
            coupon.setRedeemEndDate(request.getRedeemEndDate());
        } else if (Boolean.TRUE.equals(request.getClearRedeemEndDate())) {
            // Removing the end date only ever extends validity, so it is allowed after redemption too.
            coupon.setRedeemEndDate(null);
        }
        if (request.getUsageLimit() != null) {
            // Usage limit may only be increased after the first redemption.
            if (redemptions > 0 && coupon.getUsageLimit() != null
                    && request.getUsageLimit() < coupon.getUsageLimit()) {
                throw new VacademyException("usageLimit may only be increased after the first redemption");
            }
            coupon.setUsageLimit(request.getUsageLimit());
        }
        if (request.getIsEmailRestricted() != null) {
            coupon.setEmailRestricted(request.getIsEmailRestricted());
        }
        if (request.getAllowedEmailIds() != null) {
            coupon.setAllowedEmailIds(request.getAllowedEmailIds());
        }
    }

    private void validateDiscountInput(AppliedDiscountInputDTO d) {
        if (d == null) throw new VacademyException("appliedDiscount is required");
        String type = d.getDiscountType() == null ? "" : d.getDiscountType().toUpperCase();
        if (!CouponDiscountUtil.TYPE_PERCENTAGE.equals(type) && !CouponDiscountUtil.TYPE_FLAT.equals(type)) {
            throw new VacademyException("discountType must be PERCENTAGE or FLAT");
        }
        if (d.getDiscountPoint() == null || d.getDiscountPoint() <= 0) {
            throw new VacademyException("discountPoint must be > 0");
        }
        if (CouponDiscountUtil.TYPE_PERCENTAGE.equals(type)) {
            if (d.getDiscountPoint() > 100) {
                throw new VacademyException("percentage discountPoint must be <= 100");
            }
            // null = no cap; a value, when sent, must be a real cap.
            if (d.getMaxDiscountPoint() != null && d.getMaxDiscountPoint() <= 0) {
                throw new VacademyException("maxDiscountPoint must be > 0 when set");
            }
        }
    }

    private AppliedCouponDiscount persistDiscount(CouponCode coupon, AppliedDiscountInputDTO input) {
        AppliedCouponDiscount discount = new AppliedCouponDiscount();
        discount.setName(coupon.getCode());
        discount.setDiscountType(input.getDiscountType().toUpperCase());
        discount.setDiscountPoint(input.getDiscountPoint());
        discount.setMaxDiscountPoint(input.getMaxDiscountPoint());
        discount.setCurrency(input.getCurrency());
        discount.setDiscountSource(DISCOUNT_SOURCE_COUPON_CODE);
        discount.setStatus(STATUS_ACTIVE);
        discount.setCouponCode(coupon);
        discount.setRedeemStartDate(coupon.getRedeemStartDate());
        discount.setRedeemEndDate(coupon.getRedeemEndDate());
        return appliedCouponDiscountRepository.save(discount);
    }

    private void replaceScope(String couponId, List<String> packageSessionIds, List<String> enrollInviteIds) {
        if (packageSessionIds != null) {
            couponPackageSessionRepository.deleteByCouponCodeId(couponId);
            for (String psId : packageSessionIds) {
                if (psId == null || psId.isBlank()) continue;
                CouponPackageSession row = new CouponPackageSession();
                row.setCouponCodeId(couponId);
                row.setPackageSessionId(psId);
                couponPackageSessionRepository.save(row);
            }
        }
        if (enrollInviteIds != null) {
            couponEnrollInviteRepository.deleteByCouponCodeId(couponId);
            for (String inviteId : enrollInviteIds) {
                if (inviteId == null || inviteId.isBlank()) continue;
                CouponEnrollInvite row = new CouponEnrollInvite();
                row.setCouponCodeId(couponId);
                row.setEnrollInviteId(inviteId);
                couponEnrollInviteRepository.save(row);
            }
        }
    }

    private List<String> listPackageSessionScope(String couponId) {
        List<String> ids = new ArrayList<>();
        for (CouponPackageSession row : couponPackageSessionRepository.findByCouponCodeId(couponId)) {
            ids.add(row.getPackageSessionId());
        }
        return ids;
    }

    private List<String> listEnrollInviteScope(String couponId) {
        List<String> ids = new ArrayList<>();
        for (CouponEnrollInvite row : couponEnrollInviteRepository.findByCouponCodeId(couponId)) {
            ids.add(row.getEnrollInviteId());
        }
        return ids;
    }

    // ---------------------------------------------------------------------
    // Mapping
    // ---------------------------------------------------------------------

    private CouponSummaryDTO toSummary(CouponCode coupon) {
        Optional<AppliedCouponDiscount> discountOpt = appliedCouponDiscountRepository
                .findFirstByCouponCode_IdAndStatusOrderByCreatedAtDesc(coupon.getId(), STATUS_ACTIVE);
        long usage = couponCodeRepository.countRedemptions(coupon.getId());
        return CouponSummaryDTO.builder()
                .id(coupon.getId())
                .code(coupon.getCode())
                .status(coupon.getStatus())
                .sourceType(coupon.getSourceType())
                .redeemStartDate(coupon.getRedeemStartDate())
                .redeemEndDate(coupon.getRedeemEndDate())
                .usageLimit(coupon.getUsageLimit())
                .usageCount(usage)
                .discountType(discountOpt.map(AppliedCouponDiscount::getDiscountType).orElse(null))
                .discountPoint(discountOpt.map(AppliedCouponDiscount::getDiscountPoint).orElse(null))
                .maxDiscountPoint(discountOpt.map(AppliedCouponDiscount::getMaxDiscountPoint).orElse(null))
                .createdAt(coupon.getCreatedAt())
                .build();
    }

    private CouponDetailResponseDTO toDetail(CouponCode coupon,
                                             AppliedCouponDiscount discount,
                                             List<String> packageSessionIds,
                                             List<String> enrollInviteIds) {
        long usage = couponCodeRepository.countRedemptions(coupon.getId());
        AppliedDiscountInputDTO discountDto = discount == null ? null :
                AppliedDiscountInputDTO.builder()
                        .discountType(discount.getDiscountType())
                        .discountPoint(discount.getDiscountPoint())
                        .maxDiscountPoint(discount.getMaxDiscountPoint())
                        .currency(discount.getCurrency())
                        .build();
        return CouponDetailResponseDTO.builder()
                .id(coupon.getId())
                .code(coupon.getCode())
                .status(coupon.getStatus())
                .sourceType(coupon.getSourceType())
                .sourceId(coupon.getSourceId())
                .instituteId(coupon.getInstituteId())
                .redeemStartDate(coupon.getRedeemStartDate())
                .redeemEndDate(coupon.getRedeemEndDate())
                .usageLimit(coupon.getUsageLimit())
                .usageCount(usage)
                .emailRestricted(coupon.isEmailRestricted())
                .allowedEmailIds(coupon.getAllowedEmailIds())
                .applicablePackageSessionIds(packageSessionIds == null ? List.of() : packageSessionIds)
                .applicableEnrollInviteIds(enrollInviteIds == null ? List.of() : enrollInviteIds)
                .appliedDiscount(discountDto)
                .createdAt(coupon.getCreatedAt())
                .updatedAt(coupon.getUpdatedAt())
                .build();
    }
}
