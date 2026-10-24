package vacademy.io.admin_core_service.features.payments.manager;

import com.razorpay.Customer;
import com.razorpay.Order;
import com.razorpay.Payment;
import com.razorpay.PaymentLink;
import com.razorpay.RazorpayClient;
import com.razorpay.RazorpayException;
import org.json.JSONObject;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.payments.dto.RazorpayCustomerDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.MandateInfo;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.logging.SentryLogger;
import vacademy.io.common.payment.currency.CurrencyRegistry;
import vacademy.io.common.payment.dto.PaymentInitiationRequestDTO;
import vacademy.io.common.payment.dto.PaymentResponseDTO;
import vacademy.io.common.payment.dto.RazorpayRequestDTO;
import vacademy.io.common.payment.enums.PaymentStatusEnum;
import vacademy.io.common.payment.enums.PaymentType;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
public class RazorpayPaymentManager implements PaymentServiceStrategy {

    private static final String MANDATE_METHOD_CARD = "card";
    private static final String MANDATE_METHOD_UPI = "upi";
    /** Razorpay wants a mandate expiry for UPI Autopay; hold the mandate for 10 years. */
    private static final long DEFAULT_MANDATE_YEARS = 10;

    private static long defaultMandateExpiry() {
        return java.time.Instant.now().plus(java.time.Duration.ofDays(365 * DEFAULT_MANDATE_YEARS))
                .getEpochSecond();
    }

    @Override
    public PaymentResponseDTO initiatePayment(UserDTO user, PaymentInitiationRequestDTO request,
            Map<String, Object> paymentGatewaySpecificData) {

        try {
            validateRequest(request);
            RazorpayClient razorpayClient = createRazorpayClient(paymentGatewaySpecificData);

            long amountInPaise = CurrencyRegistry.toMinorUnits(request.getAmount(), request.getCurrency());

            Order razorpayOrder = createRazorpayOrder(razorpayClient, request, amountInPaise);

            return buildPaymentResponseFromOrder(razorpayOrder, request, paymentGatewaySpecificData);

        } catch (RazorpayException e) {
            throw new VacademyException("Error initiating Razorpay payment: " + e.getMessage());
        }
    }

    @Override
    public Map<String, Object> createCustomer(UserDTO user, PaymentInitiationRequestDTO request,
            Map<String, Object> paymentGatewaySpecificData) {

        try {
            validateInput(user, request);
            RazorpayClient razorpayClient = createRazorpayClient(paymentGatewaySpecificData);

            JSONObject customerRequest = buildRazorpayCustomerParams(user, request);
            Customer razorpayCustomer = razorpayClient.customers.create(customerRequest);

            return buildCustomerResponse(razorpayCustomer);

        } catch (RazorpayException e) {
            throw new VacademyException("Error creating Razorpay customer: " + e.getMessage());
        }
    }

    @Override
    public Map<String, Object> createCustomerForUnknownUser(String email, PaymentInitiationRequestDTO request,
            Map<String, Object> paymentGatewaySpecificData) {

        try {
            validateInputForUnknownUser(email, request);
            RazorpayClient razorpayClient = createRazorpayClient(paymentGatewaySpecificData);

            JSONObject customerRequest = buildRazorpayCustomerParamsForUnknownUser(email, request);
            Customer razorpayCustomer = razorpayClient.customers.create(customerRequest);

            return buildCustomerResponse(razorpayCustomer);

        } catch (RazorpayException e) {
            throw new VacademyException("Error creating Razorpay customer for unknown user: " + e.getMessage());
        }
    }

    @Override
    public Map<String, Object> findCustomerByEmail(String email, Map<String, Object> paymentGatewaySpecificData) {
        try {
            RazorpayClient razorpayClient = createRazorpayClient(paymentGatewaySpecificData);

            JSONObject queryParams = new JSONObject();
            queryParams.put("email", email);
            queryParams.put("count", 1);

            List<Customer> customers = razorpayClient.customers.fetchAll(queryParams);

            if (customers != null && !customers.isEmpty()) {
                return buildCustomerResponse(customers.get(0));
            } else {
                return null;
            }

        } catch (RazorpayException | RuntimeException e) {
            // A gateway failure here falls back to creating a new customer; surface it so
            // duplicate-customer creation isn't silently masking Razorpay outages.
            SentryLogger.logWarning(e, "Razorpay customer lookup by email failed", Map.of(
                    "payment.gateway", "RAZORPAY",
                    "operation", "findCustomerByEmail"
            ));
            return null;
        }
    }

    // ── Client-side payment confirmation (Checkout "phase 2") ──────────────

    /**
     * Razorpay Checkout hands the browser a payment_id + signature on success and
     * the client re-submits the original request with them — that re-submission is
     * a confirmation, not a new payment.
     */
    @Override
    public boolean isClientPaymentConfirmation(PaymentInitiationRequestDTO request) {
        RazorpayRequestDTO rr = request != null ? request.getRazorpayRequest() : null;
        return rr != null
                && StringUtils.hasText(rr.getRazorpayPaymentId())
                && StringUtils.hasText(rr.getRazorpayOrderId())
                && StringUtils.hasText(rr.getRazorpaySignature());
    }

    /**
     * Verifies the Checkout signature — HMAC-SHA256 of "order_id|payment_id" with
     * the key secret — and returns the Razorpay order id. Throws when the secret
     * is missing rather than skipping: an institute taking Razorpay payments must
     * have one, and skipping verification would let anyone confirm a pending
     * enrollment with a forged payment id.
     */
    @Override
    public String verifyClientPaymentConfirmation(PaymentInitiationRequestDTO request,
            Map<String, Object> paymentGatewaySpecificData) {
        try {
            RazorpayRequestDTO rr = request.getRazorpayRequest();
            String keySecret = paymentGatewaySpecificData != null
                    ? (String) paymentGatewaySpecificData.getOrDefault("publishableKey",
                            paymentGatewaySpecificData.get("keySecret"))
                    : null;
            if (keySecret == null && paymentGatewaySpecificData != null) {
                keySecret = (String) paymentGatewaySpecificData.get("apiSecret");
            }
            if (!StringUtils.hasText(keySecret)) {
                throw new VacademyException("Razorpay key secret not configured for this institute");
            }
            String payload = rr.getRazorpayOrderId() + "|" + rr.getRazorpayPaymentId();
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(keySecret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            byte[] hash = mac.doFinal(payload.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder();
            for (byte b : hash) {
                hex.append(String.format("%02x", b));
            }
            if (!hex.toString().equals(rr.getRazorpaySignature())) {
                throw new VacademyException("Razorpay payment signature verification failed");
            }
            return rr.getRazorpayOrderId();
        } catch (VacademyException ve) {
            throw ve;
        } catch (Exception e) {
            throw new VacademyException("Razorpay signature verification error: " + e.getMessage());
        }
    }

    // ── Recurring / mandate (autopay) ──────────────────────────────────────

    /**
     * First payment that also registers a UPI-Autopay / card e-mandate. Same as
     * a normal order but attaches the customer and a {@code token} block
     * carrying the app-computed {@code max_amount} (in paise) and frequency, so
     * Razorpay authenticates a mandate (not just a saved card). The frontend
     * must open Checkout with {@code recurring: 1} + this {@code customer_id};
     * the confirmed {@code token_id} arrives on the webhook and is persisted as
     * the mandate. Requires {@code request.razorpayRequest.customerId}.
     */
    @Override
    public PaymentResponseDTO initiateMandatePayment(UserDTO user, PaymentInitiationRequestDTO request,
            Map<String, Object> paymentGatewaySpecificData) {
        try {
            validateRequest(request);
            RazorpayRequestDTO rr = request.getRazorpayRequest();
            if (rr == null || !StringUtils.hasText(rr.getCustomerId())) {
                throw new VacademyException("Razorpay mandate registration requires a customerId");
            }
            RazorpayClient razorpayClient = createRazorpayClient(paymentGatewaySpecificData);
            long amountInPaise = CurrencyRegistry.toMinorUnits(request.getAmount(), request.getCurrency());
            long maxAmountPaise = rr.getMandateMaxAmount() != null
                    ? CurrencyRegistry.toMinorUnits(rr.getMandateMaxAmount(), request.getCurrency())
                    : amountInPaise;

            JSONObject orderRequest = new JSONObject();
            orderRequest.put("amount", amountInPaise);
            orderRequest.put("currency", request.getCurrency().toUpperCase());
            orderRequest.put("receipt", request.getOrderId());
            orderRequest.put("customer_id", rr.getCustomerId());
            orderRequest.put("payment_capture", 1);

            JSONObject token = new JSONObject();
            token.put("max_amount", maxAmountPaise);
            token.put("frequency", StringUtils.hasText(rr.getMandateFrequency())
                    ? rr.getMandateFrequency() : "as_presented");

            // A recurring order is bound to one authorization method. Card e-mandate is the
            // default; UPI Autopay must be requested explicitly and requires a mandate expiry.
            String mandateMethod = StringUtils.hasText(rr.getMandateMethod())
                    ? rr.getMandateMethod().toLowerCase()
                    : MANDATE_METHOD_CARD;
            if (!MANDATE_METHOD_CARD.equals(mandateMethod)) {
                orderRequest.put("method", mandateMethod);
            }
            if (MANDATE_METHOD_UPI.equals(mandateMethod)) {
                token.put("expire_at", rr.getMandateExpireAt() != null
                        ? rr.getMandateExpireAt()
                        : defaultMandateExpiry());
            }
            orderRequest.put("token", token);

            JSONObject notes = new JSONObject();
            notes.put("orderId", request.getOrderId());
            notes.put("instituteId", request.getInstituteId());
            notes.put("payment_type", request.getPaymentType() != null
                    ? request.getPaymentType().name() : PaymentType.INITIAL.name());
            orderRequest.put("notes", notes);

            Order order = razorpayClient.orders.create(orderRequest);
            PaymentResponseDTO dto = buildPaymentResponseFromOrder(order, request, paymentGatewaySpecificData);
            // Signal the frontend to run Checkout in recurring/mandate mode.
            dto.getResponseData().put("recurring", 1);
            dto.getResponseData().put("customerId", rr.getCustomerId());
            dto.getResponseData().put("mandateMaxAmount", maxAmountPaise);
            dto.getResponseData().put("mandateMethod", mandateMethod);
            return dto;
        } catch (RazorpayException e) {
            throw new VacademyException("Error initiating Razorpay mandate payment: " + e.getMessage());
        }
    }

    /**
     * Off-session recurring charge against a registered Razorpay mandate token.
     * Creates a fresh order for the renewal amount then submits a recurring
     * payment on the stored token. Capture confirmation still arrives via the
     * RENEWAL webhook. {@code max_amount} is enforced app-side first.
     */
    @Override
    public PaymentResponseDTO chargeRecurring(MandateInfo mandate, PaymentInitiationRequestDTO request,
            Map<String, Object> paymentGatewaySpecificData) {
        return chargeRecurring(mandate, request, paymentGatewaySpecificData, PaymentType.RENEWAL);
    }

    /**
     * {@link #chargeRecurring(MandateInfo, PaymentInitiationRequestDTO, Map)} with the
     * {@code notes.payment_type} the webhook routes on (F12). The learner autopay path keeps
     * RENEWAL; null also means RENEWAL.
     */
    public PaymentResponseDTO chargeRecurring(MandateInfo mandate, PaymentInitiationRequestDTO request,
            Map<String, Object> paymentGatewaySpecificData, PaymentType paymentType) {
        if (mandate == null || !StringUtils.hasText(mandate.getProviderRef())
                || !StringUtils.hasText(mandate.getCustomerId())) {
            throw new VacademyException("Razorpay recurring charge requires a customerId + token mandate");
        }
        if (mandate.getMaxAmount() != null && request.getAmount() > mandate.getMaxAmount()) {
            throw new VacademyException("Razorpay recurring amount " + request.getAmount()
                    + " exceeds mandate max_amount " + mandate.getMaxAmount());
        }
        try {
            RazorpayClient razorpayClient = createRazorpayClient(paymentGatewaySpecificData);
            long amountInPaise = CurrencyRegistry.toMinorUnits(request.getAmount(), request.getCurrency());

            JSONObject orderRequest = new JSONObject();
            orderRequest.put("amount", amountInPaise);
            orderRequest.put("currency", request.getCurrency().toUpperCase());
            orderRequest.put("receipt", request.getOrderId());
            orderRequest.put("payment_capture", 1);
            // NOTE: do NOT send token_id on this order. The public docs list it as
            // mandatory for subsequent recurring payments, but this account rejects it
            // outright: "BAD_REQUEST_ERROR: token_id is/are not required and should not
            // be sent" -- and it fails at orders.create, so the charge never even starts.
            JSONObject notes = new JSONObject();
            notes.put("orderId", request.getOrderId());
            notes.put("instituteId", request.getInstituteId());
            notes.put("payment_type", (paymentType != null ? paymentType : PaymentType.RENEWAL).name());
            orderRequest.put("notes", notes);
            Order order = razorpayClient.orders.create(orderRequest);

            JSONObject rec = new JSONObject();
            rec.put("email", request.getEmail());
            // The payer's phone number -- NOT vendorId, which is the invite's gateway
            // id ("RAZORPAY") and is rejected as an invalid contact.
            String contact = request.getRazorpayRequest() != null
                    ? request.getRazorpayRequest().getContact()
                    : null;
            if (StringUtils.hasText(contact)) {
                rec.put("contact", contact);
            }
            rec.put("amount", amountInPaise);
            rec.put("currency", request.getCurrency().toUpperCase());
            rec.put("order_id", order.get("id").toString());
            rec.put("customer_id", mandate.getCustomerId());
            rec.put("token", mandate.getProviderRef());
            rec.put("recurring", "1");
            rec.put("notes", notes);

            Payment payment = razorpayClient.payments.createRecurringPayment(rec);

            Map<String, Object> responseData = new HashMap<>();
            responseData.put("razorpayOrderId", order.get("id"));
            responseData.put("razorpayPaymentId", payment.has("id") ? payment.get("id") : null);
            String status = payment.has("status") && payment.get("status") != null
                    ? payment.get("status").toString() : "created";
            responseData.put("status", status);
            PaymentStatusEnum paymentStatus = ("captured".equalsIgnoreCase(status) || "authorized".equalsIgnoreCase(status))
                    ? PaymentStatusEnum.PAID : PaymentStatusEnum.PAYMENT_PENDING;
            responseData.put("paymentStatus", paymentStatus.name());

            PaymentResponseDTO dto = new PaymentResponseDTO();
            dto.setResponseData(responseData);
            dto.setOrderId(request.getOrderId());
            dto.setMessage("Recurring payment submitted");
            return dto;
        } catch (RazorpayException e) {
            throw new VacademyException("Error charging Razorpay recurring payment: " + e.getMessage());
        }
    }

    // --- Private Helper Methods ---

    /**
     * Refunds a captured payment in full. Used to return the mandate authorization
     * charge once the token is registered, so a "free" trial really is free.
     */
    public void refundPayment(String razorpayPaymentId, Map<String, Object> paymentGatewaySpecificData) {
        if (!StringUtils.hasText(razorpayPaymentId)) {
            throw new VacademyException("Cannot refund Razorpay payment: missing payment id");
        }
        try {
            RazorpayClient razorpayClient = createRazorpayClient(paymentGatewaySpecificData);
            JSONObject refundRequest = new JSONObject();
            refundRequest.put("speed", "normal");
            razorpayClient.payments.refund(razorpayPaymentId, refundRequest);
        } catch (RazorpayException e) {
            throw new VacademyException("Error refunding Razorpay payment " + razorpayPaymentId
                    + ": " + e.getMessage());
        }
    }

    /**
     * Refund a captured payment, fully ({@code amountMinor} null) or partially.
     * {@code receipt} is Razorpay's idempotency key for the refund: a repeat with the same
     * receipt on the same payment is refused ("Duplicate receipt found for this refund
     * request"), so a retried auto-refund can never pay twice.
     * Docs: https://razorpay.com/docs/api/refunds/create-normal/
     *
     * @return the refund entity as a map ({@code id}, {@code amount}, {@code status}, ...)
     */
    public Map<String, Object> refundPayment(String razorpayPaymentId, Long amountMinor, String receipt,
            Map<String, String> notes, Map<String, Object> paymentGatewaySpecificData) {
        if (!StringUtils.hasText(razorpayPaymentId)) {
            throw new VacademyException("Cannot refund Razorpay payment: missing payment id");
        }
        try {
            RazorpayClient razorpayClient = createRazorpayClient(paymentGatewaySpecificData);
            com.razorpay.Refund refund = razorpayClient.payments.refund(razorpayPaymentId,
                    buildRefundRequest(amountMinor, receipt, notes));
            return jsonToMap(refund.toJson());
        } catch (RazorpayException e) {
            throw new VacademyException("Error refunding Razorpay payment " + razorpayPaymentId
                    + ": " + e.getMessage());
        }
    }

    /** The refund request body; package-private for tests. */
    static JSONObject buildRefundRequest(Long amountMinor, String receipt, Map<String, String> notes) {
        JSONObject refundRequest = new JSONObject();
        refundRequest.put("speed", "normal");
        if (amountMinor != null) {
            if (amountMinor <= 0) {
                throw new VacademyException("Refund amount must be positive");
            }
            refundRequest.put("amount", amountMinor);
        }
        if (StringUtils.hasText(receipt)) {
            refundRequest.put("receipt", receipt.length() > 40 ? receipt.substring(0, 40) : receipt);
        }
        if (notes != null && !notes.isEmpty()) {
            refundRequest.put("notes", limitedNotes(notes, 15));
        }
        return refundRequest;
    }

    /**
     * {@code GET /v1/payments/:id}: status, amount, amount_refunded, order_id, invoice_id,
     * token_id, customer_id, notes. Used to verify a payment before a manual fulfilment and to
     * check {@code amount_refunded} before an automatic refund.
     */
    public Map<String, Object> fetchPayment(String razorpayPaymentId, Map<String, Object> paymentGatewaySpecificData) {
        if (!StringUtils.hasText(razorpayPaymentId)) {
            throw new VacademyException("Cannot fetch Razorpay payment: missing payment id");
        }
        try {
            RazorpayClient razorpayClient = createRazorpayClient(paymentGatewaySpecificData);
            Payment payment = razorpayClient.payments.fetch(razorpayPaymentId);
            return jsonToMap(payment.toJson());
        } catch (RazorpayException e) {
            throw new VacademyException("Error fetching Razorpay payment " + razorpayPaymentId
                    + ": " + e.getMessage());
        }
    }

    private RazorpayClient createRazorpayClient(Map<String, Object> paymentGatewaySpecificData)
            throws RazorpayException {
        String keyId = extractApiKey(paymentGatewaySpecificData);
        String keySecret = extractPublishableKey(paymentGatewaySpecificData);
        return new RazorpayClient(keyId, keySecret);
    }

    private Order createRazorpayOrder(RazorpayClient razorpayClient,
            PaymentInitiationRequestDTO request,
            long amountInPaise) throws RazorpayException {

        JSONObject orderRequest = new JSONObject();
        orderRequest.put("amount", amountInPaise);
        orderRequest.put("currency", request.getCurrency().toUpperCase());
        orderRequest.put("receipt", request.getOrderId());

        JSONObject notes = new JSONObject();
        notes.put("orderId", request.getOrderId());
        notes.put("instituteId", request.getInstituteId());
        notes.put("payment_type",
                request.getPaymentType() != null ? request.getPaymentType().name() : PaymentType.INITIAL.name());

        if (StringUtils.hasText(request.getDescription())) {
            notes.put("description", request.getDescription());
        }

        if (request.getRazorpayRequest() != null) {
            String applicantId = request.getRazorpayRequest().getApplicantId();
            if (StringUtils.hasText(applicantId)) {
                notes.put("applicantId", applicantId);
            }
            String optionId = request.getRazorpayRequest().getPaymentOptionId();
            if (StringUtils.hasText(optionId)) {
                notes.put("paymentOptionId", optionId);
            }
        }

        orderRequest.put("notes", notes);

        return razorpayClient.orders.create(orderRequest);
    }

    private PaymentResponseDTO buildPaymentResponseFromOrder(Order order, PaymentInitiationRequestDTO request,
            Map<String, Object> paymentGatewaySpecificData) {
        Map<String, Object> responseData = new HashMap<>();

        try {
            responseData.put("razorpayOrderId", order.has("id") ? order.get("id") : null);
            responseData.put("razorpayKeyId", extractApiKey(paymentGatewaySpecificData));
            responseData.put("amount", order.has("amount") ? order.get("amount") : 0);
            responseData.put("amountPaid", order.has("amount_paid") ? order.get("amount_paid") : 0);
            responseData.put("amountDue", order.has("amount_due") ? order.get("amount_due") : 0);
            responseData.put("currency", order.has("currency") ? order.get("currency") : request.getCurrency());
            responseData.put("receipt", order.has("receipt") ? order.get("receipt") : request.getOrderId());
            responseData.put("status", order.has("status") ? order.get("status") : "created");
            responseData.put("attempts", order.has("attempts") ? order.get("attempts") : 0);
            responseData.put("createdAt",
                    order.has("created_at") ? order.get("created_at") : System.currentTimeMillis() / 1000);

            RazorpayRequestDTO razorpayRequest = request.getRazorpayRequest();
            if (razorpayRequest != null) {
                responseData.put("customerId", razorpayRequest.getCustomerId());
                responseData.put("email", razorpayRequest.getEmail());
                responseData.put("contact", razorpayRequest.getContact());
            }

            if (StringUtils.hasText(request.getDescription())) {
                responseData.put("description", request.getDescription());
            }

            String orderStatus = order.has("status") && order.get("status") != null
                    ? order.get("status").toString()
                    : "created";

            PaymentStatusEnum paymentStatus = "created".equalsIgnoreCase(orderStatus)
                    ? PaymentStatusEnum.PAYMENT_PENDING
                    : PaymentStatusEnum.FAILED;

            responseData.put("paymentStatus", paymentStatus.name());

            PaymentResponseDTO dto = new PaymentResponseDTO();
            dto.setResponseData(responseData);
            dto.setOrderId(request.getOrderId());
            dto.setMessage("Order created successfully");

            return dto;

        } catch (Exception e) {
            PaymentResponseDTO errorDto = new PaymentResponseDTO();
            errorDto.setOrderId(request.getOrderId());
            errorDto.setMessage("Order created with warnings");

            Map<String, Object> minimalData = new HashMap<>();
            minimalData.put("razorpayOrderId", order.has("id") ? order.get("id") : "unknown");
            minimalData.put("razorpayKeyId", extractApiKey(paymentGatewaySpecificData));
            minimalData.put("paymentStatus", PaymentStatusEnum.PAYMENT_PENDING.name());
            errorDto.setResponseData(minimalData);

            return errorDto;
        }
    }

    /**
     * Create a Razorpay-hosted Payment Link (rzp.io/i/…) for this request.
     *
     * Used by the AI-credit top-up: the platform serves the admin app on many
     * white-labelled custom domains, which Razorpay won't let checkout.js run on.
     * Payment instead happens on Razorpay's own (always-allowed) hosted page, and
     * on success the browser is redirected to {@code callbackUrl} — back on the
     * originating admin domain.
     *
     * The link carries the SAME notes (orderId / instituteId / payment_type) as
     * {@link #createRazorpayOrder}, so the existing {@code payment.captured}
     * webhook grants credits with zero changes — fulfillment never moves.
     *
     * @return map with {@code paymentLinkId}, {@code paymentLinkUrl} (short_url),
     *         {@code razorpayKeyId}
     */
    public Map<String, Object> createPaymentLink(UserDTO user, PaymentInitiationRequestDTO request,
            Map<String, Object> paymentGatewaySpecificData, String callbackUrl) {
        return createPaymentLink(user, request, paymentGatewaySpecificData, callbackUrl, null);
    }

    /**
     * Per-link options for {@link #createPaymentLink(UserDTO, PaymentInitiationRequestDTO, Map, String,
     * PaymentLinkOptions)}. Every field is optional; null means "as before" (no expiry, no
     * reminders, no Razorpay SMS/email, account business name, no extra notes).
     *
     * @param expireBy       link {@code expire_by}. Razorpay: Unix seconds, at least 15 minutes in
     *                       the future, at most six months after creation (default validity is six
     *                       months). https://razorpay.com/docs/api/payments/payment-links/create-standard/
     * @param reminderEnable Razorpay's own reminders ({@code reminder_enable}); we keep them off
     *                       and send our own brand-correct emails
     * @param checkoutName   {@code options.checkout.name}: the business name shown in the checkout
     *                       section of the hosted page (no per-link logo field is documented).
     *                       https://razorpay.com/docs/api/payments/payment-links/change-business-name/
     * @param extraNotes     added to {@code notes} (Razorpay allows 15 keys, 256 chars each); the
     *                       routing keys orderId / instituteId / payment_type always win
     */
    public record PaymentLinkOptions(
            java.time.Instant expireBy,
            Boolean reminderEnable,
            String checkoutName,
            Map<String, String> extraNotes) {

        public static PaymentLinkOptions expiringAt(java.time.Instant expireBy) {
            return new PaymentLinkOptions(expireBy, null, null, null);
        }
    }

    /** Razorpay refuses an {@code expire_by} closer than 15 minutes; keep a margin for clock skew. */
    static final java.time.Duration MIN_LINK_LIFETIME = java.time.Duration.ofMinutes(16);
    /** Razorpay refuses an {@code expire_by} more than six months after creation. */
    static final java.time.Duration MAX_LINK_LIFETIME = java.time.Duration.ofDays(180);

    /**
     * {@link #createPaymentLink(UserDTO, PaymentInitiationRequestDTO, Map, String)} with per-link
     * options (F7). The response map also carries {@code expireBy} (epoch seconds) when set.
     */
    public Map<String, Object> createPaymentLink(UserDTO user, PaymentInitiationRequestDTO request,
            Map<String, Object> paymentGatewaySpecificData, String callbackUrl, PaymentLinkOptions options) {
        try {
            validateRequest(request);
            JSONObject plReq = buildPaymentLinkRequest(user, request, callbackUrl, options, java.time.Instant.now());
            RazorpayClient razorpayClient = createRazorpayClient(paymentGatewaySpecificData);
            PaymentLink paymentLink = razorpayClient.paymentLink.create(plReq);

            Map<String, Object> out = new HashMap<>();
            out.put("paymentLinkId", paymentLink.has("id") ? paymentLink.get("id") : null);
            out.put("paymentLinkUrl", paymentLink.has("short_url") ? paymentLink.get("short_url") : null);
            out.put("razorpayKeyId", extractApiKey(paymentGatewaySpecificData));
            if (plReq.has("expire_by")) {
                out.put("expireBy", plReq.getLong("expire_by"));
            }
            return out;

        } catch (RazorpayException e) {
            throw new VacademyException("Error creating Razorpay payment link: " + e.getMessage());
        }
    }

    /**
     * The Payment Link request body. With {@code options == null} it is exactly the body this
     * class sent before F7 (packs relied on it). Package-private for tests.
     */
    static JSONObject buildPaymentLinkRequest(UserDTO user, PaymentInitiationRequestDTO request,
            String callbackUrl, PaymentLinkOptions options, java.time.Instant now) {
        long amountInPaise = CurrencyRegistry.toMinorUnits(request.getAmount(), request.getCurrency());

        JSONObject plReq = new JSONObject();
        plReq.put("amount", amountInPaise);
        plReq.put("currency", request.getCurrency().toUpperCase());
        plReq.put("accept_partial", false);
        // reference_id must be unique per link — our platform_payment_id is.
        plReq.put("reference_id", request.getOrderId());
        if (StringUtils.hasText(request.getDescription())) {
            plReq.put("description", request.getDescription());
        }

        // Prefill the payer (best-effort — Razorpay still collects on its page).
        JSONObject customer = new JSONObject();
        if (user != null) {
            if (StringUtils.hasText(user.getFullName())) customer.put("name", user.getFullName());
            if (StringUtils.hasText(user.getEmail())) customer.put("email", user.getEmail());
            if (StringUtils.hasText(user.getMobileNumber())) customer.put("contact", user.getMobileNumber());
        } else if (StringUtils.hasText(request.getEmail())) {
            customer.put("email", request.getEmail());
        }
        if (customer.length() > 0) {
            plReq.put("customer", customer);
        }

        // We drive the return + balance refresh ourselves; suppress Razorpay's
        // own SMS/email so the user isn't double-notified.
        JSONObject notify = new JSONObject();
        notify.put("sms", false);
        notify.put("email", false);
        plReq.put("notify", notify);
        plReq.put("reminder_enable", options != null && Boolean.TRUE.equals(options.reminderEnable()));

        // notes MUST mirror createRazorpayOrder so PlatformRazorpayWebHookService
        // (keyed on notes.orderId + notes.payment_type) grants exactly as today.
        JSONObject notes = new JSONObject();
        if (options != null && options.extraNotes() != null) {
            // 4 keys below are always added; Razorpay allows 15 in all.
            JSONObject extra = limitedNotes(options.extraNotes(), 11);
            for (java.util.Iterator<String> it = extra.keys(); it.hasNext(); ) {
                String k = it.next();
                notes.put(k, extra.get(k));
            }
        }
        notes.put("orderId", request.getOrderId());
        notes.put("instituteId", request.getInstituteId());
        notes.put("payment_type", request.getPaymentType() != null
                ? request.getPaymentType().name() : PaymentType.INITIAL.name());
        if (StringUtils.hasText(request.getDescription())) {
            notes.put("description", request.getDescription());
        }
        plReq.put("notes", notes);

        if (StringUtils.hasText(callbackUrl)) {
            plReq.put("callback_url", callbackUrl);
            plReq.put("callback_method", "get");
        }

        if (options != null && options.expireBy() != null) {
            java.time.Instant expireBy = options.expireBy();
            if (expireBy.isBefore(now.plus(MIN_LINK_LIFETIME))) {
                throw new VacademyException("Payment link expiry must be at least "
                        + MIN_LINK_LIFETIME.toMinutes() + " minutes away");
            }
            if (expireBy.isAfter(now.plus(MAX_LINK_LIFETIME))) {
                expireBy = now.plus(MAX_LINK_LIFETIME);
            }
            plReq.put("expire_by", expireBy.getEpochSecond());
        }
        if (options != null && StringUtils.hasText(options.checkoutName())) {
            JSONObject checkout = new JSONObject();
            checkout.put("name", options.checkoutName().trim());
            JSONObject opts = new JSONObject();
            opts.put("checkout", checkout);
            plReq.put("options", opts);
        }
        return plReq;
    }

    /**
     * {@code POST /v1/payment_links/:id/cancel}. Razorpay refuses to cancel a paid or partially
     * paid link ("cannot cancel or expire an already paid/partially paid link"): the caller must
     * then {@link #fetchPaymentLink fetch} it and fulfil instead.
     * Docs: https://razorpay.com/docs/api/payments/payment-links/cancel-standard/
     *
     * @return the link as {@link #fetchPaymentLink} returns it
     */
    public Map<String, Object> cancelPaymentLink(String paymentLinkId, Map<String, Object> paymentGatewaySpecificData) {
        if (!StringUtils.hasText(paymentLinkId)) {
            throw new VacademyException("Cannot cancel Razorpay payment link: missing id");
        }
        try {
            RazorpayClient razorpayClient = createRazorpayClient(paymentGatewaySpecificData);
            PaymentLink link = razorpayClient.paymentLink.cancel(paymentLinkId);
            return summarizePaymentLink(link.toJson());
        } catch (RazorpayException e) {
            throw new VacademyException("Error cancelling Razorpay payment link " + paymentLinkId
                    + ": " + e.getMessage());
        }
    }

    /**
     * {@code GET /v1/payment_links/:id}: {@code status} (created | partially_paid | paid |
     * expired | cancelled), {@code amount}, {@code amountPaid}, {@code expireBy} and the
     * {@code payments} made on it (each {@code paymentId}, {@code status}, {@code amount}).
     * Used by the reconcile pass to recover a lost webhook.
     */
    public Map<String, Object> fetchPaymentLink(String paymentLinkId, Map<String, Object> paymentGatewaySpecificData) {
        if (!StringUtils.hasText(paymentLinkId)) {
            throw new VacademyException("Cannot fetch Razorpay payment link: missing id");
        }
        try {
            RazorpayClient razorpayClient = createRazorpayClient(paymentGatewaySpecificData);
            PaymentLink link = razorpayClient.paymentLink.fetch(paymentLinkId);
            return summarizePaymentLink(link.toJson());
        } catch (RazorpayException e) {
            throw new VacademyException("Error fetching Razorpay payment link " + paymentLinkId
                    + ": " + e.getMessage());
        }
    }

    /** Flattens a payment-link entity to the fields callers use; package-private for tests. */
    static Map<String, Object> summarizePaymentLink(JSONObject link) {
        Map<String, Object> out = new HashMap<>();
        out.put("id", link.optString("id", null));
        out.put("status", link.optString("status", null));
        out.put("referenceId", link.optString("reference_id", null));
        out.put("amount", link.has("amount") && !link.isNull("amount") ? link.getLong("amount") : null);
        out.put("amountPaid", link.has("amount_paid") && !link.isNull("amount_paid") ? link.getLong("amount_paid") : 0L);
        out.put("expireBy", link.has("expire_by") && !link.isNull("expire_by") ? link.getLong("expire_by") : null);
        java.util.List<Map<String, Object>> payments = new java.util.ArrayList<>();
        Object raw = link.opt("payments");
        if (raw instanceof org.json.JSONArray arr) {
            for (int i = 0; i < arr.length(); i++) {
                JSONObject p = arr.optJSONObject(i);
                if (p == null) continue;
                Map<String, Object> m = new HashMap<>();
                m.put("paymentId", p.optString("payment_id", null));
                m.put("status", p.optString("status", null));
                m.put("amount", p.has("amount") && !p.isNull("amount") ? p.getLong("amount") : null);
                payments.add(m);
            }
        }
        out.put("payments", payments);
        return out;
    }

    /** At most {@code max} notes (Razorpay allows 15), values cut to 255 characters. */
    static JSONObject limitedNotes(Map<String, String> notes, int max) {
        java.util.TreeMap<String, String> sorted = new java.util.TreeMap<>();
        for (Map.Entry<String, String> e : notes.entrySet()) {
            if (e.getKey() != null && e.getValue() != null) {
                sorted.put(e.getKey(), e.getValue());
            }
        }
        JSONObject out = new JSONObject();
        for (Map.Entry<String, String> e : sorted.entrySet()) {
            if (out.length() >= max) break;
            String v = e.getValue();
            out.put(e.getKey(), v.length() > 255 ? v.substring(0, 255) : v);
        }
        return out;
    }

    /**
     * A Razorpay entity as plain maps / lists. Walks {@code keys()} rather than calling
     * {@code toMap()}, which the android-json copy of org.json on the test classpath lacks.
     */
    static Map<String, Object> jsonToMap(JSONObject json) {
        Map<String, Object> out = new HashMap<>();
        if (json == null) return out;
        for (java.util.Iterator<String> it = json.keys(); it.hasNext(); ) {
            String k = it.next();
            out.put(k, jsonValue(json.opt(k)));
        }
        return out;
    }

    private static Object jsonValue(Object v) {
        if (v == null || v == JSONObject.NULL) return null;
        if (v instanceof JSONObject o) return jsonToMap(o);
        if (v instanceof org.json.JSONArray a) {
            java.util.List<Object> list = new java.util.ArrayList<>(a.length());
            for (int i = 0; i < a.length(); i++) list.add(jsonValue(a.opt(i)));
            return list;
        }
        return v;
    }

    private JSONObject buildRazorpayCustomerParams(UserDTO user, PaymentInitiationRequestDTO request) {
        JSONObject params = new JSONObject();
        params.put("name", user.getFullName());
        params.put("email", user.getEmail());
        params.put("fail_existing", "0");

        RazorpayRequestDTO razorpayRequest = request.getRazorpayRequest();
        if (razorpayRequest != null && StringUtils.hasText(razorpayRequest.getContact())) {
            params.put("contact", razorpayRequest.getContact());
        } else if (StringUtils.hasText(user.getMobileNumber())) {
            params.put("contact", user.getMobileNumber());
        }

        JSONObject notes = new JSONObject();
        notes.put("source", "vacademy_platform");
        notes.put("userId", user.getId());
        params.put("notes", notes);

        return params;
    }

    private JSONObject buildRazorpayCustomerParamsForUnknownUser(String email,
            PaymentInitiationRequestDTO request) {
        JSONObject params = new JSONObject();
        params.put("name", "Anonymous User");
        params.put("email", email);
        params.put("fail_existing", "0");

        RazorpayRequestDTO razorpayRequest = request.getRazorpayRequest();
        if (razorpayRequest != null && StringUtils.hasText(razorpayRequest.getContact())) {
            params.put("contact", razorpayRequest.getContact());
        }

        JSONObject notes = new JSONObject();
        notes.put("source", "vacademy_donation");
        params.put("notes", notes);

        return params;
    }

    private Map<String, Object> buildCustomerResponse(Customer razorpayCustomer) {
        RazorpayCustomerDTO dto = new RazorpayCustomerDTO();

        try {
            dto.setId(razorpayCustomer.has("id") ? razorpayCustomer.get("id").toString() : null);
            dto.setEntity(razorpayCustomer.has("entity") ? razorpayCustomer.get("entity").toString() : null);
            dto.setName(razorpayCustomer.has("name") && razorpayCustomer.get("name") != null
                    ? razorpayCustomer.get("name").toString()
                    : null);
            dto.setEmail(razorpayCustomer.has("email") && razorpayCustomer.get("email") != null
                    ? razorpayCustomer.get("email").toString()
                    : null);
            dto.setContact(razorpayCustomer.has("contact") && razorpayCustomer.get("contact") != null
                    ? razorpayCustomer.get("contact").toString()
                    : null);
            dto.setGstin(razorpayCustomer.has("gstin") && razorpayCustomer.get("gstin") != null
                    ? razorpayCustomer.get("gstin").toString()
                    : null);

            if (razorpayCustomer.has("created_at") && razorpayCustomer.get("created_at") != null) {
                try {
                    Object createdAtValue = razorpayCustomer.get("created_at");
                    if (createdAtValue instanceof Number) {
                        dto.setCreatedAt(((Number) createdAtValue).longValue());
                    } else {
                        dto.setCreatedAt(Long.parseLong(createdAtValue.toString()));
                    }
                } catch (NumberFormatException e) {
                    dto.setCreatedAt(null);
                }
            }

            if (razorpayCustomer.has("notes") && razorpayCustomer.get("notes") != null) {
                try {
                    Object notesObj = razorpayCustomer.get("notes");
                    if (notesObj instanceof org.json.JSONObject) {
                        Map<String, Object> notesMap = new HashMap<>();
                        org.json.JSONObject jsonNotes = (org.json.JSONObject) notesObj;
                        for (String key : jsonNotes.keySet()) {
                            notesMap.put(key, jsonNotes.get(key));
                        }
                        dto.setNotes(notesMap);
                    } else {
                        dto.setNotes(notesObj);
                    }
                } catch (Exception e) {
                    dto.setNotes(null);
                }
            } else {
                dto.setNotes(null);
            }

            Map<String, Object> response = new HashMap<>();
            response.put("customerId", razorpayCustomer.has("id") ? razorpayCustomer.get("id").toString() : null);
            response.put("customerData", dto);
            return response;

        } catch (Exception e) {
            Map<String, Object> response = new HashMap<>();
            response.put("customerId", razorpayCustomer.has("id") ? razorpayCustomer.get("id").toString() : "unknown");
            response.put("customerData", dto);
            return response;
        }
    }

    private void validateRequest(PaymentInitiationRequestDTO request) {
        if (request == null) {
            throw new VacademyException("Payment request cannot be null.");
        }
        if (request.getAmount() <= 0) {
            throw new VacademyException("Amount must be greater than zero.");
        }
        if (!StringUtils.hasText(request.getCurrency())) {
            throw new VacademyException("Currency must be specified.");
        }
        if (!StringUtils.hasText(request.getOrderId())) {
            throw new VacademyException("Order ID must be specified.");
        }
    }

    private void validateInput(UserDTO user, PaymentInitiationRequestDTO request) {
        if (request == null) {
            throw new VacademyException("PaymentInitiationRequestDTO cannot be null.");
        }
        if (!StringUtils.hasText(user.getEmail())) {
            throw new VacademyException("Email is required.");
        }
        if (!StringUtils.hasText(user.getFullName())) {
            throw new VacademyException("Full name is required.");
        }
    }

    private void validateInputForUnknownUser(String email, PaymentInitiationRequestDTO request) {
        if (request == null) {
            throw new VacademyException("PaymentInitiationRequestDTO cannot be null.");
        }
        if (!StringUtils.hasText(email)) {
            throw new VacademyException("Email is required for unknown user.");
        }
    }

    private String extractApiKey(Map<String, Object> data) {
        String apiKey = (String) data.get("apiKey");
        if (!StringUtils.hasText(apiKey)) {
            apiKey = (String) data.get("keyId");
        }
        if (!StringUtils.hasText(apiKey)) {
            throw new VacademyException("Razorpay API Key (apiKey) is missing.");
        }
        return apiKey;
    }

    private String extractPublishableKey(Map<String, Object> data) {
        String publishableKey = (String) data.get("publishableKey");
        if (!StringUtils.hasText(publishableKey)) {
            publishableKey = (String) data.get("keySecret");
        }
        if (!StringUtils.hasText(publishableKey)) {
            throw new VacademyException("Razorpay Key Secret (publishableKey) is missing.");
        }
        return publishableKey;
    }
}
