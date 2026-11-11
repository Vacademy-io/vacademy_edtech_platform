package vacademy.io.admin_core_service.features.audience.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.audience.dto.LeadMergeDTOs;
import vacademy.io.admin_core_service.features.audience.repository.LeadMergeDao;
import vacademy.io.admin_core_service.features.counsellor_workbench.service.CounsellorScopeService;
import vacademy.io.admin_core_service.features.timeline.entity.TimelineEvent;
import vacademy.io.admin_core_service.features.timeline.enums.TimelineCategory;
import vacademy.io.admin_core_service.features.timeline.repository.TimelineEventRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * Merges one person's leads into another person in the same institute, and undoes it.
 *
 * <p>A person in the CRM is a user id: their enquiries ({@code audience_response.user_id})
 * and their lead profile ({@code user_lead_profile}, one per institute). A merge moves the
 * duplicate's enquiries in this institute to the person kept (their follow-ups and timeline
 * are keyed by the enquiry, so they move with it), remembers each enquiry's previous user id,
 * and marks the duplicate's profile as merged so it stops counting as a lead or an admission.
 * Users themselves and other institutes' data are never touched.
 *
 * <p>Only plain duplicates are merged here: a duplicate with an enrolment, a plan or a payment,
 * or one linked to someone else's enquiry, is refused with the reason, for a person to fix.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class LeadMergeService {

    public static final String EVENT_TYPE = "USER_LEAD_PROFILE";
    public static final String ACTION_MERGED = "LEAD_MERGED";
    public static final String ACTION_UNMERGED = "LEAD_UNMERGED";
    static final int MAX_NAME_MATCHES = 10;

    private final LeadMergeDao dao;
    private final InstituteAccessValidator accessValidator;
    private final CounsellorScopeService counsellorScopeService;
    private final TimelineEventRepository timelineEventRepository;
    private final ObjectMapper objectMapper;

    // ── merge ────────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public LeadMergeDTOs.Preview preview(String instituteId, LeadMergeDTOs.MergeRequest request,
                                         CustomUserDetails caller) {
        accessValidator.requireInstituteAdmin(caller, instituteId);
        Pair pair = pair(request);
        return buildPreview(instituteId, pair);
    }

    @Transactional
    public LeadMergeDTOs.MergeResult merge(String instituteId, LeadMergeDTOs.MergeRequest request,
                                           CustomUserDetails caller) {
        accessValidator.requireInstituteAdmin(caller, instituteId);
        Pair pair = pair(request);
        if (!pair.keep.equals(pair.duplicate)) {
            dao.lockProfiles(instituteId, pair.keep, pair.duplicate);
        }
        LeadMergeDTOs.Preview preview = buildPreview(instituteId, pair);
        if (!preview.canMerge()) {
            throw new VacademyException(preview.refusals().get(0).message());
        }
        int moved = dao.moveEnquiries(instituteId, pair.duplicate, pair.keep);
        if (dao.markMerged(instituteId, preview.duplicate().profileId(), pair.keep, caller.getUserId()) != 1) {
            throw new VacademyException("This person changed while merging. Try again.");
        }
        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("kept_user_id", pair.keep);
        meta.put("merged_user_id", pair.duplicate);
        meta.put("enquiries_moved", moved);
        meta.put("moved_enquiry_ids", preview.duplicate().enquiries().stream()
                .map(LeadMergeDTOs.Enquiry::responseId).toList());
        String who = displayName(preview.duplicate());
        logEvent(instituteId, preview.keep().profileId(), pair.keep, ACTION_MERGED, caller,
                "Duplicate merged in",
                who + " was merged into this person: " + moved + " " + plural(moved, "enquiry", "enquiries")
                        + " moved here.", meta);
        logEvent(instituteId, preview.duplicate().profileId(), pair.duplicate, ACTION_MERGED, caller,
                "Merged into another person",
                "This person was merged into " + displayName(preview.keep()) + ". Their "
                        + plural(moved, "enquiry", "enquiries") + " moved there and this profile no longer"
                        + " counts as a lead.", meta);
        log.info("Merged lead person into another in institute {}: {} enquiries moved", instituteId, moved);
        return new LeadMergeDTOs.MergeResult(pair.keep, pair.duplicate, moved, now());
    }

    // ── unmerge ──────────────────────────────────────────────────────────

    @Transactional
    public LeadMergeDTOs.UnmergeResult unmerge(String instituteId, LeadMergeDTOs.UnmergeRequest request,
                                               CustomUserDetails caller) {
        accessValidator.requireInstituteAdmin(caller, instituteId);
        String duplicate = clean(request == null ? null : request.duplicateUserId());
        if (duplicate == null) {
            throw new VacademyException("duplicate_user_id is required");
        }
        LeadMergeDao.Profile profile = dao.findProfile(instituteId, duplicate)
                .orElseThrow(() -> new VacademyException("This person is not a lead in this institute."));
        String keep = profile.mergedIntoUserId();
        if (keep == null) {
            throw new VacademyException("This person is not merged into anyone.");
        }
        dao.lockProfiles(instituteId, keep, duplicate);
        LeadMergeDao.Profile locked = dao.findProfile(instituteId, duplicate).orElse(profile);
        if (!keep.equals(locked.mergedIntoUserId())) {
            throw new VacademyException("This person changed while undoing the merge. Try again.");
        }
        int back = dao.moveEnquiriesBack(instituteId, duplicate, keep);
        if (dao.clearMerged(instituteId, profile.id(), keep) != 1) {
            throw new VacademyException("This person changed while undoing the merge. Try again.");
        }
        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("kept_user_id", keep);
        meta.put("merged_user_id", duplicate);
        meta.put("enquiries_moved_back", back);
        String keepProfileId = dao.findProfile(instituteId, keep).map(LeadMergeDao.Profile::id).orElse(null);
        if (keepProfileId != null) {
            logEvent(instituteId, keepProfileId, keep, ACTION_UNMERGED, caller, "Merge undone",
                    "A merged person was split out again: " + back + " "
                            + plural(back, "enquiry", "enquiries") + " moved back to them.", meta);
        }
        logEvent(instituteId, profile.id(), duplicate, ACTION_UNMERGED, caller, "Merge undone",
                "This person is a separate lead again: " + back + " " + plural(back, "enquiry", "enquiries")
                        + " moved back here.", meta);
        log.info("Undid a lead person merge in institute {}: {} enquiries moved back", instituteId, back);
        return new LeadMergeDTOs.UnmergeResult(keep, duplicate, back);
    }

    // ── state ────────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public LeadMergeDTOs.MergeState state(String instituteId, String userId, CustomUserDetails caller) {
        accessValidator.requireInstituteStaff(caller, instituteId);
        String user = clean(userId);
        if (user == null) {
            throw new VacademyException("userId is required");
        }
        Optional<LeadMergeDao.Profile> profile = dao.findProfile(instituteId, user);
        List<LeadMergeDTOs.MergedPerson> merged = dao.mergedInto(instituteId, user).stream()
                .map(m -> new LeadMergeDTOs.MergedPerson(m.userId(), m.name(), m.mergedAt(), m.mergedByUserId(),
                        m.enquiries()))
                .toList();
        return new LeadMergeDTOs.MergeState(user, profile.map(LeadMergeDao.Profile::mergedIntoUserId).orElse(null),
                profile.map(LeadMergeDao.Profile::mergedAt).orElse(null), merged);
    }

    // ── similar names ────────────────────────────────────────────────────

    /**
     * Live leads here with a name like {@code name} (same once normalised, or same first and last
     * word), submitted in the last 180 days. A warning for the person adding a lead, never a block.
     * Contact is masked; a caller whose lead view is narrowed to their team sees only those leads,
     * and how many others matched.
     */
    @Transactional(readOnly = true)
    public LeadMergeDTOs.SimilarNames similarNames(String instituteId, String name, CustomUserDetails caller) {
        accessValidator.requireInstituteStaff(caller, instituteId);
        String n = clean(name);
        if (n == null || n.length() < 3 || n.length() > 200) {
            return new LeadMergeDTOs.SimilarNames(List.of(), 0, LeadMergeDao.SIMILAR_NAME_DAYS);
        }
        List<LeadMergeDao.NameMatch> found;
        try {
            found = dao.similarNames(instituteId, n, 50);
        } catch (DataAccessException e) {
            log.warn("Similar-name check skipped in institute {}: {}", instituteId, e.getMessage());
            return new LeadMergeDTOs.SimilarNames(List.of(), 0, LeadMergeDao.SIMILAR_NAME_DAYS);
        }
        Set<String> visible = null;
        if (!counsellorScopeService.hasAdminRole(caller, instituteId)
                && counsellorScopeService.isScopedCaller(instituteId, caller)) {
            visible = new HashSet<>(counsellorScopeService.scopedCounsellorUserIds(instituteId, caller.getUserId()));
            visible.add(caller.getUserId());
        }
        List<LeadMergeDTOs.NameMatch> shown = new ArrayList<>();
        int hidden = 0;
        for (LeadMergeDao.NameMatch m : found) {
            if (visible != null && (m.counsellorId() == null || !visible.contains(m.counsellorId()))) {
                hidden++;
                continue;
            }
            if (shown.size() >= MAX_NAME_MATCHES) {
                hidden++;
                continue;
            }
            shown.add(new LeadMergeDTOs.NameMatch(m.responseId(), m.userId(), m.name(), maskPhone(m.phone()),
                    maskEmail(m.email()), m.listName(), m.statusKey(), m.submittedAt(), m.exact()));
        }
        return new LeadMergeDTOs.SimilarNames(shown, hidden, LeadMergeDao.SIMILAR_NAME_DAYS);
    }

    // ── the checks ───────────────────────────────────────────────────────

    private LeadMergeDTOs.Preview buildPreview(String instituteId, Pair pair) {
        List<LeadMergeDTOs.Refusal> refusals = new ArrayList<>();
        if (pair.keep.equals(pair.duplicate)) {
            refusals.add(refusal("SAME_PERSON", "You picked the same person twice. Pick two different people."));
            return new LeadMergeDTOs.Preview(null, null, false, refusals, List.of());
        }
        Optional<LeadMergeDao.Profile> keepProfile = dao.findProfile(instituteId, pair.keep);
        Optional<LeadMergeDao.Profile> dupProfile = dao.findProfile(instituteId, pair.duplicate);
        if (keepProfile.isEmpty()) {
            refusals.add(refusal("KEEP_NOT_IN_INSTITUTE", "The person to keep is not a lead in this institute."));
        }
        if (dupProfile.isEmpty()) {
            refusals.add(refusal("DUPLICATE_NOT_IN_INSTITUTE", "The duplicate is not a lead in this institute."));
        }
        if (!refusals.isEmpty()) {
            return new LeadMergeDTOs.Preview(null, null, false, refusals, List.of());
        }
        List<LeadMergeDao.Enquiry> keepEnquiries = dao.enquiriesOf(instituteId, pair.keep);
        List<LeadMergeDao.Enquiry> dupEnquiries = dao.enquiriesOf(instituteId, pair.duplicate);
        LeadMergeDTOs.Person keep = person(keepProfile.get(), keepEnquiries);
        LeadMergeDTOs.Person dup = person(dupProfile.get(), dupEnquiries);

        if (keepProfile.get().mergedIntoUserId() != null) {
            refusals.add(refusal("KEEP_IS_MERGED", "The person to keep was merged into someone else. Pick that "
                    + "person instead, or undo that merge first."));
        }
        if (dupProfile.get().mergedIntoUserId() != null) {
            refusals.add(refusal("DUPLICATE_ALREADY_MERGED", "The duplicate was already merged into another "
                    + "person. Undo that merge first."));
        }
        if (!dao.mergedInto(instituteId, pair.duplicate).isEmpty()) {
            refusals.add(refusal("DUPLICATE_HAS_MERGED_PEOPLE", "Other people were merged into the duplicate. "
                    + "Undo those merges first, or keep the duplicate and merge the other person into it."));
        }
        if (dao.hasOptedOut(instituteId, pair.keep)) {
            refusals.add(refusal("KEEP_OPTED_OUT", "The person to keep opted out of contact. Merging would give "
                    + "enquiries to someone who asked not to be contacted, so this needs a person to review it."));
        }
        if (dao.hasOptedOut(instituteId, pair.duplicate)) {
            refusals.add(refusal("DUPLICATE_OPTED_OUT", "The duplicate opted out of contact. Merging would carry "
                    + "that opt-out to the person you keep, so this needs a person to review it."));
        }
        if (dao.hasEnrolment(instituteId, pair.duplicate)) {
            refusals.add(refusal("DUPLICATE_ENROLLED", "The duplicate is enrolled in a course here. People with "
                    + "an enrolment are not merged automatically; ask your admin team to fix it by hand."));
        }
        if (dao.hasPlan(instituteId, pair.duplicate)) {
            refusals.add(refusal("DUPLICATE_HAS_PLAN", "The duplicate has a plan here. People with a plan are not "
                    + "merged automatically; ask your admin team to fix it by hand."));
        }
        if (dao.hasPayment(instituteId, pair.duplicate)) {
            refusals.add(refusal("DUPLICATE_HAS_PAYMENT", "The duplicate has fees or payments recorded here. People "
                    + "with payments are not merged automatically; ask your admin team to fix it by hand."));
        }
        if (dao.isLinkedOnOtherEnquiry(instituteId, pair.duplicate)) {
            refusals.add(refusal("DUPLICATE_LINKED_ELSEWHERE", "The duplicate is the linked student on someone "
                    + "else's enquiry here. Merging would change that enquiry too, so this needs a person to fix "
                    + "it by hand."));
        }
        if (dao.areLinked(instituteId, pair.keep, pair.duplicate)) {
            refusals.add(refusal("PEOPLE_LINKED", "One of these people is recorded as the other's student on an "
                    + "enquiry, so they are not the same person."));
        }
        List<String> effects = new ArrayList<>();
        effects.add(dupEnquiries.size() + " " + plural(dupEnquiries.size(), "enquiry", "enquiries")
                + " of the duplicate move to the person you keep, with their follow-ups, notes and history.");
        effects.add("The duplicate stops counting as a lead or an admission. Their account is not changed or"
                + " deleted.");
        effects.add("The person you keep keeps their own status ("
                + Optional.ofNullable(keepProfile.get().conversionStatus()).orElse("LEAD")
                + "), owner and tier; change them after the merge if needed.");
        effects.add("The merge can be undone from the duplicate's details; enquiries moved by it go back.");
        return new LeadMergeDTOs.Preview(keep, dup, refusals.isEmpty(), refusals, effects);
    }

    // ── helpers ──────────────────────────────────────────────────────────

    private record Pair(String keep, String duplicate) {
    }

    private static Pair pair(LeadMergeDTOs.MergeRequest request) {
        String keep = clean(request == null ? null : request.keepUserId());
        String dup = clean(request == null ? null : request.duplicateUserId());
        if (keep == null || dup == null) {
            throw new VacademyException("keep_user_id and duplicate_user_id are required");
        }
        return new Pair(keep, dup);
    }

    private static LeadMergeDTOs.Person person(LeadMergeDao.Profile p, List<LeadMergeDao.Enquiry> enquiries) {
        List<LeadMergeDTOs.Enquiry> rows = enquiries.stream()
                .map(e -> new LeadMergeDTOs.Enquiry(e.id(), e.listId(), e.listName(), e.name(), e.phone(), e.email(),
                        e.sourceType(), e.statusKey(), e.audienceStatus(), e.submittedAt()))
                .toList();
        String name = enquiries.stream().map(LeadMergeDao.Enquiry::name).filter(s -> s != null && !s.isBlank())
                .findFirst().orElse(null);
        return new LeadMergeDTOs.Person(p.userId(), p.id(), name, p.conversionStatus(), p.leadTier(),
                p.counsellorName(), p.createdAt(), p.mergedIntoUserId(), p.mergedAt(), rows);
    }

    private void logEvent(String instituteId, String profileId, String userId, String action,
                          CustomUserDetails caller, String title, String description, Map<String, Object> meta) {
        String json = null;
        try {
            json = objectMapper.writeValueAsString(meta);
        } catch (JsonProcessingException e) {
            log.warn("Could not write merge event metadata: {}", e.getMessage());
        }
        timelineEventRepository.save(TimelineEvent.builder()
                .type(EVENT_TYPE)
                .typeId(profileId)
                .actionType(action)
                .actorType("USER")
                .actorId(caller.getUserId())
                .actorName(caller.getFullName())
                .title(title)
                .description(description)
                .metadataJson(json)
                .studentUserId(userId)
                .category(TimelineCategory.JOURNEY)
                .instituteId(instituteId)
                .build());
    }

    private static String displayName(LeadMergeDTOs.Person p) {
        return p.name() != null && !p.name().isBlank() ? p.name().trim() : "Another person";
    }

    private static LeadMergeDTOs.Refusal refusal(String code, String message) {
        return new LeadMergeDTOs.Refusal(code, message);
    }

    private static String plural(int n, String one, String many) {
        return n == 1 ? one : many;
    }

    private static String clean(String s) {
        if (s == null) return null;
        String t = s.trim();
        return t.isEmpty() ? null : t;
    }

    private static Timestamp now() {
        return new Timestamp(System.currentTimeMillis());
    }

    /** The last four digits only. */
    static String maskPhone(String phone) {
        if (phone == null) return null;
        String digits = phone.replaceAll("[^0-9]", "");
        if (digits.isEmpty()) return null;
        String tail = digits.length() <= 4 ? digits : digits.substring(digits.length() - 4);
        return "******" + tail;
    }

    /** The first letter and the domain. */
    static String maskEmail(String email) {
        if (email == null) return null;
        String e = email.trim();
        int at = e.indexOf('@');
        if (at <= 0) return null;
        return e.charAt(0) + "***" + e.substring(at);
    }
}
