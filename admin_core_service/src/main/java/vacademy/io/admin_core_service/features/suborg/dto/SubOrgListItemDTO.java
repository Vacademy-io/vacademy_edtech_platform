package vacademy.io.admin_core_service.features.suborg.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.sql.Timestamp;

/**
 * Enriched sub-org (VLE) list row for the admin Manage VLEs table: the sub-org record
 * plus its resolved admin contact, plan status, seat usage and org-level invite —
 * everything the list needs in one call so the UI needn't fan out per row.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class SubOrgListItemDTO {
    private String suborgId;
    private String name;
    private String status;
    /** auth_service user id of the sub-org's root-admin (from the mapping row, so it survives
     *  an auth-service lookup failure) — what the row's "Share credentials" action sends to. */
    private String adminUserId;
    /** Root-admin of the sub-org (null when none resolved / auth lookup failed). */
    private String adminName;
    private String adminEmail;
    private String adminPhone;
    /** Address of the spawned institute (stamped at registration when the link collects
     *  address; null for manually-created sub-orgs or links without address collection).
     *  {@code addressLine} is {@code institutes.address_line}: the registration's address
     *  line 1 + line 2 joined, exactly as the registrant typed them. It is a separate DB
     *  column from city/state/pincode, but registrants routinely repeat those inside it —
     *  so treat it as free text, never as a field to compose a full address from. */
    private String addressLine;
    private String city;
    private String state;
    private String pincode;
    /** The admin's UserPlan status (ACTIVE, PENDING_FOR_PAYMENT, …); null when no plan. */
    private String planStatus;
    /** Active learner-seat count; null total = no cap configured. */
    private Long usedSeats;
    private Integer totalSeats;
    /** Distinct ACTIVE learners enrolled under this sub-org (admins excluded) — the same
     *  population {@code usedSeats} bills against, surfaced separately so the list can show
     *  a "Learners" column independent of whether a seat cap is configured. */
    private Long learnerCount;
    private String inviteCode;
    private String shortUrl;
    private Timestamp createdAt;
}
