package vacademy.io.notification_service.features.engagement_ledger.repository;

import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;
import vacademy.io.notification_service.features.notification_log.entity.NotificationLog;

import java.time.Instant;
import java.util.List;

/**
 * B5 contact limit: how often a person was contacted by ANY system in the window, read from the
 * same notification_log the ledger reads. Kept apart from NotificationLogRepository, which other
 * features own.
 */
public interface EngagementContactRepository extends Repository<NotificationLog, String> {

    interface ContactRow {
        String getChannelId();
        Long getTouches();
        Instant getLastHumanSentAt();
    }

    /**
     * Per phone / email: touches since :since, and when a person last wrote from the inbox.
     * A touch is one outgoing WhatsApp or email from the engine, a workflow, an announcement or
     * any other automated source; a chatbot conversation counts once per day (else one chat
     * would use up the week); a provider-rejected WhatsApp does not count. Inbox messages are a
     * person talking, not a touch: they come back as lastHumanSentAt for the counsellor hold.
     */
    @Query(value = """
            SELECT channel_id AS "channelId",
                   COUNT(DISTINCT CASE WHEN source = 'CHATBOT_FLOW'
                                       THEN 'chat-' || CAST(CAST(notification_date AS date) AS varchar)
                                       ELSE id END)
                       FILTER (WHERE COALESCE(source, '') <> 'INBOX') AS "touches",
                   MAX(notification_date) FILTER (WHERE source = 'INBOX') AS "lastHumanSentAt"
            FROM notification_log
            WHERE institute_id = :instituteId
              AND channel_id IN (:channels)
              AND notification_type IN ('WHATSAPP_MESSAGE_OUTGOING', 'EMAIL')
              AND notification_date >= :since
              AND (notification_type = 'EMAIL' OR body IS NULL OR body NOT LIKE '%| Status: FAILED |%')
            GROUP BY channel_id
            """, nativeQuery = true)
    List<ContactRow> contactsSince(@Param("instituteId") String instituteId,
                                   @Param("channels") List<String> channels,
                                   @Param("since") Instant since);
}
