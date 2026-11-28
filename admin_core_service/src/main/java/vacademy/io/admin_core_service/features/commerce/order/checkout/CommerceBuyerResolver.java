package vacademy.io.admin_core_service.features.commerce.order.checkout;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.commerce.customer.entity.CommerceCustomer;
import vacademy.io.admin_core_service.features.commerce.customer.service.CommerceCustomerService;
import vacademy.io.common.auth.dto.UserDTO;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

/**
 * Finds or creates the auth user an order is written for, by the shop's {@link BuyerIdentity}.
 *
 * <p>A shop buyer is not a learner: the user gets <b>no role</b> in the institute, no
 * credentials mail and no enrolment, so nothing about who can sign in where changes.
 *
 * <p><b>The rules</b> (V = the shopper proved this phone for this order, E = an e-mail was typed):
 * <ul>
 *   <li>PHONE_OTP: V is required (403 {@code phone_verification_required}); the buyer is the
 *       <b>holder account</b> of the phone.</li>
 *   <li>EMAIL: E is required (400 {@code email_required}, {@code otp_allowed:false}); the buyer is
 *       the account of the e-mail.</li>
 *   <li>EITHER: with V the buyer is the holder of the phone and a typed e-mail never picks the
 *       account; without V, E is required ({@code otp_allowed:true}) and the buyer is the account
 *       of the e-mail.</li>
 * </ul>
 *
 * <p><b>Holder account.</b> One auth user per (institute, phone), found through the shop's own
 * customer row and otherwise created through the platform's internal get-or-create route with
 * a deterministic placeholder address {@code b-<24 hex>@buyer.invalid}: an HMAC of institute
 * and phone under a server key, so it carries no digit of the phone and cannot be turned back
 * into one, and a retry or a race finds the same user. The {@code .invalid} domain never
 * receives mail.
 *
 * <p><b>No phone is ever sent to the account service</b>: the request carries no mobile
 * number on any path. The phone lives in the shop's customer and order rows only.
 *
 * <p>It is a remote call: checkout runs it before the order transaction, never inside it.
 */
@Slf4j
@Component
public class CommerceBuyerResolver {

    public static final String HOLDER_DOMAIN = "@buyer.invalid";
    private static final String HOLDER_PURPOSE = "commerce-buyer-holder:";
    private static final int HOLDER_HEX = 24;

    /** The account an order is written for; {@code holder} when it is the phone's holder. */
    public record Buyer(String userId, boolean holder) {
    }

    private final CommerceCustomerService customerService;
    private final AuthService authService;
    /** Keys the holder address; null when no secret is set (checkout is then already 503). */
    private final byte[] holderKey;

    /**
     * @param secret         {@code commerce.buyer-holder.secret}
     * @param fallbackSecret {@code commerce.order-token.secret}, used when the first is empty
     */
    @Autowired
    public CommerceBuyerResolver(CommerceCustomerService customerService, AuthService authService,
                                 @Value("${commerce.buyer-holder.secret:}") String secret,
                                 @Value("${commerce.order-token.secret:}") String fallbackSecret) {
        this(customerService, authService, secret == null || secret.isBlank() ? fallbackSecret : secret);
    }

    CommerceBuyerResolver(CommerceCustomerService customerService, AuthService authService, String secret) {
        this.customerService = customerService;
        this.authService = authService;
        this.holderKey = secret == null || secret.isBlank() ? null
                : sha256((HOLDER_PURPOSE + secret.trim()).getBytes(StandardCharsets.UTF_8));
    }

    /**
     * Refuses an order the mode does not allow, before anything else is done for it. The
     * same rules as {@link #resolve}; checkout asks first so that a refusal costs no bot-check
     * token and no remote call.
     */
    public static void requireAllowed(BuyerIdentity mode, boolean phoneVerified, String email) {
        BuyerIdentity m = mode == null ? BuyerIdentity.DEFAULT : mode;
        if (m == BuyerIdentity.PHONE_OTP && !phoneVerified) {
            Map<String, Object> details = new LinkedHashMap<>();
            details.put("param", "phone_token");
            details.put("reason", "mode");
            throw new CheckoutException(HttpStatus.FORBIDDEN, CheckoutException.PHONE_VERIFICATION_REQUIRED,
                    "Verify your phone number to place the order.", details);
        }
        boolean needsEmail = m == BuyerIdentity.EMAIL || (m == BuyerIdentity.EITHER && !phoneVerified);
        if (needsEmail && !StringUtils.hasText(email)) {
            // The same answer for a phone the shop knows and one it does not.
            Map<String, Object> details = new LinkedHashMap<>();
            details.put("param", "customer.email");
            details.put("otp_allowed", m == BuyerIdentity.EITHER);
            throw new CheckoutException(HttpStatus.BAD_REQUEST, CheckoutException.EMAIL_REQUIRED,
                    "An e-mail address is needed to place the order.", details);
        }
    }

    /**
     * @param phone         the stored spelling ({@code CommercePhones.normalise})
     * @param phoneVerified true when the shopper proved {@code phone} for this shop (an OTP
     *                      token or a shopper session of that phone)
     */
    public Buyer resolve(String instituteId, BuyerIdentity mode, String phone, String name, String email,
                         boolean phoneVerified) {
        BuyerIdentity m = mode == null ? BuyerIdentity.DEFAULT : mode;
        requireAllowed(m, phoneVerified, email);
        if (m != BuyerIdentity.EMAIL && phoneVerified) {
            return new Buyer(holderOf(instituteId, phone, name), true);
        }
        if (isHolderEmail(email)) {
            // A placeholder address is the shop's own; a typed one never picks its account.
            throw CheckoutException.invalid("customer.email is not a valid e-mail address.");
        }
        return new Buyer(account(instituteId, email.trim(), name), false);
    }

    /** As {@link #resolve} for a shop on the default mode; the user id only. */
    public String resolveUserId(String instituteId, String phone, String name, String email, boolean phoneVerified) {
        return resolve(instituteId, BuyerIdentity.DEFAULT, phone, name, email, phoneVerified).userId();
    }

    /** The holder of a phone: the customer row's user, or a new one with the placeholder address. */
    private String holderOf(String instituteId, String phone, String name) {
        Optional<CommerceCustomer> known = customerService.findByPhone(instituteId, phone);
        if (known.isPresent() && StringUtils.hasText(known.get().getUserId())) {
            return known.get().getUserId();
        }
        return account(instituteId, holderEmail(instituteId, phone), name);
    }

    /** The placeholder address of the holder of (institute, phone). */
    public String holderEmail(String instituteId, String phone) {
        if (holderKey == null) {
            throw new CheckoutException(HttpStatus.SERVICE_UNAVAILABLE, CheckoutException.NOT_CONFIGURED,
                    "Checkout is not available for this shop yet.");
        }
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(holderKey, "HmacSHA256"));
            byte[] digest = mac.doFinal((instituteId + "|" + phone).getBytes(StandardCharsets.UTF_8));
            return "b-" + HexFormat.of().formatHex(digest).substring(0, HOLDER_HEX) + HOLDER_DOMAIN;
        } catch (java.security.GeneralSecurityException e) {
            throw new IllegalStateException("HMAC-SHA256 is not available", e);
        }
    }

    /**
     * The placeholder address of the institute's one walk-in customer (counter sales without a
     * phone): {@code w-<24 hex>@buyer.invalid}, an HMAC of the institute under the same server
     * key, so it is the same on every call and carries nothing typed at the counter.
     */
    public String walkInEmail(String instituteId) {
        if (holderKey == null) {
            throw new CheckoutException(HttpStatus.SERVICE_UNAVAILABLE, CheckoutException.NOT_CONFIGURED,
                    "Checkout is not available for this shop yet.");
        }
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(holderKey, "HmacSHA256"));
            byte[] digest = mac.doFinal(("walk-in|" + instituteId).getBytes(StandardCharsets.UTF_8));
            return "w-" + HexFormat.of().formatHex(digest).substring(0, HOLDER_HEX) + HOLDER_DOMAIN;
        } catch (java.security.GeneralSecurityException e) {
            throw new IllegalStateException("HMAC-SHA256 is not available", e);
        }
    }

    /**
     * Get-or-create of the institute's walk-in auth user (no role, no mail, no phone). A remote
     * call: never inside a transaction. The deterministic address makes a retry or a race find
     * the same user.
     */
    public String walkInAccount(String instituteId) {
        return account(instituteId, walkInEmail(instituteId), "Walk-in customer");
    }

    /** True for a placeholder address of a holder account (never mailed). */
    public static boolean isHolderEmail(String email) {
        return email != null && email.trim().toLowerCase(java.util.Locale.ROOT).endsWith(HOLDER_DOMAIN);
    }

    /** Get-or-create of the account of {@code email}: no role, no mail, and no mobile number. */
    private String account(String instituteId, String email, String name) {
        UserDTO request = new UserDTO();
        request.setFullName(name);
        request.setEmail(email);
        // Never a mobile number: the phone lives only in the shop's own rows.
        request.setMobileNumber(null);
        // Empty on purpose: no STUDENT role, no staff role, nothing to sign in with.
        request.setRoles(new ArrayList<>());
        UserDTO user;
        try {
            user = authService.createUserFromAuthServiceForLearnerEnrollment(request, instituteId, false);
        } catch (RuntimeException e) {
            // The message of the remote failure may carry the e-mail: not logged.
            log.error("Could not resolve the buyer of a shop order for institute {} ({})", instituteId,
                    e.getClass().getSimpleName());
            throw unavailable();
        }
        if (user == null || !StringUtils.hasText(user.getId())) {
            log.error("The auth service returned no user for a shop order of institute {}", instituteId);
            throw unavailable();
        }
        return user.getId();
    }

    private static CheckoutException unavailable() {
        return new CheckoutException(HttpStatus.SERVICE_UNAVAILABLE, CheckoutException.BUYER_UNAVAILABLE,
                "The order could not be placed right now. Please try again.");
    }

    private static byte[] sha256(byte[] value) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(value);
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is not available", e);
        }
    }
}
