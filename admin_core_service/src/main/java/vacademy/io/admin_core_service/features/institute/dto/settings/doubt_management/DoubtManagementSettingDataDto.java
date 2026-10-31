package vacademy.io.admin_core_service.features.institute.dto.settings.doubt_management;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Payload stored inside the institute's DOUBT_MANAGEMENT_SETTING slot. Controls which faculty are
 * auto-assigned to new doubts.
 *
 * {@link #defaultAssigneeSource} values:
 *   <ul>
 *     <li>SUBJECT_TEACHER — only FSPSSM-linked faculty whose subject_id matches the doubt's subject</li>
 *     <li>BATCH_TEACHER  — all FSPSSM-linked faculty for the doubt's batch (current/legacy behavior)</li>
 *     <li>BOTH           — union of the above (effectively same as BATCH_TEACHER in practice)</li>
 *     <li>NONE           — skip teachers; auto-assign to the institute's ADMIN users, who ARE
 *         notified and triage onward. Note this differs from a per-type
 *         {@code queryTypes[].assignee.source=NONE}, which assigns nobody and notifies nobody.</li>
 *   </ul>
 */
@Data
@Builder
@AllArgsConstructor
@NoArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class DoubtManagementSettingDataDto {
    /**
     * One of {@link DoubtDefaultAssigneeSourceEnum#name()}. String (not enum) so Jackson tolerates
     * unknown values written by an older/newer frontend without blowing up the whole settings blob.
     */
    private String defaultAssigneeSource;

    /**
     * When {@code defaultAssigneeSource=SUBJECT_TEACHER} and the doubt's subject has no FSPSSM-linked
     * faculty, fall back to batch-level faculty instead of leaving the doubt unassigned.
     */
    private Boolean fallbackToBatchWhenNoSubjectTeacher;

    /**
     * Per-event notification preferences. {@code null} means "no explicit preference configured" →
     * defaults apply (push ON, email ON, system alert ON) at dispatch time. Each channel is
     * independently toggleable: a strict-privacy institute can disable email-only, a low-noise
     * institute can disable push, etc.
     */
    private DoubtNotificationPrefs notifications;

    /**
     * Controls the learner-facing general-query intake (top-bar "?" icon + dashboard card).
     * {@code null} or {@code enabled=false} means existing institutes are unaffected — the new
     * entry points stay hidden and only the in-course slide doubt flow remains.
     */
    private LearnerQueryPrefs learnerQuery;

    /**
     * Configurable query types (DOUBT, TECHNICAL, PAYMENT, ...) with per-type default-assignee
     * routing. {@code null}/empty ⇒ legacy behavior: every doubt is treated as DOUBT and routed via
     * {@link #defaultAssigneeSource}.
     */
    private List<QueryTypeConfig> queryTypes;

    /**
     * Additionally route a sub-org learner's doubt to that sub-org's own staff. {@code null} ⇒
     * defaults apply (enabled, ALL_TEAM) — see {@link SubOrgNotificationPrefs}.
     */
    private SubOrgNotificationPrefs subOrgNotifications;

    /**
     * Configurable workflow statuses for the admin/teacher side (Pending, In progress, Escalated,
     * Waiting on learner, Resolved, …). {@code null}/empty ⇒ just the two built-ins, PENDING and
     * RESOLVED, which are always present regardless of what is stored. See
     * {@link vacademy.io.admin_core_service.features.doubts.service.DoubtStatusCatalog}.
     */
    private List<WorkflowStatusConfig> statuses;

    @Data
    @Builder
    @AllArgsConstructor
    @NoArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class WorkflowStatusConfig {
        /** Stable key persisted on doubts.workflow_status (e.g. IN_PROGRESS). Never renamed. */
        private String key;
        /** Internal label shown to admins and teachers. */
        private String label;
        /**
         * What the LEARNER sees for this status. Optional — falls back to {@link #label}. Lets an
         * internal "Escalated to HOD" read as "Being looked into" on the learner side.
         */
        private String learnerLabel;
        /**
         * One of {@link vacademy.io.admin_core_service.features.doubts.enums.DoubtStatusKindEnum}
         * as a string: OPEN | IN_PROGRESS | RESOLVED. Drives the coarse doubts.status column
         * (RESOLVED kind ⇒ status RESOLVED, else ACTIVE) and the learner-side tone.
         */
        private String kind;
        /** Optional hex colour for the admin board column / chip. */
        private String color;
        /** When false, hidden from pickers (kept for historical rows). Default true. */
        private Boolean enabled;
        /** PENDING and RESOLVED — cannot be deleted from the admin UI. */
        private Boolean isSystem;
    }

    @Data
    @Builder
    @AllArgsConstructor
    @NoArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class SubOrgNotificationPrefs {
        /**
         * Default true. When a doubt is raised by a learner who belongs to a sub-org, the sub-org's
         * staff are added to the assignee list on top of whatever {@link #defaultAssigneeSource} /
         * per-type routing resolved. Without this the sub-org never hears about it: every other
         * cascade is keyed on the PARENT institute (batch teachers exclude sub-org access rows, and
         * role lookups run against the parent), so a sub-org learner's query lands only on the
         * parent's desk. Only an explicit {@code false} disables it.
         */
        private Boolean enabled;
        /**
         * {@code ADMINS_ONLY} (sub-org ADMIN/ROOT_ADMIN only) or {@code ALL_TEAM} (admins + every
         * active sub-org team member). Default {@code ALL_TEAM}. String rather than enum so an
         * unknown value from an older/newer frontend can't break the settings blob.
         */
        private String recipients;

        /**
         * Whether the PARENT institute's own staff are also notified about a sub-org learner's
         * doubt. {@code null}/true (default) = additive: the normal batch-teacher/role/admin cascade
         * still runs and those people get the email/push/bell too. Explicit {@code false} = the
         * sub-org handles it exclusively: parent-institute staff are NOT added as assignees, so they
         * receive no doubt notification — but the doubt still appears in their Doubt Management inbox
         * (inbox visibility is scoped by institute/batch, not by assignee), so nothing is hidden from
         * them. Only meaningful for sub-org learners; parent-institute learners are unaffected.
         */
        private Boolean notifyParentStaff;
    }

    @Data
    @Builder
    @AllArgsConstructor
    @NoArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class LearnerQueryPrefs {
        /** Master switch — when false (default) neither entry point is shown to learners. */
        private Boolean enabled;
        /** Show the "?" quick-access icon in the learner top layout bar. */
        private Boolean showTopbarIcon;
        /** Show the "Need help? Raise a query" card on the learner dashboard. */
        private Boolean showDashboardCard;
        /**
         * Allow logged-out visitors to raise queries from the login page (default false). Guests
         * leave name + email; staff replies are emailed to that address.
         */
        private Boolean allowGuest;
    }

    @Data
    @Builder
    @AllArgsConstructor
    @NoArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class QueryTypeConfig {
        /** Stable key persisted on doubts.type (e.g. DOUBT, TECHNICAL, PAYMENT). Never renamed. */
        private String key;
        /** User-facing label shown in admin filters/columns and the learner type dropdown. */
        private String label;
        /** When false, the type is hidden everywhere (kept for historical rows). Default true. */
        private Boolean enabled;
        /** The built-in academic DOUBT type — cannot be deleted from the admin UI. */
        private Boolean isSystem;
        /** When true, learners may pick this type when raising a general query. */
        private Boolean learnerSelectable;
        /** Per-type default-assignee routing. {@code null} ⇒ fall back to {@link #defaultAssigneeSource}. */
        private QueryTypeAssignee assignee;
    }

    @Data
    @Builder
    @AllArgsConstructor
    @NoArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class QueryTypeAssignee {
        /**
         * One of SUBJECT_TEACHER | BATCH_TEACHER | BOTH | ROLE | SPECIFIC_USERS | NONE. String (not
         * enum) so an older/newer frontend can't break the whole settings blob with an unknown value.
         */
        private String source;
        /** Role name to route to when {@code source=ROLE} (e.g. ADMIN). */
        private String role;
        /** Explicit handler user ids when {@code source=SPECIFIC_USERS}. */
        private List<String> userIds;

        /**
         * Role names whose holders are assigned IN ADDITION to whatever {@link #source} resolved —
         * this is what lets a type route to "subject teacher AND admin". {@code null}/empty ⇒ the
         * base route alone, i.e. every config written before this field existed behaves unchanged.
         */
        private List<String> alsoRoles;

        /**
         * User ids assigned IN ADDITION to whatever {@link #source} resolved, so a type can keep its
         * faculty cascade and still always land on a fixed set of handlers. {@code null}/empty ⇒ the
         * base route alone.
         */
        private List<String> alsoUserIds;
    }

    @Data
    @Builder
    @AllArgsConstructor
    @NoArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class DoubtNotificationPrefs {
        /** Fired to assigned teacher(s) + optional admin CC when a learner raises a new doubt. */
        private DoubtNotificationChannelPrefs onDoubtRaised;
        /** Fired to the learner who raised the doubt when its status flips to RESOLVED. */
        private DoubtNotificationChannelPrefs onDoubtResolved;
    }

    @Data
    @Builder
    @AllArgsConstructor
    @NoArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class DoubtNotificationChannelPrefs {
        /** Default true — FCM push via notification-service. */
        private Boolean pushEnabled;
        /**
         * Default true — falls back to the seeded global default template (V215) when
         * {@link #emailTemplateId} is unset, so dispatch works out-of-the-box. Admins can opt out
         * from the Doubt Management settings page.
         */
        private Boolean emailEnabled;
        /**
         * Default true — populates the recipient's in-app bell (via an Announcement with
         * modeType=SYSTEM_ALERT). Independent of push: bell stays visible when a user returns to
         * the app even if they missed the push toast. Admins can opt out per event.
         */
        private Boolean systemAlertEnabled;
        /**
         * Id of a {@code Template} row (type=EMAIL) owned by this institute. Admin picks from the
         * existing Templates settings tab. Null is valid while email is disabled.
         */
        private String emailTemplateId;
    }
}
