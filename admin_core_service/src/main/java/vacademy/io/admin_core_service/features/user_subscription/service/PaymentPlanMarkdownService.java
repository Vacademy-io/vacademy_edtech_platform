package vacademy.io.admin_core_service.features.user_subscription.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.common.enums.StatusEnum;
import vacademy.io.admin_core_service.features.enroll_invite.entity.PackageSessionLearnerInvitationToPaymentOption;
import vacademy.io.admin_core_service.features.enroll_invite.repository.PackageSessionLearnerInvitationToPaymentOptionRepository;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute.utils.InstituteSettingUtils;
import vacademy.io.admin_core_service.features.user_subscription.dto.markdown.ApplyMarkdownRequestDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.markdown.MarkdownErrorCode;
import vacademy.io.admin_core_service.features.user_subscription.dto.markdown.MarkdownLookupItemDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.markdown.MarkdownLookupRequestDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.markdown.MarkdownResponseDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.markdown.MarkdownResultDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.markdown.ResetMarkdownRequestDTO;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentOption;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.admin_core_service.features.user_subscription.enums.MarkdownMode;
import vacademy.io.admin_core_service.features.user_subscription.enums.PaymentOptionSource;
import vacademy.io.admin_core_service.features.user_subscription.enums.PaymentOptionType;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentPlanRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Apply or reset a markdown on a package session's payment plan.
 *
 * "Markdown" = setting payment_plan.actual_price below elevated_price. Elevated price
 * is the strike-through MRP and never moves. Coupons / applied_coupon_discount are a
 * separate feature ("discount") and are not touched here.
 *
 * Refusals (per-session, returned in results — request as a whole still 200):
 *  - package_session not found in this institute / no ACTIVE ps_link
 *  - payment_option is FREE or CPO (FREE has no price to lower; CPO is managed via fee-management)
 *  - payment_option is institute-default (shared catch-all)
 *  - payment_option has 0 or >1 active plans (ambiguous which to mutate)
 *  - payment_option is shared with another package_session outside the request
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class PaymentPlanMarkdownService {

    private final PackageSessionLearnerInvitationToPaymentOptionRepository psLinkRepository;
    private final PaymentPlanRepository paymentPlanRepository;
    private final InstituteRepository instituteRepository;
    private final vacademy.io.admin_core_service.features.commerce.common.CommerceLegacyGuard commerceLegacyGuard;

    @Transactional
    public MarkdownResponseDTO applyMarkdown(ApplyMarkdownRequestDTO request, CustomUserDetails user) {
        validateApplyRequest(request);
        MarkdownMode mode = MarkdownMode.fromString(request.getMode());
        double value = request.getValue();
        String roundingMode = resolveRoundingMode(request.getInstituteId());
        return process(
                request.getInstituteId(),
                request.getPackageSessionIds(),
                plan -> computeMarkdownPrice(plan, mode, value, roundingMode));
    }

    @Transactional
    public MarkdownResponseDTO resetMarkdown(ResetMarkdownRequestDTO request, CustomUserDetails user) {
        validateResetRequest(request);
        return process(
                request.getInstituteId(),
                request.getPackageSessionIds(),
                PaymentPlan::getElevatedPrice);
    }

    public List<MarkdownLookupItemDTO> lookup(MarkdownLookupRequestDTO request, CustomUserDetails user) {
        validateLookupRequest(request);

        Set<String> uniqueIds = new LinkedHashSet<>(request.getPackageSessionIds());
        String instituteId = request.getInstituteId();

        List<PackageSessionLearnerInvitationToPaymentOption> psLinks =
                psLinkRepository.findActiveByPackageSessionIdsAndInstituteId(
                        new ArrayList<>(uniqueIds), instituteId);

        Map<String, PackageSessionLearnerInvitationToPaymentOption> psLinkBySessionId = new HashMap<>();
        for (PackageSessionLearnerInvitationToPaymentOption psl : psLinks) {
            if (psl.getPackageSession() == null) continue;
            psLinkBySessionId.putIfAbsent(psl.getPackageSession().getId(), psl);
        }

        Set<String> resolvedPaymentOptionIds = psLinkBySessionId.values().stream()
                .map(PackageSessionLearnerInvitationToPaymentOption::getPaymentOption)
                .filter(java.util.Objects::nonNull)
                .map(PaymentOption::getId)
                .collect(Collectors.toSet());

        Map<String, Set<String>> sessionsByPaymentOption = buildSessionsByPaymentOption(
                resolvedPaymentOptionIds, instituteId);

        List<MarkdownLookupItemDTO> out = new ArrayList<>();
        for (String id : uniqueIds) {
            MarkdownLookupItemDTO item = MarkdownLookupItemDTO.builder()
                    .packageSessionId(id)
                    .discountable(false)
                    .build();
            PackageSessionLearnerInvitationToPaymentOption psl = psLinkBySessionId.get(id);
            if (psl == null) {
                item.setIneligibleReason(MarkdownErrorCode.PACKAGE_SESSION_NOT_FOUND.name());
                out.add(item);
                continue;
            }
            PaymentOption po = psl.getPaymentOption();
            if (po == null) {
                item.setIneligibleReason(MarkdownErrorCode.NO_ACTIVE_PAYMENT_OPTION.name());
                out.add(item);
                continue;
            }
            item.setPaymentOptionId(po.getId());
            item.setPaymentOptionType(po.getType());
            item.setPaymentOptionSource(po.getSource());

            List<PaymentPlan> activePlans = po.getPaymentPlans() == null
                    ? List.of()
                    : po.getPaymentPlans().stream()
                            .filter(p -> StatusEnum.ACTIVE.name().equalsIgnoreCase(p.getStatus()))
                            .toList();
            if (activePlans.size() == 1) {
                PaymentPlan plan = activePlans.get(0);
                item.setPaymentPlanId(plan.getId());
                item.setActualPrice(plan.getActualPrice());
                item.setElevatedPrice(plan.getElevatedPrice());
                item.setCurrency(plan.getCurrency());
            }

            Set<String> siblings = sessionsByPaymentOption.getOrDefault(po.getId(), Collections.emptySet());
            List<String> otherSessions = siblings.stream().filter(s -> !s.equals(id)).distinct().toList();
            item.setSharedWithPackageSessionIds(otherSessions);

            String ineligible = null;
            if (PaymentOptionType.FREE.name().equalsIgnoreCase(po.getType())) {
                ineligible = MarkdownErrorCode.FREE_OPTION_NOT_DISCOUNTABLE.name();
            } else if (PaymentOptionType.CPO.name().equalsIgnoreCase(po.getType())) {
                ineligible = MarkdownErrorCode.CPO_OPTION_NOT_SUPPORTED.name();
            } else if (PaymentOptionSource.INSTITUTE.name().equalsIgnoreCase(po.getSource())) {
                ineligible = MarkdownErrorCode.INSTITUTE_DEFAULT_OPTION_NOT_DISCOUNTABLE.name();
            } else if (activePlans.isEmpty()) {
                ineligible = MarkdownErrorCode.NO_ACTIVE_PAYMENT_PLAN.name();
            } else if (activePlans.size() > 1) {
                ineligible = MarkdownErrorCode.MULTIPLE_ACTIVE_PAYMENT_PLANS.name();
            } else if (!otherSessions.isEmpty()) {
                ineligible = MarkdownErrorCode.PAYMENT_OPTION_SHARED_WITH_OTHERS.name();
            }
            item.setIneligibleReason(ineligible);
            item.setDiscountable(ineligible == null);
            out.add(item);
        }
        return out;
    }

    private MarkdownResponseDTO process(
            String instituteId,
            List<String> rawPackageSessionIds,
            Function<PaymentPlan, Double> newActualPriceFn) {

        Set<String> uniqueIds = new LinkedHashSet<>(rawPackageSessionIds);
        // A shop price changes only in Commerce, where the change is audited.
        commerceLegacyGuard.refuseVariantSessions(uniqueIds, "mark its price down here");

        List<PackageSessionLearnerInvitationToPaymentOption> psLinks =
                psLinkRepository.findActiveByPackageSessionIdsAndInstituteId(
                        new ArrayList<>(uniqueIds), instituteId);

        Map<String, PackageSessionLearnerInvitationToPaymentOption> psLinkBySessionId = new HashMap<>();
        for (PackageSessionLearnerInvitationToPaymentOption psl : psLinks) {
            if (psl.getPackageSession() == null) continue;
            psLinkBySessionId.putIfAbsent(psl.getPackageSession().getId(), psl);
        }

        Map<String, MarkdownResultDTO> resultBySessionId = new LinkedHashMap<>();
        for (String id : uniqueIds) {
            MarkdownResultDTO r = MarkdownResultDTO.builder().packageSessionId(id).build();
            resultBySessionId.put(id, r);
            if (!psLinkBySessionId.containsKey(id)) {
                fail(r, MarkdownErrorCode.PACKAGE_SESSION_NOT_FOUND,
                        "Package session not found or has no active enrollment configuration in this institute.");
            }
        }

        Set<String> resolvedPaymentOptionIds = psLinkBySessionId.values().stream()
                .map(PackageSessionLearnerInvitationToPaymentOption::getPaymentOption)
                .filter(java.util.Objects::nonNull)
                .map(PaymentOption::getId)
                .collect(Collectors.toSet());

        Map<String, Set<String>> sessionsByPaymentOption = buildSessionsByPaymentOption(
                resolvedPaymentOptionIds, instituteId);

        List<PaymentPlan> plansToSave = new ArrayList<>();

        for (Map.Entry<String, PackageSessionLearnerInvitationToPaymentOption> entry : psLinkBySessionId.entrySet()) {
            String sessionId = entry.getKey();
            PackageSessionLearnerInvitationToPaymentOption psl = entry.getValue();
            MarkdownResultDTO r = resultBySessionId.get(sessionId);

            PaymentOption po = psl.getPaymentOption();
            if (po == null) {
                fail(r, MarkdownErrorCode.NO_ACTIVE_PAYMENT_OPTION, "No payment option attached.");
                continue;
            }
            r.setPaymentOptionId(po.getId());

            if (PaymentOptionType.FREE.name().equalsIgnoreCase(po.getType())) {
                fail(r, MarkdownErrorCode.FREE_OPTION_NOT_DISCOUNTABLE,
                        "Cannot mark down a FREE payment option.");
                continue;
            }
            if (PaymentOptionType.CPO.name().equalsIgnoreCase(po.getType())) {
                fail(r, MarkdownErrorCode.CPO_OPTION_NOT_SUPPORTED,
                        "CPO-based payment options are managed via fee management, not via markdown.");
                continue;
            }
            if (PaymentOptionSource.INSTITUTE.name().equalsIgnoreCase(po.getSource())) {
                fail(r, MarkdownErrorCode.INSTITUTE_DEFAULT_OPTION_NOT_DISCOUNTABLE,
                        "Institute-default payment options are shared across the institute and cannot be marked down.");
                continue;
            }

            Set<String> siblings = sessionsByPaymentOption.getOrDefault(po.getId(), Collections.emptySet());
            List<String> outsiders = siblings.stream()
                    .filter(s -> !uniqueIds.contains(s))
                    .distinct()
                    .toList();
            if (!outsiders.isEmpty()) {
                r.setConflictingPackageSessionIds(outsiders);
                fail(r, MarkdownErrorCode.PAYMENT_OPTION_SHARED_WITH_OTHERS,
                        "This payment option is also attached to other package sessions not in the request. "
                                + "Include them in the selection or skip this session.");
                continue;
            }

            List<PaymentPlan> activePlans = po.getPaymentPlans() == null
                    ? List.of()
                    : po.getPaymentPlans().stream()
                            .filter(p -> StatusEnum.ACTIVE.name().equalsIgnoreCase(p.getStatus()))
                            .toList();

            if (activePlans.isEmpty()) {
                fail(r, MarkdownErrorCode.NO_ACTIVE_PAYMENT_PLAN,
                        "No active payment plan to update on this payment option.");
                continue;
            }
            if (activePlans.size() > 1) {
                fail(r, MarkdownErrorCode.MULTIPLE_ACTIVE_PAYMENT_PLANS,
                        "Payment option has multiple active plans; cannot determine which to mark down.");
                continue;
            }

            PaymentPlan plan = activePlans.get(0);
            r.setPaymentPlanId(plan.getId());
            r.setOldActualPrice(plan.getActualPrice());
            r.setElevatedPrice(plan.getElevatedPrice());
            r.setCurrency(plan.getCurrency());

            double newPrice;
            try {
                newPrice = newActualPriceFn.apply(plan);
            } catch (IllegalArgumentException ex) {
                fail(r, MarkdownErrorCode.INVALID_MARKDOWN_VALUE, ex.getMessage());
                continue;
            }

            plan.setActualPrice(newPrice);
            plansToSave.add(plan);

            r.setNewActualPrice(newPrice);
            r.setSuccess(true);
        }

        if (!plansToSave.isEmpty()) {
            paymentPlanRepository.saveAll(plansToSave);
        }

        List<MarkdownResultDTO> results = new ArrayList<>(resultBySessionId.values());
        int successes = (int) results.stream().filter(MarkdownResultDTO::isSuccess).count();
        return MarkdownResponseDTO.builder()
                .totalRequested(uniqueIds.size())
                .successCount(successes)
                .failureCount(uniqueIds.size() - successes)
                .results(results)
                .build();
    }

    private Map<String, Set<String>> buildSessionsByPaymentOption(
            Set<String> paymentOptionIds, String instituteId) {
        if (paymentOptionIds.isEmpty()) return Collections.emptyMap();

        List<PackageSessionLearnerInvitationToPaymentOption> allLinks =
                psLinkRepository.findActiveByPaymentOptionIdsAndInstituteId(
                        new ArrayList<>(paymentOptionIds), instituteId);

        Map<String, Set<String>> map = new HashMap<>();
        for (PackageSessionLearnerInvitationToPaymentOption psl : allLinks) {
            if (psl.getPaymentOption() == null || psl.getPackageSession() == null) continue;
            map.computeIfAbsent(psl.getPaymentOption().getId(), k -> new HashSet<>())
                    .add(psl.getPackageSession().getId());
        }
        return map;
    }

    private double computeMarkdownPrice(PaymentPlan plan, MarkdownMode mode, double value, String roundingMode) {
        if (Double.isNaN(value) || Double.isInfinite(value)) {
            throw new IllegalArgumentException("Value must be a finite number.");
        }
        double elevated = plan.getElevatedPrice();
        double raw;
        if (mode == MarkdownMode.PERCENT) {
            if (value < 0 || value > 100) {
                throw new IllegalArgumentException("Percent must be between 0 and 100 (got " + value + ").");
            }
            raw = elevated * (1.0 - value / 100.0);
        } else {
            if (value < 0) {
                throw new IllegalArgumentException("Absolute price must be >= 0 (got " + value + ").");
            }
            if (value > elevated) {
                throw new IllegalArgumentException(
                        "New price (" + value + ") must not exceed elevated price (" + elevated + ").");
            }
            raw = value;
        }
        return applyRounding(roundTo2(raw), roundingMode);
    }

    private static double roundTo2(double v) {
        return Math.round(v * 100.0) / 100.0;
    }

    /**
     * Apply the institute's configured whole-unit rounding on top of the 2dp baseline.
     * CEIL/FLOOR round to the nearest whole currency unit (₹1, $1, etc.);
     * NONE keeps the 2dp value as-is.
     */
    private static double applyRounding(double v, String roundingMode) {
        if ("CEIL".equals(roundingMode)) return Math.ceil(v);
        if ("FLOOR".equals(roundingMode)) return Math.floor(v);
        return v;
    }

    private String resolveRoundingMode(String instituteId) {
        if (!StringUtils.hasText(instituteId)) return "NONE";
        return instituteRepository.findById(instituteId)
                .map(Institute::getSetting)
                .map(InstituteSettingUtils::getOfferPricingRounding)
                .orElse("NONE");
    }

    private static void fail(MarkdownResultDTO r, MarkdownErrorCode code, String message) {
        r.setSuccess(false);
        r.setErrorCode(code.name());
        r.setErrorMessage(message);
    }

    private static void validateApplyRequest(ApplyMarkdownRequestDTO request) {
        if (request == null) throw new VacademyException("Request body required.");
        if (!StringUtils.hasText(request.getInstituteId()))
            throw new VacademyException("instituteId required.");
        if (request.getPackageSessionIds() == null || request.getPackageSessionIds().isEmpty())
            throw new VacademyException("packageSessionIds required.");
        if (!StringUtils.hasText(request.getMode()))
            throw new VacademyException("mode required (PERCENT or ABSOLUTE).");
        if (request.getValue() == null)
            throw new VacademyException("value required.");
        MarkdownMode.fromString(request.getMode());
    }

    private static void validateResetRequest(ResetMarkdownRequestDTO request) {
        if (request == null) throw new VacademyException("Request body required.");
        if (!StringUtils.hasText(request.getInstituteId()))
            throw new VacademyException("instituteId required.");
        if (request.getPackageSessionIds() == null || request.getPackageSessionIds().isEmpty())
            throw new VacademyException("packageSessionIds required.");
    }

    private static void validateLookupRequest(MarkdownLookupRequestDTO request) {
        if (request == null) throw new VacademyException("Request body required.");
        if (!StringUtils.hasText(request.getInstituteId()))
            throw new VacademyException("instituteId required.");
        if (request.getPackageSessionIds() == null || request.getPackageSessionIds().isEmpty())
            throw new VacademyException("packageSessionIds required.");
    }
}
