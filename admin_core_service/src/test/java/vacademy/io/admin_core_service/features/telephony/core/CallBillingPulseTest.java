package vacademy.io.admin_core_service.features.telephony.core;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.math.BigDecimal;
import java.math.RoundingMode;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * The pricing arithmetic behind {@code CallBillingService.bill}, pinned on its own.
 *
 * <p>Worth a test of its own because it is money: the rate stays credits-per-MINUTE
 * whatever the pulse is, so switching an institute from 60s to 30s must halve what one
 * pulse costs rather than leave the per-minute price applied twice as often. A mistake
 * either way is a silent double-charge or a silent giveaway on every call.
 */
class CallBillingPulseTest {

    /** Mirrors the production expression exactly. */
    private static BigDecimal cost(double perMinute, int durationSeconds, int pulseSeconds) {
        long pulses = (durationSeconds + pulseSeconds - 1L) / pulseSeconds;
        BigDecimal perPulse = BigDecimal.valueOf(perMinute)
                .multiply(BigDecimal.valueOf(pulseSeconds))
                .divide(BigDecimal.valueOf(60), 6, RoundingMode.HALF_UP);
        return perPulse.multiply(BigDecimal.valueOf(pulses)).setScale(4, RoundingMode.HALF_UP);
    }

    @ParameterizedTest(name = "{2}s pulse, {1}s call at {0}/min -> {3} credits")
    @CsvSource({
            // 60s pulse — the historical behaviour must be untouched
            "5.0,   1, 60,  5.0000",   // a 1-second call still pays a whole minute
            "5.0,  60, 60,  5.0000",
            "5.0,  61, 60, 10.0000",   // one second over rounds up
            "1.0, 125, 60,  3.0000",

            // 30s pulse at the SAME per-minute rate — half a minute costs half
            "5.0,   1, 30,  2.5000",
            "5.0,  30, 30,  2.5000",
            "5.0,  31, 30,  5.0000",
            "5.0,  60, 30,  5.0000",   // a full minute costs the same either way

            // Shiksha Nation's agreed numbers: 2 credits per 30s AI = 4/min,
            // 0.2 per 30s telephony = 0.4/min
            "4.0,   5, 30,  2.0000",   // short call: 2 credits, not 6
            "4.0,  30, 30,  2.0000",
            "4.0,  45, 30,  4.0000",
            "4.0,  90, 30,  6.0000",
            "0.4,   5, 30,  0.2000",
            "0.4,  90, 30,  0.6000",
    })
    void pricesEachPulse(double perMinute, int seconds, int pulse, String expected) {
        assertEquals(new BigDecimal(expected), cost(perMinute, seconds, pulse));
    }

    @Test
    @DisplayName("a full minute costs the same at any pulse — the pulse refines rounding, not price")
    void pulseDoesNotRepriceAFullMinute() {
        assertEquals(cost(5.0, 60, 60), cost(5.0, 60, 30));
        assertEquals(cost(5.0, 120, 60), cost(5.0, 120, 30));
    }

    @Test
    @DisplayName("a 30s pulse never costs more than a 60s pulse for the same call")
    void finerPulseNeverCostsMore() {
        for (int secs = 1; secs <= 600; secs++) {
            assertEquals(1, cost(5.0, secs, 60).compareTo(cost(5.0, secs, 30)) >= 0 ? 1 : 0,
                    "60s pulse should never be cheaper than 30s at " + secs + "s");
        }
    }

    @Test
    @DisplayName("Shiksha Nation: a 5-second call drops from 6 credits to 2.2")
    void theShortCallCase() {
        BigDecimal before = cost(5.0, 5, 60).add(cost(1.0, 5, 60));   // 5 + 1
        BigDecimal after = cost(4.0, 5, 30).add(cost(0.4, 5, 30));    // 2 + 0.2
        assertEquals(new BigDecimal("6.0000"), before);
        assertEquals(new BigDecimal("2.2000"), after);
    }
}
