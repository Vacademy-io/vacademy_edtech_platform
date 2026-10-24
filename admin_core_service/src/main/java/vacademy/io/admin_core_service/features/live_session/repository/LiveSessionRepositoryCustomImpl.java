package vacademy.io.admin_core_service.features.live_session.repository;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import jakarta.persistence.Query;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Repository;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.live_session.dto.LiveSessionVisibilityScope;
import vacademy.io.admin_core_service.features.live_session.dto.SessionSearchRequest;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Repository
public class LiveSessionRepositoryCustomImpl implements LiveSessionRepositoryCustom {

    @PersistenceContext
    private EntityManager entityManager;

    @Override
    public Page<LiveSessionRepository.LiveSessionListProjection> searchSessions(
            SessionSearchRequest request, Pageable pageable, LiveSessionVisibilityScope scope) {

        // Build dynamic query
        StringBuilder queryBuilder = new StringBuilder();
        StringBuilder countQueryBuilder = new StringBuilder();
        Map<String, Object> parameters = new HashMap<>();

        // Base query
        String baseSelect = """
                SELECT DISTINCT
                    s.id AS sessionId,
                    s.waiting_room_time AS waitingRoomTime,
                    s.thumbnail_file_id AS thumbnailFileId,
                    s.background_score_file_id AS backgroundScoreFileId,
                    s.session_streaming_service_type AS sessionStreamingServiceType,
                    ss.id AS scheduleId,
                    ss.meeting_date AS meetingDate,
                    ss.start_time AS startTime,
                    ss.last_entry_time AS lastEntryTime,
                    ss.recurrence_type AS recurrenceType,
                    s.access_level AS accessLevel,
                    s.title AS title,
                    s.subject AS subject,
                    s.registration_form_link_for_public_sessions AS registrationFormLinkForPublicSessions,
                    s.allow_play_pause AS allowPlayPause,
                    COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata') AS timezone,
                    CASE
                        WHEN ss.custom_meeting_link IS NOT NULL AND ss.custom_meeting_link <> '' THEN ss.custom_meeting_link
                        ELSE s.default_meet_link
                    END AS meetingLink,
                    s.learner_button_config AS learnerButtonConfig,
                    ss.default_class_link AS defaultClassLink,
                    ss.default_class_name AS defaultClassName,
                    COALESCE(ss.link_type, s.link_type) AS linkType,
                    ss.provider_meeting_id AS providerMeetingId,
                    s.waiting_room_type AS waitingRoomType
                """;

        String baseFrom = """
                FROM live_session s
                JOIN session_schedules ss ON s.id = ss.session_id
                """;

        String countSelect = "SELECT COUNT(DISTINCT ss.id) ";

        queryBuilder.append(baseSelect).append(baseFrom);
        countQueryBuilder.append(countSelect).append(baseFrom);

        // Add LEFT JOIN for participants if filtering by batchIds or userIds
        if ((request.getBatchIds() != null && !request.getBatchIds().isEmpty()) ||
                (request.getUserIds() != null && !request.getUserIds().isEmpty())) {
            String participantJoin = "LEFT JOIN live_session_participants lsp ON lsp.session_id = s.id ";
            queryBuilder.append(participantJoin);
            countQueryBuilder.append(participantJoin);
        }

        // WHERE clause
        List<String> conditions = new ArrayList<>();

        // Always filter: institute_id and ss.status != 'DELETED'
        conditions.add("s.institute_id = :instituteId");
        parameters.put("instituteId", request.getInstituteId());

        conditions.add("ss.status != 'DELETED'");

        // Role-based visibility (V524). Applied here rather than by post-filtering
        // the page, so the paging counts stay truthful -- a filtered page would
        // report totals for sessions the caller can't see.
        if (scope != null && scope.restricted()) {
            conditions.add("""
                    (
                        s.created_by_user_id = :visibilityCallerId
                        OR EXISTS (
                            SELECT 1 FROM live_session_instructors lsi
                            WHERE lsi.session_id = s.id
                              AND lsi.status = 'ACTIVE'
                              AND lsi.user_id IN :visibilityAllowedUserIds
                        )
                        OR (
                            NOT EXISTS (
                                SELECT 1 FROM live_session_instructors lsi2
                                WHERE lsi2.session_id = s.id
                                  AND lsi2.status = 'ACTIVE'
                            )
                            AND s.created_by_user_id IN :visibilityAllowedUserIds
                        )
                    )""");
            parameters.put("visibilityCallerId", scope.callerUserId());
            parameters.put("visibilityAllowedUserIds", scope.bindableUserIds());
        }

        // Status filter (default: exclude DELETED from live_session)
        if (request.getStatuses() != null && !request.getStatuses().isEmpty()) {
            conditions.add("s.status IN :statuses");
            parameters.put("statuses", request.getStatuses());
        } else {
            // Default: show LIVE and DRAFT only
            conditions.add("s.status IN ('LIVE', 'DRAFT')");
        }

        // Session IDs filter
        if (request.getSessionIds() != null && !request.getSessionIds().isEmpty()) {
            conditions.add("s.id IN :sessionIds");
            parameters.put("sessionIds", request.getSessionIds());
        }

        // Date range filter with timezone-aware smart defaults
        LocalDate startDate = request.getStartDate();
        LocalDate endDate = request.getEndDate();

        // Check if filtering for LIVE status specifically
        List<String> statuses = request.getStatuses();
        boolean isLiveOnly = statuses != null && statuses.size() == 1 &&
                statuses.stream().anyMatch(s -> s.equalsIgnoreCase("LIVE"));

        // Apply smart date defaults if not provided
        if (startDate == null && endDate == null) {
            if (isLiveOnly) {
                // For LIVE status only: get sessions that are ACTUALLY LIVE RIGHT NOW
                // This means:
                // 1. meeting_date = TODAY in session's timezone
                // 2. current_time >= start_time (session has started)
                // 3. current_time <= last_entry_time (still accepting entries)
                // Uses timezone-aware comparison
                conditions.add(
                        "ss.meeting_date = CAST((CURRENT_TIMESTAMP AT TIME ZONE COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata')) AS date)");

                // Check if current time is between start_time and last_entry_time
                conditions.add(
                        "CAST((CURRENT_TIMESTAMP AT TIME ZONE COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata')) AS time) >= ss.start_time");
                conditions.add(
                        "CAST((CURRENT_TIMESTAMP AT TIME ZONE COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata')) AS time) <= ss.last_entry_time");
            } else {
                // For upcoming/draft sessions: show next month using timezone-aware logic
                // meeting_date >= CURRENT_DATE in session's timezone
                conditions.add(
                        "ss.meeting_date >= CAST((CURRENT_TIMESTAMP AT TIME ZONE COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata')) AS date)");

                // Add end date: 1 month from now
                LocalDate oneMonthLater = LocalDate.now().plusMonths(1);
                conditions.add("ss.meeting_date <= :endDate");
                parameters.put("endDate", java.sql.Date.valueOf(oneMonthLater));
            }
        } else {
            // User provided explicit dates - use them directly
            if (startDate != null) {
                conditions.add("ss.meeting_date >= :startDate");
                parameters.put("startDate", java.sql.Date.valueOf(startDate));
            }

            if (endDate != null) {
                conditions.add("ss.meeting_date <= :endDate");
                parameters.put("endDate", java.sql.Date.valueOf(endDate));
            }
        }

        // Time Status Filter (UPCOMING, LIVE, PAST)
        if (request.getTimeStatus() != null) {
            String status = request.getTimeStatus().toUpperCase();
            String timeZoneExp = "COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata')";
            String nowExp = "(CURRENT_TIMESTAMP AT TIME ZONE " + timeZoneExp + ")";
            String todayExp = "CAST(" + nowExp + " AS date)";
            String currentTimeExp = "CAST(" + nowExp + " AS time)";

            if ("LIVE".equals(status)) {
                conditions.add("ss.meeting_date = " + todayExp);
                conditions.add("ss.start_time <= " + currentTimeExp);
                conditions.add("ss.last_entry_time >= " + currentTimeExp);

                // Also enforce session status is LIVE
                conditions.add("s.status = 'LIVE'");
            } else if ("UPCOMING".equals(status)) {
                // Future dates OR today but future time
                conditions.add("(ss.meeting_date > " + todayExp +
                        " OR (ss.meeting_date = " + todayExp + " AND ss.start_time > " + currentTimeExp + "))");
            } else if ("PAST".equals(status)) {
                // Past dates OR today but past last entry time
                conditions.add("(ss.meeting_date < " + todayExp +
                        " OR (ss.meeting_date = " + todayExp + " AND ss.last_entry_time < " + currentTimeExp + "))");
            }
        }

        // Booking & Source Filters
        if (request.getBookingTypeIds() != null && !request.getBookingTypeIds().isEmpty()) {
            conditions.add("s.booking_type_id IN :bookingTypeIds");
            parameters.put("bookingTypeIds", request.getBookingTypeIds());
        }

        if (request.getSource() != null) {
            conditions.add("s.source = :source");
            parameters.put("source", request.getSource());
        }

        if (request.getSourceId() != null) {
            conditions.add("s.source_id = :sourceId");
            parameters.put("sourceId", request.getSourceId());
        }

        // Time of day filter
        if (request.getStartTimeOfDay() != null) {
            conditions.add("ss.start_time >= :startTimeOfDay");
            parameters.put("startTimeOfDay", java.sql.Time.valueOf(request.getStartTimeOfDay()));
        }

        if (request.getEndTimeOfDay() != null) {
            conditions.add("ss.start_time <= :endTimeOfDay");
            parameters.put("endTimeOfDay", java.sql.Time.valueOf(request.getEndTimeOfDay()));
        }

        // Recurrence types filter
        if (request.getRecurrenceTypes() != null && !request.getRecurrenceTypes().isEmpty()) {
            conditions.add("ss.recurrence_type IN :recurrenceTypes");
            parameters.put("recurrenceTypes", request.getRecurrenceTypes());
        }

        // Access levels filter
        if (request.getAccessLevels() != null && !request.getAccessLevels().isEmpty()) {
            conditions.add("s.access_level IN :accessLevels");
            parameters.put("accessLevels", request.getAccessLevels());
        }

        // Timezone filter
        if (request.getTimezones() != null && !request.getTimezones().isEmpty()) {
            conditions.add("s.timezone IN :timezones");
            parameters.put("timezones", request.getTimezones());
        }

        // Streaming service types filter.
        // The platform value historically sat in `session_streaming_service_type`
        // (when frontend send-mapping was reversed) and now sits in `link_type`
        // for sessions created after the swap-fix. Both columns are checked so
        // the filter returns sessions from both eras. Safe because platform
        // values (bbb/youtube/zoom/zoho/google meet/other) and streaming-mode
        // values (embed/redirect) don't overlap.
        if (request.getStreamingServiceTypes() != null && !request.getStreamingServiceTypes().isEmpty()) {
            conditions.add("(s.session_streaming_service_type IN :streamingServiceTypes "
                    + "OR s.link_type IN :streamingServiceTypes)");
            parameters.put("streamingServiceTypes", request.getStreamingServiceTypes());
        }

        // Schedule IDs filter
        if (request.getScheduleIds() != null && !request.getScheduleIds().isEmpty()) {
            conditions.add("ss.id IN :scheduleIds");
            parameters.put("scheduleIds", request.getScheduleIds());
        }

        // Batch IDs filter
        if (request.getBatchIds() != null && !request.getBatchIds().isEmpty()) {
            conditions.add("lsp.source_type = 'BATCH' AND lsp.source_id IN :batchIds");
            parameters.put("batchIds", request.getBatchIds());
        }

        // User IDs filter
        if (request.getUserIds() != null && !request.getUserIds().isEmpty()) {
            conditions.add("lsp.source_type = 'USER' AND lsp.source_id IN :userIds");
            parameters.put("userIds", request.getUserIds());
        }

        // Search query filter (title or subject)
        if (StringUtils.hasText(request.getSearchQuery())) {
            conditions.add("(LOWER(s.title) LIKE :searchQuery OR LOWER(s.subject) LIKE :searchQuery)");
            parameters.put("searchQuery", "%" + request.getSearchQuery().toLowerCase() + "%");
        }

        // Append WHERE clause
        if (!conditions.isEmpty()) {
            String whereClause = " WHERE " + String.join(" AND ", conditions);
            queryBuilder.append(whereClause);
            countQueryBuilder.append(whereClause);
        }

        // ORDER BY
        String orderBy = buildOrderByClause(request);
        queryBuilder.append(orderBy);

        // Execute count query
        Query countQuery = entityManager.createNativeQuery(countQueryBuilder.toString());
        setQueryParameters(countQuery, parameters);
        Long totalCount = ((Number) countQuery.getSingleResult()).longValue();

        // Execute data query with pagination
        Query dataQuery = entityManager.createNativeQuery(queryBuilder.toString(), "LiveSessionListProjectionMapping");
        setQueryParameters(dataQuery, parameters);
        dataQuery.setFirstResult((int) pageable.getOffset());
        dataQuery.setMaxResults(pageable.getPageSize());

        @SuppressWarnings("unchecked")
        List<LiveSessionRepository.LiveSessionListProjection> results = dataQuery.getResultList();

        return new PageImpl<>(results, pageable, totalCount);
    }

    private String buildOrderByClause(SessionSearchRequest request) {
        String sortBy = request.getSortBy() != null ? request.getSortBy() : "meetingDate";
        String sortDirection = request.getSortDirection() != null ? request.getSortDirection() : "ASC";

        // Map sortBy to actual column names
        String column = switch (sortBy.toLowerCase()) {
            case "meetingdate" -> "ss.meeting_date";
            case "starttime" -> "ss.start_time";
            case "title" -> "s.title";
            case "createdat" -> "s.created_at";
            default -> "ss.meeting_date";
        };

        // Add secondary sort by start_time if primary is not time-related
        if (column.equals("ss.meeting_date")) {
            return String.format(" ORDER BY %s %s, ss.start_time %s", column, sortDirection, sortDirection);
        } else {
            return String.format(" ORDER BY %s %s", column, sortDirection);
        }
    }

    private void setQueryParameters(Query query, Map<String, Object> parameters) {
        for (Map.Entry<String, Object> entry : parameters.entrySet()) {
            query.setParameter(entry.getKey(), entry.getValue());
        }
    }
}
