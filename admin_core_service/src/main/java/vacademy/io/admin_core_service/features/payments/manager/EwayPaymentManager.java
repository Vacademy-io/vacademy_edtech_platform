package vacademy.io.admin_core_service.features.payments.manager;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;
import vacademy.io.admin_core_service.features.common.util.JsonUtil;
import vacademy.io.admin_core_service.features.payments.service.WebHookService;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentLogService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.payment.currency.CurrencyRegistry;
import vacademy.io.common.payment.dto.*;
import vacademy.io.common.payment.enums.PaymentGateway;
import vacademy.io.common.payment.enums.PaymentStatusEnum;
import vacademy.io.common.payment.enums.PaymentType;

import java.time.Instant;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;

@Service
public class EwayPaymentManager implements PaymentServiceStrategy {

    private static final Logger LOGGER = LoggerFactory.getLogger(EwayPaymentManager.class);
    private final WebClient webClient;
    private final ObjectMapper jsonMapper = new ObjectMapper();
    private final WebHookService webHookService;
    private final PaymentLogService paymentLogService;

    public EwayPaymentManager(WebClient.Builder webClientBuilder,WebHookService webHookService,PaymentLogService paymentLogService) {
        this.webClient = webClientBuilder.build();
        this.jsonMapper.setSerializationInclusion(JsonInclude.Include.NON_NULL);
        this.webHookService = webHookService;
        this.paymentLogService = paymentLogService;
    }

    // ===================================================================================
    // Overridden Methods from PaymentServiceStrategy
    // ===================================================================================

    @Override
    public PaymentResponseDTO initiatePayment(UserDTO user, PaymentInitiationRequestDTO request,
                                              Map<String, Object> paymentGatewaySpecificData) {

        EwayApiResponseDTO.Transaction transaction;
        EwayRequestDTO ewayRequest = request.getEwayRequest();

        if (StringUtils.hasText(ewayRequest.getCustomerId())) {
            LOGGER.info("Performing a Token Payment for customerId: {}", ewayRequest.getCustomerId());
            transaction = createTokenTransactionPayload(
                    ewayRequest.getCustomerId(),
                    (int) CurrencyRegistry.toMinorUnits(request.getAmount(), request.getCurrency()),
                    ewayRequest.getCvn(),
                    request.getCurrency()
            );
        } else {
            LOGGER.info("Performing a new card payment.");
            String fullName = (user != null && user.getFullName() != null) ? user.getFullName() : "Anonymous User";
            String email = request.getEmail() != null ? request.getEmail() : "noemail@unknown.com";

            transaction = createCardTransactionPayload(
                    fullName,
                    email,
                    ewayRequest,
                    (int) CurrencyRegistry.toMinorUnits(request.getAmount(), request.getCurrency()),
                    "ProcessPayment",
                    request.getCurrency()
            );
        }        EwayApiResponseDTO response = callEwayTransactionApi(transaction, paymentGatewaySpecificData);


        PaymentResponseDTO paymentResponseDTO = buildPaymentResponseFromIntent(response, request.getOrderId());

        createWebHook(request.getInstituteId(), paymentResponseDTO, request);

        return paymentResponseDTO;
    }

    @Override
    public Map<String, Object> createCustomer(UserDTO user, PaymentInitiationRequestDTO request,
                                              Map<String, Object> paymentGatewaySpecificData) {

        EwayApiResponseDTO.Transaction transaction = createCardTransactionPayload(user.getFullName(), user.getEmail(), request.getEwayRequest(), 0, "CreateTokenCustomer", request.getCurrency());
        EwayApiResponseDTO response = callEwayTransactionApi(transaction, paymentGatewaySpecificData);

        if (response.Errors != null || !StringUtils.hasText(response.Customer.TokenCustomerID)) {
            throw new VacademyException("Failed to create e-way customer: " + response.Errors);
        }

        Map<String, Object> responseMap = new HashMap<>();
        responseMap.put("customerId", response.Customer.TokenCustomerID);
        responseMap.put("customerData", response);
        return responseMap;
    }

    @Override
    public Map<String, Object> createCustomerForUnknownUser(String email, PaymentInitiationRequestDTO request,
                                                            Map<String, Object> paymentGatewaySpecificData) {

        EwayApiResponseDTO.Transaction transaction = createCardTransactionPayload("Anonymous User", email, request.getEwayRequest(), 0, "CreateTokenCustomer", request.getCurrency());
        EwayApiResponseDTO
                response = callEwayTransactionApi(transaction, paymentGatewaySpecificData);

        if (response.Errors != null || !StringUtils.hasText(response.Customer.TokenCustomerID)) {
            throw new VacademyException("Failed to create e-way customer for unknown user: " + response.Errors);
        }

        Map<String, Object> responseMap = new HashMap<>();
        responseMap.put("customerId", response.Customer.TokenCustomerID);
        responseMap.put("customerData", response);
        return responseMap;
    }

    @Override
    public Map<String, Object> findCustomerByEmail(String email, Map<String, Object> paymentGatewaySpecificData) {
        return null;
    }


    // ===================================================================================
    // Public Methods specific to EwayPaymentManager
    // ===================================================================================

    /**
     * Off-session recurring charge for eWay. The saved TokenCustomerID is
     * charged with {@code TransactionType="Recurring"} and NO CVN — eWay allows
     * unattended stored-card recurring charges without CVN (a manual renewal
     * would supply one; the scheduler cannot). Delegates to the existing
     * {@link #chargeToken} path. The mandate's {@code max_amount} is enforced
     * app-side before hitting eWay (eWay card-on-file has no native limit).
     */
    @Override
    public PaymentResponseDTO chargeRecurring(vacademy.io.admin_core_service.features.user_subscription.dto.MandateInfo mandate,
                                              PaymentInitiationRequestDTO request,
                                              Map<String, Object> paymentGatewaySpecificData) {
        if (mandate == null || !StringUtils.hasText(mandate.getCustomerId())) {
            throw new VacademyException("eWay recurring charge requires a saved TokenCustomerID mandate");
        }
        if (mandate.getMaxAmount() != null && request.getAmount() > mandate.getMaxAmount()) {
            throw new VacademyException("eWay recurring amount " + request.getAmount()
                    + " exceeds mandate max_amount " + mandate.getMaxAmount());
        }
        LOGGER.info("eWay recurring charge: tokenCustomerId={}, amount={}", mandate.getCustomerId(), request.getAmount());
        return chargeToken(mandate.getCustomerId(), request.getAmount(), null,
                request.getCurrency(), paymentGatewaySpecificData);
    }

    /**
     * Charges a stored TokenCustomerID. {@code currencyCode} must be the plan's currency:
     * passing null made eWay fall back to the account's default currency AND scaled the
     * amount with the default 2-decimal exponent, so a GBP plan on an AUD account was
     * silently charged in AUD (Vet Education has both).
     */
    public PaymentResponseDTO chargeToken(String tokenCustomerId, double amount, String cvn,
                                          String currencyCode, Map<String, Object> paymentGatewaySpecificData) {
        EwayApiResponseDTO.Transaction transaction = createTokenTransactionPayload(
                tokenCustomerId,
                (int) CurrencyRegistry.toMinorUnits(amount, currencyCode),
                cvn,
                currencyCode
        );

        EwayApiResponseDTO response = callEwayTransactionApi(transaction, paymentGatewaySpecificData);

        if (response.Errors != null || !response.TransactionStatus) {
            throw new VacademyException("e-way token payment failed: " + response.Errors);
        }

        PaymentResponseDTO paymentResponse = new PaymentResponseDTO();
        paymentResponse.setResponseData(Map.of(
                "transactionId", response.TransactionID,
                "status", "succeeded"
        ));
        return paymentResponse;
    }

    // ===================================================================================
    // Responsive Shared Page (hosted checkout)
    // ===================================================================================

    /**
     * Reserves an eWay Responsive Shared Page session and returns the hosted URL to send the
     * learner to.
     *
     * <p>Different endpoint, same account: the Direct calls above post a card we collected to
     * {@code /Transaction}, whereas this posts only the ORDER to
     * {@code /AccessCodesShared} and lets eWay collect the card on its own page. Nothing
     * is charged here -- eWay charges when the learner submits, and the outcome is read back
     * with {@link #getSharedAccessCodeResult(String, Map)} after the redirect.
     *
     * @param redirectUrl where eWay returns the browser; eWay appends {@code ?AccessCode=...}
     * @param cancelUrl   where "cancel" on the hosted page returns the browser
     */
    public EwaySharedPageResponseDTO createSharedAccessCode(PaymentInitiationRequestDTO request,
                                                            UserDTO user,
                                                            String redirectUrl,
                                                            String cancelUrl,
                                                            Map<String, Object> paymentGatewaySpecificData) {
        EwayApiResponseDTO.Customer customer = new EwayApiResponseDTO.Customer();
        if (user != null) {
            customer.FirstName = firstName(user.getFullName());
            customer.LastName = lastName(user.getFullName());
            customer.Email = user.getEmail();
        }
        if (!StringUtils.hasText(customer.Email)) {
            customer.Email = request.getEmail();
        }

        EwayApiResponseDTO.PaymentDetails payment = new EwayApiResponseDTO.PaymentDetails();
        payment.TotalAmount = (int) CurrencyRegistry.toMinorUnits(request.getAmount(), request.getCurrency());
        payment.CurrencyCode = request.getCurrency();
        payment.InvoiceDescription = request.getDescription();
        // Our payment_log id, so an eWay-side transaction can always be traced back to the
        // order it belongs to even if the learner never returns to the redirect URL.
        payment.InvoiceReference = request.getOrderId();

        EwayApiResponseDTO.Transaction transaction = new EwayApiResponseDTO.Transaction();
        transaction.Customer = customer;
        transaction.Payment = payment;
        transaction.Method = "ProcessPayment";
        transaction.TransactionType = "Purchase";
        transaction.RedirectUrl = redirectUrl;
        transaction.CancelUrl = cancelUrl;

        String apiKey = (String) paymentGatewaySpecificData.get("apiKey");
        String password = (String) paymentGatewaySpecificData.get("password");
        String baseUrl = (String) paymentGatewaySpecificData.get("baseUrl");
        if (!StringUtils.hasText(apiKey) || !StringUtils.hasText(password) || !StringUtils.hasText(baseUrl)) {
            throw new VacademyException("Eway API credentials (apiKey, password, baseUrl) are missing.");
        }
        String authHeader = "Basic " + Base64.getEncoder()
                .encodeToString((apiKey + ":" + password).getBytes());

        EwaySharedPageResponseDTO response = webClient.post()
                // REST path. "CreateAccessCodeShared" is the legacy RPC name and only resolves with a
                // ".json" suffix -- without it eWay answers 404 and pay-to-continue fails.
                .uri(baseUrl + "/AccessCodesShared")
                .header("Authorization", authHeader)
                .header("Content-Type", "application/json")
                .bodyValue(transaction)
                .retrieve()
                .onStatus(status -> status.isError(),
                        resp -> Mono.error(new VacademyException("Eway shared-page error: " + resp.statusCode())))
                .bodyToMono(EwaySharedPageResponseDTO.class)
                .block();

        if (response == null || StringUtils.hasText(response.Errors)
                || !StringUtils.hasText(response.SharedPaymentUrl)) {
            throw new VacademyException("eWay could not open a hosted checkout: "
                    + (response == null ? "no response" : response.Errors));
        }
        LOGGER.info("eWay shared page opened for order {} (accessCode {})",
                request.getOrderId(), response.AccessCode);
        return response;
    }

    /**
     * Reads back what happened on the hosted page. Called after eWay redirects the learner to
     * our RedirectUrl, and safe to call again later for an order whose learner never came back.
     */
    public EwayApiResponseDTO getSharedAccessCodeResult(String accessCode,
                                                        Map<String, Object> paymentGatewaySpecificData) {
        String apiKey = (String) paymentGatewaySpecificData.get("apiKey");
        String password = (String) paymentGatewaySpecificData.get("password");
        String baseUrl = (String) paymentGatewaySpecificData.get("baseUrl");
        String authHeader = "Basic " + Base64.getEncoder()
                .encodeToString((apiKey + ":" + password).getBytes());

        return webClient.get()
                .uri(baseUrl + "/AccessCode/" + accessCode)
                .header("Authorization", authHeader)
                .retrieve()
                .onStatus(status -> status.isError(),
                        resp -> Mono.error(new VacademyException("Eway access-code lookup error: " + resp.statusCode())))
                .bodyToMono(EwayApiResponseDTO.class)
                .block();
    }

    private String firstName(String fullName) {
        if (!StringUtils.hasText(fullName)) {
            return "Member";
        }
        String[] parts = fullName.trim().split("\\s+");
        return parts[0];
    }

    private String lastName(String fullName) {
        if (!StringUtils.hasText(fullName)) {
            return "";
        }
        String[] parts = fullName.trim().split("\\s+");
        return parts.length > 1 ? parts[parts.length - 1] : "";
    }

    /**
     * Replaces the card stored against an existing eWay Token Customer
     * (Method="UpdateTokenCustomer" on the same Transaction endpoint). The
     * TokenCustomerID is unchanged, so renewal charges pick up the new card
     * with no local snapshot rewrite. eWay requires the customer's name on
     * update, so identity fields are re-sent from the stored customer data.
     * Card number / CVN arrive client-side encrypted (eCrypt), same as
     * CreateTokenCustomer.
     */
    public EwayApiResponseDTO updateTokenCustomer(String tokenCustomerId,
                                                  EwayRequestDTO cardRequest,
                                                  EwayApiResponseDTO.Customer storedCustomer,
                                                  Map<String, Object> paymentGatewaySpecificData) {
        EwayApiResponseDTO.Customer customer = new EwayApiResponseDTO.Customer();
        customer.TokenCustomerID = tokenCustomerId;
        if (storedCustomer != null) {
            customer.FirstName = storedCustomer.FirstName;
            customer.LastName = storedCustomer.LastName;
            customer.Email = storedCustomer.Email;
            customer.Country = storedCustomer.Country;
        }
        if (cardRequest != null && StringUtils.hasText(cardRequest.getCountryCode())) {
            customer.Country = cardRequest.getCountryCode();
        }

        if (cardRequest != null && StringUtils.hasText(cardRequest.getCardNumber())) {
            EwayApiResponseDTO.CardDetails cardDetails = new EwayApiResponseDTO.CardDetails();
            cardDetails.Name = cardRequest.getCardName();
            cardDetails.Number = cardRequest.getCardNumber();
            cardDetails.ExpiryMonth = cardRequest.getExpiryMonth();
            cardDetails.ExpiryYear = cardRequest.getExpiryYear();
            cardDetails.CVN = cardRequest.getCvn();
            customer.CardDetails = cardDetails;
        }

        EwayApiResponseDTO.Transaction transaction = new EwayApiResponseDTO.Transaction();
        transaction.Customer = customer;
        transaction.Method = "UpdateTokenCustomer";
        transaction.TransactionType = "Purchase";

        EwayApiResponseDTO response = callEwayTransactionApi(transaction, paymentGatewaySpecificData);

        if (response == null) {
            throw new VacademyException("No response from e-way while updating token customer");
        }
        if (StringUtils.hasText(response.Errors)) {
            throw new VacademyException("e-way token customer update failed: " + response.Errors);
        }
        if (response.Customer == null || !StringUtils.hasText(response.Customer.TokenCustomerID)) {
            throw new VacademyException("e-way token customer update returned no customer");
        }
        return response;
    }

    /**
     * Updates only the identity/billing fields on a Token Customer, leaving
     * the stored card untouched (CardDetails omitted from the payload).
     */
    public EwayApiResponseDTO updateTokenCustomerBillingDetails(String tokenCustomerId,
                                                                String firstName, String lastName,
                                                                String email, String country,
                                                                Map<String, Object> paymentGatewaySpecificData) {
        EwayApiResponseDTO.Customer customer = new EwayApiResponseDTO.Customer();
        customer.TokenCustomerID = tokenCustomerId;
        customer.FirstName = firstName;
        customer.LastName = lastName;
        customer.Email = email;
        customer.Country = country;

        EwayApiResponseDTO.Transaction transaction = new EwayApiResponseDTO.Transaction();
        transaction.Customer = customer;
        transaction.Method = "UpdateTokenCustomer";
        transaction.TransactionType = "Purchase";

        EwayApiResponseDTO response = callEwayTransactionApi(transaction, paymentGatewaySpecificData);

        if (response == null) {
            throw new VacademyException("No response from e-way while updating token customer billing details");
        }
        if (StringUtils.hasText(response.Errors)) {
            throw new VacademyException("e-way billing details update failed: " + response.Errors);
        }
        return response;
    }

    public EwayTransaction getTransactionById(String transactionId, Map<String, Object> paymentGatewaySpecificData) {
        LOGGER.info("Fetching Eway transaction details for transactionId: {}", transactionId);

        String apiKey = (String) paymentGatewaySpecificData.get("apiKey");
        String password = (String) paymentGatewaySpecificData.get("password");
        String baseUrl = (String) paymentGatewaySpecificData.get("baseUrl");

        if (!StringUtils.hasText(apiKey) || !StringUtils.hasText(password) || !StringUtils.hasText(baseUrl)) {
            throw new VacademyException("Eway API credentials (apiKey, password, baseUrl) are missing.");
        }

        String authHeader = "Basic " + Base64.getEncoder().encodeToString((apiKey + ":" + password).getBytes());

        String str = webClient.get()
                .uri(baseUrl + "/Transaction/" + transactionId)
                .header("Authorization", authHeader)
                .header("Content-Type", "application/json")
                .retrieve()
                .onStatus(status -> status.isError(), resp -> {
                    LOGGER.error("Eway API error while fetching transaction {}: {}", transactionId, resp.statusCode());
                    return Mono.error(new VacademyException("Eway API error: " + resp.statusCode()));
                })
                .bodyToMono(String.class)
                .block();
        EwayTransactionQueryResponse response = JsonUtil.fromJson(str, EwayTransactionQueryResponse.class);
        if (response == null) {
            throw new VacademyException("No response from Eway API for transactionId: " + transactionId);
        }

        if (StringUtils.hasText(response.getErrors())) {
            throw new VacademyException("Eway API returned errors for transactionId " + transactionId + ": " + response.getErrors());
        }

        if (response.getTransactions() == null || response.getTransactions().isEmpty()) {
            LOGGER.warn("No transaction found for transactionId: {}", transactionId);
            return null;
        }

        return response.getTransactions().get(0);
    }

    // ===================================================================================
    // Private Helper Methods
    // ===================================================================================

    private EwayApiResponseDTO callEwayTransactionApi(EwayApiResponseDTO.Transaction transaction, Map<String, Object> paymentGatewaySpecificData) {
        String apiKey = (String) paymentGatewaySpecificData.get("apiKey");
        String password = (String) paymentGatewaySpecificData.get("password");
        String baseUrl = (String) paymentGatewaySpecificData.get("baseUrl");

        String authHeader = "Basic " + Base64.getEncoder().encodeToString((apiKey + ":" + password).getBytes());

        return webClient.post()
                .uri(baseUrl + "/Transaction")
                .header("Authorization", authHeader)
                .header("Content-Type", "application/json")
                .bodyValue(transaction)
                .retrieve()
                .onStatus(status -> status.isError(), resp -> Mono.error(new VacademyException("Eway API error: " + resp.statusCode())))
                .bodyToMono(EwayApiResponseDTO.class)
                .block();
    }

    private EwayApiResponseDTO.Transaction createTokenTransactionPayload(String customerId, int amount, String cvn, String currencyCode) {
        EwayApiResponseDTO.Customer customer = new EwayApiResponseDTO.Customer();
        customer.TokenCustomerID = customerId;
        customer.CardDetails = new EwayApiResponseDTO.CardDetails();
        customer.CardDetails.CVN = cvn;

        EwayApiResponseDTO.PaymentDetails payment = new EwayApiResponseDTO.PaymentDetails();
        payment.TotalAmount = amount;
        payment.CurrencyCode = currencyCode;

        EwayApiResponseDTO.Transaction transaction = new EwayApiResponseDTO.Transaction();
        transaction.Customer = customer;
        transaction.Payment = payment;
        transaction.Method = "ProcessPayment";
        transaction.TransactionType = "Recurring";

        return transaction;
    }

    /**
     * eWay rejects a transaction whose Customer.LastName is empty, and learners
     * enrolling through an invite often supply only a first name. Duplicating the
     * single token ("Jane" -> "Jane Jane") keeps the checkout going instead of
     * failing the payment; a name that already has a surname is left untouched.
     */
    private String ensureLastName(String fullName) {
        if (!StringUtils.hasText(fullName)) {
            return fullName;
        }
        String trimmed = fullName.trim();
        return trimmed.split("\\s+").length == 1 ? trimmed + " " + trimmed : trimmed;
    }

    private EwayApiResponseDTO.Transaction createCardTransactionPayload(String fullName, String email, EwayRequestDTO ewayRequest, int amount, String method, String currencyCode) {
        fullName = ensureLastName(fullName);

        EwayApiResponseDTO.CardDetails cardDetails = new EwayApiResponseDTO.CardDetails();
        cardDetails.Name = fullName;
        cardDetails.Number = ewayRequest.getCardNumber();
        cardDetails.ExpiryMonth = ewayRequest.getExpiryMonth();
        cardDetails.ExpiryYear = ewayRequest.getExpiryYear();
        cardDetails.CVN = ewayRequest.getCvn();

        EwayApiResponseDTO.Customer customer = new EwayApiResponseDTO.Customer();
        customer.CardDetails = cardDetails;
        customer.Email = email;
        customer.Country = ewayRequest.getCountryCode();
        String[] nameParts = StringUtils.hasText(fullName) ? fullName.split("\\s+", 2) : new String[]{""};
        customer.FirstName = nameParts[0];
        customer.LastName = nameParts.length > 1 ? nameParts[1] : "";

        EwayApiResponseDTO.Transaction transaction = new EwayApiResponseDTO.Transaction();
        transaction.Customer = customer;
        transaction.Method = method;
        transaction.TransactionType = "Purchase";

        if ("ProcessPayment".equals(method)) {
            EwayApiResponseDTO.PaymentDetails paymentDetails = new EwayApiResponseDTO.PaymentDetails();
            paymentDetails.TotalAmount = amount;
            paymentDetails.CurrencyCode = currencyCode;
            transaction.Payment = paymentDetails;
        }

        return transaction;
    }

    private PaymentResponseDTO buildPaymentResponseFromIntent(EwayApiResponseDTO responseDTO, String orderId) {
        if (responseDTO == null) {
            throw new IllegalArgumentException("EwayApiResponseDTO cannot be null");
        }

        Map<String, Object> responseData = new HashMap<>();

        double amount = 0;
        if (responseDTO.getPayment() != null && responseDTO.getPayment().getTotalAmount() != 0) {
            // eWay returns the amount in minor units; decode with the currency's exponent.
            amount = CurrencyRegistry.fromMinorUnits(
                    responseDTO.getPayment().getTotalAmount(),
                    responseDTO.getPayment().getCurrencyCode());
        }

        responseData.put("transactionId", responseDTO.getTransactionID());
        responseData.put("status", responseDTO.getTransactionStatus());
        responseData.put("amount", amount);
        responseData.put("currency", responseDTO.getPayment() != null ? responseDTO.getPayment().getCurrencyCode() : null);
        responseData.put("created", Instant.now().getEpochSecond());
        PaymentStatusEnum paymentStatus;
        if ("00".equalsIgnoreCase(responseDTO.getResponseCode()) && Boolean.TRUE.equals(responseDTO.getTransactionStatus())) {
            paymentStatus = PaymentStatusEnum.PAID;
        } else if (responseDTO.getResponseCode() == null) {
            paymentStatus = PaymentStatusEnum.PAYMENT_PENDING;
        } else {
            paymentStatus = PaymentStatusEnum.FAILED;
        }

        responseData.put("paymentStatus", paymentStatus.name());

        PaymentResponseDTO dto = new PaymentResponseDTO();
        dto.setResponseData(responseData);
        dto.setOrderId(orderId);

        return dto;
    }

    private void createWebHook(String instituteId, PaymentResponseDTO paymentResponseDTO, PaymentInitiationRequestDTO request){
        EwayWebHookDTO eWayWebHookDTO = new EwayWebHookDTO();
        eWayWebHookDTO.setInstituteId(instituteId);
        eWayWebHookDTO.setPaymentResponse(paymentResponseDTO);
        eWayWebHookDTO.setPaymentType(request.getPaymentType() != null ? 
            request.getPaymentType().name() : PaymentType.INITIAL.name());
        webHookService.saveWebhook(PaymentGateway.EWAY.name(),JsonUtil.toJson(eWayWebHookDTO),paymentResponseDTO.getOrderId());
    }
}