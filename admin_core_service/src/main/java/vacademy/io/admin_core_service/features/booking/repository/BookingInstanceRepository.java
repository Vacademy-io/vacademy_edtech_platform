package vacademy.io.admin_core_service.features.booking.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.booking.entity.BookingInstance;

import java.sql.Timestamp;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

@Repository
public interface BookingInstanceRepository extends JpaRepository<BookingInstance, String> {

    Optional<BookingInstance> findByManageToken(String manageToken);

    /**
     * Live bookings (CONFIRMED / PENDING) of one person that start in [dayStart, dayEnd).
     * The person is matched by any identifier the new booking carries, because the same
     * person often arrives as two lead rows or two user ids with one phone and one email.
     * Null parameters match nothing.
     */
    @Query(value = """
            SELECT * FROM booking_instance b
             WHERE b.institute_id = :instituteId
               AND b.status IN ('CONFIRMED', 'PENDING')
               AND b.scheduled_start_utc >= :dayStart AND b.scheduled_start_utc < :dayEnd
               AND ( (CAST(:responseId AS text) IS NOT NULL AND b.audience_response_id = CAST(:responseId AS text))
                  OR (CAST(:userId AS text) IS NOT NULL AND b.invitee_user_id = CAST(:userId AS text))
                  OR (CAST(:phone10 AS text) IS NOT NULL
                      AND RIGHT(REGEXP_REPLACE(COALESCE(b.invitee_phone, ''), '[^0-9]', '', 'g'), 10) = CAST(:phone10 AS text))
                  OR (CAST(:email AS text) IS NOT NULL AND LOWER(b.invitee_email) = CAST(:email AS text)) )
             ORDER BY b.scheduled_start_utc
            """, nativeQuery = true)
    List<BookingInstance> findLiveBookingsOfPersonBetween(@Param("instituteId") String instituteId,
                                                          @Param("responseId") String responseId,
                                                          @Param("userId") String userId,
                                                          @Param("phone10") String phone10,
                                                          @Param("email") String email,
                                                          @Param("dayStart") Timestamp dayStart,
                                                          @Param("dayEnd") Timestamp dayEnd);

    /** Public-endpoint abuse caps (see PublicBookingService.book). */
    long countByBookingPageIdAndCreatedAtAfter(String bookingPageId, Timestamp after);

    /** Count active bookings across a set of hosts in a time window — mentorship dashboard stats. */
    @Query("""
            SELECT COUNT(b) FROM BookingInstance b
            WHERE b.hostUserId IN :hostUserIds
              AND b.status NOT IN ('CANCELLED', 'RESCHEDULED')
              AND b.scheduledStartUtc >= :start
              AND b.scheduledStartUtc < :end
            """)
    long countActiveForHostsBetween(@Param("hostUserIds") List<String> hostUserIds,
                                    @Param("start") Timestamp start,
                                    @Param("end") Timestamp end);

    long countByBookingPageIdAndInviteeEmailIgnoreCaseAndCreatedAtAfter(
            String bookingPageId, String inviteeEmail, Timestamp after);

    Optional<BookingInstance> findByLiveSessionId(String liveSessionId);

    /** Upcoming-session candidates for the mentorship reminder scheduler (all institutes). */
    List<BookingInstance> findByStatusNotInAndScheduledStartUtcBetween(
            Collection<String> statuses, Timestamp from, Timestamp to);

    /** Any session of this mentor↔student pair after the cutoff (recent past or scheduled ahead). */
    boolean existsByHostUserIdAndInviteeUserIdAndStatusNotInAndScheduledStartUtcAfter(
            String hostUserId, String inviteeUserId, Collection<String> statuses, Timestamp after);

    List<BookingInstance> findByAudienceResponseId(String audienceResponseId);

    List<BookingInstance> findByInstituteIdAndInviteeUserIdOrderByScheduledStartUtcDesc(
            String instituteId, String inviteeUserId);

    List<BookingInstance> findByInstituteIdAndInviteeEmailIgnoreCaseOrderByScheduledStartUtcDesc(
            String instituteId, String inviteeEmail);

    /** Active (non-cancelled) bookings of one host overlapping a window — slot blocking. */
    @Query("""
            SELECT b FROM BookingInstance b
            WHERE b.hostUserId = :hostUserId
              AND b.status NOT IN ('CANCELLED', 'RESCHEDULED')
              AND b.scheduledStartUtc < :windowEnd
              AND b.scheduledEndUtc > :windowStart
            """)
    List<BookingInstance> findActiveOverlapping(
            @Param("hostUserId") String hostUserId,
            @Param("windowStart") Timestamp windowStart,
            @Param("windowEnd") Timestamp windowEnd);

    /** All bookings of an institute inside a window — Team Meetings for admins. */
    @Query("""
            SELECT b FROM BookingInstance b
            WHERE b.instituteId = :instituteId
              AND b.scheduledStartUtc < :windowEnd
              AND b.scheduledEndUtc > :windowStart
            ORDER BY b.scheduledStartUtc ASC
            """)
    List<BookingInstance> findForInstituteInWindow(
            @Param("instituteId") String instituteId,
            @Param("windowStart") Timestamp windowStart,
            @Param("windowEnd") Timestamp windowEnd);

    /** Bookings of a set of hosts inside a window — My Schedule / Team Meetings. */
    @Query("""
            SELECT b FROM BookingInstance b
            WHERE b.instituteId = :instituteId
              AND b.hostUserId IN :hostUserIds
              AND b.scheduledStartUtc < :windowEnd
              AND b.scheduledEndUtc > :windowStart
            ORDER BY b.scheduledStartUtc ASC
            """)
    List<BookingInstance> findForHostsInWindow(
            @Param("instituteId") String instituteId,
            @Param("hostUserIds") Collection<String> hostUserIds,
            @Param("windowStart") Timestamp windowStart,
            @Param("windowEnd") Timestamp windowEnd);
}
