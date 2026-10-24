package vacademy.io.admin_core_service.features.learner_payment_method.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.regional_pricing.service.RegionalPriceLock;
import vacademy.io.admin_core_service.features.institute.service.InstitutePaymentGatewayMappingService;
import vacademy.io.admin_core_service.features.learner_payment_method.dto.LearnerBillingDetailsDTO;
import vacademy.io.admin_core_service.features.learner_payment_method.dto.LearnerCardUpdateRequestDTO;
import vacademy.io.admin_core_service.features.learner_payment_method.dto.LearnerPaymentMethodSummaryDTO;
import vacademy.io.admin_core_service.features.learner_payment_method.dto.StripeSetupIntentResponseDTO;
import vacademy.io.admin_core_service.features.payments.manager.EwayPaymentManager;
import vacademy.io.admin_core_service.features.payments.manager.StripePaymentManager;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserInstitutePaymentGatewayMapping;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.repository.UserInstitutePaymentGatewayMappingRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.UserPlanRepository;
import vacademy.io.admin_core_service.features.user_subscription.service.UserInstitutePaymentGatewayMappingService;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.payment.dto.EwayApiResponseDTO;
import vacademy.io.common.payment.dto.EwayRequestDTO;
import vacademy.io.common.payment.enums.PaymentGateway;

import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * Learner self-service management of the saved payment method that auto
 * renewal charges. Only STRIPE and EWAY expose card update: Stripe via
 * SetupIntent + default payment method, eWay via UpdateTokenCustomer on the
 * stored TokenCustomerID. Other gateways have no merchant-side saved-card API
 * (Razorpay tokens are only minted by a payment webhook).
 */
@Slf4j
@Service
public class LearnerPaymentMethodService {

    private static final Set<String> UPDATE_SUPPORTED_VENDORS = Set.of(
            PaymentGateway.STRIPE.name(), PaymentGateway.EWAY.name());

    private static final List<String> RELEVANT_PLAN_STATUSES = List.of("ACTIVE", "PENDING");

    public static final String REASON_GATEWAY_NOT_CONFIGURED = "GATEWAY_NOT_CONFIGURED";
    public static final String REASON_NO_CUSTOMER = "NO_CUSTOMER";
    public static final String REASON_UNSUPPORTED_GATEWAY = "UNSUPPORTED_GATEWAY";

    @Autowired
    private UserInstitutePaymentGatewayMappingService userGatewayMappingService;

    @Autowired
    private UserInstitutePaymentGatewayMappingRepository userGatewayMappingRepository;

    @Autowired
    private InstitutePaymentGatewayMappingService institutePaymentGatewayMappingService;

    @Autowired
    private StripePaymentManager stripePaymentManager;

    @Autowired
    private EwayPaymentManager ewayPaymentManager;

    @Autowired
    private UserPlanRepository userPlanRepository;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private TransactionTemplate transactionTemplate;

    // ── Summary ──────────────────────────────────────────────────────────

    public LearnerPaymentMethodSummaryDTO getSummary(String userId, String instituteId) {
        LearnerPaymentMethodSummaryDTO summary = new LearnerPaymentMethodSummaryDTO();

        String vendor = resolveVendor(userId, instituteId);
        summary.setVendor(vendor);

        if (!UPDATE_SUPPORTED_VENDORS.contains(vendor)) {
            summary.setUpdateSupported(false);
            summary.setReason(REASON_UNSUPPORTED_GATEWAY);
            return summary;
        }

        Optional<UserInstitutePaymentGatewayMapping> mappingOpt = userGatewayMappingService
                .findByUserIdAndInstituteId(userId, instituteId, vendor);
        if (mappingOpt.isEmpty()) {
            summary.setUpdateSupported(false);
            summary.setHasSavedPaymentMethod(false);
            summary.setReason(REASON_NO_CUSTOMER);
            return summary;
        }

        Map<String, Object> gatewayData;
        try {
            gatewayData = institutePaymentGatewayMappingService.findInstitutePaymentGatewaySpecifData(vendor,
                    instituteId);
        } catch (Exception e) {
            log.warn("Payment gateway {} not configured for institute {}: {}", vendor, instituteId, e.getMessage());
            summary.setUpdateSupported(false);
            summary.setReason(REASON_GATEWAY_NOT_CONFIGURED);
            return summary;
        }

        summary.setUpdateSupported(true);
        UserInstitutePaymentGatewayMapping mapping = mappingOpt.get();
        JsonNode customerData = parseJson(mapping.getPaymentGatewayCustomerData());

        if (PaymentGateway.STRIPE.name().equals(vendor)) {
            populateStripeSummary(summary, mapping, customerData, gatewayData, userId, instituteId);
        } else {
            populateEwaySummary(summary, customerData);
        }

        // Locally stored billing details (written on every billing update) win
        // over gateway-derived ones so the section renders without live calls.
        JsonNode storedBilling = customerData != null ? customerData.get("billingDetails") : null;
        if (storedBilling != null && storedBilling.isObject()) {
            summary.setBillingDetails(objectMapper.convertValue(storedBilling, LearnerBillingDetailsDTO.class));
        }
        return summary;
    }

    private void populateStripeSummary(LearnerPaymentMethodSummaryDTO summary,
                                       UserInstitutePaymentGatewayMapping mapping,
                                       JsonNode customerData,
                                       Map<String, Object> gatewayData,
                                       String userId, String instituteId) {
        Map<String, Object> stored = userGatewayMappingService.getPaymentMethodDetails(userId, instituteId,
                PaymentGateway.STRIPE.name());
        if (stored.get("cardLast4") != null) {
            summary.setHasSavedPaymentMethod(true);
            summary.setCardLast4((String) stored.get("cardLast4"));
            summary.setCardBrand((String) stored.get("cardBrand"));
        } else {
            Map<String, Object> live = stripePaymentManager.getDefaultPaymentMethodSummary(
                    mapping.getPaymentGatewayCustomerId(), gatewayData);
            if (live != null) {
                summary.setHasSavedPaymentMethod(true);
                summary.setCardBrand((String) live.get("brand"));
                summary.setCardLast4((String) live.get("last4"));
                summary.setCardExpiryMonth((Long) live.get("expMonth"));
                summary.setCardExpiryYear((Long) live.get("expYear"));
            }
        }
        if ((customerData == null || customerData.get("billingDetails") == null)) {
            Map<String, Object> billing = stripePaymentManager.getCustomerBillingDetails(
                    mapping.getPaymentGatewayCustomerId(), gatewayData);
            if (billing != null) {
                summary.setBillingDetails(objectMapper.convertValue(billing, LearnerBillingDetailsDTO.class));
            }
        }
    }

    private void populateEwaySummary(LearnerPaymentMethodSummaryDTO summary, JsonNode customerData) {
        JsonNode ewayCustomer = extractEwayCustomerNode(customerData);
        if (ewayCustomer == null) {
            return;
        }
        JsonNode cardDetails = ewayCustomer.get("CardDetails");
        if (cardDetails != null) {
            String maskedNumber = textOrNull(cardDetails, "Number");
            if (StringUtils.hasText(maskedNumber) && maskedNumber.length() >= 4) {
                summary.setHasSavedPaymentMethod(true);
                summary.setCardLast4(maskedNumber.substring(maskedNumber.length() - 4));
                String expMonth = textOrNull(cardDetails, "ExpiryMonth");
                String expYear = textOrNull(cardDetails, "ExpiryYear");
                if (StringUtils.hasText(expMonth)) {
                    summary.setCardExpiryMonth(parseLongOrNull(expMonth));
                }
                if (StringUtils.hasText(expYear)) {
                    Long year = parseLongOrNull(expYear);
                    // eWay stores 2-digit years
                    summary.setCardExpiryYear(year != null && year < 100 ? 2000 + year : year);
                }
            }
        }
        LearnerBillingDetailsDTO billing = new LearnerBillingDetailsDTO();
        String firstName = textOrNull(ewayCustomer, "FirstName");
        String lastName = textOrNull(ewayCustomer, "LastName");
        // eWay refuses an empty LastName, so a learner who gave only a first name is
        // sent to the gateway as "Jane Jane" (see EwayPaymentManager#ensureLastName).
        // That padding is for eWay alone — collapse it back to the single name here.
        if (lastName != null && lastName.equalsIgnoreCase(firstName)) {
            lastName = null;
        }
        String fullName = ((firstName != null ? firstName : "") + " " + (lastName != null ? lastName : "")).trim();
        billing.setName(StringUtils.hasText(fullName) ? fullName : null);
        billing.setEmail(textOrNull(ewayCustomer, "Email"));
        billing.setCountry(textOrNull(ewayCustomer, "Country"));
        billing.setCity(textOrNull(ewayCustomer, "City"));
        billing.setState(textOrNull(ewayCustomer, "State"));
        billing.setPostalCode(textOrNull(ewayCustomer, "PostalCode"));
        billing.setAddressLine(textOrNull(ewayCustomer, "Street1"));
        summary.setBillingDetails(billing);
    }

    // ── Stripe SetupIntent ───────────────────────────────────────────────

    public StripeSetupIntentResponseDTO createStripeSetupIntent(String userId, String instituteId) {
        UserInstitutePaymentGatewayMapping mapping = requireMapping(userId, instituteId,
                PaymentGateway.STRIPE.name());
        Map<String, Object> gatewayData = institutePaymentGatewayMappingService
                .findInstitutePaymentGatewaySpecifData(PaymentGateway.STRIPE.name(), instituteId);
        Map<String, Object> setupIntent = stripePaymentManager
                .createSetupIntent(mapping.getPaymentGatewayCustomerId(), gatewayData);
        Map<String, Object> openDetails = institutePaymentGatewayMappingService
                .getPaymentGatewayOpenDetails(instituteId, PaymentGateway.STRIPE.name());
        return new StripeSetupIntentResponseDTO(
                (String) setupIntent.get("clientSecret"),
                (String) openDetails.get("publishableKey"),
                mapping.getPaymentGatewayCustomerId());
    }

    // ── Card update ──────────────────────────────────────────────────────

    public LearnerPaymentMethodSummaryDTO confirmCardUpdate(String userId, String instituteId,
                                                            LearnerCardUpdateRequestDTO request) {
        String vendor = request.getVendor() != null ? request.getVendor().toUpperCase() : null;
        if (PaymentGateway.STRIPE.name().equals(vendor)) {
            confirmStripeCardUpdate(userId, instituteId, request);
        } else if (PaymentGateway.EWAY.name().equals(vendor)) {
            confirmEwayCardUpdate(userId, instituteId, request);
        } else {
            throw new VacademyException("Card update is not supported for payment gateway: " + vendor);
        }
        return getSummary(userId, instituteId);
    }

    private void confirmStripeCardUpdate(String userId, String instituteId, LearnerCardUpdateRequestDTO request) {
        if (request.getStripe() == null || !StringUtils.hasText(request.getStripe().getPaymentMethodId())) {
            throw new VacademyException("Stripe payment method id is required");
        }
        String vendor = PaymentGateway.STRIPE.name();
        UserInstitutePaymentGatewayMapping mapping = requireMapping(userId, instituteId, vendor);
        Map<String, Object> gatewayData = institutePaymentGatewayMappingService
                .findInstitutePaymentGatewaySpecifData(vendor, instituteId);

        // Gateway first (idempotent, and the attach doubles as the ownership
        // check), local writes after so partial local state cannot occur.
        String paymentMethodId = request.getStripe().getPaymentMethodId();
        Map<String, Object> cardSummary = stripePaymentManager.attachAndSetDefaultPaymentMethod(
                mapping.getPaymentGatewayCustomerId(), paymentMethodId, gatewayData);

        String last4 = (String) cardSummary.get("last4");
        String brand = (String) cardSummary.get("brand");
        // TransactionTemplate (not @Transactional) because a self-invoked
        // annotated method would bypass the Spring proxy; the mapping metadata
        // and the plan snapshots must commit together.
        transactionTemplate.executeWithoutResult(tx -> {
            userGatewayMappingService.savePaymentMethodInCustomerData(userId, instituteId,
                    PaymentGateway.STRIPE.name(), paymentMethodId, "card", last4, brand);
            rewriteStripeSnapshots(userId, instituteId, mapping.getPaymentGatewayCustomerId(), paymentMethodId,
                    last4);
        });
    }

    /**
     * Auto-renewal replays the PaymentInitiationRequestDTO stored in
     * user_plan.json_payment_details, whose stripe_request.payment_method_id
     * is frozen at enrollment time. Rewrite it for every plan the renewal
     * scheduler could charge. Legacy rows may hold the serialized gateway
     * mapping entity (or null) instead of the DTO — normalize those to a
     * clean DTO snapshot so renewals become chargeable again.
     */
    private void rewriteStripeSnapshots(String userId, String instituteId, String customerId,
                                        String paymentMethodId, String last4) {
        List<UserPlan> plans = userPlanRepository.findAllByUserIdAndInstituteIdAndStatusIn(
                userId, instituteId, RELEVANT_PLAN_STATUSES);
        List<UserPlan> modified = new java.util.ArrayList<>();
        for (UserPlan plan : plans) {
            String planVendor = plan.getEnrollInvite() != null ? plan.getEnrollInvite().getVendor() : null;
            if (!PaymentGateway.STRIPE.name().equalsIgnoreCase(planVendor)) {
                continue;
            }
            JsonNode root = parseJson(plan.getJsonPaymentDetails());
            if (root != null && root.has("linkedToParentPayment")) {
                continue; // child of a multi-package payment, never charged directly
            }
            // DTO-shaped snapshots carry a vendor/amount alongside
            // stripe_request; anything else (entity JSON, null, garbage) is
            // rebuilt from the plan's enroll invite + payment plan.
            ObjectNode snapshot;
            if (root != null && root.isObject() && root.has("stripe_request")) {
                snapshot = (ObjectNode) root;
            } else {
                snapshot = buildNormalizedStripeSnapshot(plan, customerId);
            }
            ObjectNode stripeRequest = snapshot.path("stripe_request").isObject()
                    ? (ObjectNode) snapshot.get("stripe_request")
                    : snapshot.putObject("stripe_request");
            stripeRequest.put("customer_id", customerId);
            stripeRequest.put("payment_method_id", paymentMethodId);
            stripeRequest.put("card_last4", last4);
            plan.setJsonPaymentDetails(snapshot.toString());
            modified.add(plan);
        }
        if (!modified.isEmpty()) {
            userPlanRepository.saveAll(modified);
            log.info("Rewrote Stripe payment snapshot on {} user plan(s) for user {}", modified.size(), userId);
        }
    }

    private ObjectNode buildNormalizedStripeSnapshot(UserPlan plan, String customerId) {
        ObjectNode snapshot = objectMapper.createObjectNode();
        snapshot.put("vendor", PaymentGateway.STRIPE.name());
        if (plan.getEnrollInvite() != null) {
            snapshot.put("vendor_id", plan.getEnrollInvite().getVendorId());
            snapshot.put("currency", plan.getEnrollInvite().getCurrency());
            snapshot.put("institute_id", plan.getEnrollInvite().getInstituteId());
        }
        if (plan.getPaymentPlan() != null) {
            snapshot.put("amount", RegionalPriceLock.listPrice(plan));
            if (!StringUtils.hasText(snapshot.path("currency").asText(null))) {
                snapshot.put("currency", plan.getPaymentPlan().getCurrency());
            }
        }
        if (RegionalPriceLock.isLocked(plan)) {
            snapshot.put("currency", plan.getRegionalCurrency());
        }
        snapshot.putObject("stripe_request").put("customer_id", customerId);
        return snapshot;
    }

    private void confirmEwayCardUpdate(String userId, String instituteId, LearnerCardUpdateRequestDTO request) {
        LearnerCardUpdateRequestDTO.EwayCardUpdate eway = request.getEway();
        if (eway == null || !StringUtils.hasText(eway.getEncryptedCardNumber())) {
            throw new VacademyException("Encrypted card details are required for eWay");
        }
        String vendor = PaymentGateway.EWAY.name();
        UserInstitutePaymentGatewayMapping mapping = requireMapping(userId, instituteId, vendor);
        Map<String, Object> gatewayData = institutePaymentGatewayMappingService
                .findInstitutePaymentGatewaySpecifData(vendor, instituteId);

        EwayRequestDTO cardRequest = new EwayRequestDTO();
        cardRequest.setCardName(eway.getCardName());
        cardRequest.setExpiryMonth(eway.getExpiryMonth());
        cardRequest.setExpiryYear(eway.getExpiryYear());
        cardRequest.setCardNumber(eway.getEncryptedCardNumber());
        cardRequest.setCvn(eway.getEncryptedCvn());
        cardRequest.setCountryCode(eway.getCountryCode());

        EwayApiResponseDTO.Customer storedCustomer = extractEwayCustomer(mapping);
        EwayApiResponseDTO response = ewayPaymentManager.updateTokenCustomer(
                mapping.getPaymentGatewayCustomerId(), cardRequest, storedCustomer, gatewayData);

        // Same TokenCustomerID keeps renewals working; we only refresh the
        // stored customer data (new masked PAN / expiry) for the summary.
        replaceEwayCustomerData(mapping, response);
    }

    // ── Billing details ──────────────────────────────────────────────────

    public LearnerPaymentMethodSummaryDTO updateBillingDetails(String userId, String instituteId,
                                                               LearnerBillingDetailsDTO billing) {
        String vendor = resolveVendor(userId, instituteId);
        if (!UPDATE_SUPPORTED_VENDORS.contains(vendor)) {
            throw new VacademyException("Billing details update is not supported for payment gateway: " + vendor);
        }
        UserInstitutePaymentGatewayMapping mapping = requireMapping(userId, instituteId, vendor);
        Map<String, Object> gatewayData = institutePaymentGatewayMappingService
                .findInstitutePaymentGatewaySpecifData(vendor, instituteId);

        if (PaymentGateway.STRIPE.name().equals(vendor)) {
            stripePaymentManager.updateCustomerBillingDetails(mapping.getPaymentGatewayCustomerId(),
                    billing.getName(), billing.getEmail(), billing.getAddressLine(), billing.getCity(),
                    billing.getState(), billing.getPostalCode(), billing.getCountry(), gatewayData);
        } else {
            String[] nameParts = billing.getName() != null ? billing.getName().trim().split("\\s+", 2)
                    : new String[]{""};
            EwayApiResponseDTO.Customer stored = extractEwayCustomer(mapping);
            EwayApiResponseDTO response = ewayPaymentManager.updateTokenCustomerBillingDetails(
                    mapping.getPaymentGatewayCustomerId(),
                    nameParts[0],
                    nameParts.length > 1 ? nameParts[1] : "",
                    StringUtils.hasText(billing.getEmail()) ? billing.getEmail()
                            : (stored != null ? stored.Email : null),
                    StringUtils.hasText(billing.getCountry()) ? billing.getCountry()
                            : (stored != null ? stored.Country : null),
                    gatewayData);
            replaceEwayCustomerData(mapping, response);
        }

        storeBillingDetailsLocally(mapping, billing);
        return getSummary(userId, instituteId);
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    /** Deterministic preference order when probing for a saved card. */
    private static final List<String> SUPPORTED_VENDOR_PROBE_ORDER = List.of(
            PaymentGateway.STRIPE.name(), PaymentGateway.EWAY.name());

    /**
     * The vendor whose saved payment method matters is the one on the
     * learner's most recent chargeable plan. But plan invites frequently
     * carry no vendor (free/manual invites), and the institute's
     * newest-configured gateway is an arbitrary tiebreak — so before giving
     * up on an unsupported answer, prefer a supported gateway where the
     * learner actually has a customer mapping (that is where a saved card
     * lives). Only report an unsupported vendor when the learner genuinely
     * has no Stripe/eWay customer.
     */
    private String resolveVendor(String userId, String instituteId) {
        List<UserPlan> plans = userPlanRepository.findAllByUserIdAndInstituteIdAndStatusIn(
                userId, instituteId, RELEVANT_PLAN_STATUSES);
        String planVendor = plans.stream()
                .sorted(Comparator.comparing(UserPlan::getCreatedAt,
                        Comparator.nullsFirst(Comparator.naturalOrder())).reversed())
                .map(p -> p.getEnrollInvite() != null ? p.getEnrollInvite().getVendor() : null)
                .filter(StringUtils::hasText)
                .map(String::toUpperCase)
                .findFirst()
                .orElse(null);

        if (planVendor != null && UPDATE_SUPPORTED_VENDORS.contains(planVendor)) {
            return planVendor;
        }

        for (String candidate : SUPPORTED_VENDOR_PROBE_ORDER) {
            if (userGatewayMappingService.findByUserIdAndInstituteId(userId, instituteId, candidate).isPresent()) {
                return candidate;
            }
        }

        if (planVendor != null) {
            return planVendor;
        }
        return institutePaymentGatewayMappingService.getLatestVendorInfoForInstitute(instituteId).getVendor();
    }

    private UserInstitutePaymentGatewayMapping requireMapping(String userId, String instituteId, String vendor) {
        return userGatewayMappingService.findByUserIdAndInstituteId(userId, instituteId, vendor)
                .orElseThrow(() -> new VacademyException(
                        "No saved payment profile found for this account. Complete a payment first."));
    }

    private EwayApiResponseDTO.Customer extractEwayCustomer(UserInstitutePaymentGatewayMapping mapping) {
        JsonNode customerNode = extractEwayCustomerNode(parseJson(mapping.getPaymentGatewayCustomerData()));
        if (customerNode == null) {
            return null;
        }
        try {
            return objectMapper.treeToValue(customerNode, EwayApiResponseDTO.Customer.class);
        } catch (Exception e) {
            log.warn("Could not parse stored eWay customer data for mapping {}", mapping.getId());
            return null;
        }
    }

    /** Stored shape: {customerId, customerData: {Customer: {...}, ...}, ...}. */
    private JsonNode extractEwayCustomerNode(JsonNode root) {
        if (root == null) {
            return null;
        }
        JsonNode customerData = root.has("customerData") ? root.get("customerData") : root;
        JsonNode customer = customerData.get("Customer");
        return customer != null && customer.isObject() ? customer : null;
    }

    private void replaceEwayCustomerData(UserInstitutePaymentGatewayMapping mapping, EwayApiResponseDTO response) {
        JsonNode root = parseJson(mapping.getPaymentGatewayCustomerData());
        ObjectNode rootNode = root != null && root.isObject() ? (ObjectNode) root : objectMapper.createObjectNode();
        rootNode.set("customerData", objectMapper.valueToTree(response));
        rootNode.put("customerId", mapping.getPaymentGatewayCustomerId());
        mapping.setPaymentGatewayCustomerData(rootNode.toString());
        userGatewayMappingRepository.save(mapping);
    }

    private void storeBillingDetailsLocally(UserInstitutePaymentGatewayMapping mapping,
                                            LearnerBillingDetailsDTO billing) {
        JsonNode root = parseJson(mapping.getPaymentGatewayCustomerData());
        ObjectNode rootNode = root != null && root.isObject() ? (ObjectNode) root : objectMapper.createObjectNode();
        rootNode.set("billingDetails", objectMapper.valueToTree(billing));
        mapping.setPaymentGatewayCustomerData(rootNode.toString());
        userGatewayMappingRepository.save(mapping);
    }

    private JsonNode parseJson(String json) {
        if (!StringUtils.hasText(json)) {
            return null;
        }
        try {
            return objectMapper.readTree(json);
        } catch (Exception e) {
            return null;
        }
    }

    private String textOrNull(JsonNode node, String field) {
        JsonNode value = node.get(field);
        return value != null && !value.isNull() ? value.asText() : null;
    }

    private Long parseLongOrNull(String value) {
        try {
            return Long.parseLong(value.trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
