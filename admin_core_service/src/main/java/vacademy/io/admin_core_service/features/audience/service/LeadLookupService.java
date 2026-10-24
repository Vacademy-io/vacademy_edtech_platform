package vacademy.io.admin_core_service.features.audience.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.audience.dto.LeadLookupResultDto;
import vacademy.io.admin_core_service.features.audience.entity.LeadFollowup;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.audience.repository.LeadFollowupRepository;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.counsellor_workbench.service.CounsellorScopeService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * "Is this phone / email already ours?" — the one thing a counsellor may learn
 * about a lead that belongs to someone else.
 *
 * A counsellor only sees the leads assigned to them, so searching a number that
 * a colleague already owns returns nothing, and they call it as a fresh lead.
 * This closes that gap without widening the lead list: it answers for one exact
 * phone or email, with the handful of fields the institute chose to share, and
 * returns no identifier that would let the caller reach anything else.
 *
 * <p><b>Name search is off unless the institute turns it on.</b> Phone and email
 * are things the caller already has in front of them; a name is something they
 * can guess, so searching by name is the one mode that could be used to page
 * through other counsellors' leads. Where an institute does enable it the match
 * is <b>exact</b> - the whole name, not a prefix or a substring - so it answers
 * "is this person already ours" without being walkable one letter at a time.
 *
 * <p><b>Follow-up history only for the lead's own side.</b> An admin, or the
 * counsellor the lead is assigned to (or their team lead), gets every field plus
 * the follow-up history. Another counsellor gets the shared lead details and no
 * history — they need to know the lead is taken, not how it is being worked.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class LeadLookupService {

    private final AudienceResponseRepository audienceResponseRepository;
    private final LeadLookupSettingService settingService;
    private final CounsellorScopeService counsellorScopeService;
    private final LeadFollowupRepository leadFollowupRepository;
    private final AuthService authService;
    private final LeadDedupSettingService leadDedupSettingService;

    public LeadLookupResultDto lookup(String instituteId, String phone, String email, String name,
                                      CustomUserDetails caller) {
        if (instituteId == null || instituteId.isBlank()) {
            throw new VacademyException("instituteId is required");
        }
        LeadLookupSettingService.LookupSettings settings = settingService.get(instituteId);
        if (!settings.enabled()) {
            throw new VacademyException("Lead lookup is not enabled for this institute");
        }

        // Admins are not scoped out of lead data anywhere else, so masking here
        // would only make the same records harder to reach. They get everything.
        boolean isAdmin = counsellorScopeService.hasAdminRole(caller, instituteId);
        LeadLookupSettingService.Fields fields = isAdmin
                ? LeadLookupSettingService.Fields.ALL
                : settings.fields();
        if (fields.isEmpty()) {
            throw new VacademyException("Lead lookup has no fields configured for this institute");
        }

        String last10 = lastTenDigits(phone);
        String normalisedEmail = (email == null || email.isBlank()) ? null : email.trim();
        String normalisedName = (name == null || name.isBlank()) ? null : name.trim();
        // Name search is for counsellors only. An admin already has a real name
        // search over every lead in the leads list, so routing them through a
        // one-answer-at-a-time probe adds nothing. Field masking is separate -
        // admins still see every field on whatever they do look up.
        if (normalisedName != null && (!settings.searchByName() || isAdmin)) {
            throw new VacademyException(
                    "Search by name is not available here - use the leads list");
        }
        if (last10 == null && normalisedEmail == null && normalisedName == null) {
            throw new VacademyException("Search by a full phone number, an email address or a full name");
        }

        Optional<AudienceResponseRepository.LeadLookupRow> match = audienceResponseRepository
                .lookupByPhoneOrEmail(instituteId, last10, normalisedEmail, normalisedName,
                        settings.courseFieldId(), settings.branchFieldId());

        if (match.isEmpty()) {
            return LeadLookupResultDto.builder().found(false).build();
        }

        AudienceResponseRepository.LeadLookupRow row = match.get();
        boolean ownLead = !isAdmin && isOwnLead(instituteId, row.getCounsellorId(), caller);
        if (ownLead) {
            // Their own lead: nothing to mask, the same view an admin gets.
            fields = LeadLookupSettingService.Fields.ALL;
        }
        boolean followUpsVisible = isAdmin || ownLead;

        List<LeadFollowup> followUps = followUpsVisible
                ? followUpsFor(instituteId, last10, normalisedEmail, normalisedName)
                : List.of();
        Map<String, UserDTO> users = usersById(row, fields, followUps);
        UserDTO leadUser = row.getUserId() != null ? users.get(row.getUserId()) : null;

        LeadLookupResultDto.LeadLookupResultDtoBuilder result = LeadLookupResultDto.builder()
                .found(true)
                .leadName(fields.name() ? firstNonBlank(row.getLeadName(),
                        leadUser != null ? leadUser.getFullName() : null) : null)
                .leadEmail(fields.email() ? firstNonBlank(row.getLeadEmail(),
                        leadUser != null ? leadUser.getEmail() : null) : null)
                .leadMobile(fields.phone() ? firstNonBlank(row.getLeadMobile(),
                        leadUser != null ? leadUser.getMobileNumber() : null) : null)
                .counsellorName(fields.counsellor() ? blankToNull(row.getCounsellorName()) : null)
                .enquiredBy(fields.enquiredBy() ? nameOf(users, row.getCreatedByUserId()) : null)
                .campaignType(fields.source() ? blankToNull(row.getCampaignType()) : null)
                .campaignName(fields.campaign() ? blankToNull(row.getCampaignName()) : null)
                .status(fields.status() ? blankToNull(row.getStatusLabel()) : null)
                .stage(fields.status() ? stageOf(row) : null)
                .course(fields.course() ? blankToNull(row.getCourseValue()) : null)
                .branch(fields.branch() ? blankToNull(row.getBranchValue()) : null)
                .optedOut("OPTED_OUT".equalsIgnoreCase(row.getOverallStatus()))
                .followUpsVisible(followUpsVisible);

        if (followUpsVisible) {
            result.leadCreatedAt(row.getCreatedAt())
                    .interestLevel(blankToNull(row.getInterestLevel()))
                    .nextFollowUpAt(followUps.stream()
                            .filter(LeadLookupService::isOpen)
                            .map(LeadFollowup::getScheduleTime)
                            .filter(Objects::nonNull)
                            .min(Comparator.naturalOrder())
                            .orElse(null))
                    .followUps(followUps.stream()
                            .map(f -> LeadLookupResultDto.FollowUpEntry.builder()
                                    .scheduleTime(f.getScheduleTime())
                                    .status(f.getStatus())
                                    .counsellorName(nameOf(users, f.getCreatedBy()))
                                    .actionLabel(blankToNull(f.getNextAction()))
                                    .mode(blankToNull(f.getFollowUpMode()))
                                    .comments(blankToNull(f.getContent()))
                                    .studentResponse(blankToNull(f.getStudentResponse()))
                                    .interestLevel(blankToNull(f.getInterestLevel()))
                                    .closerReason(blankToNull(f.getCloserReason()))
                                    .closedAt(f.getClosedAt())
                                    .createdAt(f.getCreatedAt())
                                    .build())
                            .toList());
        }
        return result.build();
    }

    private List<LeadFollowup> followUpsFor(String instituteId, String last10, String email, String name) {
        List<String> responseIds = audienceResponseRepository
                .lookupMatchingResponseIds(instituteId, last10, email, name, reattemptsFlagged(instituteId));
        return responseIds.isEmpty()
                ? List.of()
                : leadFollowupRepository.findByAudienceResponseIdInOrderByScheduleTimeDesc(responseIds);
    }

    /** The institute's repeat-lead handling flags reattempts as duplicates (Lead Settings). */
    private boolean reattemptsFlagged(String instituteId) {
        try {
            return leadDedupSettingService.get(instituteId).repeatLead().reattempt().markDuplicate();
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Is the lead assigned to the caller, or to a counsellor in the caller's team?
     * Same hierarchy test the follow-up endpoint uses. An unassigned lead is
     * nobody's own: it keeps the institute's field masking and no history, as
     * before this rule existed — unmasking it would hand every counsellor the
     * phone and email of every pool lead.
     */
    private boolean isOwnLead(String instituteId, String assigneeId, CustomUserDetails caller) {
        if (caller == null || caller.getUserId() == null) return false;
        if (assigneeId == null || assigneeId.isBlank()) return false;
        if (assigneeId.equals(caller.getUserId())) return true;
        try {
            return counsellorScopeService.scopedCounsellorUserIds(instituteId, caller.getUserId())
                    .contains(assigneeId);
        } catch (Exception e) {
            log.warn("[leadLookup] scope check failed for {}: {}", caller.getUserId(), e.getMessage());
            return false;
        }
    }

    /**
     * Admission Taken (Ongoing / Completed), Discarded or Pending. Admitted is
     * read off either the status or the lead profile — the two drift apart on
     * migrated leads, and a person who paid is admitted whichever one says so.
     */
    private String stageOf(AudienceResponseRepository.LeadLookupRow row) {
        boolean admitted = "CONVERTED".equalsIgnoreCase(row.getStatusKey())
                || "CONVERTED".equalsIgnoreCase(row.getConversionStatus());
        if (admitted) {
            return switch (String.valueOf(row.getEnrolmentState())) {
                case "ONGOING" -> "ADMISSION_ONGOING";
                case "COMPLETED" -> "ADMISSION_COMPLETED";
                default -> "ADMISSION_TAKEN";
            };
        }
        return "LOST".equalsIgnoreCase(row.getStatusKey()) ? "DISCARDED" : "PENDING";
    }

    private static boolean isOpen(LeadFollowup f) {
        return !Boolean.TRUE.equals(f.getIsClosed()) && !"COMPLETED".equalsIgnoreCase(f.getStatus());
    }

    /**
     * One auth-service call for every name the card needs: the lead itself
     * (user-linked leads keep parent_name blank), who entered it, and who logged
     * each follow-up. A failure leaves names blank rather than failing the lookup.
     */
    private Map<String, UserDTO> usersById(AudienceResponseRepository.LeadLookupRow row,
                                           LeadLookupSettingService.Fields fields,
                                           List<LeadFollowup> followUps) {
        Set<String> ids = new HashSet<>();
        boolean leadIdentityMissing = (fields.name() && isBlank(row.getLeadName()))
                || (fields.email() && isBlank(row.getLeadEmail()))
                || (fields.phone() && isBlank(row.getLeadMobile()));
        if (leadIdentityMissing && !isBlank(row.getUserId())) ids.add(row.getUserId());
        if (fields.enquiredBy() && !isBlank(row.getCreatedByUserId())) ids.add(row.getCreatedByUserId());
        followUps.stream().map(LeadFollowup::getCreatedBy).filter(id -> !isBlank(id)).forEach(ids::add);
        if (ids.isEmpty()) return Map.of();
        try {
            return authService.getUsersFromAuthServiceByUserIds(new ArrayList<>(ids)).stream()
                    .filter(u -> u != null && u.getId() != null)
                    .collect(Collectors.toMap(UserDTO::getId, u -> u, (a, b) -> a));
        } catch (Exception e) {
            log.warn("[leadLookup] user name lookup failed: {}", e.getMessage());
            return Map.of();
        }
    }

    private String nameOf(Map<String, UserDTO> users, String userId) {
        if (userId == null) return null;
        UserDTO u = users.get(userId);
        return u != null ? blankToNull(u.getFullName()) : null;
    }

    private String firstNonBlank(String a, String b) {
        return !isBlank(a) ? a : blankToNull(b);
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    /**
     * Last 10 digits, matching the dedup check — most stored numbers have no
     * country code, so comparing the tail is what makes "+91 98…" and "98…" the
     * same person. Fewer than 10 digits is a partial number, not a lookup: it
     * would match whoever happens to share the suffix.
     */
    private String lastTenDigits(String phone) {
        if (phone == null) return null;
        String digits = phone.replaceAll("[^0-9]", "");
        return digits.length() < 10 ? null : digits.substring(digits.length() - 10);
    }

    private String blankToNull(String value) {
        return (value == null || value.isBlank()) ? null : value;
    }
}
