package vacademy.io.admin_core_service.features.institute_learner.dto.student_list_dto;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

@Data
@AllArgsConstructor
@NoArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class StudentListFilter {
    private String name;
    private List<String> statuses;
    private List<String> instituteIds;
    private List<String> packageSessionIds;
    private List<String> groupIds;
    private List<String> gender;
    private List<String> paymentStatuses;
    private List<String> customFields;
    private Map<String, String> sortColumns;
    private List<String> sources;
    private List<String> types;
    private List<String> typeIds;
    private List<String> destinationPackageSessionIds;
    private List<String> levelIds;
    private List<String> subOrgUserTypes;
    // Sub-org filter (from request body) — restricts to learners enrolled under these sub-orgs
    // (matched on ssigm.sub_org_id).
    private List<String> subOrgIds;
    private Map<String, List<String>> customFieldFilters;
    // Operator-aware custom-field filters ([{field_id, operator, values}] —
    // CONTAINS / IS_EMPTY / NOT_EMPTY / BETWEEN / GTE / LTE; see
    // CustomFieldListFilterDTO). Coexists with the legacy values-IN map above;
    // both AND together when sent.
    private List<vacademy.io.admin_core_service.features.common.dto.CustomFieldListFilterDTO> customFieldTypedFilters;
    // Campaign (UTM) attribution filter — same shape on every list surface.
    // Pre-resolved into user ids and folded into cfTypedMatchedUserIds /
    // cfTypedExcludedUserIds below, so it rides the same custom-repo path.
    private vacademy.io.admin_core_service.features.utm_attribution.dto.UtmListFilterDTO utmFilters;
    /** TRIAL and/or PAID. Empty = no membership filter; a learner with no plan never matches. */
    private List<String> membershipTypes;
    private LocalDate startDate;
    private LocalDate endDate;

    // User-facing invite filter (from request body)
    private List<String> enrollInviteIds;

    // Audience filter — when set, restrict to learners who have an audience_response
    // in one of these audiences (and that response isn't OPTED_OUT).
    private List<String> audienceIds;

    // Internal fields - auto-injected by server for faculty ENROLL_INVITE filtering
    @JsonIgnore
    private List<String> serverEnrollInviteIds;
    @JsonIgnore
    private List<String> enrollInvitePackageSessionIds;

    // Internal fields — the typed custom-field filters above, pre-resolved by
    // CustomFieldListFilterResolver into user-id sets before the repository call.
    @JsonIgnore
    private List<String> cfTypedMatchedUserIds;
    @JsonIgnore
    private List<String> cfTypedExcludedUserIds;

    // Internal fields — custom-field sort, extracted server-side from a
    // sortColumns entry keyed "cf:<custom_field_id>" (the students table sends
    // that key when sorting a custom-field column). Forces the heavy
    // custom-repo path, which orders by the learner's latest USER-scoped answer.
    @JsonIgnore
    private String sortCustomFieldId;
    @JsonIgnore
    private String sortCustomFieldDirection;
}