package vacademy.io.admin_core_service.features.timeline.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.timeline.entity.TimelineEvent;
import vacademy.io.admin_core_service.features.timeline.enums.TimelineCategory;

import java.util.List;

@Repository
public interface TimelineEventRepository extends JpaRepository<TimelineEvent, String> {

    /**
     * Fetch timeline events for a specific entity type and ID, ordered by creation
     * date descending.
     * This powers the main timeline UI.
     */
    Page<TimelineEvent> findByTypeAndTypeIdOrderByCreatedAtDesc(String type, String typeId, Pageable pageable);

    /**
     * The CALL_MADE event already written for one telephony call (matched on the call_log_id
     * in its metadata). Lets the call-ended and recording-uploaded paths share one row.
     */
    @Query(value = """
            SELECT * FROM timeline_event
            WHERE type = 'LEAD'
              AND type_id = :typeId
              AND action_type = 'CALL_MADE'
              AND metadata_json ->> 'call_log_id' = :callLogId
            ORDER BY created_at
            LIMIT 1
            """, nativeQuery = true)
    java.util.Optional<TimelineEvent> findCallEvent(@Param("typeId") String typeId,
                                                    @Param("callLogId") String callLogId);

    /**
     * Fetch ALL timeline events/notes for a student across all stages (enquiry,
     * application, enrollment).
     * Pinned notes appear first, then ordered by creation date descending.
     */
    Page<TimelineEvent> findByStudentUserIdOrderByIsPinnedDescCreatedAtDesc(String studentUserId, Pageable pageable);

    /**
     * Fetch ALL timeline events for a student (both JOURNEY and ACTIVITY), sorted purely
     * by creation date descending. Used for the unified lead journey view.
     */
    Page<TimelineEvent> findByStudentUserIdOrderByCreatedAtDesc(String studentUserId, Pageable pageable);

    /**
     * Unified lead journey query: events where student_user_id matches OR type_id is in the
     * provided list (covers legacy journey events stored before studentUserId backfill).
     * Returns all categories sorted by created_at DESC.
     */
    @Query(value = """
            SELECT * FROM timeline_event
            WHERE student_user_id = :studentUserId
               OR type_id IN (:typeIds)
            ORDER BY created_at DESC
            """,
           countQuery = """
            SELECT COUNT(*) FROM timeline_event
            WHERE student_user_id = :studentUserId
               OR type_id IN (:typeIds)
            """,
           nativeQuery = true)
    Page<TimelineEvent> findAllEventsForLead(
            @Param("studentUserId") String studentUserId,
            @Param("typeIds") List<String> typeIds,
            Pageable pageable);

    /**
     * Fetch timeline events for a specific entity, with pinned first.
     * Used for notes-enhanced timeline view.
     */
    Page<TimelineEvent> findByTypeAndTypeIdOrderByIsPinnedDescCreatedAtDesc(String type, String typeId,
            Pageable pageable);

    /**
     * Count timeline events for an entity (used by lead scoring engagement factor).
     */
    long countByTypeAndTypeId(String type, String typeId);

    /**
     * Count timeline events across multiple entity IDs of the same type.
     * Used by UserLeadProfileService to aggregate events across all audience
     * responses.
     */
    long countByTypeAndTypeIdIn(String type, java.util.List<String> typeIds);

    long countByStudentUserId(String studentUserId);

    // ── Journey (category = JOURNEY) ──────────────────────────────────────────

    /**
     * Paginated lead-journey events for a specific entity, newest first.
     * Used by GET /timeline/v1/journey to render the lifecycle timeline.
     */
    Page<TimelineEvent> findByTypeAndTypeIdAndCategoryOrderByCreatedAtDesc(
            String type, String typeId, TimelineCategory category, Pageable pageable);

    /**
     * Paginated lead-journey events for a student across all stages.
     * Powers the cross-stage journey view on the student side panel.
     */
    Page<TimelineEvent> findByStudentUserIdAndCategoryOrderByCreatedAtDesc(
            String studentUserId, TimelineCategory category, Pageable pageable);

    @Query(value = """
            SELECT id, type, type_id, action_type, actor_type, actor_id,
                   actor_name, title, description, metadata_json,
                   is_pinned, student_user_id, category, created_at
            FROM (
                SELECT te.*,
                       ROW_NUMBER() OVER (
                           PARTITION BY te.student_user_id
                           ORDER BY te.created_at DESC
                       ) AS rn
                FROM timeline_event te
                WHERE te.student_user_id IN (:studentUserIds)
            ) ranked
            WHERE rn <= :perStudentLimit
            ORDER BY student_user_id, created_at DESC
            """, nativeQuery = true)
    List<TimelineEvent> findRecentPerStudent(
            @Param("studentUserIds") List<String> studentUserIds,
            @Param("perStudentLimit") int perStudentLimit);

    /** Row of {@link #findJourneyRowsForUsers} — a timeline event resolved to
     *  the lead user id it belongs to, regardless of how it was keyed. */
    interface JourneyEventRow {
        String getJourneyUserId();
        String getId();
        String getActionType();
        String getCategory();
        String getTitle();
        String getDescription();
        String getActorName();
        java.sql.Timestamp getCreatedAt();
    }

    /**
     * Journey events per lead user id for the CSV export, matched through BOTH
     * linkages timeline events actually carry (same dual-keying issue
     * {@link #findAllEventsForLead} documents for the side panel):
     * <ul>
     *   <li>{@code student_user_id} — how notes / follow-ups / reassign events
     *       are stamped;</li>
     *   <li>the {@code audience_response} behind {@code type_id} — how
     *       status-change (and other response-keyed) events are written, whose
     *       {@code student_user_id} is often NULL or the linked student rather
     *       than the lead.</li>
     * </ul>
     * The old student_user_id-only lookup silently dropped the second class —
     * which is most of the lead flow — so exports showed a single journey row.
     * UNION (not ALL) dedupes events matched by both branches; the window cap
     * applies per resolved user, newest first.
     */
    @Query(value = """
            SELECT journey_user_id AS "journeyUserId",
                   id, action_type AS "actionType", category, title, description,
                   actor_name AS "actorName", created_at AS "createdAt"
            FROM (
                SELECT u.*,
                       ROW_NUMBER() OVER (
                           PARTITION BY u.journey_user_id
                           ORDER BY u.created_at DESC
                       ) AS rn
                FROM (
                    SELECT te.id, te.action_type, te.category, te.title, te.description,
                           te.actor_name, te.created_at,
                           te.student_user_id AS journey_user_id
                    FROM timeline_event te
                    WHERE te.student_user_id IN (:userIds)
                    UNION
                    SELECT te.id, te.action_type, te.category, te.title, te.description,
                           te.actor_name, te.created_at,
                           ar.user_id AS journey_user_id
                    FROM timeline_event te
                    JOIN audience_response ar
                      ON te.type IN ('AUDIENCE_RESPONSE', 'LEAD') AND ar.id = te.type_id
                    WHERE ar.user_id IN (:userIds)
                ) u
            ) ranked
            WHERE rn <= :perUserLimit
            ORDER BY journey_user_id, created_at DESC
            """, nativeQuery = true)
    List<JourneyEventRow> findJourneyRowsForUsers(
            @Param("userIds") List<String> userIds,
            @Param("perUserLimit") int perUserLimit);

    /**
     * Per-student note count for a batch of users. Returns rows of
     * [student_user_id, count] so the FE can render a count chip without
     * issuing N separate count queries.
     */
    @Query(value = """
            SELECT student_user_id, COUNT(*)
            FROM timeline_event
            WHERE student_user_id IN (:studentUserIds)
            GROUP BY student_user_id
            """, nativeQuery = true)
    List<Object[]> countByStudentUserIds(@Param("studentUserIds") List<String> studentUserIds);
}
