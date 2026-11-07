package vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing;

import org.springframework.http.HttpStatus;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;

/**
 * The institute cannot afford the copies it asked to grade (spec 8.3:
 * 402 {@code insufficient_credits}, details {required, available, balance,
 * credit_limit, committed}). Nothing was queued.
 */
public class InsufficientCreditsException extends VacademyException {

        public static final String CODE = "insufficient_credits";

        private final BigDecimal required;
        private final BigDecimal available;
        private final BigDecimal balance;
        private final BigDecimal creditLimit;
        private final BigDecimal committed;

        public InsufficientCreditsException(BigDecimal required, BigDecimal available, BigDecimal balance,
                        BigDecimal creditLimit, BigDecimal committed) {
                super(HttpStatus.PAYMENT_REQUIRED, message(required, available, committed));
                this.required = required;
                this.available = available;
                this.balance = balance;
                this.creditLimit = creditLimit;
                this.committed = committed;
        }

        private static String message(BigDecimal required, BigDecimal available, BigDecimal committed) {
                String queued = committed != null && committed.signum() > 0
                                ? " (" + committed.stripTrailingZeros().toPlainString()
                                                + " credits are already held by checks still queued or running)"
                                : "";
                return "Not enough AI credits: this check needs " + plain(required) + " credits and "
                                + plain(available) + " are available" + queued
                                + ". Top up AI credits and try again.";
        }

        private static String plain(BigDecimal value) {
                return value == null ? "0" : value.stripTrailingZeros().toPlainString();
        }

        public String getCode() {
                return CODE;
        }

        public BigDecimal getRequired() {
                return required;
        }

        public BigDecimal getAvailable() {
                return available;
        }

        public BigDecimal getBalance() {
                return balance;
        }

        public BigDecimal getCreditLimit() {
                return creditLimit;
        }

        public BigDecimal getCommitted() {
                return committed;
        }
}
