package vacademy.io.admin_core_service.features.engagement.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.util.HtmlUtils;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementAction;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementMember;
import vacademy.io.admin_core_service.features.engagement.spi.Subject;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.common.auth.dto.UserDTO;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * The engine needs a human: a reply it won't answer on its own, or a request for an asset it
 * doesn't hold. The inbox task is the durable record; this tells people straight away, by a bell
 * alert AND an email. Recipients are the team members chosen on the engine plus the lead's own
 * counsellor; only when both are missing does it fall back to whoever created the engine.
 * Each channel is best-effort and independent: a failed email never hides the alert, and neither
 * can break the reply flow.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class EngagementTeamAlertService {

    private static final String ACTOR = "ENGAGEMENT_ENGINE";
    private static final ObjectMapper JSON = new ObjectMapper();

    private final NotificationService notificationService;
    private final AuthService authService;
    private final EngagementCoordinationDao coordinationDao;
    private final ContactResolver contactResolver;

    /** A person asked for material the engine's assets don't hold. */
    public void notifyMissing(EngagementEngine engine, EngagementMember member, EngagementAction task,
                              String requestedMaterial, String theirMessage) {
        String wanted = requestedMaterial != null && !requestedMaterial.isBlank() ? requestedMaterial : "some material";
        String who = personLabel(member);
        notifyHumanNeeded(engine, member, task, who + " asked for " + wanted,
                "asked for \"" + wanted + "\" and the engine \"" + engine.getName()
                        + "\" has nothing like it in its assets. Their message: " + theirMessage
                        + "\n\nSend it from the Engagement inbox (a holding reply is already drafted), "
                        + "and add it to the engine's assets so the agent can share it next time.");
    }

    /** Any reply the engine hands to a person: why, and what they said. */
    public void notifyEscalated(EngagementEngine engine, EngagementMember member, EngagementAction task,
                                String reason, String theirMessage) {
        notifyHumanNeeded(engine, member, task, personLabel(member) + " needs a reply from you",
                "wrote to the engine \"" + engine.getName() + "\" and it needs a person: " + reason
                        + (theirMessage != null && !theirMessage.isBlank() ? "\nTheir message: " + theirMessage : "")
                        + "\n\nOpen the Engagement inbox to answer.");
    }

    /**
     * @param headline the alert title
     * @param detail   the sentence after the person's name and number
     */
    public void notifyHumanNeeded(EngagementEngine engine, EngagementMember member, EngagementAction task,
                                  String headline, String detail) {
        try {
            List<String> recipients = recipients(engine, member);
            if (recipients.isEmpty()) {
                log.info("Engine {} needs a human but has nobody to tell; the inbox task remains", engine.getId());
                return;
            }
            Subject who = contactResolver.resolve(List.of(member)).get(0);
            String body = personLabel(who) + (who.getPhone() != null && who.getName() != null ? " (" + who.getPhone() + ")" : "")
                    + " " + detail;
            sendAlert(engine, recipients, headline, body, task);
            sendEmail(engine, recipients, headline, body);
        } catch (Exception e) {
            log.warn("Team alert failed for engine {}: {}", engine.getId(), e.getMessage());
        }
    }

    /** The engine's chosen contacts, then the lead's counsellor; the creator only if there is neither. */
    List<String> recipients(EngagementEngine engine, EngagementMember member) {
        Set<String> ids = new LinkedHashSet<>();
        try {
            ids.addAll(JSON.readValue(engine.getNotifyUserIds() == null ? "[]" : engine.getNotifyUserIds(),
                    new TypeReference<List<String>>() {}));
        } catch (Exception e) {
            log.warn("Engine {} has unreadable notify_user_ids: {}", engine.getId(), e.getMessage());
        }
        String owner = member.getAudienceResponseId() != null
                ? coordinationDao.leadOwnerUserId(engine.getInstituteId(), member.getAudienceResponseId()) : null;
        if (owner != null) ids.add(owner);
        if (ids.isEmpty() && engine.getCreatedBy() != null) ids.add(engine.getCreatedBy());
        ids.removeIf(i -> i == null || i.isBlank());
        return List.copyOf(ids);
    }

    private String personLabel(EngagementMember member) {
        return personLabel(contactResolver.resolve(List.of(member)).get(0));
    }

    private static String personLabel(Subject who) {
        if (who.getName() != null && !who.getName().isBlank()) return who.getName();
        return who.getPhone() != null ? who.getPhone() : "A lead";
    }

    private void sendAlert(EngagementEngine engine, List<String> userIds, String title, String body, EngagementAction task) {
        try {
            notificationService.createSystemAlertAnnouncement(engine.getInstituteId(), userIds,
                    title, body, ACTOR, "Engagement Engine", "ADMIN", null, "ENGAGEMENT_ACTION", task.getId());
        } catch (Exception e) {
            log.warn("Team bell alert failed for engine {}: {}", engine.getId(), e.getMessage());
        }
    }

    private void sendEmail(EngagementEngine engine, List<String> userIds, String title, String body) {
        try {
            String html = "<p>" + HtmlUtils.htmlEscape(body).replace("\n", "<br>") + "</p>";
            for (UserDTO user : authService.getUsersFromAuthServiceByUserIds(userIds)) {
                if (user.getEmail() == null || user.getEmail().isBlank()) continue;
                notificationService.sendHtmlEmailViaUnified(user.getEmail(), title, html,
                        engine.getInstituteId(), null, null, "UTILITY_EMAIL");
            }
        } catch (Exception e) {
            log.warn("Team email failed for engine {}: {}", engine.getId(), e.getMessage());
        }
    }
}
