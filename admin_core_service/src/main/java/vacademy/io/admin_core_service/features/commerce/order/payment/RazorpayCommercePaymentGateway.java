package vacademy.io.admin_core_service.features.commerce.order.payment;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.institute.service.InstitutePaymentGatewayMappingService;
import vacademy.io.admin_core_service.features.payments.manager.PaymentServiceFactory;
import vacademy.io.admin_core_service.features.payments.manager.PaymentServiceStrategy;
import vacademy.io.admin_core_service.features.payments.manager.RazorpayPaymentManager;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.payment.currency.CurrencyGatewaySupport;
import vacademy.io.common.payment.currency.CurrencyRegistry;
import vacademy.io.common.payment.dto.PaymentInitiationRequestDTO;
import vacademy.io.common.payment.dto.PaymentResponseDTO;
import vacademy.io.common.payment.enums.PaymentGateway;
import vacademy.io.common.payment.enums.PaymentType;

import java.util.Date;
import java.util.Map;
import java.util.TreeMap;

/**
 * Razorpay for commerce orders.
 *
 * <p>It does what {@code PaymentService.makePayment} does for a course, outside that class's
 * transaction: the institute's own gateway credentials through
 * {@code findInstitutePaymentGatewaySpecifData}, the currency check, then the Razorpay
 * strategy of the platform, with {@code instituteId} set on the request (the webhook needs it
 * to find the institute's secret). The order
 * reference is the Razorpay receipt and the {@code orderId} note, as for every other payment
 * of the platform.
 *
 * <p>Each gateway order is written to {@code commerce_gateway_order}. That row, not a note, is
 * what later ties a payment to the commerce order and to the amount.
 *
 * <p>No credential is logged or put into an exception; the key id returned to the storefront
 * is the public one.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class RazorpayCommercePaymentGateway implements CommercePaymentGateway {

    /** Razorpay accepts at most 40 characters for a receipt. */
    static final int MAX_RECEIPT_LENGTH = 40;
    /** A Razorpay note value holds at most 256 characters. */
    static final int MAX_NOTE_LENGTH = 250;
    static final String VENDOR = PaymentGateway.RAZORPAY.name();

    private final InstitutePaymentGatewayMappingService institutePaymentGatewayMappingService;
    private final PaymentServiceFactory paymentServiceFactory;
    private final CommerceGatewayOrderRepository gatewayOrders;

    @Override
    public GatewayOrder createOrder(String instituteId, String commerceOrderId, long amountMinor, String currency,
                                    String receipt, Map<String, String> notes) {
        if (TransactionSynchronizationManager.isActualTransactionActive()) {
            // A gateway call inside the order transaction would keep stock, counter and order
            // locks for as long as Razorpay takes to answer.
            throw new IllegalStateException("The gateway order is created after the order transaction commits");
        }
        if (!StringUtils.hasText(instituteId) || !StringUtils.hasText(commerceOrderId)
                || !StringUtils.hasText(currency) || !StringUtils.hasText(receipt) || amountMinor <= 0) {
            throw new CommercePaymentGatewayException(CommercePaymentGatewayException.INVALID_REQUEST,
                    "Institute, order, amount, currency and receipt are needed for a gateway order");
        }
        if (receipt.length() > MAX_RECEIPT_LENGTH) {
            throw new CommercePaymentGatewayException(CommercePaymentGatewayException.INVALID_REQUEST,
                    "The receipt is longer than " + MAX_RECEIPT_LENGTH + " characters");
        }
        String isoCurrency = currency.trim().toUpperCase();

        // An attempt that is still open is given back: a repeated call for the same order and
        // amount does not leave a second gateway order behind.
        for (CommerceGatewayOrder earlier : gatewayOrders.findByCommerceOrderIdOrderByCreatedAtDesc(commerceOrderId)) {
            if (!VENDOR.equals(earlier.getVendor()) || !instituteId.equals(earlier.getInstituteId())) {
                continue;
            }
            if (CommerceGatewayOrder.STATUS_PAID.equals(earlier.getStatus())) {
                throw new CommercePaymentGatewayException(CommercePaymentGatewayException.INVALID_REQUEST,
                        "This order is already paid");
            }
            if (earlier.getAmountMinor() == amountMinor && isoCurrency.equals(earlier.getCurrency())
                    && receipt.equals(earlier.getReceipt())) {
                return view(earlier);
            }
        }

        Map<String, Object> gatewayData;
        try {
            gatewayData = institutePaymentGatewayMappingService.findInstitutePaymentGatewaySpecifData(VENDOR,
                    instituteId);
        } catch (RuntimeException e) {
            throw new CommercePaymentGatewayException(CommercePaymentGatewayException.NOT_CONFIGURED,
                    "Razorpay is not set up for this institute");
        }
        if (gatewayData == null || gatewayData.isEmpty()) {
            throw new CommercePaymentGatewayException(CommercePaymentGatewayException.NOT_CONFIGURED,
                    "Razorpay is not set up for this institute");
        }
        if (!CurrencyGatewaySupport.isSupported(PaymentGateway.RAZORPAY, isoCurrency)) {
            throw new CommercePaymentGatewayException(CommercePaymentGatewayException.CURRENCY_NOT_SUPPORTED,
                    "Currency " + isoCurrency + " is not supported by Razorpay");
        }

        PaymentInitiationRequestDTO request = new PaymentInitiationRequestDTO();
        request.setAmount(CurrencyRegistry.fromMinorUnits(amountMinor, isoCurrency));
        request.setCurrency(isoCurrency);
        request.setOrderId(receipt);
        request.setInstituteId(instituteId);
        request.setVendor(VENDOR);
        request.setPaymentType(PaymentType.INITIAL);
        request.setDescription(describe(commerceOrderId, notes));

        PaymentResponseDTO response;
        try {
            PaymentServiceStrategy strategy = paymentServiceFactory.getStrategy(PaymentGateway.RAZORPAY);
            response = strategy.initiatePayment(new UserDTO(), request, gatewayData);
        } catch (RuntimeException e) {
            // The message names the fault and is not passed on; any credential value that a
            // client library might echo in it is blanked before it is logged.
            log.warn("Razorpay order for commerce order {} of institute {} failed: {}", commerceOrderId,
                    instituteId, withoutCredentials(e.getMessage(), gatewayData));
            throw new CommercePaymentGatewayException(CommercePaymentGatewayException.UNAVAILABLE,
                    "The payment gateway did not create an order", e);
        }

        Map<String, Object> data = response == null ? null : response.getResponseData();
        String gatewayOrderId = data == null ? null : text(data.get("razorpayOrderId"));
        String keyId = data == null ? null : text(data.get("razorpayKeyId"));
        Long createdMinor = data == null ? null : number(data.get("amount"));
        if (gatewayOrderId == null || "unknown".equals(gatewayOrderId) || keyId == null) {
            log.warn("Razorpay answered without an order id for commerce order {}", commerceOrderId);
            throw new CommercePaymentGatewayException(CommercePaymentGatewayException.UNAVAILABLE,
                    "The payment gateway did not create an order");
        }
        if (createdMinor == null || createdMinor != amountMinor) {
            // Never hand the shopper an order for another amount than the order total.
            log.error("COMMERCE_ALERT Razorpay order {} for commerce order {} was created for {} instead of {}",
                    gatewayOrderId, commerceOrderId, createdMinor, amountMinor);
            throw new CommercePaymentGatewayException(CommercePaymentGatewayException.UNAVAILABLE,
                    "The payment gateway created an order for another amount");
        }

        CommerceGatewayOrder row = new CommerceGatewayOrder();
        row.setInstituteId(instituteId);
        row.setCommerceOrderId(commerceOrderId);
        row.setVendor(VENDOR);
        row.setGatewayOrderId(gatewayOrderId);
        row.setKeyId(keyId);
        row.setAmountMinor(amountMinor);
        row.setCurrency(isoCurrency);
        row.setReceipt(receipt);
        row.setStatus(CommerceGatewayOrder.STATUS_CREATED);
        row.setStatusAt(new Date());
        try {
            gatewayOrders.save(row);
        } catch (RuntimeException e) {
            // Without the row a payment on this gateway order cannot be tied to the order and
            // would be refused, so the order is not handed out.
            log.error("COMMERCE_ALERT Razorpay order {} for commerce order {} could not be recorded: {}",
                    gatewayOrderId, commerceOrderId, e.getMessage());
            throw new CommercePaymentGatewayException(CommercePaymentGatewayException.UNAVAILABLE,
                    "The gateway order could not be recorded", e);
        }
        log.info("Razorpay order {} created for commerce order {} of institute {}", gatewayOrderId,
                commerceOrderId, instituteId);
        return new GatewayOrder(VENDOR, gatewayOrderId, keyId, amountMinor, isoCurrency);
    }

    /** {@code message} with every value of the gateway credentials replaced by stars. */
    static String withoutCredentials(String message, Map<String, Object> gatewayData) {
        if (message == null || gatewayData == null) {
            return message;
        }
        String clean = message;
        for (Object value : gatewayData.values()) {
            if (value instanceof String secret && secret.length() >= 4) {
                clean = clean.replace(secret, "***");
            }
        }
        return clean;
    }

    private static GatewayOrder view(CommerceGatewayOrder row) {
        return new GatewayOrder(row.getVendor(), row.getGatewayOrderId(), row.getKeyId(), row.getAmountMinor(),
                row.getCurrency());
    }

    /**
     * The one free note of a platform Razorpay order ({@code description}): the commerce order
     * id first, then the caller's notes in key order. It is for the gateway dashboard; nothing
     * reads it back.
     */
    static String describe(String commerceOrderId, Map<String, String> notes) {
        // The prefix is also what tells the Razorpay manager to ask for automatic capture.
        StringBuilder text = new StringBuilder(RazorpayPaymentManager.COMMERCE_ORDER_DESCRIPTION_PREFIX)
                .append(commerceOrderId);
        if (notes != null) {
            Map<String, String> sorted = new TreeMap<>();
            for (Map.Entry<String, String> note : notes.entrySet()) {
                if (StringUtils.hasText(note.getKey()) && StringUtils.hasText(note.getValue())
                        && !"commerce_order_id".equals(note.getKey().trim())) {
                    sorted.put(note.getKey().trim(), note.getValue().trim());
                }
            }
            for (Map.Entry<String, String> note : sorted.entrySet()) {
                text.append("; ").append(note.getKey()).append('=').append(note.getValue());
            }
        }
        return text.length() <= MAX_NOTE_LENGTH ? text.toString() : text.substring(0, MAX_NOTE_LENGTH);
    }

    private static String text(Object value) {
        if (value == null) {
            return null;
        }
        String s = value.toString().trim();
        return s.isEmpty() ? null : s;
    }

    private static Long number(Object value) {
        if (value instanceof Number n) {
            return n.longValue();
        }
        try {
            return value == null ? null : Long.valueOf(value.toString().trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
