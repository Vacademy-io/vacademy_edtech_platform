package vacademy.io.admin_core_service.features.payments.service;

import jakarta.transaction.Transactional;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import lombok.extern.slf4j.Slf4j;
import vacademy.io.admin_core_service.features.regional_pricing.service.RegionalPriceLock;
import vacademy.io.admin_core_service.features.common.util.JsonUtil;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.institute.service.InstitutePaymentGatewayMappingService;
import vacademy.io.admin_core_service.features.learner_payment_option_operation.service.PaymentGatewaySpecificPaymentDetailService;
import vacademy.io.admin_core_service.features.payments.manager.PaymentServiceFactory;
import vacademy.io.admin_core_service.features.payments.manager.PaymentServiceStrategy;
import vacademy.io.admin_core_service.features.payments.manager.PhonePePaymentManager;
import vacademy.io.admin_core_service.features.user_subscription.entity.AppliedCouponDiscount;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLogLineItem;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserInstitutePaymentGatewayMapping;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.enums.PaymentLogStatusEnum;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentLogLineItemRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentLogRepository;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentLogService;
import vacademy.io.admin_core_service.features.user_subscription.service.coupon.AdminDiscountService;
import vacademy.io.admin_core_service.features.user_subscription.service.coupon.CouponDiscountUtil;
import vacademy.io.admin_core_service.features.user_subscription.service.UserInstitutePaymentGatewayMappingService;
import vacademy.io.admin_core_service.features.user_subscription.service.UserPlanService;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.dto.learner.LearnerPackageSessionsEnrollDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.payment.dto.PaymentInitiationRequestDTO;
import vacademy.io.common.payment.dto.PaymentResponseDTO;
import vacademy.io.common.payment.dto.PhonePeStatusResponseDTO;
import vacademy.io.common.payment.currency.CurrencyGatewaySupport;
import vacademy.io.common.payment.enums.PaymentGateway;
import vacademy.io.common.payment.enums.PaymentStatusEnum;
import vacademy.io.common.exceptions.VacademyException;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Slf4j
@Service
@Transactional
public class PaymentService {

        @Autowired
        private PaymentServiceFactory paymentServiceFactory;

        @Autowired
        private UserInstitutePaymentGatewayMappingService userInstitutePaymentGatewayMappingService;

        @Autowired
        private InstitutePaymentGatewayMappingService institutePaymentGatewayMappingService;

        @Autowired
        private PaymentLogService paymentLogService;

        @Autowired
        private PaymentGatewaySpecificPaymentDetailService paymentGatewaySpecificPaymentDetailService;

        @Autowired
        private UserPlanService userPlanService;

        @Autowired
        private AuthService authService;

        @Autowired
        private PaymentLogRepository paymentLogRepository;

        @Autowired
        private PaymentLogLineItemRepository paymentLogLineItemRepository;

        /**
         * Persist a PaymentLogLineItem for the coupon discount when the
         * UserPlan was created with one. Without this row, InvoiceService
         * has no way to render the "Coupon SAVE20 -₹50" line — the invoice
         * would show full price - 0 discount = full price, contradicting
         * what the gateway actually captured.
         *
         * Idempotent: skips if a line item with the same source_id already
         * exists on any PaymentLog of this UserPlan. Required because
         * LearnerInstallmentPaymentService.payInstallments re-invokes
         * handlePayment for subsequent installments on a UserPlan where
         * userPlan.appliedCouponDiscount is still set — without the guard
         * each installment would record a duplicate discount line, and the
         * invoice would show plan_price − (N × discount).
         */
        private void recordCouponLineItemIfApplicable(String paymentLogId, UserPlan userPlan) {
                PaymentPlan plan = userPlan != null ? userPlan.getPaymentPlan() : null;
                recordFirstPaymentDiscountLineItem(paymentLogId, userPlan,
                                plan != null ? RegionalPriceLock.listPrice(userPlan) : null);
        }

        /**
         * First charge of a UserPlan: records the attached discount (coupon or admin)
         * as a negative line item and counts it as one discounted cycle. Public so the
         * admin manual-payment paths (manual enroll, bulk assign) record the same line
         * the gateway paths do.
         *
         * @param grossAmount the pre-discount amount the discount was computed on
         */
        public void recordFirstPaymentDiscountLineItem(String paymentLogId, UserPlan userPlan, Double grossAmount) {
                if (userPlan == null || paymentLogId == null || grossAmount == null) {
                        return;
                }
                AppliedCouponDiscount discount = userPlan.getAppliedCouponDiscount();
                if (discount == null) {
                        return;
                }
                if (paymentLogLineItemRepository
                                .existsByPaymentLog_UserPlan_IdAndSourceId(userPlan.getId(), discount.getId())) {
                        log.debug("Discount line item already recorded for userPlan={} discount={} — skipping",
                                        userPlan.getId(), discount.getId());
                        return;
                }
                // Cycles only matter for admin discounts (renewals never apply coupons), so a
                // coupon enrollment is left exactly as it was — no extra counter write.
                if (saveDiscountLineItem(paymentLogId, discount, grossAmount, RegionalPriceLock.scale(userPlan))
                                && AdminDiscountService.SOURCE_ADMIN.equals(discount.getDiscountSource())) {
                        markDiscountedCycle(userPlan);
                }
        }

        /**
         * Renewal charge: records the discount on THIS payment log (each renewal is its
         * own invoice). The cycle is counted when the renewal is confirmed PAID, see
         * RenewalPaymentService.
         */
        public void recordRenewalDiscountLineItem(String paymentLogId, AppliedCouponDiscount discount,
                        double grossAmount, UserPlan userPlan) {
                if (paymentLogId == null || discount == null) {
                        return;
                }
                if (paymentLogLineItemRepository.existsByPaymentLogIdAndSourceId(paymentLogId, discount.getId())) {
                        return;
                }
                saveDiscountLineItem(paymentLogId, discount, grossAmount, RegionalPriceLock.scale(userPlan));
        }

        /** One more charge reduced by the plan's discount; persisted with the plan's next save. */
        public void markDiscountedCycle(UserPlan userPlan) {
                int used = userPlan.getDiscountCyclesApplied() != null ? userPlan.getDiscountCyclesApplied() : 0;
                userPlan.setDiscountCyclesApplied(used + 1);
                userPlanService.save(userPlan);
        }

        /**
         * @param scale regional ÷ base price of the UserPlan (1 when not regionally priced):
         *              discount amounts are written in the base currency, the gross is not.
         */
        private boolean saveDiscountLineItem(String paymentLogId, AppliedCouponDiscount discount, double grossAmount,
                        double scale) {
                boolean admin = AdminDiscountService.SOURCE_ADMIN.equals(discount.getDiscountSource());
                double computed = CouponDiscountUtil.computeDiscount(discount, grossAmount / scale) * scale;
                // Coupons: same figure as before. Admin discounts: never more than the price.
                double amount = admin ? Math.min(computed, grossAmount) : computed;
                if (amount <= 0.0) {
                        return false;
                }
                return paymentLogRepository.findById(paymentLogId).map(paymentLog -> {
                        PaymentLogLineItem item = new PaymentLogLineItem();
                        item.setPaymentLog(paymentLog);
                        // Coupon rows: both fields contain "COUPON" so InvoiceService picks the
                        // row up in calculateDiscountAmount AND resolves the code via
                        // buildDiscountDescription. Admin rows: type contains "DISCOUNT",
                        // which calculateDiscountAmount and buildLineItems also pick up.
                        item.setType(admin ? "ADMIN_DISCOUNT" : "COUPON_DISCOUNT");
                        item.setSource(admin ? "ADMIN_DISCOUNT" : "COUPON_CODE");
                        item.setSourceId(discount.getId());
                        // Stored as negative — calculateDiscountAmount's "< 0" branch is the
                        // canonical convention for this column.
                        item.setAmount(-(Math.round(amount * 100.0) / 100.0));
                        paymentLogLineItemRepository.save(item);
                        log.info("Recorded {} line item {} for paymentLog={} discount={} amount={}",
                                        item.getType(), item.getId(), paymentLogId, discount.getId(), amount);
                        return true;
                }).orElse(false);
        }

        /**
         * Handles payment for learner package enrollment with EnrollInvite.
         */
        public PaymentResponseDTO handlePayment(UserDTO user,
                        LearnerPackageSessionsEnrollDTO enrollDTO,
                        String instituteId,
                        EnrollInvite enrollInvite,
                        UserPlan userPlan) {

                PaymentInitiationRequestDTO request = enrollDTO.getPaymentInitiationRequest();
                if (request == null) {
                        log.error("handlePayment aborted: PaymentInitiationRequest is null");
                        throw new VacademyException("Payment initiation request is missing");
                }
                log.info("handlePayment: amount={}, orderId={}", request.getAmount(), request.getOrderId());

                String paymentLogId = createPaymentLogHelper(
                                user.getId(),
                                request.getAmount(),
                                enrollInvite.getVendor(),
                                enrollInvite.getVendorId(),
                                resolvePaymentCurrency(request, enrollInvite, userPlan),
                                userPlan,
                                request.getOrderId());

                // Persist the coupon discount as a PaymentLogLineItem so
                // InvoiceService can render the discount line on receipts
                // (plan price − coupon = paid amount). Without this row the
                // invoice arithmetic contradicts what the gateway captured.
                recordCouponLineItemIfApplicable(paymentLogId, userPlan);

                if (!StringUtils.hasText(request.getOrderId())) {
                        request.setOrderId(paymentLogId);
                }

                UserInstitutePaymentGatewayMapping gatewayMapping = createOrGetCustomer(
                                instituteId,
                                user,
                                enrollInvite.getVendor(),
                                request);

                paymentGatewaySpecificPaymentDetailService.configureCustomerPaymentData(
                                gatewayMapping,
                                enrollInvite.getVendor(),
                                request);

                userPlan.setJsonPaymentDetails(JsonUtil.toJson(gatewayMapping));
                userPlanService.save(userPlan);

                PaymentResponseDTO response = makePayment(
                                enrollInvite.getVendor(),
                                instituteId,
                                user,
                                request);

                updatePaymentLogHelper(paymentLogId, response, request);

                // CRITICAL: Always set the payment log ID in the response
                // This is needed for multi-package enrollments to link child logs
                response.setOrderId(paymentLogId);

                return response;
        }

        /**
         * First payment for an autopay/trial enrollment: registers a recurring
         * mandate (UPI Autopay / card e-mandate) via the gateway's
         * {@code initiateMandatePayment} instead of a plain charge. Reuses the same
         * PaymentLog + customer plumbing as {@link #handlePayment}; the returned
         * response carries the recurring-checkout flags (e.g. Razorpay
         * {@code recurring:1} + {@code customerId}) for the frontend. The mandate
         * token is persisted from the webhook. For a trial pass a minimal auth
         * {@code request.amount}; for immediate-charge autopay pass the plan price.
         */
        public PaymentResponseDTO handleMandatePayment(UserDTO user,
                        String instituteId,
                        EnrollInvite enrollInvite,
                        UserPlan userPlan,
                        PaymentInitiationRequestDTO request) {

                String paymentLogId = createPaymentLogHelper(
                                user.getId(),
                                request.getAmount(),
                                enrollInvite.getVendor(),
                                enrollInvite.getVendorId(),
                                resolvePaymentCurrency(request, enrollInvite, userPlan),
                                userPlan,
                                request.getOrderId());
                if (!StringUtils.hasText(request.getOrderId())) {
                        request.setOrderId(paymentLogId);
                }

                UserInstitutePaymentGatewayMapping gatewayMapping = createOrGetCustomer(
                                instituteId, user, enrollInvite.getVendor(), request);
                paymentGatewaySpecificPaymentDetailService.configureCustomerPaymentData(
                                gatewayMapping, enrollInvite.getVendor(), request);

                userPlan.setJsonPaymentDetails(JsonUtil.toJson(gatewayMapping));
                userPlanService.save(userPlan);

                Map<String, Object> paymentGatewaySpecificData = institutePaymentGatewayMappingService
                                .findInstitutePaymentGatewaySpecifData(enrollInvite.getVendor(), instituteId);
                PaymentServiceStrategy strategy = paymentServiceFactory
                                .getStrategy(PaymentGateway.fromString(enrollInvite.getVendor()));
                request.setInstituteId(instituteId);

                PaymentResponseDTO response = strategy.initiateMandatePayment(user, request, paymentGatewaySpecificData);
                updatePaymentLogHelper(paymentLogId, response, request);
                response.setOrderId(paymentLogId);
                return response;
        }

        /**
         * Handles payment log creation without initiating gateway call.
         * Used for multi-package enrollments where one payment covers multiple plans.
         */
        public PaymentResponseDTO handlePaymentWithoutGateway(UserDTO user,
                        LearnerPackageSessionsEnrollDTO enrollDTO,
                        String instituteId,
                        EnrollInvite enrollInvite,
                        UserPlan userPlan) {
                return handlePaymentWithoutGateway(user, enrollDTO, instituteId, enrollInvite, userPlan, Map.of());
        }

        /**
         * Overloaded method to handle payment log creation without initiating gateway
         * call.
         * Allows passing extraData for status overrides.
         */
        public PaymentResponseDTO handlePaymentWithoutGateway(UserDTO user,
                        LearnerPackageSessionsEnrollDTO enrollDTO,
                        String instituteId,
                        EnrollInvite enrollInvite,
                        UserPlan userPlan,
                        Map<String, Object> extraData) {

                PaymentInitiationRequestDTO request = enrollDTO.getPaymentInitiationRequest();

                String paymentLogId = createPaymentLogHelper(
                                user.getId(),
                                request.getAmount(),
                                enrollInvite.getVendor(),
                                enrollInvite.getVendorId(),
                                resolvePaymentCurrency(request, enrollInvite, userPlan),
                                userPlan,
                                request.getOrderId());

                // Same rationale as handlePayment — invoices need the coupon
                // line item to render the discount row.
                recordCouponLineItemIfApplicable(paymentLogId, userPlan);

                if (!StringUtils.hasText(request.getOrderId())) {
                        request.setOrderId(paymentLogId);
                }

                // Skip gateway interactions, just save plan
                userPlan.setJsonPaymentDetails(JsonUtil
                                .toJson(Map.of("linkedToParentPayment", true, "paymentLogId", paymentLogId)));
                userPlanService.save(userPlan);

                // Create response
                PaymentResponseDTO response = new PaymentResponseDTO();
                response.setOrderId(paymentLogId);
                response.setMessage("Payment Log Created (Gateway Skipped)");
                Map<String, Object> responseData = new HashMap<>();

                String status = PaymentStatusEnum.PAYMENT_PENDING.name();
                if (Boolean.TRUE.equals(extraData.get("FORCE_PAID_STATUS"))) {
                        log.info("Forcing PAID status for skipped payment as requested");
                        status = PaymentStatusEnum.PAID.name();
                }
                responseData.put("paymentStatus", status);
                response.setResponseData(responseData);

                updatePaymentLogHelper(paymentLogId, response, request);

                return response;
        }

        /**
         * Handles payment for unknown users (donations, anonymous payments).
         */
        public PaymentResponseDTO handlePayment(PaymentInitiationRequestDTO request,
                        String instituteId) {

                String paymentLogId = createPaymentLogHelper(
                                null,
                                request.getAmount(),
                                request.getVendor(),
                                request.getVendorId(),
                                request.getCurrency(),
                                null,
                                request.getOrderId());

                request.setOrderId(paymentLogId);

                // Create or get customer for unknown user based on email
                Map<String, Object> gatewayMapping = createOrGetCustomerForUnknownUser(
                                instituteId,
                                request.getEmail(),
                                request.getVendor(),
                                request);

                // Extract customer ID from the gateway mapping for payment configuration

                String customerId = (String) gatewayMapping.get("customerId");
                if (customerId == null) {
                        throw new RuntimeException("Failed to get customer ID from payment gateway");
                }

                paymentGatewaySpecificPaymentDetailService.configureCustomerPaymentData(
                                gatewayMapping,
                                request.getVendor(),
                                request);

                PaymentResponseDTO response = makePayment(
                                request.getVendor(),
                                instituteId,
                                null, // No user for unknown donations
                                request);

                updatePaymentLogHelper(paymentLogId, response, request);

                return response;
        }

        /**
         * Handles payment for UserPlan initiated by user via frontend.
         */
        public PaymentResponseDTO handleUserPlanPayment(PaymentInitiationRequestDTO request,
                        String instituteId,
                        CustomUserDetails userDetails,
                        String userPlanId) {

                String userId = (userDetails != null) ? userDetails.getUserId() : null;

                // Validate that user plan exists and belongs to the user
                UserPlan userPlan = userPlanService.findById(userPlanId);

                if (userId != null && !userPlan.getUserId().equals(userId)) {
                        throw new RuntimeException("User plan does not belong to the specified user");
                }

                // If user is null (Public/Guest flow), use the ID from the Plan itself
                if (userId == null) {
                        userId = userPlan.getUserId();
                }

                // Create payment log for the user plan
                String paymentLogId = createPaymentLogHelper(
                                userId,
                                request.getAmount(),
                                request.getVendor(),
                                request.getVendorId(),
                                request.getCurrency(),
                                userPlan,
                                request.getOrderId());

                request.setOrderId(paymentLogId);

                PaymentResponseDTO response = null;

                // Branch: Authenticated User vs. Guest
                if (userDetails != null) {
                        // Authenticated User: Fetch UserDTO and Customer Mapping
                        UserDTO userDTO = getUserById(userId);
                        UserInstitutePaymentGatewayMapping gatewayMapping = createOrGetCustomer(
                                        instituteId,
                                        userDTO,
                                        request.getVendor(),
                                        request);

                        paymentGatewaySpecificPaymentDetailService.configureCustomerPaymentData(
                                        gatewayMapping,
                                        request.getVendor(),
                                        request);

                        // Process the payment
                        response = makePayment(
                                        request.getVendor(),
                                        instituteId,
                                        userDTO,
                                        request);
                } else {
                        // Guest/Applicant: Use Unknown User Logic
                        Map<String, Object> gatewayMapping = createOrGetCustomerForUnknownUser(
                                        instituteId,
                                        request.getEmail(),
                                        request.getVendor(),
                                        request);

                        paymentGatewaySpecificPaymentDetailService.configureCustomerPaymentData(
                                        gatewayMapping,
                                        request.getVendor(),
                                        request);

                        // Process payment with NULL user
                        response = makePayment(
                                        request.getVendor(),
                                        instituteId,
                                        null,
                                        request);
                }

                // Update payment log with response
                updatePaymentLogHelper(paymentLogId, response, request);

                return response;
        }

        /**
         * Handles payment for UserPlan with UserDTO (for auto-renewal scenarios).
         * This method is used when we have both UserDTO and UserPlan available,
         * such as in subscription auto-renewal flows.
         * 
         * @param request     Payment initiation request with all payment details
         * @param instituteId Institute ID for payment processing
         * @param user        UserDTO of the user making the payment (ROOT_ADMIN for
         *                    SubOrg)
         * @param userPlan    UserPlan associated with this payment
         * @return PaymentResponseDTO with payment result
         */
        public PaymentResponseDTO handlePaymentWithUser(PaymentInitiationRequestDTO request,
                        String instituteId,
                        UserDTO user,
                        UserPlan userPlan) {

                // Create payment log for the user plan
                String paymentLogId = createPaymentLogHelper(
                                user.getId(),
                                request.getAmount(),
                                request.getVendor(),
                                request.getVendorId(),
                                request.getCurrency(),
                                userPlan,
                                request.getOrderId());

                request.setOrderId(paymentLogId);

                // Create or get customer for the user
                UserInstitutePaymentGatewayMapping gatewayMapping = createOrGetCustomer(
                                instituteId,
                                user,
                                request.getVendor(),
                                request);

                paymentGatewaySpecificPaymentDetailService.configureCustomerPaymentData(
                                gatewayMapping,
                                request.getVendor(),
                                request);

                // Process the payment
                PaymentResponseDTO response = makePayment(
                                request.getVendor(),
                                instituteId,
                                user,
                                request);

                // Update payment log with response
                updatePaymentLogHelper(paymentLogId, response, request);

                return response;
        }

        /**
         * Off-session recurring charge against a registered mandate (autopay
         * renewal). Reuses the same PaymentLog + gateway-credential plumbing as a
         * normal payment, but dispatches to the strategy's {@code chargeRecurring}
         * with the stored mandate instead of an interactive checkout. Confirmation
         * for webhook gateways still arrives via the RENEWAL webhook; for
         * synchronous gateways (eWay) the returned status is authoritative.
         *
         * @return the PaymentResponseDTO; its orderId is the new RENEWAL PaymentLog id.
         */
        public PaymentResponseDTO handleRecurringCharge(UserDTO user,
                        String instituteId,
                        String vendor,
                        PaymentInitiationRequestDTO request,
                        UserPlan userPlan,
                        vacademy.io.admin_core_service.features.user_subscription.dto.MandateInfo mandate) {

                String paymentLogId = createPaymentLogHelper(
                                user.getId(),
                                request.getAmount(),
                                vendor,
                                request.getVendorId(),
                                request.getCurrency(),
                                userPlan,
                                request.getOrderId());
                request.setOrderId(paymentLogId);
                request.setInstituteId(instituteId);

                Map<String, Object> paymentGatewaySpecificData = institutePaymentGatewayMappingService
                                .findInstitutePaymentGatewaySpecifData(vendor, instituteId);
                PaymentServiceStrategy strategy = paymentServiceFactory
                                .getStrategy(PaymentGateway.fromString(vendor));

                PaymentResponseDTO response = strategy.chargeRecurring(mandate, request, paymentGatewaySpecificData);

                updatePaymentLogHelper(paymentLogId, response, request);
                response.setOrderId(paymentLogId);
                return response;
        }

        /**
         * Initiates payment through the configured payment gateway.
         */
        public PaymentResponseDTO makePayment(String vendor, String instituteId, UserDTO user,
                        PaymentInitiationRequestDTO request) {
                Map<String, Object> paymentGatewaySpecificData = institutePaymentGatewayMappingService
                                .findInstitutePaymentGatewaySpecifData(vendor, instituteId);
                PaymentGateway gateway = PaymentGateway.fromString(vendor);
                if (StringUtils.hasText(request.getCurrency())
                                && !CurrencyGatewaySupport.isSupported(gateway, request.getCurrency())) {
                        throw new VacademyException("Currency " + request.getCurrency().trim().toUpperCase()
                                        + " is not supported by payment gateway " + gateway.name() + ".");
                }
                PaymentServiceStrategy paymentServiceStrategy = paymentServiceFactory.getStrategy(gateway);
                request.setInstituteId(instituteId);
                return paymentServiceStrategy.initiatePayment(user, request, paymentGatewaySpecificData);
        }

        /**
         * Creates or retrieves existing customer mapping for a user.
         */
        public UserInstitutePaymentGatewayMapping createOrGetCustomer(String instituteId, UserDTO user, String vendor,
                        PaymentInitiationRequestDTO request) {
                Map<String, Object> paymentGatewaySpecificData = institutePaymentGatewayMappingService
                                .findInstitutePaymentGatewaySpecifData(vendor, instituteId);
                Optional<UserInstitutePaymentGatewayMapping> optionalUserInstitutePaymentGatewayMapping = userInstitutePaymentGatewayMappingService
                                .findByUserIdAndInstituteId(user.getId(), instituteId, vendor);
                if (optionalUserInstitutePaymentGatewayMapping.isPresent()) {
                        return optionalUserInstitutePaymentGatewayMapping.get();
                }
                PaymentServiceStrategy paymentServiceStrategy = paymentServiceFactory
                                .getStrategy(PaymentGateway.fromString(vendor));
                Map<String, Object> gatewayCustomerIdAndDataMap = paymentServiceStrategy.createCustomer(user, request,
                                paymentGatewaySpecificData);
                return userInstitutePaymentGatewayMappingService.saveUserInstituteVendorMapping(
                                user.getId(),
                                instituteId,
                                vendor,
                                (String) gatewayCustomerIdAndDataMap.get("customerId"),
                                gatewayCustomerIdAndDataMap);
        }

        /**
         * Creates or retrieves customer for unknown users (email-based).
         */
        public Map<String, Object> createOrGetCustomerForUnknownUser(String instituteId, String email,
                        String vendor, PaymentInitiationRequestDTO request) {
                Map<String, Object> paymentGatewaySpecificData = institutePaymentGatewayMappingService
                                .findInstitutePaymentGatewaySpecifData(vendor, instituteId);

                // Check if customer exists directly from payment gateway
                PaymentServiceStrategy paymentServiceStrategy = paymentServiceFactory
                                .getStrategy(PaymentGateway.fromString(vendor));

                // First try to find existing customer by email
                Map<String, Object> existingCustomer = paymentServiceStrategy.findCustomerByEmail(email,
                                paymentGatewaySpecificData);
                if (existingCustomer != null && existingCustomer.containsKey("customerId")) {
                        // Customer exists, return their data
                        return existingCustomer;
                }

                // Create customer for unknown user if not found
                return paymentServiceStrategy.createCustomerForUnknownUser(email,
                                request, paymentGatewaySpecificData);
        }

        /**
         * Checks payment status for a given order ID.
         * Currently supports PhonePe payment gateway.
         * 
         * @param vendor      Payment gateway vendor
         * @param instituteId Institute ID
         * @param orderId     Order ID to check status for
         * @return Map containing payment status and details
         */
        public Map<String, Object> checkPaymentStatus(String vendor, String instituteId, String orderId) {
                Map<String, Object> paymentGatewaySpecificData = institutePaymentGatewayMappingService
                                .findInstitutePaymentGatewaySpecifData(vendor, instituteId);
                PaymentServiceStrategy paymentServiceStrategy = paymentServiceFactory
                                .getStrategy(PaymentGateway.fromString(vendor));

                if (paymentServiceStrategy instanceof PhonePePaymentManager) {
                        PhonePeStatusResponseDTO status = ((PhonePePaymentManager) paymentServiceStrategy)
                                        .checkPaymentStatus(orderId, paymentGatewaySpecificData);

                        // Prepare response map
                        Map<String, Object> responseMap = new HashMap<>();
                        responseMap.put("status", status.getState());
                        responseMap.put("details", status);

                        // Update payment log based on status
                        if ("COMPLETED".equalsIgnoreCase(status.getState())) {
                                paymentLogService.updatePaymentLog(orderId, PaymentStatusEnum.PAID.name(),
                                                instituteId);
                        } else if ("FAILED".equalsIgnoreCase(status.getState())) {
                                paymentLogService.updatePaymentLog(orderId, PaymentStatusEnum.FAILED.name(),
                                                instituteId);
                        }

                        return responseMap;
                }

                if (PaymentGateway.CASHFREE.name().equalsIgnoreCase(vendor)) {
                        // Cashfree: status is updated by webhook; return from PaymentLog
                        var logDto = paymentLogService.getPaymentLog(orderId);
                        String paymentStatus = logDto.getPaymentStatus() != null
                                        ? logDto.getPaymentStatus()
                                        : PaymentStatusEnum.PAYMENT_PENDING.name();
                        Map<String, Object> responseMap = new HashMap<>();
                        responseMap.put("status", paymentStatus);
                        responseMap.put("details", Map.of(
                                        "orderId", orderId,
                                        "paymentStatus", paymentStatus));
                        return responseMap;
                }

                throw new UnsupportedOperationException("Status check not supported for " + vendor);
        }

        /**
         * Helper method to retrieve user details by ID.
         */
        private UserDTO getUserById(String userId) {
                List<UserDTO> users = authService.getUsersFromAuthServiceByUserIds(List.of(userId));
                if (users.isEmpty()) {
                        throw new RuntimeException("User not found with ID: " + userId);
                }
                return users.get(0);
        }

        /**
         * The currency the payment is actually taken in.
         *
         * {@code enroll_invite.currency} is optional in the admin invite payload and is persisted
         * blank for a large share of invites, so copying it straight into
         * {@code payment_log.currency} left the listing unable to tell an INR charge from a USD one
         * (it rendered a ₹1,999 Razorpay order as "$1,999.00"). The initiation request carries the
         * currency the gateway order is created with, so prefer it; fall back to the invite, then to
         * the plan being paid for. Normalised to upper case — gateways receive it that way.
         */
        private String resolvePaymentCurrency(PaymentInitiationRequestDTO request, EnrollInvite enrollInvite,
                        UserPlan userPlan) {
                if (request != null && StringUtils.hasText(request.getCurrency())) {
                        return request.getCurrency().trim().toUpperCase();
                }
                if (enrollInvite != null && StringUtils.hasText(enrollInvite.getCurrency())) {
                        return enrollInvite.getCurrency().trim().toUpperCase();
                }
                if (userPlan != null && userPlan.getPaymentPlan() != null
                                && StringUtils.hasText(userPlan.getPaymentPlan().getCurrency())) {
                        return userPlan.getPaymentPlan().getCurrency().trim().toUpperCase();
                }
                return null;
        }

        /**
         * Helper method to create payment log with consistent parameters.
         */
        private String createPaymentLogHelper(String userId, Double amount, String vendor, String vendorId,
                        String currency, UserPlan userPlan, String orderId) {
                return paymentLogService.createPaymentLog(
                                userId,
                                amount,
                                vendor,
                                vendorId,
                                currency,
                                userPlan,
                                orderId);
        }

        /**
         * Helper method to update payment log with response data.
         */
        private void updatePaymentLogHelper(String paymentLogId, PaymentResponseDTO response,
                        PaymentInitiationRequestDTO request) {
                Map<String, Object> logData = new HashMap<>();
                logData.put("response", response);
                if (request != null) {
                        logData.put("originalRequest", request);
                }

                String paymentStatus = null;
                if (response.getResponseData() != null) {
                        paymentStatus = (String) response.getResponseData().get("paymentStatus");
                }
                if (!StringUtils.hasText(paymentStatus)) {
                        paymentStatus = PaymentStatusEnum.PAYMENT_PENDING.name();
                }

                paymentLogService.updatePaymentLog(
                                paymentLogId,
                                PaymentLogStatusEnum.ACTIVE.name(),
                                paymentStatus,
                                JsonUtil.toJson(logData));
        }
}