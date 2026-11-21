package vacademy.io.admin_core_service.features.engagement.service;

import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.credits.client.CreditClient;

import java.util.Optional;

/**
 * One rule for "the engines stop asking the model": AI decisions cost credits, so with the
 * institute's balance used up the sweep leaves members unclaimed (EngagementSweepJob) and the
 * engine page says so. An unreadable balance is not "used up": a credits-service blip must not
 * stop engines or show a false warning.
 */
@Component
@RequiredArgsConstructor
public class EngagementCreditGate {

    private final CreditClient creditClient;

    @Value("${engagement.credits.pause-decisions-when-empty:true}")
    private boolean pauseDecisionsWhenEmpty;

    /** The balance, or empty when it could not be read. Never throws. */
    public Optional<Double> balance(String instituteId) {
        try {
            return creditClient.readBalance(instituteId);
        } catch (Exception e) {
            return Optional.empty();
        }
    }

    /** True when AI decisions are paused for this institute because its credits are used up. */
    public boolean decisionsPaused(String instituteId) {
        return decisionsPaused(balance(instituteId));
    }

    /** {@link #decisionsPaused(String)} for a balance already read. */
    public boolean decisionsPaused(Optional<Double> balance) {
        return pauseDecisionsWhenEmpty && balance != null && balance.isPresent() && balance.get() <= 0.0;
    }
}
