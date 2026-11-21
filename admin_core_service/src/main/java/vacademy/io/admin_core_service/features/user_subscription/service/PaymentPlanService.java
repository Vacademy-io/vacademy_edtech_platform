package vacademy.io.admin_core_service.features.user_subscription.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.common.enums.StatusEnum;
import vacademy.io.admin_core_service.features.user_subscription.dto.PaymentPlanDTO;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentOption;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentPlanRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
public class PaymentPlanService {
    @Autowired
    private PaymentPlanRepository paymentPlanRepository;

    public Optional<PaymentPlan>findById(String id){
        return paymentPlanRepository.findById(id);
    }
     public List<PaymentPlan> findByPaymentOption(PaymentOption paymentOption) {
        return paymentPlanRepository.findByPaymentOption(paymentOption);
    }
    public List<PaymentPlan>editPaymentPlans(List<PaymentPlan>existingPaymentPlans, List<PaymentPlanDTO>paymentPlanDTOS, PaymentOption paymentOption){
        return editPaymentPlans(existingPaymentPlans, paymentPlanDTOS, paymentOption, false);
    }

    /**
     * @param fullPayload true when the caller sends every plan field (the Settings page
     *                    save). A null {@code validityInDays} then means "no expiry" —
     *                    the FREE "Unlimited" / ONE_TIME "Lifetime" choice — and is
     *                    written. With a partial payload (the Edit Payment Option dialog)
     *                    null only means "not sent" and the stored value is kept.
     */
    public List<PaymentPlan>editPaymentPlans(List<PaymentPlan>existingPaymentPlans, List<PaymentPlanDTO>paymentPlanDTOS, PaymentOption paymentOption, boolean fullPayload){
        Map<String,PaymentPlan>existingPaymentPlanMap = existingPaymentPlans.stream().
                collect(Collectors.toMap(PaymentPlan::getId, Function.identity()));
        List<PaymentPlan>toSave = new ArrayList<>();
        Set<String> retainedIds = new HashSet<>();
        if (paymentPlanDTOS == null) paymentPlanDTOS = List.of();
        // Single-plan option types (FREE / DONATION, and older clients for ONE_TIME) are
        // resent by the Settings page without a plan id. One stored plan edited into one
        // resent plan is an update of that plan, not a replacement: matching them keeps
        // the id, so user_plan.plan_id of everyone already on it still points at a live
        // row instead of a retired one.
        if (paymentPlanDTOS.size() == 1 && existingPaymentPlans.size() == 1
                && !StringUtils.hasText(paymentPlanDTOS.get(0).getId())) {
            paymentPlanDTOS.get(0).setId(existingPaymentPlans.get(0).getId());
        }
        for (PaymentPlanDTO paymentPlanDTO : paymentPlanDTOS) {
            if (StringUtils.hasText(paymentPlanDTO.getId())){
                PaymentPlan paymentPlan = existingPaymentPlanMap.get(paymentPlanDTO.getId());
                if (paymentPlan != null){
                    updatePaymentPlan(paymentPlan,paymentPlanDTO);
                    if (fullPayload) paymentPlan.setValidityInDays(paymentPlanDTO.getValidityInDays());
                }else{
                    throw new VacademyException("Payment Plan with id " + paymentPlanDTO.getId() + " not found");
                }
                retainedIds.add(paymentPlanDTO.getId());
                toSave.add(paymentPlan);
            }else{
                toSave.add(new PaymentPlan(paymentPlanDTO,paymentOption));
            }
        }
        // Plans the edit dropped (or replaced by id-less copies) must be retired, or
        // they stay ACTIVE alongside the new ones and learners see duplicate plans.
        List<PaymentPlan> dropped = existingPaymentPlans.stream()
                .filter(plan -> !retainedIds.contains(plan.getId()))
                .toList();
        if (!dropped.isEmpty()) {
            dropped.forEach(plan -> plan.setStatus(StatusEnum.DELETED.name()));
            paymentPlanRepository.saveAll(dropped);
        }
        return toSave;
    }
    // Callers (e.g. the Edit Payment Option dialog) may send only a subset of fields;
    // a missing field deserializes as null and must not overwrite the existing value.
    private void updatePaymentPlan(PaymentPlan paymentPlan, PaymentPlanDTO paymentPlanDTO) {
        if (paymentPlanDTO.getName() != null) paymentPlan.setName(paymentPlanDTO.getName());
        if (paymentPlanDTO.getStatus() != null) paymentPlan.setStatus(paymentPlanDTO.getStatus());
        if (paymentPlanDTO.getValidityInDays() != null) paymentPlan.setValidityInDays(paymentPlanDTO.getValidityInDays());
        // Prices are null-guarded like every other field. They used to be assigned
        // unconditionally off primitive doubles, so an edit payload that omitted them
        // deserialized 0.0 and wiped the price off a paid plan.
        if (paymentPlanDTO.getActualPrice() != null) paymentPlan.setActualPrice(paymentPlanDTO.getActualPrice());
        if (paymentPlanDTO.getElevatedPrice() != null) paymentPlan.setElevatedPrice(paymentPlanDTO.getElevatedPrice());
        if (paymentPlanDTO.getCurrency() != null) paymentPlan.setCurrency(paymentPlanDTO.getCurrency());
        if (paymentPlanDTO.getDescription() != null) paymentPlan.setDescription(paymentPlanDTO.getDescription());
        if (paymentPlanDTO.getTag() != null) paymentPlan.setTag(paymentPlanDTO.getTag());
        if (paymentPlanDTO.getFeatureJson() != null) paymentPlan.setFeatureJson(paymentPlanDTO.getFeatureJson());
        if (paymentPlanDTO.getPlanChangeAllowed() != null) paymentPlan.setPlanChangeAllowed(paymentPlanDTO.getPlanChangeAllowed());
    }
}
