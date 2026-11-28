package vacademy.io.admin_core_service.features.audience.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.audience.dto.LeadEnquiryContactsDTO;
import vacademy.io.admin_core_service.features.audience.entity.AudienceResponse;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.timeline.enums.LeadJourneyActionType;
import vacademy.io.admin_core_service.features.timeline.service.TimelineEventService;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.function.Consumer;

/**
 * Lead deduplication service scoped within a single Audience/Campaign.
 * Generates a dedupe_key from normalized email + phone and checks for existing leads.
 */
@Service
public class LeadDeduplicationService {

    private static final Logger logger = LoggerFactory.getLogger(LeadDeduplicationService.class);

    @Autowired
    private AudienceResponseRepository audienceResponseRepository;

    @Autowired
    private TimelineEventService timelineEventService;

    @Autowired
    private LeadDedupSettingService leadDedupSettingService;

    @Autowired
    private PlaceholderEmailService placeholderEmailService;

    /**
     * Generate a dedupe key from email and phone.
     * Normalizes: lowercase email, strip non-digit chars from phone.
     * Returns SHA-256 hash truncated to 32 chars.
     */
    public String generateDedupeKey(String email, String phone) {
        String normalizedEmail = (email != null) ? email.toLowerCase().trim() : "";
        String normalizedPhone = (phone != null) ? phone.replaceAll("[^0-9]", "") : "";

        // If both are empty, return null (can't dedupe without identifier)
        if (normalizedEmail.isEmpty() && normalizedPhone.isEmpty()) {
            return null;
        }

        String combined = normalizedEmail + "|" + normalizedPhone;
        return sha256(combined).substring(0, 32);
    }

    /**
     * Check if a lead is a duplicate within the same campaign.
     *
     * @param audienceId   The campaign ID to scope the dedupe check
     * @param dedupeKey    The generated dedupe key
     * @return The existing primary AudienceResponse if duplicate, empty if new lead
     */
    public Optional<AudienceResponse> findDuplicate(String audienceId, String dedupeKey) {
        if (dedupeKey == null) return Optional.empty();
        return audienceResponseRepository.findByAudienceIdAndDedupeKey(audienceId, dedupeKey);
    }

    /**
     * Mark a new response as a duplicate and merge source info on the primary.
     *
     * @param duplicateResponse  The new (duplicate) response
     * @param primaryResponse    The existing (primary) response
     * @param sourceType         Source type of the new submission
     */
    public void markDuplicate(AudienceResponse duplicateResponse,
                               AudienceResponse primaryResponse,
                               String sourceType) {
        // Mark the new response as duplicate
        duplicateResponse.setIsDuplicate(true);
        duplicateResponse.setPrimaryResponseId(primaryResponse.getId());

        // Log a JOURNEY event on the primary response — duplicate merges are lifecycle milestones
        timelineEventService.logJourneyEvent(
                "AUDIENCE_RESPONSE",
                primaryResponse.getId(),
                LeadJourneyActionType.DUPLICATE_MERGED,
                "SYSTEM",
                null,
                "System",
                "Duplicate lead merged",
                "New submission from " + (sourceType != null ? sourceType : "UNKNOWN")
                        + " merged into this lead",
                Map.of(
                        "duplicate_response_id", duplicateResponse.getId() != null ? duplicateResponse.getId() : "",
                        "source_type", sourceType != null ? sourceType : "UNKNOWN"
                ),
                primaryResponse.getStudentUserId()
        );

        logger.info("Marked response as duplicate of primary={}, source={}",
                primaryResponse.getId(), sourceType);
    }

    /**
     * Result of a duplicate match under the institute's configured action:
     * REJECT carries a user-facing rejection message; ALLOW_REASSIGN carries the
     * repeat-lead settings the caller must apply (counsellor + status handling).
     */
    public record DuplicateMatch(LeadDedupSettingService.DedupAction action, String rejectionMessage,
            LeadDedupSettingService.RepeatLeadSettings repeatLeadSettings) {
    }

    /**
     * Institute-configurable dedup check (LEAD_SETTING.data.dedup).
     * Independent of {@link #generateDedupeKey} / {@link #findDuplicate} / {@link #markDuplicate},
     * which remain the enquiry flow's soft-merge mechanism used when this setting is disabled.
     *
     * @return empty if the setting is disabled, the relevant field is blank, or no match was
     *         found; otherwise a {@link DuplicateMatch} — REJECT (block the submission, as
     *         before) or ALLOW_REASSIGN (let it through, caller applies repeatLeadSettings).
     */
    public Optional<DuplicateMatch> checkDuplicate(String instituteId, String audienceId, String email, String phone) {
        return checkDuplicate(instituteId, audienceId, email, phone, null);
    }

    /**
     * Same as {@link #checkDuplicate(String, String, String, String)}, but excludes a specific
     * response id from the match — for an in-place lead edit (updateLeadProfile), so checking
     * "does this new value collide with some OTHER lead" doesn't match the row being edited
     * against its own not-yet-saved self. Creation-flow callers pass null (nothing to exclude).
     */
    public Optional<DuplicateMatch> checkDuplicate(String instituteId, String audienceId, String email, String phone,
            String excludeResponseId) {
        LeadDedupSettingService.DedupSettings settings = leadDedupSettingService.get(instituteId);
        if (!settings.enabled()) return Optional.empty();

        LeadDedupSettingService.DedupScope scope = settings.scope();
        // A SELECTED scope with no lists configured has nothing to check against —
        // fail open (no rejection) rather than silently blocking every submission.
        if (scope == LeadDedupSettingService.DedupScope.SELECTED
                && (settings.audienceIds() == null || settings.audienceIds().isEmpty())) {
            return Optional.empty();
        }

        String scopeLabel = switch (scope) {
            case INSTITUTE -> "in this institute";
            case SELECTED -> "in one of the selected lead lists";
            case CAMPAIGN -> "in this lead list";
        };

        boolean exists;
        String matchedFieldLabel;
        if (settings.field() == LeadDedupSettingService.DedupField.PHONE) {
            String last10 = lastNDigits(phone, 10);
            exists = last10 != null && switch (scope) {
                case INSTITUTE -> audienceResponseRepository
                        .existsByInstituteIdAndPhoneLast10(instituteId, last10, excludeResponseId);
                case SELECTED -> audienceResponseRepository.existsByAudienceIdInAndPhoneLast10(
                        settings.audienceIds(), last10, excludeResponseId);
                case CAMPAIGN -> audienceResponseRepository
                        .existsByAudienceIdAndPhoneLast10(audienceId, last10, excludeResponseId);
            };
            matchedFieldLabel = "phone number";
            // Intake only (nothing excluded): an in-place edit of one of this person's leads
            // must not collide with their other leads through the shared email.
            if (!exists && excludeResponseId == null && alsoMatchesEmail(settings) && isRealEmail(email, phone)) {
                exists = emailExists(settings, instituteId, audienceId, email, null);
                matchedFieldLabel = "email";
            }
        } else {
            exists = emailExists(settings, instituteId, audienceId, email, excludeResponseId);
            matchedFieldLabel = "email";
        }

        if (!exists) return Optional.empty();

        if (settings.action() == LeadDedupSettingService.DedupAction.ALLOW_REASSIGN) {
            return Optional.of(new DuplicateMatch(
                    LeadDedupSettingService.DedupAction.ALLOW_REASSIGN, null, settings.repeatLead()));
        }
        return Optional.of(new DuplicateMatch(
                LeadDedupSettingService.DedupAction.REJECT,
                "A lead with this " + matchedFieldLabel + " already exists " + scopeLabel + ".",
                null));
    }

    /**
     * Counsellor who owns the most recent OTHER lead matching this submission, under the
     * same field (email / phone) and scope the dedup check used — the "previous" counsellor
     * for the repeat-lead SAME_AS_PREVIOUS policy. Empty when the setting is off, the
     * identifier is blank, or no matching lead has an owner.
     *
     * <p>Needed because a repeat that matches on phone but carries a different email is a
     * NEW auth user with a fresh, ownerless profile — the previous owner lives on the
     * other lead's profile, not this one.
     */
    public Optional<String> findPreviousCounsellorId(String instituteId, String audienceId, String email,
            String phone, String excludeResponseId) {
        LeadDedupSettingService.DedupSettings settings = leadDedupSettingService.get(instituteId);
        if (!settings.enabled() || excludeResponseId == null) return Optional.empty();

        String audienceIdsCsv = scopeAudienceIdsCsv(settings, audienceId);

        List<String> owners;
        if (settings.field() == LeadDedupSettingService.DedupField.PHONE) {
            String last10 = lastNDigits(phone, 10);
            owners = last10 == null ? List.of() : audienceResponseRepository.findPreviousCounsellorIdByPhoneLast10(
                    instituteId, audienceIdsCsv, last10, excludeResponseId);
            if (owners.isEmpty() && alsoMatchesEmail(settings) && isRealEmail(email, phone)) {
                owners = audienceResponseRepository.findPreviousCounsellorIdByEmail(
                        instituteId, audienceIdsCsv, email, excludeResponseId);
            }
        } else {
            if (email == null || email.isBlank()) return Optional.empty();
            owners = audienceResponseRepository.findPreviousCounsellorIdByEmail(
                    instituteId, audienceIdsCsv, email, excludeResponseId);
        }
        return owners.isEmpty() ? Optional.empty() : Optional.ofNullable(owners.get(0));
    }

    /**
     * The person who already holds this phone in the dedup scope, when the institute dedups
     * on PHONE with "Allow & reassign" and has switched on repeatLead.samePersonByPhone. A
     * repeat that brings a different email then joins that person instead of becoming a
     * second person, a second lead and often a second owner (auth_service matches people by
     * email, not phone). Prefers a lead that has an owner, then the newest. Empty for any
     * other setting, a short phone, or no match.
     */
    public Optional<String> findExistingLeadUserIdByPhone(String instituteId, String audienceId, String phone) {
        LeadDedupSettingService.DedupSettings settings = phoneReassignSettings(instituteId);
        if (settings == null || !settings.repeatLead().samePersonByPhone()) return Optional.empty();
        String last10 = lastNDigits(phone, 10);
        if (last10 == null) return Optional.empty();
        List<String> users = audienceResponseRepository.findLeadUserIdByPhoneLast10(
                instituteId, scopeAudienceIdsCsv(settings, audienceId), last10);
        return users.isEmpty() ? Optional.empty() : Optional.ofNullable(users.get(0));
    }

    /**
     * Counsellor who currently owns the lead with this phone in the dedup scope (the most
     * recent active, owned one), when the institute dedups on PHONE with "Allow &
     * reassign" and has switched on repeatLead.blockOwnedManualAdd. Used to stop a
     * counsellor adding by hand a lead someone else owns.
     */
    public Optional<AudienceResponseRepository.LeadOwnerRow> findCurrentOwnerByPhone(String instituteId,
            String audienceId, String phone) {
        LeadDedupSettingService.DedupSettings settings = phoneReassignSettings(instituteId);
        if (settings == null || !settings.repeatLead().blockOwnedManualAdd()) return Optional.empty();
        String last10 = lastNDigits(phone, 10);
        if (last10 == null) return Optional.empty();
        List<AudienceResponseRepository.LeadOwnerRow> owners = audienceResponseRepository
                .findCurrentOwnerByPhoneLast10(instituteId, scopeAudienceIdsCsv(settings, audienceId), last10);
        return owners.isEmpty() ? Optional.empty() : Optional.ofNullable(owners.get(0));
    }

    /**
     * The lead a repeat enquiry repeats, under the same field (email / phone) and scope the
     * dedup check used: the active, non-duplicate other lead, an owned one first, then the
     * newest. Empty when the setting is off, the identifier is blank, or nothing matches.
     */
    public Optional<AudienceResponseRepository.PrimaryLeadRow> findPrimaryLead(String instituteId,
            String audienceId, String email, String phone, String excludeResponseId) {
        LeadDedupSettingService.DedupSettings settings = leadDedupSettingService.get(instituteId);
        if (!settings.enabled() || excludeResponseId == null) return Optional.empty();

        String audienceIdsCsv = scopeAudienceIdsCsv(settings, audienceId);

        List<AudienceResponseRepository.PrimaryLeadRow> rows;
        if (settings.field() == LeadDedupSettingService.DedupField.PHONE) {
            String last10 = lastNDigits(phone, 10);
            rows = last10 == null ? List.of() : audienceResponseRepository.findPrimaryLeadByPhoneLast10(
                    instituteId, audienceIdsCsv, last10, excludeResponseId);
            if (rows.isEmpty() && alsoMatchesEmail(settings) && isRealEmail(email, phone)) {
                rows = audienceResponseRepository.findPrimaryLeadByEmail(
                        instituteId, audienceIdsCsv, email, excludeResponseId);
            }
        } else {
            if (email == null || email.isBlank()) return Optional.empty();
            rows = audienceResponseRepository.findPrimaryLeadByEmail(
                    instituteId, audienceIdsCsv, email, excludeResponseId);
        }
        return rows.isEmpty() ? Optional.empty() : Optional.ofNullable(rows.get(0));
    }

    /**
     * A "Reattempt" entry in the journey of the lead a repeat enquiry repeats, naming where
     * the enquiry came from, the list it landed in and any phone or email it brought that
     * the lead does not have.
     */
    public void logReattempt(AudienceResponseRepository.PrimaryLeadRow primary, AudienceResponse repeat,
            String sourceLabel, String campaignName) {
        StringBuilder description = new StringBuilder("Enquired again");
        if (sourceLabel != null && !sourceLabel.isBlank()) {
            description.append(" via ").append(sourceLabel);
        }
        if (campaignName != null && !campaignName.isBlank()) {
            description.append(" · ").append(campaignName);
        }
        AudienceResponseRepository.ResponseContactRow primaryRow = primaryContactForNotes(primary, repeat);
        String numberNote = primaryRow == null ? null : reattemptNumberNote(primaryRow, repeat);
        if (numberNote != null) {
            description.append(" · ").append(numberNote);
        }
        String emailNote = primaryRow == null ? null : reattemptEmailNote(primaryRow, repeat);
        if (emailNote != null) {
            description.append(" · ").append(emailNote);
        }
        Map<String, String> metadata = new HashMap<>(Map.of(
                "duplicate_response_id", repeat.getId() != null ? repeat.getId() : "",
                "source_type", repeat.getSourceType() != null ? repeat.getSourceType() : "UNKNOWN",
                "campaign_name", campaignName != null ? campaignName : ""
        ));
        if (numberNote != null) {
            metadata.put("phone", repeat.getParentMobile().trim());
        }
        if (emailNote != null) {
            metadata.put("email", repeat.getParentEmail().trim());
        }
        timelineEventService.logJourneyEvent(
                "AUDIENCE_RESPONSE",
                primary.getResponseId(),
                LeadJourneyActionType.REATTEMPT,
                "SYSTEM",
                null,
                "System",
                "Reattempt",
                description.toString(),
                metadata,
                primary.getUserId()
        );
    }

    /**
     * The phone and email of the lead a repeat repeats (plain columns, never the entity),
     * read only when the repeat carries a phone or a real email to compare. Null when there
     * is nothing to compare or the lookup fails (the entry is then written as before,
     * without contact notes).
     */
    private AudienceResponseRepository.ResponseContactRow primaryContactForNotes(
            AudienceResponseRepository.PrimaryLeadRow primary, AudienceResponse repeat) {
        boolean hasPhone = lastNDigits(repeat.getParentMobile(), 10) != null;
        boolean hasEmail = isRealEmail(repeat.getParentEmail(), repeat.getParentMobile());
        if ((!hasPhone && !hasEmail) || primary.getResponseId() == null) return null;
        try {
            List<AudienceResponseRepository.ResponseContactRow> rows =
                    audienceResponseRepository.findContactOfResponse(primary.getResponseId());
            return rows == null || rows.isEmpty() ? null : rows.get(0);
        } catch (Exception e) {
            logger.warn("Reattempt on {}: lookup failed, entry written without contact notes: {}",
                    primary.getResponseId(), e.getMessage());
            return null;
        }
    }

    /**
     * "new number +91…" when the repeat brought a phone the lead it repeats does not have,
     * "number +91…" when that lead has no phone of its own to compare with, null when the
     * phone is the same or missing.
     */
    private String reattemptNumberNote(AudienceResponseRepository.ResponseContactRow primaryRow,
            AudienceResponse repeat) {
        String phone = repeat.getParentMobile() == null ? null : repeat.getParentMobile().trim();
        String last10 = lastNDigits(phone, 10);
        if (last10 == null) return null;
        String primaryLast10 = lastNDigits(primaryRow.getPhone(), 10);
        if (primaryLast10 == null) return "number " + phone;
        return last10.equals(primaryLast10) ? null : "new number " + phone;
    }

    /**
     * "new email a@x.com" when the repeat brought a real email the lead it repeats does not
     * have (that lead has another email, or only a placeholder), "email a@x.com" when that
     * lead has no email of its own, null when the email is the same, missing or a placeholder.
     */
    private String reattemptEmailNote(AudienceResponseRepository.ResponseContactRow primaryRow,
            AudienceResponse repeat) {
        if (!isRealEmail(repeat.getParentEmail(), repeat.getParentMobile())) return null;
        String email = repeat.getParentEmail().trim();
        String primaryEmail = primaryRow.getEmail() == null ? "" : primaryRow.getEmail().trim();
        if (primaryEmail.isEmpty()) return "email " + email;
        return primaryEmail.equalsIgnoreCase(email) ? null : "new email " + email;
    }

    /**
     * A deliverable-looking email: not blank, not a placeholder this platform mints for
     * emailless leads, and not a phone number dressed as an email (all-digit local part
     * holding the lead's own phone, as imported placeholder rows carry).
     */
    private boolean isRealEmail(String email, String phone) {
        if (email == null || email.isBlank() || !email.contains("@")) return false;
        String e = email.trim().toLowerCase();
        if ((placeholderEmailService != null && placeholderEmailService.isPlaceholder(e))
                || e.endsWith("@noemail.vacademy.io")) {
            return false;
        }
        String local = e.substring(0, e.indexOf('@'));
        String last10 = lastNDigits(phone, 10);
        return !(local.matches("[0-9]+") && last10 != null && local.contains(last10));
    }

    /**
     * The different phone numbers and real emails the person behind this lead has enquired
     * with (their active enquiries in the lead's institute), each with the first enquiry
     * that brought it, oldest first. {@code requireAccess} gets the lead's institute id
     * before anything is returned and throws when the caller may not read it. Empty lists
     * for an unknown lead.
     */
    public LeadEnquiryContactsDTO findEnquiryContacts(String responseId, Consumer<String> requireAccess) {
        List<LeadEnquiryContactsDTO.Contact> phones = new ArrayList<>();
        List<LeadEnquiryContactsDTO.Contact> emails = new ArrayList<>();
        LeadEnquiryContactsDTO result = new LeadEnquiryContactsDTO(phones, emails);
        if (responseId == null || responseId.isBlank()) return result;
        List<AudienceResponseRepository.EnquiryContactRow> rows =
                audienceResponseRepository.findEnquiryContactsOfLeadPerson(responseId);
        if (rows.isEmpty()) return result;
        requireAccess.accept(rows.get(0).getInstituteId());

        Set<String> seenPhones = new LinkedHashSet<>();
        Set<String> seenEmails = new LinkedHashSet<>();
        for (AudienceResponseRepository.EnquiryContactRow row : rows) {
            String phone = row.getPhone() == null ? "" : row.getPhone().trim();
            String digits = phone.replaceAll("[^0-9]", "");
            if (!digits.isEmpty()
                    && seenPhones.add(digits.length() >= 10 ? digits.substring(digits.length() - 10) : digits)) {
                phones.add(contact(phone, row));
            }
            if (isRealEmail(row.getEmail(), row.getPhone())) {
                String email = row.getEmail().trim();
                if (seenEmails.add(email.toLowerCase())) {
                    emails.add(contact(email, row));
                }
            }
        }
        return result;
    }

    private static LeadEnquiryContactsDTO.Contact contact(String value,
            AudienceResponseRepository.EnquiryContactRow row) {
        return LeadEnquiryContactsDTO.Contact.builder()
                .value(value)
                .responseId(row.getResponseId())
                .sourceType(row.getSourceType())
                .campaignName(row.getCampaignName())
                .createdAt(row.getCreatedAt())
                .build();
    }

    /**
     * The open lead (not converted, not LOST) this manual add would repeat, under the
     * dedup field and scope, when the institute dedups with "Allow & reassign" and has
     * switched on repeatLead.blockOpenLeadManualAdd. Empty for any other setting, a blank
     * or short identifier, or when every matching lead is closed.
     */
    public Optional<AudienceResponseRepository.OpenLeadRow> findOpenLeadForManualAdd(String instituteId,
            String audienceId, String email, String phone) {
        LeadDedupSettingService.DedupSettings settings = leadDedupSettingService.get(instituteId);
        if (!settings.enabled() || settings.repeatLead() == null
                || settings.action() != LeadDedupSettingService.DedupAction.ALLOW_REASSIGN
                || !settings.repeatLead().blockOpenLeadManualAdd()) {
            return Optional.empty();
        }
        if (settings.scope() == LeadDedupSettingService.DedupScope.SELECTED
                && (settings.audienceIds() == null || settings.audienceIds().isEmpty())) {
            return Optional.empty();
        }
        String audienceIdsCsv = scopeAudienceIdsCsv(settings, audienceId);
        List<AudienceResponseRepository.OpenLeadRow> rows;
        if (settings.field() == LeadDedupSettingService.DedupField.PHONE) {
            String last10 = lastNDigits(phone, 10);
            rows = last10 == null ? List.of()
                    : audienceResponseRepository.findOpenLeadByPhoneLast10(instituteId, audienceIdsCsv, last10);
            if (rows.isEmpty() && alsoMatchesEmail(settings) && isRealEmail(email, phone)) {
                rows = audienceResponseRepository.findOpenLeadByEmail(instituteId, audienceIdsCsv, email.trim());
            }
        } else {
            if (email == null || email.isBlank()) return Optional.empty();
            rows = audienceResponseRepository.findOpenLeadByEmail(instituteId, audienceIdsCsv, email.trim());
        }
        return rows.isEmpty() ? Optional.empty() : Optional.ofNullable(rows.get(0));
    }

    /** The dedup settings when they are PHONE + ALLOW_REASSIGN and enabled, else null. */
    private LeadDedupSettingService.DedupSettings phoneReassignSettings(String instituteId) {
        LeadDedupSettingService.DedupSettings settings = leadDedupSettingService.get(instituteId);
        boolean applies = settings.enabled()
                && settings.repeatLead() != null
                && settings.field() == LeadDedupSettingService.DedupField.PHONE
                && settings.action() == LeadDedupSettingService.DedupAction.ALLOW_REASSIGN
                // SELECTED with no lists dedups nothing (checkDuplicate fails open), so no match either.
                && !(settings.scope() == LeadDedupSettingService.DedupScope.SELECTED
                        && (settings.audienceIds() == null || settings.audienceIds().isEmpty()));
        return applies ? settings : null;
    }

    /**
     * PHONE dedup with "Allow & reassign" and repeatLead.alsoMatchEmail on: an enquiry whose
     * phone matches no lead is still a repeat when its email matches one.
     */
    private static boolean alsoMatchesEmail(LeadDedupSettingService.DedupSettings settings) {
        return settings.field() == LeadDedupSettingService.DedupField.PHONE
                && settings.action() == LeadDedupSettingService.DedupAction.ALLOW_REASSIGN
                && settings.repeatLead() != null
                && settings.repeatLead().alsoMatchEmail();
    }

    /**
     * Lead Settings → repeat lead → "Show duplicates only in Duplicate Leads": lead lists hide
     * duplicate enquiries unless their route asks for them, and badge the lead they repeat.
     * False (lists unchanged) unless dedup is on with "Allow & reassign".
     */
    public boolean duplicatesTabOnly(String instituteId) {
        LeadDedupSettingService.DedupSettings settings = leadDedupSettingService.get(instituteId);
        return settings != null
                && settings.enabled()
                && settings.action() == LeadDedupSettingService.DedupAction.ALLOW_REASSIGN
                && settings.repeatLead() != null
                && settings.repeatLead().reattempt() != null
                && settings.repeatLead().reattempt().duplicatesTabOnly();
    }

    /** Whether another lead in the dedup scope has this email; false for a blank email. */
    private boolean emailExists(LeadDedupSettingService.DedupSettings settings, String instituteId,
            String audienceId, String email, String excludeResponseId) {
        String normalizedEmail = (email != null) ? email.trim() : "";
        if (normalizedEmail.isEmpty()) return false;
        return switch (settings.scope()) {
            case INSTITUTE -> audienceResponseRepository
                    .existsByInstituteIdAndParentEmailIgnoreCase(instituteId, normalizedEmail, excludeResponseId);
            case SELECTED -> audienceResponseRepository.existsByAudienceIdInAndParentEmailIgnoreCase(
                    settings.audienceIds(), normalizedEmail, excludeResponseId);
            case CAMPAIGN -> audienceResponseRepository
                    .existsByAudienceIdAndParentEmailIgnoreCase(audienceId, normalizedEmail, excludeResponseId);
        };
    }

    /** Lists the dedup scope covers, as the CSV the native queries take; null = whole institute. */
    private static String scopeAudienceIdsCsv(LeadDedupSettingService.DedupSettings settings, String audienceId) {
        return switch (settings.scope()) {
            case INSTITUTE -> null;
            case SELECTED -> settings.audienceIds() == null || settings.audienceIds().isEmpty()
                    ? null : String.join(",", settings.audienceIds());
            case CAMPAIGN -> audienceId;
        };
    }

    /**
     * Strip non-digits and return the last n digits (tolerates country-code prefixes),
     * or null if there aren't enough digits to compare.
     */
    private String lastNDigits(String phone, int n) {
        if (phone == null) return null;
        String digits = phone.replaceAll("[^0-9]", "");
        if (digits.length() < n) return null;
        return digits.substring(digits.length() - n);
    }

    /**
     * SHA-256 hash helper.
     */
    private String sha256(String input) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(input.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (byte b : hash) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new RuntimeException("SHA-256 not available", e);
        }
    }
}
