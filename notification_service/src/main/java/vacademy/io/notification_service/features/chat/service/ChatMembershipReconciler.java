package vacademy.io.notification_service.features.chat.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.notification_service.features.chat.entity.ChatConversation;
import vacademy.io.notification_service.features.chat.entity.ChatConversationMember;
import vacademy.io.notification_service.features.chat.enums.ChatMemberRole;
import vacademy.io.notification_service.features.chat.repository.ChatConversationMemberRepository;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Per-conversation BATCH_GROUP membership reconcile. Lives in its own bean so the
 * {@code @Transactional} boundary is honoured: {@link ChatMembershipSyncService} invokes this across
 * the Spring proxy (a self-invocation from the {@code @Scheduled} method would bypass the proxy and
 * run with no transaction).
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class ChatMembershipReconciler {

    private final ChatConversationMemberRepository memberRepo;
    private final ChatConversationService conversationService;

    @Transactional
    public void reconcileOne(ChatConversation conv) {
        Map<String, String> current = conversationService.resolveBatchMembers(conv.getReferenceId());
        if (current.isEmpty()) {
            // Treat an empty roster as a transient upstream failure rather than removing everyone.
            return;
        }
        Set<String> currentIds = current.keySet();

        // resolveBatchMembers merges TWO independent admin-core calls (students + faculty), each of
        // which returns an empty list on failure — indistinguishable from a genuinely-empty class. So a
        // partial failure (e.g. faculty endpoint times out) yields a roster missing a whole role-class.
        // Fail CLOSED: if a role-class is entirely absent from the resolved roster, treat that class's
        // source call as possibly-failed and do NOT deactivate its members this cycle.
        boolean rosterHasStudent = current.containsValue("STUDENT");
        boolean rosterHasTeacher = current.containsValue("TEACHER");

        // Single read of the active roster, then diff in memory (no per-user find+save in the loop).
        List<ChatConversationMember> activeMembers = memberRepo.findByConversationIdAndIsActiveTrue(conv.getId());
        Map<String, ChatConversationMember> activeByUser = new HashMap<>();
        for (ChatConversationMember m : activeMembers) {
            activeByUser.put(m.getUserId(), m);
        }

        List<ChatConversationMember> dirty = new ArrayList<>();

        // Deactivate plain members no longer in the batch (keep moderators/owners).
        for (ChatConversationMember m : activeMembers) {
            if (currentIds.contains(m.getUserId()) || !ChatMemberRole.MEMBER.name().equals(m.getMemberRole())) {
                continue;
            }
            // Skip deactivation when this member's role-class is wholly missing from the roster
            // (its upstream call likely failed) — avoids kicking every teacher/student on a transient blip.
            String snapRole = m.getUserRole();
            if ("STUDENT".equalsIgnoreCase(snapRole) && !rosterHasStudent) continue;
            if ("TEACHER".equalsIgnoreCase(snapRole) && !rosterHasTeacher) continue;
            m.setIsActive(false);
            dirty.add(m);
        }

        // Add/reactivate current members in bulk.
        for (Map.Entry<String, String> e : current.entrySet()) {
            ChatConversationMember existing = activeByUser.get(e.getKey());
            if (existing != null) {
                continue; // already active, nothing to change
            }
            // Either no row at all, or an inactive row — resolve via a single targeted lookup.
            ChatConversationMember row = memberRepo.findByConversationIdAndUserId(conv.getId(), e.getKey())
                    .orElse(null);
            // New/returning members of an existing batch start caught up (see ChatConversationService#ensureMember):
            // pre-join history must not count as unread in the app-wide badge.
            long joinSeq = conv.getLastMessageSeq() == null ? 0L : conv.getLastMessageSeq();
            if (row == null) {
                ChatConversationMember member = buildMember(conv.getId(), e.getKey(), e.getValue());
                member.setLastReadSeq(joinSeq);
                dirty.add(member);
            } else if (!Boolean.TRUE.equals(row.getIsActive())) {
                row.setIsActive(true);
                row.setLastReadSeq(Math.max(row.getLastReadSeq() == null ? 0L : row.getLastReadSeq(), joinSeq));
                dirty.add(row);
            }
        }

        if (!dirty.isEmpty()) {
            memberRepo.saveAll(dirty);
        }
    }

    private ChatConversationMember buildMember(String conversationId, String userId, String userRole) {
        return ChatConversationMember.builder()
                .conversationId(conversationId)
                .userId(userId)
                .userRole(ChatPermissionService.normalizeRole(userRole).toUpperCase())
                .memberRole(ChatMemberRole.MEMBER.name())
                .lastReadSeq(0L)
                .muted(false)
                .isActive(true)
                .rulesAcknowledgedVersion(0)
                .joinedAt(LocalDateTime.now())
                .build();
    }
}
