package vacademy.io.notification_service.features.announcements.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.notification_service.features.announcements.entity.Announcement;
import vacademy.io.notification_service.features.announcements.enums.AnnouncementStatus;

import java.time.LocalDateTime;
import java.util.List;

@Repository
public interface AnnouncementRepository extends JpaRepository<Announcement, String> {
    
    Page<Announcement> findByInstituteIdOrderByCreatedAtDesc(String instituteId, Pageable pageable);

    /*
     * Switch off every still-active system alert raised ABOUT one thing — the
     * lead-assignment bell, once the counsellor has actually worked that lead.
     *
     * Updates the alert row rather than deleting the announcement: the alert is
     * what the bell reads, and the announcement stays as a record that it was
     * sent. Scoped by institute so one institute can never clear another's.
     */
    @Modifying
    @Transactional
    @Query(value = """
            UPDATE announcement_system_alerts sa
            SET is_active = FALSE
            FROM announcements a
            WHERE sa.announcement_id = a.id
              AND sa.is_active = TRUE
              AND a.institute_id = :instituteId
              AND a.entity = :entity
              AND a.entity_id = :entityId
            """, nativeQuery = true)
    int deactivateSystemAlertsForEntity(@Param("instituteId") String instituteId,
                                        @Param("entity") String entity,
                                        @Param("entityId") String entityId);
    
    Page<Announcement> findByInstituteIdAndStatusOrderByCreatedAtDesc(String instituteId, AnnouncementStatus status, Pageable pageable);
    
    List<Announcement> findByInstituteIdAndCreatedByOrderByCreatedAtDesc(String instituteId, String createdBy);
    
    @Query("SELECT a FROM Announcement a WHERE a.instituteId = :instituteId AND a.createdAt BETWEEN :startDate AND :endDate ORDER BY a.createdAt DESC")
    List<Announcement> findByInstituteIdAndDateRange(@Param("instituteId") String instituteId, 
                                                   @Param("startDate") LocalDateTime startDate, 
                                                   @Param("endDate") LocalDateTime endDate);
    
    long countByInstituteIdAndStatus(String instituteId, AnnouncementStatus status);
    
    @Query("SELECT a FROM Announcement a JOIN a.scheduledMessages sm WHERE sm.isActive = true AND sm.nextRunTime <= :currentTime")
    List<Announcement> findScheduledAnnouncementsToProcess(@Param("currentTime") LocalDateTime currentTime);

    // Planned announcements (DRAFT/PENDING_APPROVAL/SCHEDULED having active schedules within optional range)
    @Query("""
        SELECT a FROM Announcement a
        WHERE a.instituteId = :instituteId
          AND a.status IN (vacademy.io.notification_service.features.announcements.enums.AnnouncementStatus.PENDING_APPROVAL,
                           vacademy.io.notification_service.features.announcements.enums.AnnouncementStatus.SCHEDULED,
                           vacademy.io.notification_service.features.announcements.enums.AnnouncementStatus.DRAFT)
          AND EXISTS (
              SELECT sm FROM ScheduledMessage sm
              WHERE sm.announcement.id = a.id AND sm.isActive = true
                AND (COALESCE(sm.nextRunTime, sm.startDate, sm.endDate) >= COALESCE(:fromDate, COALESCE(sm.nextRunTime, sm.startDate, sm.endDate)))
                AND (COALESCE(sm.nextRunTime, sm.startDate, sm.endDate) <= COALESCE(:toDate, COALESCE(sm.nextRunTime, sm.startDate, sm.endDate)))
          )
        ORDER BY a.createdAt DESC
    """)
    Page<Announcement> findPlannedAnnouncements(
            @Param("instituteId") String instituteId,
            @Param("fromDate") LocalDateTime fromDate,
            @Param("toDate") LocalDateTime toDate,
            Pageable pageable);

    // Past announcements (already delivered/expired/rejected) within optional createdAt range
    @Query("""
        SELECT a FROM Announcement a
        WHERE a.instituteId = :instituteId
          AND a.status IN (vacademy.io.notification_service.features.announcements.enums.AnnouncementStatus.ACTIVE,
                           vacademy.io.notification_service.features.announcements.enums.AnnouncementStatus.INACTIVE,
                           vacademy.io.notification_service.features.announcements.enums.AnnouncementStatus.EXPIRED,
                           vacademy.io.notification_service.features.announcements.enums.AnnouncementStatus.REJECTED)
          AND a.createdAt >= COALESCE(:fromDate, a.createdAt)
          AND a.createdAt <= COALESCE(:toDate, a.createdAt)
        ORDER BY a.createdAt DESC
    """)
    Page<Announcement> findPastAnnouncements(
            @Param("instituteId") String instituteId,
            @Param("fromDate") LocalDateTime fromDate,
            @Param("toDate") LocalDateTime toDate,
            Pageable pageable);
}