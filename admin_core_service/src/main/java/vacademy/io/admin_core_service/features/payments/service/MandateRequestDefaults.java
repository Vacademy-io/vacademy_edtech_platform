package vacademy.io.admin_core_service.features.payments.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.admin_core_service.features.user_subscription.service.UserInstitutePaymentGatewayMappingService;
import vacademy.io.common.payment.dto.PaymentInitiationRequestDTO;
import vacademy.io.common.payment.dto.RazorpayRequestDTO;

import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Fills the mandate fields of a {@link RazorpayRequestDTO} the same way for every
 * path that registers a recurring mandate — enrolment, manual renewal
 * ("pay to continue + turn auto-pay back on") and a plan-change re-authorisation.
 *
 * Before this existed only the enrolment path set these: the renewal and
 * plan-change paths handed the gateway a request with no method / max-amount /
 * frequency, so {@code RazorpayPaymentManager} fell back to a CARD e-mandate
 * even for a learner whose original mandate was UPI Autopay.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class MandateRequestDefaults {

    public static final String METHOD_UPI = "upi";
    public static final String METHOD_CARD = "card";
    public static final String METHOD_EMANDATE = "emandate";
    private static final Set<String> SUPPORTED_METHODS = Set.of(METHOD_UPI, METHOD_CARD, METHOD_EMANDATE);

    /**
     * Razorpay mandate frequency. Always {@code as_presented}.
     *
     * A fixed cadence is NOT cosmetic. Razorpay/NPCI enforce it as the mandate's
     * debit cycle, so a "monthly" mandate permits exactly one debit per calendar
     * month and a "yearly" one exactly one per calendar year -- and the Rs 1
     * authorization transaction consumes that cycle's only slot. Every later charge
     * inside the same period is then refused with:
     *   BAD_REQUEST_ERROR: Customer has been already debited for the current cycle.
     *
     * Verified on live UPI Autopay mandates 2026-09-02 -- same customer, same hour,
     * same code path, only the registered frequency differing:
     *   token_TXCR7TVC28E598 (monthly)       Rs 1 auth 14:22 -> Rs 1,200 at 14:30  REFUSED
     *   token_TXDVlb9TqcY6Hm (as_presented)  Rs 1 auth 15:25 -> Rs 4,800 at 15:51  CHARGED
     *
     * We drive the schedule ourselves (RenewalChargeService), so the mandate must
     * impose none. max_amount still caps every individual debit and expire_at still
     * bounds the mandate's life, so the learner keeps both protections.
     */
    public static final String MANDATE_FREQUENCY = "as_presented";

    private final UserInstitutePaymentGatewayMappingService gatewayMappingService;
    private final ObjectMapper objectMapper;

    /**
     * Per-debit ceiling + frequency: {@code AUTOPAY_SETTING.MAX_AMOUNT} on the invite
     * when configured, otherwise the plan's price (the amount every renewal will debit).
     */
    public void applyMaxAmountAndFrequency(PaymentInitiationRequestDTO request,
                                           EnrollInvite enrollInvite, PaymentPlan paymentPlan) {
        applyMaxAmountAndFrequency(request, enrollInvite,
                paymentPlan != null ? Double.valueOf(paymentPlan.getActualPrice()) : null);
    }

    /**
     * As above with the per-cycle price given directly — a regionally priced UserPlan
     * renews at its locked price, not the plan's base price.
     */
    public void applyMaxAmountAndFrequency(PaymentInitiationRequestDTO request,
                                           EnrollInvite enrollInvite, Double planPrice) {
        if (request == null || request.getRazorpayRequest() == null) {
            return;
        }
        Double maxAmount = null;
        try {
            if (enrollInvite != null && StringUtils.hasText(enrollInvite.getSettingJson())) {
                JsonNode ap = objectMapper.readTree(enrollInvite.getSettingJson())
                        .path("setting").path("AUTOPAY_SETTING");
                if (ap.has("MAX_AMOUNT") && !ap.get("MAX_AMOUNT").isNull()) {
                    maxAmount = ap.get("MAX_AMOUNT").asDouble();
                }
            }
        } catch (Exception e) {
            log.warn("Could not read AUTOPAY_SETTING.MAX_AMOUNT for invite {}: {}",
                    enrollInvite != null ? enrollInvite.getId() : null, e.getMessage());
        }
        if (maxAmount == null) {
            maxAmount = planPrice;
        }
        request.getRazorpayRequest().setMandateMaxAmount(maxAmount);
        request.getRazorpayRequest().setMandateFrequency(MANDATE_FREQUENCY);
    }

    /**
     * Authorisation method for a mandate re-registration (renewal / plan change), in
     * order of preference:
     * <ol>
     *   <li>what the learner picked in the checkout ({@code requestedMethod});</li>
     *   <li>the method of the mandate they already hold with this vendor — the
     *       webhook records the authorising payment's {@code method} as
     *       {@code paymentMethodType}, so a UPI Autopay learner is re-registered on UPI;</li>
     *   <li>UPI, matching the enrolment form's default.</li>
     * </ol>
     * Enrolment does not go through here: its method is chosen by the learner on the
     * enrol form and arrives already set on the request.
     */
    public void applyMethod(PaymentInitiationRequestDTO request, String requestedMethod,
                            String userId, String instituteId, String vendor) {
        if (request == null || request.getRazorpayRequest() == null) {
            return;
        }
        String method = normalise(requestedMethod);
        if (method == null) {
            method = normalise(storedMethod(userId, instituteId, vendor));
        }
        if (method == null) {
            method = METHOD_UPI;
        }
        request.getRazorpayRequest().setMandateMethod(method);
    }

    private String storedMethod(String userId, String instituteId, String vendor) {
        try {
            Map<String, Object> details = gatewayMappingService.getPaymentMethodDetails(userId, instituteId, vendor);
            Object type = details.get("paymentMethodType");
            return type != null ? type.toString() : null;
        } catch (Exception e) {
            log.warn("Could not read stored mandate method for user {}: {}", userId, e.getMessage());
            return null;
        }
    }

    private static String normalise(String method) {
        if (!StringUtils.hasText(method)) {
            return null;
        }
        String m = method.trim().toLowerCase(Locale.ROOT);
        return SUPPORTED_METHODS.contains(m) ? m : null;
    }
}
