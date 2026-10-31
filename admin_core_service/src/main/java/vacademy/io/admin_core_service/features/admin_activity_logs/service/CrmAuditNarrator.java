package vacademy.io.admin_core_service.features.admin_activity_logs.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.audience.entity.Audience;
import vacademy.io.admin_core_service.features.audience.entity.AudienceResponse;
import vacademy.io.admin_core_service.features.audience.entity.LeadFollowup;
import vacademy.io.admin_core_service.features.audience.entity.LeadStatus;
import vacademy.io.admin_core_service.features.audience.entity.LeadTier;
import vacademy.io.admin_core_service.features.audience.repository.AudienceRepository;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.audience.repository.LeadFollowupRepository;
import vacademy.io.admin_core_service.features.audience.repository.LeadStatusRepository;
import vacademy.io.admin_core_service.features.audience.repository.LeadTierRepository;
import vacademy.io.admin_core_service.features.audience.entity.UserLeadProfile;
import vacademy.io.admin_core_service.features.audience.repository.UserLeadProfileRepository;
import vacademy.io.admin_core_service.features.institute_learner.entity.Student;
import vacademy.io.admin_core_service.features.institute_learner.repository.InstituteStudentRepository;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * CRM-side twin of {@link AuditNarrator}: turns the ids a CRM request carries
 * into the phrases stored in {@code admin_activity_log.description}.
 *
 * <p>Kept separate from {@link AuditNarrator} so the learner/course lookups and
 * the audience/lead lookups don't drag each other's repositories into one bean.
 * Annotations reach it as {@code @crmAuditNarrator.<method>(...)}.
 *
 * <p>Conventions carried over from {@link AuditNarrator}, and they matter:
 * <ul>
 *   <li><b>Never throw.</b> Every method degrades to an id, a count, or null —
 *       an audit lookup must not be able to fail a customer mutation.</li>
 *   <li><b>No actor in the phrase</b> — the read UI prepends {@code actor_name}.</li>
 *   <li><b>One name, many counted.</b> Listing 200 leads makes a row unreadable;
 *       the count is what an admin scanning the log needs.</li>
 *   <li><b>Distinct method names, no overloads</b> — SpEL resolves overloads
 *       poorly when an argument is null.</li>
 * </ul>
 */
@Component
public class CrmAuditNarrator {

    private static final Logger logger = LoggerFactory.getLogger(CrmAuditNarrator.class);

    @Autowired
    private AudienceRepository audienceRepository;

    @Autowired
    private AudienceResponseRepository audienceResponseRepository;

    @Autowired
    private LeadStatusRepository leadStatusRepository;

    @Autowired
    private LeadTierRepository leadTierRepository;

    @Autowired
    private LeadFollowupRepository leadFollowupRepository;

    @Autowired
    private UserLeadProfileRepository userLeadProfileRepository;

    @Autowired
    private InstituteStudentRepository instituteStudentRepository;

    // ── Audiences (campaigns) ─────────────────────────────────────────────

    /** Campaign name for an audience id, falling back to the raw id. */
    public String audienceFor(String audienceId) {
        if (isBlank(audienceId)) {
            return null;
        }
        try {
            return audienceRepository.findById(audienceId)
                    .map(Audience::getCampaignName)
                    .filter(name -> !isBlank(name))
                    .map(String::trim)
                    .orElse(audienceId);
        } catch (Exception e) {
            logger.warn("Could not resolve audience name for {}: {}", audienceId, e.getMessage());
            return audienceId;
        }
    }

    /**
     * Snapshot of an audience for {@code captureBefore}. Returned as a map
     * rather than the entity so the JSON in {@code before_payload} stays small
     * and stable, and so {@code descriptionExpr} can read the name back as
     * {@code #before['name']} <em>after</em> the row is gone (a DELETE cannot
     * look the name up again).
     */
    public Map<String, Object> audienceSnapshot(String audienceId) {
        if (isBlank(audienceId)) {
            return null;
        }
        try {
            return audienceRepository.findById(audienceId)
                    .map(audience -> {
                        Map<String, Object> snapshot = new LinkedHashMap<>();
                        snapshot.put("id", audience.getId());
                        snapshot.put("name", audience.getCampaignName());
                        snapshot.put("type", audience.getCampaignType());
                        snapshot.put("objective", audience.getCampaignObjective());
                        snapshot.put("status", audience.getStatus());
                        snapshot.put("description", audience.getDescription());
                        snapshot.put("to_notify", audience.getToNotify());
                        snapshot.put("start_date", String.valueOf(audience.getStartDate()));
                        snapshot.put("end_date", String.valueOf(audience.getEndDate()));
                        snapshot.put("tags", audience.getTagsJson());
                        return snapshot;
                    })
                    .orElse(null);
        } catch (Exception e) {
            logger.warn("Could not snapshot audience {}: {}", audienceId, e.getMessage());
            return null;
        }
    }

    /** Reads a name out of an {@code audienceSnapshot}, for post-delete phrasing. */
    public String nameFromSnapshot(Object snapshot, String fallback) {
        if (snapshot instanceof Map<?, ?> map) {
            Object name = map.get("name");
            if (name != null && !isBlank(name.toString())) {
                return name.toString().trim();
            }
        }
        return fallback;
    }

    // ── Leads ─────────────────────────────────────────────────────────────

    /**
     * Display name for one lead (an {@code audience_response} row): their
     * learner record if they have one, then the contact details captured on the
     * form, then the raw id.
     */
    public String leadFor(String audienceResponseId) {
        if (isBlank(audienceResponseId)) {
            return null;
        }
        try {
            AudienceResponse response = audienceResponseRepository.findById(audienceResponseId).orElse(null);
            if (response == null) {
                return audienceResponseId;
            }
            String learnerName = studentNameFor(response.getUserId());
            if (learnerName != null) {
                return learnerName;
            }
            String contact = contactLabel(response);
            return contact != null ? contact : audienceResponseId;
        } catch (Exception e) {
            logger.warn("Could not resolve lead name for {}: {}", audienceResponseId, e.getMessage());
            return audienceResponseId;
        }
    }

    /**
     * Display name for a lead identified by their <em>user</em> id, which is
     * how the lead-profile endpoints (status, tier, conversion, counsellor
     * assignment) address them.
     *
     * <p>Note what this deliberately does not do: look the person up in
     * {@code users}. That table belongs to auth_service and does not exist in
     * this service's database, so the query throws, the catch swallows it, and
     * every description ends up naming a raw UUID — which is exactly what
     * shipped and what this replaces. Everything below is inside admin_core's
     * own schema.
     */
    public String leadUserFor(String leadUserId) {
        if (isBlank(leadUserId)) {
            return null;
        }
        String learnerName = studentNameFor(leadUserId);
        if (learnerName != null) {
            return learnerName;
        }
        try {
            return audienceResponseRepository.findByUserId(leadUserId).stream()
                    .filter(Objects::nonNull)
                    .map(this::contactLabel)
                    .filter(Objects::nonNull)
                    .findFirst()
                    .orElse(leadUserId);
        } catch (Exception e) {
            logger.warn("Could not resolve lead name for user {}: {}", leadUserId, e.getMessage());
            return leadUserId;
        }
    }

    /** Name, email or phone off a lead's own form submission, in that order. */
    private String contactLabel(AudienceResponse response) {
        if (response == null) {
            return null;
        }
        if (!isBlank(response.getParentName())) {
            return response.getParentName().trim();
        }
        if (!isBlank(response.getParentEmail())) {
            return response.getParentEmail().trim();
        }
        if (!isBlank(response.getParentMobile())) {
            return response.getParentMobile().trim();
        }
        return null;
    }

    /** Learner name for a user id, or null when they are not enrolled here. */
    private String studentNameFor(String userId) {
        if (isBlank(userId)) {
            return null;
        }
        try {
            return instituteStudentRepository.findByUserId(userId).stream()
                    .filter(Objects::nonNull)
                    .map(Student::getFullName)
                    .filter(name -> !isBlank(name))
                    .map(String::trim)
                    .findFirst()
                    .orElse(null);
        } catch (Exception e) {
            logger.warn("Could not resolve learner name for {}: {}", userId, e.getMessage());
            return null;
        }
    }

    /** Names one lead, or counts several — "Amit Kumar" vs "5 lead(s)". */
    public String leadsFor(List<String> audienceResponseIds) {
        List<String> ids = distinctNonBlank(audienceResponseIds);
        if (ids.isEmpty()) {
            return null;
        }
        if (ids.size() > 1) {
            return ids.size() + " lead(s)";
        }
        return leadFor(ids.get(0));
    }

    /** Human label of a lead status id ("Interested"), falling back to the id. */
    public String leadStatusFor(String leadStatusId) {
        if (isBlank(leadStatusId)) {
            return null;
        }
        try {
            return leadStatusRepository.findById(leadStatusId)
                    .map(LeadStatus::getLabel)
                    .filter(label -> !isBlank(label))
                    .map(String::trim)
                    .orElse(leadStatusId);
        } catch (Exception e) {
            logger.warn("Could not resolve lead status label for {}: {}", leadStatusId, e.getMessage());
            return leadStatusId;
        }
    }

    /** Snapshot of a lead status row, for UPDATE/DELETE before-payloads. */
    public Map<String, Object> leadStatusSnapshot(String leadStatusId) {
        if (isBlank(leadStatusId)) {
            return null;
        }
        try {
            return leadStatusRepository.findById(leadStatusId)
                    .map(status -> {
                        Map<String, Object> snapshot = new LinkedHashMap<>();
                        snapshot.put("id", status.getId());
                        snapshot.put("name", status.getLabel());
                        snapshot.put("status_key", status.getStatusKey());
                        snapshot.put("color", status.getColor());
                        snapshot.put("display_order", status.getDisplayOrder());
                        snapshot.put("is_default", status.getIsDefault());
                        snapshot.put("is_active", status.getIsActive());
                        snapshot.put("show_in_filter", status.getShowInFilter());
                        return snapshot;
                    })
                    .orElse(null);
        } catch (Exception e) {
            logger.warn("Could not snapshot lead status {}: {}", leadStatusId, e.getMessage());
            return null;
        }
    }

    /** Human label of a lead tier id ("Super Hot"), falling back to the id. */
    public String leadTierFor(String leadTierId) {
        if (isBlank(leadTierId)) {
            return null;
        }
        try {
            return leadTierRepository.findById(leadTierId)
                    .map(LeadTier::getLabel)
                    .filter(label -> !isBlank(label))
                    .map(String::trim)
                    .orElse(leadTierId);
        } catch (Exception e) {
            logger.warn("Could not resolve lead tier label for {}: {}", leadTierId, e.getMessage());
            return leadTierId;
        }
    }

    /** Snapshot of a lead tier row, for UPDATE/DELETE before-payloads. */
    public Map<String, Object> leadTierSnapshot(String leadTierId) {
        if (isBlank(leadTierId)) {
            return null;
        }
        try {
            return leadTierRepository.findById(leadTierId)
                    .map(tier -> {
                        Map<String, Object> snapshot = new LinkedHashMap<>();
                        snapshot.put("id", tier.getId());
                        snapshot.put("name", tier.getLabel());
                        snapshot.put("tier_key", tier.getTierKey());
                        snapshot.put("color", tier.getColor());
                        snapshot.put("display_order", tier.getDisplayOrder());
                        snapshot.put("min_score", tier.getMinScore());
                        snapshot.put("is_active", tier.getIsActive());
                        return snapshot;
                    })
                    .orElse(null);
        } catch (Exception e) {
            logger.warn("Could not snapshot lead tier {}: {}", leadTierId, e.getMessage());
            return null;
        }
    }

    // ── Follow-ups ────────────────────────────────────────────────────────

    /** "Amit Kumar" — the lead a follow-up belongs to, for update/close rows. */
    public String followupLeadFor(String followupId) {
        if (isBlank(followupId)) {
            return null;
        }
        try {
            return leadFollowupRepository.findById(followupId)
                    .map(LeadFollowup::getAudienceResponseId)
                    .map(this::leadFor)
                    .orElse(null);
        } catch (Exception e) {
            logger.warn("Could not resolve follow-up {}: {}", followupId, e.getMessage());
            return null;
        }
    }

    /**
     * The editable part of a follow-up, for UPDATE before-payloads — notes stay
     * editable after closing, so this is the only record of what was there before.
     */
    public Map<String, Object> followupSnapshot(String followupId) {
        if (isBlank(followupId)) {
            return null;
        }
        try {
            return leadFollowupRepository.findById(followupId)
                    .map(f -> {
                        Map<String, Object> snapshot = new LinkedHashMap<>();
                        snapshot.put("id", f.getId());
                        snapshot.put("schedule_time", f.getScheduleTime());
                        snapshot.put("content", f.getContent());
                        snapshot.put("closer_reason", f.getCloserReason());
                        snapshot.put("interest_level", f.getInterestLevel());
                        snapshot.put("is_closed", f.getIsClosed());
                        return snapshot;
                    })
                    .orElse(null);
        } catch (Exception e) {
            logger.warn("Could not snapshot follow-up {}: {}", followupId, e.getMessage());
            return null;
        }
    }

    // ── People (counsellors, staff) ───────────────────────────────────────

    /**
     * Name of a staff member — a counsellor, a pool member, whoever a target
     * was set for — falling back to the id.
     *
     * <p>The only record of a staff name inside admin_core's own database is
     * the denormalized {@code assigned_counselor_name} the CRM writes onto a
     * lead profile, so that is what this reads. A staff member who has never
     * been assigned a lead is named by their learner record if they happen to
     * have one, and otherwise stays an id — better than the previous behaviour,
     * which was an id every single time because the lookup queried a table this
     * service cannot see.
     */
    public String personFor(String userId) {
        if (isBlank(userId)) {
            return null;
        }
        try {
            String counsellorName = userLeadProfileRepository
                    .findFirstByAssignedCounselorIdAndAssignedCounselorNameIsNotNull(userId)
                    .map(UserLeadProfile::getAssignedCounselorName)
                    .filter(name -> !isBlank(name))
                    .map(String::trim)
                    .orElse(null);
            if (counsellorName != null) {
                return counsellorName;
            }
        } catch (Exception e) {
            logger.warn("Could not resolve counsellor name for {}: {}", userId, e.getMessage());
        }
        String learnerName = studentNameFor(userId);
        return learnerName != null ? learnerName : userId;
    }

    /** Names one person, or counts several — for bulk assign/target actions. */
    public String peopleFor(List<String> userIds) {
        List<String> ids = distinctNonBlank(userIds);
        if (ids.isEmpty()) {
            return null;
        }
        if (ids.size() > 1) {
            return ids.size() + " user(s)";
        }
        return personFor(ids.get(0));
    }

    // ── Phrase helpers used directly from annotations ─────────────────────

    /**
     * The counsellor currently on a lead, read <em>before</em> a reassignment.
     * Exists so the audit can tell a real removal from a no-op: the assign
     * endpoint returns early, and 200, when asked to unassign a lead that has
     * no counsellor, and logging that would claim an action nobody performed.
     */
    public String assignedCounsellorFor(String leadUserId, String instituteId) {
        if (isBlank(leadUserId) || isBlank(instituteId)) {
            return null;
        }
        try {
            return userLeadProfileRepository.findByUserIdAndInstituteId(leadUserId, instituteId)
                    .map(profile -> profile.getAssignedCounselorId())
                    .filter(id -> !isBlank(id))
                    .orElse(null);
        } catch (Exception e) {
            logger.warn("Could not read the assigned counsellor for {}: {}", leadUserId, e.getMessage());
            return null;
        }
    }

    /**
     * "assigned Amit Kumar to Rahul" / "unassigned Amit Kumar from Rahul".
     * The counsellor name is optional — assignment dialogs send it, other
     * callers only send the id, which we then resolve.
     */
    public String counsellorAssignment(String leadUserId, String counsellorId, String counsellorName) {
        String who = leadUserFor(leadUserId);
        if (isBlank(counsellorId)) {
            return who == null ? null : "unassigned counsellor from lead " + who;
        }
        String counsellor = !isBlank(counsellorName) ? counsellorName.trim() : personFor(counsellorId);
        if (who == null) {
            return counsellor == null ? null : "assigned a lead to " + counsellor;
        }
        return "assigned lead " + who + " to " + (counsellor != null ? counsellor : counsellorId);
    }

    // ── Internals ─────────────────────────────────────────────────────────

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private List<String> distinctNonBlank(List<String> values) {
        if (values == null) {
            return List.of();
        }
        return values.stream()
                .filter(Objects::nonNull)
                .filter(value -> !value.isBlank())
                .distinct()
                .toList();
    }
}
