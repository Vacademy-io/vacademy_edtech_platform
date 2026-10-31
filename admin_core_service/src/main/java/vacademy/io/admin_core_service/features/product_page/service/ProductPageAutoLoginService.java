package vacademy.io.admin_core_service.features.product_page.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.common.util.JsonUtil;
import vacademy.io.admin_core_service.features.product_page.dto.ProductPageLoginCodeExchangeResponse;
import vacademy.io.admin_core_service.features.product_page.entity.ProductPage;
import vacademy.io.admin_core_service.features.product_page.entity.ProductPageLoginCode;
import vacademy.io.admin_core_service.features.product_page.repository.ProductPageLoginCodeRepository;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLog;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentLogRepository;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.dto.learner.UserWithJwtDTO;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.payment.enums.PaymentStatusEnum;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Map;

/**
 * "Log the buyer in after purchase" for product pages (settings_json.autoLoginAfterPayment).
 *
 * <p>The checkout is open: anyone can type any email, and the account behind it is reused.
 * Handing out a session for that email would let a stranger buy a cheap course in someone
 * else's name and walk into their account. So a code only works when the account was set up
 * by this very checkout and has never been logged into; everyone else gets the normal success
 * screen and signs in themselves.
 *
 * <p>The code goes back in the enroll response to the browser that paid, is stored only as a
 * SHA-256 hash, works once, and expires after {@link #CODE_TTL_MINUTES} minutes. It is
 * recorded after the enrollment commits, in its own transaction, so nothing here can roll
 * back a paid enrollment; if recording fails or the purchase does not qualify, the code is
 * simply never redeemable and the learner app falls back to the normal screen.
 */
@Slf4j
@Service
public class ProductPageAutoLoginService {

    static final int CODE_TTL_MINUTES = 10;
    /** How long before the payment the account may have been created and still count as new. */
    static final int NEW_ACCOUNT_WINDOW_MINUTES = 60;

    private static final SecureRandom RANDOM = new SecureRandom();

    @Autowired
    private ProductPageLoginCodeRepository loginCodeRepository;

    @Autowired
    private PaymentLogRepository paymentLogRepository;

    @Autowired
    private AuthService authService;

    private final TransactionTemplate newTransaction;

    public ProductPageAutoLoginService(PlatformTransactionManager transactionManager) {
        this.newTransaction = new TransactionTemplate(transactionManager);
        this.newTransaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    /**
     * Returns a one-time login code for the buyer when the page asks for auto-login, else null.
     * Never throws: a failure here must not fail an enrollment that has already been paid for.
     */
    public String issue(ProductPage page, String paymentLogId, UserDTO user, String instituteId) {
        try {
            if (page == null || !isEnabled(page.getSettingsJson())
                    || user == null || !StringUtils.hasText(user.getId())
                    || !StringUtils.hasText(paymentLogId) || !StringUtils.hasText(instituteId)
                    || user.getLastLoginTime() != null) {
                return null;
            }
            byte[] raw = new byte[32];
            RANDOM.nextBytes(raw);
            String code = Base64.getUrlEncoder().withoutPadding().encodeToString(raw);
            String codeHash = sha256(code);
            String userId = user.getId();
            String pageId = page.getId();

            Runnable record = () -> recordIfEligible(codeHash, userId, instituteId, pageId, paymentLogId);
            if (TransactionSynchronizationManager.isSynchronizationActive()) {
                TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                    @Override
                    public void afterCommit() {
                        record.run();
                    }
                });
            } else {
                record.run();
            }
            return code;
        } catch (Exception e) {
            log.warn("Auto-login code not issued for payment log {}: {}", paymentLogId, e.getMessage());
            return null;
        }
    }

    private void recordIfEligible(String codeHash, String userId, String instituteId, String pageId,
                                  String paymentLogId) {
        try {
            newTransaction.executeWithoutResult(status -> {
                PaymentLog paymentLog = paymentLogRepository.findById(paymentLogId).orElse(null);
                if (paymentLog == null
                        || !PaymentStatusEnum.PAID.name().equals(paymentLog.getPaymentStatus())
                        || !userId.equals(paymentLog.getUserId())) {
                    log.info("Auto-login skipped: payment log {} is not a PAID log of user {}", paymentLogId, userId);
                    return;
                }
                if (!loginCodeRepository.accountCreatedByCheckout(userId, paymentLogId, NEW_ACCOUNT_WINDOW_MINUTES)) {
                    log.info("Auto-login skipped: user {} had an account before this checkout", userId);
                    return;
                }
                if (loginCodeRepository.existsByPaymentLogId(paymentLogId)) {
                    return;
                }
                ProductPageLoginCode row = new ProductPageLoginCode();
                row.setCodeHash(codeHash);
                row.setUserId(userId);
                row.setInstituteId(instituteId);
                row.setProductPageId(pageId);
                row.setPaymentLogId(paymentLogId);
                row.setExpiresAt(LocalDateTime.now().plusMinutes(CODE_TTL_MINUTES));
                loginCodeRepository.save(row);
                log.info("Auto-login code recorded for user {} on payment log {}", userId, paymentLogId);
            });
        } catch (Exception e) {
            log.warn("Auto-login code not recorded for payment log {}: {}", paymentLogId, e.getMessage());
        }
    }

    /**
     * Swaps a code for the buyer's tokens. The claim is conditional, so two racing calls cannot
     * both succeed; if token generation fails the claim rolls back and the code stays usable
     * until it expires.
     */
    @Transactional
    public ProductPageLoginCodeExchangeResponse exchange(String code, String instituteId) {
        if (!StringUtils.hasText(code) || !StringUtils.hasText(instituteId)) {
            throw new VacademyException("Invalid login code");
        }
        String hash = sha256(code);
        ProductPageLoginCode row = loginCodeRepository.findByCodeHash(hash)
                .filter(r -> instituteId.equals(r.getInstituteId()))
                .orElseThrow(() -> new VacademyException("Invalid login code"));
        if (loginCodeRepository.consume(hash) != 1) {
            throw new VacademyException("This login link has expired. Please log in.");
        }
        UserWithJwtDTO tokens = authService.generateJwtTokensWithUser(row.getUserId(), row.getInstituteId());
        return ProductPageLoginCodeExchangeResponse.builder()
                .accessToken(tokens.getAccessToken())
                .refreshToken(tokens.getRefreshToken())
                .build();
    }

    @SuppressWarnings("unchecked")
    private boolean isEnabled(String settingsJson) {
        if (!StringUtils.hasText(settingsJson)) {
            return false;
        }
        try {
            Map<String, Object> settings = JsonUtil.fromJson(settingsJson, Map.class);
            return settings != null && Boolean.TRUE.equals(settings.get("autoLoginAfterPayment"));
        } catch (Exception e) {
            return false;
        }
    }

    private static String sha256(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
