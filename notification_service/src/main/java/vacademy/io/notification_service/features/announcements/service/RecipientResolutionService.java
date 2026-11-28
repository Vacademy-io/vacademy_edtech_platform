package vacademy.io.notification_service.features.announcements.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.notification_service.features.announcements.client.AdminCoreServiceClient;
import vacademy.io.notification_service.features.announcements.entity.AnnouncementRecipient;
import vacademy.io.notification_service.features.announcements.enums.RecipientType;
import vacademy.io.notification_service.features.announcements.repository.AnnouncementRecipientRepository;
import vacademy.io.notification_service.features.announcements.repository.AnnouncementRepository;
import vacademy.io.notification_service.features.announcements.entity.Announcement;
import vacademy.io.notification_service.features.announcements.service.resolver.CustomFieldFilterRecipientResolver;
import vacademy.io.notification_service.features.announcements.service.resolver.RecipientResolver;
import vacademy.io.notification_service.features.announcements.service.resolver.RecipientResolverRegistry;

import java.util.*;
import java.util.stream.Collectors;
import vacademy.io.notification_service.features.announcements.dto.CentralizedRecipientResolutionRequest;
import vacademy.io.notification_service.features.announcements.dto.PaginatedUserIdResponse;
import vacademy.io.notification_service.features.announcements.dto.CreateAnnouncementRequest;
import com.fasterxml.jackson.databind.ObjectMapper;

@Service
@RequiredArgsConstructor
@Slf4j
public class RecipientResolutionService {

    private final AnnouncementRecipientRepository recipientRepository;
    private final AdminCoreServiceClient adminCoreServiceClient;
    private final AnnouncementRepository announcementRepository;
    private final RecipientResolverRegistry resolverRegistry;
    private final CustomFieldFilterRecipientResolver customFieldFilterResolver;
    private final ObjectMapper objectMapper = new ObjectMapper();

    /**
     * Resolves announcement recipients (roles, users, package_sessions, tags) to actual user IDs
     * Ensures deduplication and handles exclusions (identified by "EXCLUDE:" prefix in recipientId)
     * Uses centralized API for better performance and scalability
     */
    public List<String> resolveRecipientsToUsers(String announcementId) {
        log.info("Resolving recipients for announcement: {}", announcementId);

        // Fetch announcement to get institute ID
        Announcement announcement = announcementRepository.findById(announcementId)
            .orElseThrow(() -> new RuntimeException("Announcement not found: " + announcementId));

        return resolveUserIds(announcement.getInstituteId(), announcementId,
                recipientRepository.findByAnnouncementId(announcementId));
    }

    /**
     * Resolves recipient rows — persisted, or built in memory for a draft that has not been saved
     * (see {@code AnnouncementService.buildRecipientEntities}) — to unique user IDs.
     * Tries the centralized admin-core API first and falls back to the per-type resolvers.
     *
     * @param label only used in logs (the announcement ID, or a description of the draft)
     */
    public List<String> resolveUserIds(String instituteId, String label, List<AnnouncementRecipient> allRecipients) {
        try {
            // Try to use centralized resolution first
            return resolveRecipientsToUsersCentralized(instituteId, label, allRecipients);
        } catch (Exception e) {
            log.warn("Centralized recipient resolution failed for {}, falling back to legacy method", label, e);
            // Fallback to legacy method
            return resolveRecipientsToUsersLegacy(instituteId, label, allRecipients);
        }
    }

    /**
     * New centralized resolution method - uses admin-core-service centralized API
     */
    private List<String> resolveRecipientsToUsersCentralized(String instituteId, String label,
                                                            List<AnnouncementRecipient> allRecipients) {
        log.debug("Using centralized recipient resolution for {}", label);

        // Build centralized request
        CentralizedRecipientResolutionRequest request = buildCentralizedRequest(instituteId, label, allRecipients);

        // Call centralized API with pagination to get all users
        List<String> allUserIds = new ArrayList<>();
        int pageSize = 1000; // Match the default page size

        while (true) {
            request.setPageNumber(allUserIds.size() / pageSize);
            request.setPageSize(pageSize);

            PaginatedUserIdResponse response = adminCoreServiceClient.resolveRecipientsCentralized(request);

            if (response.getUserIds() != null) {
                allUserIds.addAll(response.getUserIds());
            }

            // Check if we have all pages
            if (!response.isHasNext() || response.getUserIds() == null || response.getUserIds().size() < pageSize) {
                break;
            }
        }

        log.info("Centralized resolution completed for {}: {} unique users", label, allUserIds.size());
        return allUserIds;
    }

    /**
     * Legacy resolution method - kept as fallback
     */
    private List<String> resolveRecipientsToUsersLegacy(String announcementInstituteId, String label,
                                                       List<AnnouncementRecipient> allRecipients) {
        log.debug("Using legacy recipient resolution for {}", label);

        // Separate inclusions from exclusions based on prefix
        List<AnnouncementRecipient> recipients = allRecipients.stream()
                .filter(r -> !r.isExclusion())
                .toList();
        List<AnnouncementRecipient> exclusions = allRecipients.stream()
                .filter(AnnouncementRecipient::isExclusion)
                .toList();

        // Step 1: Resolve all included recipients
        Set<String> includedUserIds = resolveRecipientList(recipients, announcementInstituteId, "inclusions");
        log.info("Resolved {} inclusion recipients to {} unique users", recipients.size(), includedUserIds.size());

        // Step 2: Resolve all excluded recipients
        Set<String> excludedUserIds = new HashSet<>();
        if (!exclusions.isEmpty()) {
            excludedUserIds = resolveRecipientList(exclusions, announcementInstituteId, "exclusions");
            log.info("Resolved {} exclusion recipients to {} unique users", exclusions.size(), excludedUserIds.size());

            // Step 3: Remove excluded users from included users
            int beforeExclusion = includedUserIds.size();
            includedUserIds.removeAll(excludedUserIds);
            int afterExclusion = includedUserIds.size();
            log.info("Applied exclusions: {} users removed, {} users remaining",
                    (beforeExclusion - afterExclusion), afterExclusion);
        }

        List<String> finalUserList = new ArrayList<>(includedUserIds);
        log.info("Final resolved recipients for {}: {} unique users", label, finalUserList.size());

        return finalUserList;
    }

    /**
     * Build the centralized resolution request from persisted AnnouncementRecipient rows.
     *
     * Per-type behaviour:
     *  - USER: pre-resolve via AuthService (handles email → user ID conversion), emit one
     *    USER recipient per resolved user.
     *  - ROLE: pre-resolve via AuthService (admin_core's centralized SQL can't see auth_service's
     *    user_role/roles tables — they live in a different database). Emit one USER recipient
     *    per resolved user.
     *  - CUSTOM_FIELD_FILTER: recipientName holds a JSON array of CustomFieldFilter (set by
     *    AnnouncementService.saveRecipients). Parse it as filters and attach them — NOT as
     *    exclusions; the shapes are different and Jackson would silently produce null-filled
     *    Exclusion objects, which admin_core then rejects with 400.
     *  - Everything else (TAG, PACKAGE_SESSION, sub-org-roles, AUDIENCE): recipientName may
     *    hold a JSON array of Exclusions (when the row was saved with per-row exclusions) or
     *    a display name. Try parsing as exclusions; if it's not an exclusion shape, treat it
     *    as a display name and continue without exclusions.
     */
    private CentralizedRecipientResolutionRequest buildCentralizedRequest(String instituteId, String label,
                                                                          List<AnnouncementRecipient> allRecipients) {
        CentralizedRecipientResolutionRequest request = new CentralizedRecipientResolutionRequest();
        request.setInstituteId(instituteId);
        request.setPageNumber(0);
        request.setPageSize(1000);

        List<CentralizedRecipientResolutionRequest.RecipientWithExclusions> built = new ArrayList<>();

        for (AnnouncementRecipient recipient : allRecipients) {
            if (recipient.isExclusion()) {
                // Exclusions are scoped per-inclusion via recipientName JSON, not top-level.
                continue;
            }

            String type = recipient.getRecipientType().name();
            String actualRecipientId = recipient.getActualRecipientId();

            // USER / ROLE: pre-resolve to concrete user IDs, then emit them as USER recipients.
            if ("USER".equals(type) || "ROLE".equals(type)) {
                Set<String> resolvedUserIds = preResolveToUserIds(type, actualRecipientId, instituteId);
                if (resolvedUserIds.isEmpty()) {
                    log.warn("Pre-resolution of {} recipient '{}' yielded no users; skipping",
                            type, actualRecipientId);
                    continue;
                }
                for (String userId : resolvedUserIds) {
                    CentralizedRecipientResolutionRequest.RecipientWithExclusions userRecipient =
                            new CentralizedRecipientResolutionRequest.RecipientWithExclusions();
                    userRecipient.setRecipientType("USER");
                    userRecipient.setRecipientId(userId);
                    built.add(userRecipient);
                }
                continue;
            }

            CentralizedRecipientResolutionRequest.RecipientWithExclusions rwe =
                    new CentralizedRecipientResolutionRequest.RecipientWithExclusions();
            rwe.setRecipientType(type);
            rwe.setRecipientId(actualRecipientId);

            if ("CUSTOM_FIELD_FILTER".equals(type)) {
                // recipientName holds a JSON array of CustomFieldFilter (NOT exclusions).
                List<CentralizedRecipientResolutionRequest.RecipientWithExclusions.CustomFieldFilter> filters =
                        parseStoredFilters(recipient.getRecipientName());
                if (filters.isEmpty()) {
                    log.warn("CUSTOM_FIELD_FILTER recipient {} has no resolvable filters; skipping",
                            recipient.getId());
                    continue;
                }
                rwe.setCustomFieldFilters(filters);
            } else {
                // Try recipientName as stored exclusions JSON; otherwise treat as a display name.
                List<CentralizedRecipientResolutionRequest.RecipientWithExclusions.Exclusion> exclusions =
                        parseStoredExclusions(recipient.getRecipientName(), instituteId);
                if (!exclusions.isEmpty()) {
                    rwe.setExclusions(exclusions);
                    log.info("Attached {} exclusions to recipient {}={} for {}",
                            exclusions.size(), type, actualRecipientId, label);
                }
            }

            built.add(rwe);
        }

        // Empty-recipient guard: admin-core requires at least one entry. Sending a
        // bogus USER prevents a 400 and naturally resolves to zero users.
        if (built.isEmpty()) {
            CentralizedRecipientResolutionRequest.RecipientWithExclusions empty =
                    new CentralizedRecipientResolutionRequest.RecipientWithExclusions();
            empty.setRecipientType("USER");
            empty.setRecipientId("nonexistent");
            built.add(empty);
        }

        request.setRecipients(built);
        return request;
    }

    /**
     * Run an existing resolver (USER or ROLE) and return the concrete user IDs.
     * Both pull from auth_service via REST — admin_core can't see those tables directly.
     */
    private Set<String> preResolveToUserIds(String type, String recipientId, String instituteId) {
        Optional<RecipientResolver> resolverOpt = resolverRegistry.getResolver(type);
        if (resolverOpt.isEmpty()) {
            log.warn("No resolver registered for type {}", type);
            return Collections.emptySet();
        }
        try {
            Set<String> resolved = resolverOpt.get().resolve(recipientId, instituteId);
            return resolved == null ? Collections.emptySet() : resolved;
        } catch (Exception e) {
            log.error("Error pre-resolving {} recipient {}: {}", type, recipientId, e.getMessage(), e);
            return Collections.emptySet();
        }
    }

    /** Parse the CUSTOM_FIELD_FILTER JSON blob stored in recipientName into outbound filters. */
    private List<CentralizedRecipientResolutionRequest.RecipientWithExclusions.CustomFieldFilter>
            parseStoredFilters(String json) {
        if (json == null || json.isBlank() || "ERROR".equals(json)) {
            return Collections.emptyList();
        }
        try {
            List<CreateAnnouncementRequest.RecipientRequest.CustomFieldFilter> stored =
                    objectMapper.readValue(json,
                            objectMapper.getTypeFactory().constructCollectionType(List.class,
                                    CreateAnnouncementRequest.RecipientRequest.CustomFieldFilter.class));
            List<CentralizedRecipientResolutionRequest.RecipientWithExclusions.CustomFieldFilter> out =
                    new ArrayList<>(stored.size());
            for (CreateAnnouncementRequest.RecipientRequest.CustomFieldFilter f : stored) {
                if ((f.getCustomFieldId() == null || f.getCustomFieldId().isBlank())
                        && (f.getFieldName() == null || f.getFieldName().isBlank())) {
                    log.warn("Skipping filter with neither customFieldId nor fieldName");
                    continue;
                }
                if (f.getFieldValue() == null) {
                    log.warn("Skipping filter with null fieldValue (customFieldId={}, fieldName={})",
                            f.getCustomFieldId(), f.getFieldName());
                    continue;
                }
                CentralizedRecipientResolutionRequest.RecipientWithExclusions.CustomFieldFilter centralized =
                        new CentralizedRecipientResolutionRequest.RecipientWithExclusions.CustomFieldFilter();
                centralized.setCustomFieldId(f.getCustomFieldId());
                centralized.setFieldName(f.getFieldName());
                centralized.setFieldValue(f.getFieldValue());
                centralized.setOperator(f.getOperator());
                out.add(centralized);
            }
            return out;
        } catch (Exception e) {
            log.warn("Failed to parse stored CUSTOM_FIELD_FILTER JSON: {} (error: {})", json, e.getMessage());
            return Collections.emptyList();
        }
    }

    /**
     * Parse stored exclusions JSON. Returns empty list if json is not a list-of-Exclusion shape
     * (e.g. it's a display name instead).
     */
    private List<CentralizedRecipientResolutionRequest.RecipientWithExclusions.Exclusion>
            parseStoredExclusions(String json, String instituteId) {
        if (json == null || json.isBlank()) {
            return Collections.emptyList();
        }
        // Cheap shape check before we ask Jackson to do work and swallow nulls.
        String trimmed = json.trim();
        if (!trimmed.startsWith("[")) return Collections.emptyList();

        List<CreateAnnouncementRequest.RecipientRequest.Exclusion> stored;
        try {
            stored = objectMapper.readValue(json,
                    objectMapper.getTypeFactory().constructCollectionType(List.class,
                            CreateAnnouncementRequest.RecipientRequest.Exclusion.class));
        } catch (Exception e) {
            return Collections.emptyList();
        }

        List<CentralizedRecipientResolutionRequest.RecipientWithExclusions.Exclusion> out = new ArrayList<>();
        for (CreateAnnouncementRequest.RecipientRequest.Exclusion excl : stored) {
            // exclusionType=null means this JSON is not actually an exclusion list (e.g. it's a
            // stale filter list from before the type-based dispatch was correct). Skip.
            if (excl.getExclusionType() == null || excl.getExclusionType().isBlank()) {
                continue;
            }

            String exclusionId = excl.getExclusionId();

            // USER email → user ID: same hop as the inclusion side.
            if ("USER".equals(excl.getExclusionType()) && exclusionId != null && exclusionId.contains("@")) {
                Optional<RecipientResolver> userResolverOpt = resolverRegistry.getResolver("USER");
                if (userResolverOpt.isPresent()) {
                    try {
                        Set<String> resolved = userResolverOpt.get().resolve(exclusionId, instituteId);
                        if (!resolved.isEmpty()) {
                            exclusionId = resolved.iterator().next();
                        } else {
                            log.warn("USER exclusion email {} unresolved; dropping exclusion", excl.getExclusionId());
                            continue;
                        }
                    } catch (Exception e) {
                        log.error("Error pre-resolving USER exclusion {}: {}", excl.getExclusionId(), e.getMessage());
                        continue;
                    }
                }
            }

            CentralizedRecipientResolutionRequest.RecipientWithExclusions.Exclusion centralized =
                    new CentralizedRecipientResolutionRequest.RecipientWithExclusions.Exclusion();
            centralized.setExclusionType(excl.getExclusionType());
            centralized.setExclusionId(exclusionId);

            if (excl.getCustomFieldFilters() != null && !excl.getCustomFieldFilters().isEmpty()) {
                List<CentralizedRecipientResolutionRequest.RecipientWithExclusions.CustomFieldFilter> cffList =
                        excl.getCustomFieldFilters().stream()
                                .map(cff -> {
                                    CentralizedRecipientResolutionRequest.RecipientWithExclusions.CustomFieldFilter c =
                                            new CentralizedRecipientResolutionRequest.RecipientWithExclusions.CustomFieldFilter();
                                    c.setCustomFieldId(cff.getCustomFieldId());
                                    c.setFieldName(cff.getFieldName());
                                    c.setFieldValue(cff.getFieldValue());
                                    c.setOperator(cff.getOperator());
                                    return c;
                                })
                                .toList();
                centralized.setCustomFieldFilters(cffList);
            }
            out.add(centralized);
        }
        return out;
    }
    
    /**
     * Helper method to resolve a list of recipients (either inclusions or exclusions)
     * Refactored to use resolver pattern following SOLID principles
     */
    private Set<String> resolveRecipientList(List<AnnouncementRecipient> recipients, String instituteId, String type) {
        Set<String> resolvedUserIds = new HashSet<>();
        List<String> tagIdsToResolve = new ArrayList<>();
        List<AnnouncementRecipient> customFieldFilterRecipients = new ArrayList<>();
        
        // Group recipients by type for efficient processing
        for (AnnouncementRecipient recipient : recipients) {
            RecipientType recipientType = recipient.getRecipientType();
            String actualRecipientId = recipient.getActualRecipientId();
            
            // Handle TAG recipients - batch them for single API call
            if (recipientType == RecipientType.TAG) {
                if (actualRecipientId != null && !actualRecipientId.isBlank()) {
                    tagIdsToResolve.add(actualRecipientId);
                }
                continue;
            }
            
            // Handle CUSTOM_FIELD_FILTER recipients - need special handling
            if (recipientType == RecipientType.CUSTOM_FIELD_FILTER) {
                customFieldFilterRecipients.add(recipient);
                continue;
            }
            
            // Use resolver pattern for other types (USER, ROLE, PACKAGE_SESSION)
            Optional<RecipientResolver> resolverOpt = resolverRegistry.getResolver(recipientType.name());
            if (resolverOpt.isPresent()) {
                try {
                    RecipientResolver resolver = resolverOpt.get();
                    Set<String> userIds = resolver.resolve(actualRecipientId, instituteId);
                    resolvedUserIds.addAll(userIds);
                    log.debug("[{}] Resolved {} {} to {} users", type, recipientType, actualRecipientId, userIds.size());
                } catch (Exception e) {
                    log.error("[{}] Error resolving {} recipient {} for institute {}", 
                            type, recipientType, actualRecipientId, instituteId, e);
                }
            } else {
                log.warn("[{}] No resolver found for recipient type: {}", type, recipientType);
            }
        }
        
        // Resolve TAG recipients in one batched call (optimized for large datasets)
        if (!tagIdsToResolve.isEmpty()) {
            if (instituteId == null || instituteId.isBlank()) {
                log.warn("[{}] Institute ID unavailable while resolving TAG recipients; skipping tag resolution", type);
            } else {
                try {
                    // Get resolver for TAG type
                    Optional<RecipientResolver> tagResolverOpt = resolverRegistry.getResolver("TAG");
                    if (tagResolverOpt.isPresent()) {
                        // Resolve all tags - the resolver handles pagination internally if needed
                        for (String tagId : tagIdsToResolve) {
                            Set<String> tagUserIds = tagResolverOpt.get().resolve(tagId, instituteId);
                            resolvedUserIds.addAll(tagUserIds);
                        }
                        log.debug("[{}] Resolved {} users from {} tag(s)", type, tagIdsToResolve.size(), tagIdsToResolve.size());
                    }
                } catch (Exception e) {
                    log.error("[{}] Error resolving users by tags {} for institute {}", type, tagIdsToResolve, instituteId, e);
                }
            }
        }
        
        // Resolve CUSTOM_FIELD_FILTER recipients (works for both inclusions and exclusions)
        for (AnnouncementRecipient recipient : customFieldFilterRecipients) {
            try {
                log.debug("[{}] Processing CUSTOM_FIELD_FILTER recipient (ID: {}, Name: {})", 
                        type, recipient.getRecipientId(), recipient.getRecipientName());
                Set<String> filterUserIds = customFieldFilterResolver.resolveFromRecipient(recipient, instituteId);
                resolvedUserIds.addAll(filterUserIds);
                log.debug("[{}] Resolved CUSTOM_FIELD_FILTER to {} users", type, filterUserIds.size());
            } catch (Exception e) {
                log.error("[{}] Error resolving CUSTOM_FIELD_FILTER recipient for institute {}", 
                        type, instituteId, e);
            }
        }
        
        return resolvedUserIds;
    }


    /**
     * Get recipient summary for an announcement
     */
    public RecipientSummary getRecipientSummary(String announcementId) {
        List<AnnouncementRecipient> recipients = recipientRepository.findByAnnouncementId(announcementId);
        
        Map<RecipientType, Long> recipientCounts = recipients.stream()
                .collect(Collectors.groupingBy(
                        AnnouncementRecipient::getRecipientType,
                        Collectors.counting()
                ));
        
        List<String> resolvedUsers = resolveRecipientsToUsers(announcementId);
        
        return new RecipientSummary(
                recipientCounts.getOrDefault(RecipientType.USER, 0L),
                recipientCounts.getOrDefault(RecipientType.ROLE, 0L),
                recipientCounts.getOrDefault(RecipientType.PACKAGE_SESSION, 0L),
                (long) resolvedUsers.size(),
                resolvedUsers
        );
    }

    /**
     * Validate if recipients are valid before creating announcement
     */
    public ValidationResult validateRecipients(List<String> recipientIds, RecipientType recipientType) {
        // TODO: Implement validation logic
        // This should validate that the recipient IDs exist in the system
        
        log.debug("Validating {} recipients of type: {}", recipientIds.size(), recipientType);
        
        List<String> invalidIds = new ArrayList<>();
        List<String> validIds = new ArrayList<>(recipientIds);
        
        // Placeholder validation - in real implementation:
        // 1. For USER type: Check if user exists in auth service
        // 2. For ROLE type: Check if role exists and has users
        // 3. For PACKAGE_SESSION type: Check if package session exists and has enrolled users
        
        return new ValidationResult(validIds, invalidIds, invalidIds.isEmpty());
    }

    // Helper classes
    public static class RecipientSummary {
        private final Long directUsers;
        private final Long roles;
        private final Long packageSessions;
        private final Long totalResolvedUsers;
        private final List<String> resolvedUserIds;
        
        public RecipientSummary(Long directUsers, Long roles, Long packageSessions, 
                               Long totalResolvedUsers, List<String> resolvedUserIds) {
            this.directUsers = directUsers;
            this.roles = roles;
            this.packageSessions = packageSessions;
            this.totalResolvedUsers = totalResolvedUsers;
            this.resolvedUserIds = resolvedUserIds;
        }
        
        // Getters
        public Long getDirectUsers() { return directUsers; }
        public Long getRoles() { return roles; }
        public Long getPackageSessions() { return packageSessions; }
        public Long getTotalResolvedUsers() { return totalResolvedUsers; }
        public List<String> getResolvedUserIds() { return resolvedUserIds; }
    }
    
    public static class ValidationResult {
        private final List<String> validIds;
        private final List<String> invalidIds;
        private final boolean isValid;
        
        public ValidationResult(List<String> validIds, List<String> invalidIds, boolean isValid) {
            this.validIds = validIds;
            this.invalidIds = invalidIds;
            this.isValid = isValid;
        }
        
        // Getters
        public List<String> getValidIds() { return validIds; }
        public List<String> getInvalidIds() { return invalidIds; }
        public boolean isValid() { return isValid; }
    }
}