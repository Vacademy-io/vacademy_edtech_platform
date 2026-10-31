package vacademy.io.auth_service.feature.user.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * What a "share credentials" request actually did.
 *
 * <p>The endpoint used to answer with a bare sentence and always a 200 — including when it
 * mailed nobody, because every selected learner was missing an email, a username or a
 * password. The admin dashboard read that 200 as proof of delivery and reported success, so a
 * batch that sent nothing looked identical to one that sent everything. Counts make the
 * difference visible to the caller.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class CredentialShareResult {

    /** Learners the mail was actually dispatched for. */
    private int sent;

    /** Learners asked for that produced no mail — skipped, or rejected downstream. */
    private int failed;

    /** Human-readable explanation, always populated so a wholly-failed batch can say why. */
    private String message;
}
