package vacademy.io.notification_service.features.chat.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import vacademy.io.common.auth.entity.User;
import vacademy.io.notification_service.features.announcements.client.AdminCoreServiceClient;
import vacademy.io.notification_service.features.announcements.client.AuthServiceClient;
import vacademy.io.notification_service.features.announcements.dto.AnnouncementEvent;
import vacademy.io.notification_service.features.announcements.enums.EventType;
import vacademy.io.notification_service.features.announcements.enums.ModeType;
import vacademy.io.notification_service.features.chat.dto.*;
import vacademy.io.notification_service.features.chat.entity.ChatConversation;
import vacademy.io.notification_service.features.chat.entity.ChatConversationMember;
import vacademy.io.notification_service.features.chat.entity.ChatMessage;
import vacademy.io.notification_service.features.chat.enums.ChatConversationType;
import vacademy.io.notification_service.features.chat.enums.ChatMemberRole;
import vacademy.io.notification_service.features.chat.event.ChatFanoutEvent;
import vacademy.io.notification_service.features.chat.repository.ChatConversationMemberRepository;
import vacademy.io.notification_service.features.chat.repository.ChatConversationRepository;
import vacademy.io.notification_service.features.chat.repository.ChatMessageRepository;
import vacademy.io.notification_service.features.chat.util.ChatTimeUtil;

import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Slf4j
public class ChatConversationService {

    private final ChatConversationRepository convRepo;
    private final ChatConversationMemberRepository memberRepo;
    private final ChatMessageRepository messageRepo;
    private final AdminCoreServiceClient adminCoreServiceClient;
    private final AuthServiceClient authServiceClient;
    private final ChatPermissionService permissionService;
    private final ChatRulesService rulesService;
    private final ApplicationEventPublisher eventPublisher;
    private final ObjectMapper objectMapper;

    private static final long UNREAD_CAP = 100L;

    // ---------------------------------------------------------------------
    // Provisioning
    // ---------------------------------------------------------------------

    @Transactional
    public ChatConversation findOrCreateDirect(String instituteId, String callerId, String callerRole, String callerName,
                                               StartDirectRequest req) {
        if (!permissionService.isChatEnabled(instituteId)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "CHAT_DISABLED");
        }
        String targetId = req.getTargetUserId();
        if (targetId == null || targetId.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "TARGET_REQUIRED");
        }
        if (targetId.equals(callerId)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "CANNOT_DM_SELF");
        }
        if (!permissionService.canDirectMessage(instituteId, callerRole, req.getTargetUserRole())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "DM_NOT_ALLOWED");
        }

        String pairKey = pairKey(callerId, targetId);
        Optional<ChatConversation> existing = convRepo.findByInstituteIdAndTypeAndPairKey(
                instituteId, ChatConversationType.DIRECT.name(), pairKey);
        if (existing.isPresent()) {
            return existing.get();
        }

        // saveAndFlush forces the partial-unique-index check NOW so a concurrent create throws
        // DataIntegrityViolationException here (not at commit). The exception poisons this transaction,
        // so recovery is NOT attempted inline — it propagates and the controller retries get-or-create,
        // which then finds the winner's row. See ChatConversationController.provisionWithRetry.
        ChatConversation conv = ChatConversation.builder()
                .type(ChatConversationType.DIRECT.name())
                .instituteId(instituteId)
                .pairKey(pairKey)
                .createdBy(callerId)
                .isActive(true)
                .lastMessageSeq(0L)
                .rulesVersion(0)
                .createdAt(LocalDateTime.now())
                .updatedAt(LocalDateTime.now())
                .build();
        conv = convRepo.saveAndFlush(conv);
        // Store each participant's display name so the DM can be titled with the OTHER member's name.
        saveMember(conv.getId(), callerId, ChatPermissionService.normalizeRole(callerRole).toUpperCase(), callerName, ChatMemberRole.MEMBER);
        saveMember(conv.getId(), targetId, ChatPermissionService.normalizeRole(req.getTargetUserRole()).toUpperCase(), req.getTargetUserName(), ChatMemberRole.MEMBER);
        return conv;
    }

    @Transactional
    public ChatConversation getOrProvisionBatch(String instituteId, String packageSessionId,
                                                String callerId, String callerRole, String callerName) {
        if (!permissionService.isChatEnabled(instituteId)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "CHAT_DISABLED");
        }
        Optional<ChatConversation> existing = convRepo.findByInstituteIdAndTypeAndReferenceId(
                instituteId, ChatConversationType.BATCH_GROUP.name(), packageSessionId);
        ChatConversation conv;
        if (existing.isPresent()) {
            conv = existing.get();
        } else {
            // saveAndFlush surfaces a concurrent-create unique violation here; it propagates and the
            // controller retries get-or-create (then takes the existing branch). See provisionWithRetry.
            conv = ChatConversation.builder()
                    .type(ChatConversationType.BATCH_GROUP.name())
                    .instituteId(instituteId)
                    .referenceId(packageSessionId)
                    .createdBy(callerId)
                    .isActive(true)
                    .lastMessageSeq(0L)
                    .rulesVersion(0)
                    .createdAt(LocalDateTime.now())
                    .updatedAt(LocalDateTime.now())
                    .build();
            conv = convRepo.saveAndFlush(conv);
            materializeBatchMembers(conv.getId(), packageSessionId);
        }
        // Caller must belong to the batch.
        if (!memberRepo.existsByConversationIdAndUserIdAndIsActiveTrue(conv.getId(), callerId)) {
            if ("admin".equals(ChatPermissionService.normalizeRole(callerRole))) {
                ensureMember(conv, callerId, callerRole, ChatMemberRole.MODERATOR);
            } else {
                // Not in the cached roster — re-validate against the LIVE batch membership and self-heal.
                // The materialized members are a cache: a student who enrolled after the batch chat was
                // first provisioned (or who was missed by an incomplete initial materialization) would
                // otherwise be wrongly rejected. If they genuinely belong to the batch, add them.
                Map<String, String> roster = resolveBatchMembers(packageSessionId);
                String roleInBatch = roster.get(callerId);
                if (roleInBatch != null) {
                    ensureMember(conv, callerId, roleInBatch, ChatMemberRole.MEMBER);
                } else {
                    throw new ResponseStatusException(HttpStatus.FORBIDDEN, "NOT_A_MEMBER");
                }
            }
        }
        return conv;
    }

    @Transactional
    public ChatConversation getOrProvisionCommunity(String instituteId, String callerId, String callerRole, String callerName) {
        if (!permissionService.isChatEnabled(instituteId)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "CHAT_DISABLED");
        }
        if (!permissionService.isCommunityEnabled(instituteId)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "COMMUNITY_DISABLED");
        }
        Optional<ChatConversation> existing = convRepo.findByInstituteIdAndType(instituteId, ChatConversationType.COMMUNITY.name());
        ChatConversation conv;
        if (existing.isPresent()) {
            conv = existing.get();
        } else {
            // saveAndFlush surfaces a concurrent-create unique violation here; it propagates and the
            // controller retries get-or-create (then takes the existing branch). See provisionWithRetry.
            conv = ChatConversation.builder()
                    .type(ChatConversationType.COMMUNITY.name())
                    .instituteId(instituteId)
                    .title("Community")
                    .createdBy(callerId)
                    .isActive(true)
                    .lastMessageSeq(0L)
                    .rulesVersion(0)
                    .createdAt(LocalDateTime.now())
                    .updatedAt(LocalDateTime.now())
                    .build();
            conv = convRepo.saveAndFlush(conv);
        }
        // Lazy member row for read-cursor + rules-acknowledgement state. Admins moderate by default.
        ChatMemberRole role = "admin".equals(ChatPermissionService.normalizeRole(callerRole))
                ? ChatMemberRole.MODERATOR : ChatMemberRole.MEMBER;
        ensureMember(conv, callerId, callerRole, role);
        return conv;
    }

    private void materializeBatchMembers(String conversationId, String packageSessionId) {
        // Only ever called right after the conversation is first created, so it has no member rows yet:
        // skip the per-user pre-SELECT and bulk-insert the whole resolved roster in one round-trip.
        Map<String, String> roleByUser = resolveBatchMembers(packageSessionId);
        if (roleByUser.isEmpty()) {
            return;
        }
        List<ChatConversationMember> rows = new ArrayList<>(roleByUser.size());
        for (Map.Entry<String, String> e : roleByUser.entrySet()) {
            // Batch members: name not needed (group is titled by batch name; messages carry sender names).
            rows.add(newMember(conversationId, e.getKey(), e.getValue(), null, ChatMemberRole.MEMBER));
        }
        memberRepo.saveAll(rows);
    }

    /** Resolve a batch (package session) into userId -> normalized role. Faculty wins over student. */
    public Map<String, String> resolveBatchMembers(String packageSessionId) {
        Map<String, String> map = new HashMap<>();
        try {
            adminCoreServiceClient.getStudentsByPackageSessions(List.of(packageSessionId))
                    .forEach(id -> map.put(id, "STUDENT"));
            adminCoreServiceClient.getFacultyByPackageSessions(List.of(packageSessionId))
                    .forEach(id -> map.put(id, "TEACHER"));
        } catch (Exception e) {
            log.warn("Failed to resolve batch members for {}: {}", packageSessionId, e.getMessage());
        }
        return map;
    }

    /**
     * Get-or-create the caller's member row. The stored member_role is deliberately NEVER rewritten
     * for an existing row: {@link ChatMembershipReconciler} keeps every non-MEMBER row out of roster
     * reconciliation, so promoting a materialized MEMBER here would quietly make that person immune to
     * being removed when they leave the batch. Moderation authority that comes from the institute role
     * is evaluated per-request from the token instead (see ChatMessageService#canModerate).
     */
    public ChatConversationMember ensureMember(ChatConversation conv, String userId, String userRole, ChatMemberRole memberRole) {
        // Joining (or re-joining) an existing conversation starts caught up: history from before the join is
        // readable but not "unread" — otherwise the app-wide unread badge shows 99+ for a community/batch the
        // learner never opened, and the community push rule would never reach them.
        long joinSeq = conv.getLastMessageSeq() == null ? 0L : conv.getLastMessageSeq();
        Optional<ChatConversationMember> existing = memberRepo.findByConversationIdAndUserId(conv.getId(), userId);
        if (existing.isPresent()) {
            ChatConversationMember m = existing.get();
            if (!Boolean.TRUE.equals(m.getIsActive())) {
                m.setIsActive(true);
                m.setLastReadSeq(Math.max(m.getLastReadSeq() == null ? 0L : m.getLastReadSeq(), joinSeq));
                memberRepo.save(m);
            }
            return m;
        }
        ChatConversationMember member = newMember(conv.getId(), userId,
                ChatPermissionService.normalizeRole(userRole).toUpperCase(), null, memberRole);
        member.setLastReadSeq(joinSeq);
        return memberRepo.save(member);
    }

    private ChatConversationMember saveMember(String conversationId, String userId, String userRole, String userName, ChatMemberRole memberRole) {
        return memberRepo.save(newMember(conversationId, userId, userRole, userName, memberRole));
    }

    private ChatConversationMember newMember(String conversationId, String userId, String userRole, String userName, ChatMemberRole memberRole) {
        return ChatConversationMember.builder()
                .conversationId(conversationId)
                .userId(userId)
                .userRole(userRole)
                .userName(userName)
                .memberRole(memberRole.name())
                .lastReadSeq(0L)
                .muted(false)
                .isActive(true)
                .rulesAcknowledgedVersion(0)
                .joinedAt(LocalDateTime.now())
                .build();
    }

    // ---------------------------------------------------------------------
    // Listing
    // ---------------------------------------------------------------------

    /**
     * Unread total for the caller's badge, computed like listConversations' per-row unreadCount (capped per
     * conversation) in a single aggregate query — no conversation hydration, no title lookups.
     */
    public long getUnreadTotal(String userId, String instituteId) {
        if (!permissionService.isChatEnabled(instituteId)) {
            return 0L;
        }
        // Community is left out of the app-wide badge: members get a row (cursor 0) when they first open chat,
        // so an unopened community would pin the badge at 99+ everywhere. Its unread still shows in the list.
        Long total = memberRepo.sumUnread(userId, instituteId, false, UNREAD_CAP);
        return total == null ? 0L : total;
    }

    // Intentionally NOT @Transactional: the reads are independent SELECTs that don't need one
    // snapshot, and title resolution makes external HTTP calls. Wrapping this in a transaction would
    // pin a Hikari connection (pool=3/pod) across that I/O — a real saturation risk. Keep DB and
    // network work unbound from a single connection.
    public List<ChatConversationResponse> listConversations(String userId, String instituteId, String callerRole,
                                                            String typeFilter, int limit) {
        if (!permissionService.isChatEnabled(instituteId)) {
            // Chat is off for this institute — surface a clean "disabled" state on the FE rather than
            // a stale list (old conversations from a previously-enabled period stay hidden).
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "CHAT_DISABLED");
        }
        List<ChatConversationMember> myMembers = memberRepo.findByUserIdAndIsActiveTrue(userId);
        Map<String, ChatConversationMember> memberByConv = myMembers.stream()
                .collect(Collectors.toMap(ChatConversationMember::getConversationId, m -> m, (a, b) -> a));

        List<String> convIds = new ArrayList<>(memberByConv.keySet());
        List<ChatConversation> convs = convIds.isEmpty()
                ? new ArrayList<>()
                : new ArrayList<>(convRepo.findByIdInOrderByLastMessageAtDesc(convIds));

        // Surface the institute community channel (to every role), unless it's flagged off.
        if (permissionService.isCommunityEnabled(instituteId)) {
            convRepo.findByInstituteIdAndType(instituteId, ChatConversationType.COMMUNITY.name())
                    .ifPresent(community -> {
                        if (convs.stream().noneMatch(c -> c.getId().equals(community.getId()))) {
                            convs.add(community);
                        }
                    });
        }

        // Role-derived batch channels (beyond the ones the caller has personally joined):
        //   admin   -> every active batch group in the institute
        //   teacher -> batch groups for the package sessions they are faculty-mapped to
        //   student -> none here (their enrolled batches already come in via membership above)
        // Only batches that already have a conversation are surfaced ("active" batches); a not-yet-
        // provisioned batch is reachable via the batch search ("start a new conversation").
        addRoleVisibleBatches(convs, instituteId, userId, callerRole, limit <= 0 ? 30 : limit);

        int pageSize = limit <= 0 ? 30 : limit;
        List<ChatConversation> candidates = convs.stream()
                .filter(c -> instituteId.equals(c.getInstituteId()))
                .filter(c -> typeFilter == null || typeFilter.equalsIgnoreCase(c.getType()))
                .sorted(Comparator.comparing(ChatConversation::getLastMessageAt,
                        Comparator.nullsLast(Comparator.reverseOrder())))
                .collect(Collectors.toList());

        // The community channel is PINNED to the top of the page instead of competing for a slot on
        // recency. It is the one channel that is usually never-messaged (so it sorts dead last), while
        // an admin's page is filled with every batch group in the institute — at any institute with
        // more than `pageSize` messaged batches the community fell off the page entirely and became
        // unreachable (the FE has no other entry point to it). Pinning keeps it visible by default for
        // every role — admin, mentor, teacher and learner alike — at any institute size.
        // Sized off the candidates, never off the caller-supplied `limit` (unvalidated at the
        // controller — a bogus ?limit=2000000000 must not turn into a 2-billion-slot allocation).
        List<ChatConversation> visible = new ArrayList<>(Math.min(pageSize, candidates.size()));
        candidates.stream()
                .filter(c -> ChatConversationType.COMMUNITY.name().equals(c.getType()))
                .findFirst()
                .ifPresent(visible::add);
        for (ChatConversation c : candidates) {
            if (visible.size() >= pageSize) {
                break;
            }
            if (!ChatConversationType.COMMUNITY.name().equals(c.getType())) {
                visible.add(c);
            }
        }

        // Fetch every active member of the visible page in ONE query, grouped by conversation,
        // so mapConversation never has to look up DIRECT participants per-row.
        List<String> visibleIds = visible.stream().map(ChatConversation::getId).collect(Collectors.toList());
        Map<String, List<ChatConversationMember>> activeByConv = visibleIds.isEmpty()
                ? Collections.emptyMap()
                : memberRepo.findByConversationIdInAndIsActiveTrue(visibleIds).stream()
                        .collect(Collectors.groupingBy(ChatConversationMember::getConversationId));

        // Resolve display titles for the whole page in bulk (one batch-name call, one institute-name
        // call, one DM-name call) so mapConversation never does a per-row external lookup.
        Map<String, String> titleByConv = resolveTitlesBulk(visible, userId, instituteId, activeByConv);

        return visible.stream()
                .map(c -> mapConversation(c, userId, callerRole, memberByConv.get(c.getId()),
                        activeByConv.getOrDefault(c.getId(), Collections.emptyList()),
                        titleByConv.get(c.getId())))
                .collect(Collectors.toList());
    }

    /**
     * Merge role-derived batch channels into the candidate list (deduped by conversation id), so an
     * admin sees every institute batch and a teacher sees their faculty-mapped batches — even ones
     * they never personally opened. Fail-soft: a failed faculty/roster lookup just adds nothing.
     */
    private void addRoleVisibleBatches(List<ChatConversation> convs, String instituteId, String userId,
                                       String callerRole, int limit) {
        String role = ChatPermissionService.normalizeRole(callerRole);
        List<ChatConversation> extra;
        if ("admin".equals(role)) {
            // Bounded top-N by recency so a big institute doesn't hydrate every batch to fill one page.
            extra = convRepo.findActiveByInstituteAndTypeTopN(
                    instituteId, ChatConversationType.BATCH_GROUP.name(), PageRequest.of(0, Math.max(1, limit)));
        } else if ("teacher".equals(role)) {
            List<String> mappedPackageSessionIds = adminCoreServiceClient.getFacultyPackageSessions(userId, instituteId);
            if (mappedPackageSessionIds == null || mappedPackageSessionIds.isEmpty()) {
                return;
            }
            extra = convRepo.findByInstituteIdAndTypeAndReferenceIdInAndIsActiveTrue(
                    instituteId, ChatConversationType.BATCH_GROUP.name(), mappedPackageSessionIds);
        } else {
            return; // students: enrolled batches already arrive via membership
        }
        if (extra == null || extra.isEmpty()) {
            return;
        }
        Set<String> seen = convs.stream().map(ChatConversation::getId).collect(Collectors.toSet());
        for (ChatConversation c : extra) {
            if (seen.add(c.getId())) {
                convs.add(c);
            }
        }
    }

    public ChatConversationResponse mapConversation(ChatConversation c, String callerId, String callerRole,
                                                    ChatConversationMember callerMember) {
        // Self-contained path (describe): resolve active members for this single conversation lazily.
        List<ChatConversationMember> activeMembers = ChatConversationType.DIRECT.name().equals(c.getType())
                ? memberRepo.findByConversationIdAndIsActiveTrue(c.getId())
                : Collections.emptyList();
        String resolvedTitle = resolveTitleSingle(c, callerId, activeMembers);
        return mapConversation(c, callerId, callerRole, callerMember, activeMembers, resolvedTitle);
    }

    public ChatConversationResponse mapConversation(ChatConversation c, String callerId, String callerRole,
                                                    ChatConversationMember callerMember,
                                                    List<ChatConversationMember> activeMembers,
                                                    String resolvedTitle) {
        // Unread is pure arithmetic off the denormalized counters — zero queries, capped.
        // No member row = caller is OBSERVING (e.g. an admin seeing every batch they never joined):
        // there's no read cursor, so report 0 rather than blasting a full-unread badge on every channel.
        long lastSeq = c.getLastMessageSeq() == null ? 0L : c.getLastMessageSeq();
        long unread = callerMember == null ? 0L
                : Math.max(0, Math.min(UNREAD_CAP, lastSeq - (callerMember.getLastReadSeq() == null ? 0L : callerMember.getLastReadSeq())));

        String otherUserId = null;
        boolean canPost;
        if (ChatConversationType.DIRECT.name().equals(c.getType())) {
            ChatConversationMember other = activeMembers.stream()
                    .filter(m -> !m.getUserId().equals(callerId)).findFirst().orElse(null);
            otherUserId = other != null ? other.getUserId() : null;
            canPost = permissionService.canDirectMessage(c.getInstituteId(), callerRole, other != null ? other.getUserRole() : null);
        } else if (ChatConversationType.BATCH_GROUP.name().equals(c.getType())) {
            canPost = permissionService.canPostToBatch(c.getInstituteId(), callerRole);
        } else {
            canPost = permissionService.canPostToCommunity(c.getInstituteId(), callerRole);
        }

        // Resolved title (other member's name / batch name / "{Institute} Community") wins; if it
        // couldn't be resolved, fall back to whatever is stored on the row (FE adds its own fallback).
        String title = (resolvedTitle != null && !resolvedTitle.isBlank()) ? resolvedTitle : c.getTitle();

        return ChatConversationResponse.builder()
                .id(c.getId())
                .type(c.getType())
                .instituteId(c.getInstituteId())
                .referenceId(c.getReferenceId())
                .title(title)
                .otherUserId(otherUserId)
                .lastMessagePreview(c.getLastMessagePreview())
                .lastMessageSenderId(c.getLastMessageSenderId())
                .lastMessageAt(ChatTimeUtil.toInstant(c.getLastMessageAt()))
                .lastMessageSeq(c.getLastMessageSeq())
                .unreadCount(unread)
                .memberRole(callerMember != null ? callerMember.getMemberRole() : null)
                .rulesVersion(c.getRulesVersion())
                .canPost(canPost)
                .canEditOwnMessages(permissionService.canEditOwnMessage(c.getInstituteId(), callerRole))
                .canDeleteOwnMessages(permissionService.canDeleteOwnMessage(c.getInstituteId(), callerRole))
                .build();
    }

    // ---------------------------------------------------------------------
    // Display-title resolution
    //
    // A conversation's display title is computed per-viewer at read time (not stored), so it always
    // reflects current data and works for rows created before titles existed:
    //   DIRECT      -> the OTHER participant's name (stored member name; auth-service lookup if absent)
    //   BATCH_GROUP -> the batch's real name ("{Level} {Course}") from admin-core
    //   COMMUNITY   -> "{Institute name} Community"
    // Every external call is cached and fail-soft (null/empty -> FE shows its own generic fallback).
    // ---------------------------------------------------------------------

    /** Bulk title resolution for a page of conversations — one external call per source, not per row. */
    private Map<String, String> resolveTitlesBulk(List<ChatConversation> convs, String callerId,
                                                  String instituteId,
                                                  Map<String, List<ChatConversationMember>> activeByConv) {
        Map<String, String> titles = new HashMap<>();

        // Batch names — one bulk call for every batch group on the page.
        List<String> psIds = convs.stream()
                .filter(c -> ChatConversationType.BATCH_GROUP.name().equals(c.getType()))
                .map(ChatConversation::getReferenceId)
                .filter(id -> id != null && !id.isBlank())
                .distinct().collect(Collectors.toList());
        Map<String, String> batchNames = psIds.isEmpty()
                ? Collections.emptyMap() : adminCoreServiceClient.getBatchNames(psIds);

        // Institute name — single lookup (the page is institute-scoped); only if a community channel is shown.
        boolean hasCommunity = convs.stream()
                .anyMatch(c -> ChatConversationType.COMMUNITY.name().equals(c.getType()));
        String instituteName = hasCommunity ? adminCoreServiceClient.getInstituteName(instituteId) : null;

        // DM names — fast path is the stored member name; only legacy rows (null name) need a lookup,
        // and those are batched into ONE auth-service call.
        Map<String, ChatConversationMember> otherByConv = new HashMap<>();
        Set<String> missingNameUserIds = new HashSet<>();
        for (ChatConversation c : convs) {
            if (!ChatConversationType.DIRECT.name().equals(c.getType())) continue;
            ChatConversationMember other = activeByConv.getOrDefault(c.getId(), Collections.emptyList()).stream()
                    .filter(m -> !m.getUserId().equals(callerId)).findFirst().orElse(null);
            if (other == null) continue;
            otherByConv.put(c.getId(), other);
            if (other.getUserName() == null || other.getUserName().isBlank()) {
                missingNameUserIds.add(other.getUserId());
            }
        }
        Map<String, String> nameById = missingNameUserIds.isEmpty()
                ? Collections.emptyMap() : lookupUserNames(missingNameUserIds);

        for (ChatConversation c : convs) {
            String type = c.getType();
            if (ChatConversationType.DIRECT.name().equals(type)) {
                ChatConversationMember other = otherByConv.get(c.getId());
                if (other == null) continue;
                String name = (other.getUserName() != null && !other.getUserName().isBlank())
                        ? other.getUserName() : nameById.get(other.getUserId());
                if (name != null) titles.put(c.getId(), name);
            } else if (ChatConversationType.BATCH_GROUP.name().equals(type)) {
                String name = c.getReferenceId() != null ? batchNames.get(c.getReferenceId()) : null;
                if (name != null) titles.put(c.getId(), name);
            } else {
                titles.put(c.getId(), communityTitle(instituteName, c.getTitle()));
            }
        }
        return titles;
    }

    /** Single-conversation title resolution (open/describe path). */
    private String resolveTitleSingle(ChatConversation c, String callerId,
                                      List<ChatConversationMember> activeMembers) {
        String type = c.getType();
        if (ChatConversationType.DIRECT.name().equals(type)) {
            ChatConversationMember other = activeMembers.stream()
                    .filter(m -> !m.getUserId().equals(callerId)).findFirst().orElse(null);
            if (other == null) return null;
            if (other.getUserName() != null && !other.getUserName().isBlank()) {
                return other.getUserName();
            }
            return lookupUserNames(Set.of(other.getUserId())).get(other.getUserId());
        }
        if (ChatConversationType.BATCH_GROUP.name().equals(type)) {
            if (c.getReferenceId() == null || c.getReferenceId().isBlank()) return c.getTitle();
            String name = adminCoreServiceClient.getBatchNames(List.of(c.getReferenceId())).get(c.getReferenceId());
            return name != null ? name : c.getTitle();
        }
        // COMMUNITY
        return communityTitle(adminCoreServiceClient.getInstituteName(c.getInstituteId()), c.getTitle());
    }

    private String communityTitle(String instituteName, String storedTitle) {
        return (instituteName != null && !instituteName.isBlank())
                ? instituteName + " Community" : storedTitle;
    }

    /** Resolve userId -> full name via auth-service. Fail-soft: missing/blank names are omitted. */
    private Map<String, String> lookupUserNames(Set<String> userIds) {
        Map<String, String> nameById = new HashMap<>();
        if (userIds == null || userIds.isEmpty()) return nameById;
        try {
            for (User u : authServiceClient.getUsersByIds(new ArrayList<>(userIds))) {
                if (u != null && u.getId() != null && u.getFullName() != null && !u.getFullName().isBlank()) {
                    nameById.put(u.getId(), u.getFullName());
                }
            }
        } catch (Exception e) {
            log.warn("Failed to resolve DM display names for {} users: {}", userIds.size(), e.getMessage());
        }
        return nameById;
    }

    // ---------------------------------------------------------------------
    // Read state
    // ---------------------------------------------------------------------

    @Transactional
    public void markRead(String conversationId, String userId, String upToMessageId) {
        ChatConversation conv = getConversationOrThrow(conversationId);
        ChatConversationMember member = memberRepo.findByConversationIdAndUserId(conversationId, userId).orElse(null);
        if (member == null) {
            // Observer with no read cursor (e.g. an admin who can see a batch but never joined it).
            // There's nothing to advance — treat as a no-op rather than 403 so read never errors.
            return;
        }

        long fallbackSeq = conv.getLastMessageSeq() == null ? 0L : conv.getLastMessageSeq();
        long targetSeq;
        if (upToMessageId != null && !upToMessageId.isBlank()) {
            // Scope the cursor to THIS conversation — seq is per-conversation, so a messageId from a
            // different (busier) conversation must not inject a foreign seq into the read cursor.
            targetSeq = messageRepo.findById(upToMessageId)
                    .filter(m -> conversationId.equals(m.getConversationId()))
                    .map(ChatMessage::getSeq)
                    .orElse(fallbackSeq);
        } else {
            targetSeq = fallbackSeq;
        }
        // Reading the newest live message reads the whole conversation: deleted messages after it are never
        // shown, so without this a deleted tail leaves a phantom unread (badge never clears) and blocks the
        // community "one push until read" rule.
        if (targetSeq < fallbackSeq
                && !messageRepo.existsByConversationIdAndSeqGreaterThanAndIsDeletedFalse(conversationId, targetSeq)) {
            targetSeq = fallbackSeq;
        }

        // Atomic, forward-only: two overlapping markRead calls must never move the cursor backwards (a lower
        // cursor makes the push rule treat an already-seen message as unread).
        if (memberRepo.advanceReadCursor(member.getId(), targetSeq, upToMessageId, LocalDateTime.now()) > 0) {

            // Read receipts only matter for DIRECT (and small batch); skip community fan-out.
            if (!ChatConversationType.COMMUNITY.name().equals(conv.getType())) {
                List<String> others = memberRepo.findByConversationIdAndIsActiveTrue(conversationId).stream()
                        .map(ChatConversationMember::getUserId)
                        .filter(id -> !id.equals(userId))
                        .collect(Collectors.toList());
                AnnouncementEvent event = AnnouncementEvent.builder()
                        .type(EventType.CHAT_READ)
                        .modeType(ModeType.CHAT)
                        .instituteId(conv.getInstituteId())
                        .data(ChatMessagePayload.builder()
                                .conversationId(conversationId)
                                .conversationType(conv.getType())
                                .readerUserId(userId)
                                .lastReadSeq(targetSeq)
                                .build())
                        .timestamp(LocalDateTime.now())
                        .eventId("chatread_" + conversationId + "_" + userId + "_" + targetSeq)
                        .build();
                eventPublisher.publishEvent(new ChatFanoutEvent(conv.getInstituteId(), conv.getType(), others, event));
            }
        }
    }

    // ---------------------------------------------------------------------
    // Rules
    // ---------------------------------------------------------------------

    @Transactional(readOnly = true)
    public ChatRulesResponse getRules(String conversationId, String userId) {
        ChatConversation conv = getConversationOrThrow(conversationId);
        ChatConversationMember member = memberRepo.findByConversationIdAndUserId(conversationId, userId).orElse(null);
        return ChatRulesResponse.builder()
                .rules(rulesService.getEffectiveRules(conv))
                .currentVersion(conv.getRulesVersion() == null ? 0 : conv.getRulesVersion())
                .acknowledged(rulesService.hasAcknowledged(conv, member))
                .isOverride(rulesService.isOverride(conv))
                .canEdit(isModerator(member))
                .build();
    }

    @Transactional
    public ChatRulesResponse updateRules(String conversationId, String userId, ChatRulesDto rules) {
        ChatConversation conv = getConversationOrThrow(conversationId);
        ChatConversationMember member = memberRepo.findByConversationIdAndUserId(conversationId, userId).orElse(null);
        if (!isModerator(member)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "NOT_A_MODERATOR");
        }
        @SuppressWarnings("unchecked")
        Map<String, Object> rulesMap = objectMapper.convertValue(rules, Map.class);
        conv.setRules(rulesMap);
        conv.setRulesVersion((conv.getRulesVersion() == null ? 0 : conv.getRulesVersion()) + 1);
        convRepo.save(conv);
        return getRules(conversationId, userId);
    }

    @Transactional
    public ChatRulesResponse acknowledgeRules(String conversationId, String userId, String userRole, String userName) {
        ChatConversation conv = getConversationOrThrow(conversationId);
        ChatConversationMember member = ensureMember(conv, userId, userRole,
                "admin".equals(ChatPermissionService.normalizeRole(userRole)) ? ChatMemberRole.MODERATOR : ChatMemberRole.MEMBER);
        member.setRulesAcknowledgedVersion(conv.getRulesVersion() == null ? 0 : conv.getRulesVersion());
        member.setRulesAcknowledgedAt(LocalDateTime.now());
        memberRepo.save(member);
        return getRules(conversationId, userId);
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------

    // Not @Transactional: resolveTitleSingle makes external HTTP calls; don't hold a connection across them.
    public ChatConversationResponse describe(ChatConversation conv, String userId, String userRole) {
        ChatConversationMember member = memberRepo.findByConversationIdAndUserId(conv.getId(), userId).orElse(null);
        return mapConversation(conv, userId, userRole, member);
    }

    public ChatConversation getConversationOrThrow(String conversationId) {
        return convRepo.findById(conversationId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "CONVERSATION_NOT_FOUND"));
    }

    public List<String> getActiveMemberIds(String conversationId) {
        return memberRepo.findActiveMemberIds(conversationId);
    }

    private boolean isModerator(ChatConversationMember member) {
        return member != null && (ChatMemberRole.MODERATOR.name().equals(member.getMemberRole())
                || ChatMemberRole.OWNER.name().equals(member.getMemberRole()));
    }

    private String pairKey(String a, String b) {
        return a.compareTo(b) <= 0 ? a + "::" + b : b + "::" + a;
    }
}
