package vacademy.io.admin_core_service.features.catalogue_analytics.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.catalogue_analytics.entity.CataloguePageEvent;

import java.sql.Timestamp;
import java.util.List;

/**
 * Aggregates for the site-analytics dashboard.
 *
 * Every query is native and grouped in SQL rather than in Java: these tables
 * grow one row per page view, so pulling rows back to count them in memory
 * stops working at exactly the traffic level where an institute starts caring
 * about analytics.
 */
@Repository
public interface CataloguePageEventRepository extends JpaRepository<CataloguePageEvent, String> {

    /** Views and unique visitors per day, for the trend line. */
    @Query(value = """
            SELECT DATE(created_at) AS day,
                   COUNT(*) AS views,
                   COUNT(DISTINCT visitor_hash) AS visitors
              FROM catalogue_page_event
             WHERE institute_id = :instituteId
               AND event_type = 'VIEW'
               AND created_at >= :from AND created_at < :to
             GROUP BY DATE(created_at)
             ORDER BY day
            """, nativeQuery = true)
    List<Object[]> dailyTotals(@Param("instituteId") String instituteId,
                               @Param("from") Timestamp from,
                               @Param("to") Timestamp to);

    /** Views and unique visitors per page. */
    @Query(value = """
            SELECT page_route,
                   COUNT(*) AS views,
                   COUNT(DISTINCT visitor_hash) AS visitors
              FROM catalogue_page_event
             WHERE institute_id = :instituteId
               AND event_type = 'VIEW'
               AND created_at >= :from AND created_at < :to
             GROUP BY page_route
             ORDER BY views DESC
             LIMIT 100
            """, nativeQuery = true)
    List<Object[]> byPage(@Param("instituteId") String instituteId,
                          @Param("from") Timestamp from,
                          @Param("to") Timestamp to);

    /**
     * Where traffic came from. utm_source when the visit was tagged, otherwise
     * the referring host, otherwise 'direct' — so the column always adds up to
     * total traffic instead of quietly dropping untagged visits.
     */
    @Query(value = """
            SELECT COALESCE(NULLIF(utm_source, ''), NULLIF(referrer_host, ''), 'direct') AS src,
                   COUNT(*) AS views,
                   COUNT(DISTINCT visitor_hash) AS visitors
              FROM catalogue_page_event
             WHERE institute_id = :instituteId
               AND event_type = 'VIEW'
               AND created_at >= :from AND created_at < :to
             GROUP BY src
             ORDER BY views DESC
             LIMIT 25
            """, nativeQuery = true)
    List<Object[]> bySource(@Param("instituteId") String instituteId,
                            @Param("from") Timestamp from,
                            @Param("to") Timestamp to);

    /** Headline totals for the range. */
    @Query(value = """
            SELECT COUNT(*) AS views,
                   COUNT(DISTINCT visitor_hash) AS visitors,
                   COUNT(DISTINCT session_id) AS sessions
              FROM catalogue_page_event
             WHERE institute_id = :instituteId
               AND event_type = 'VIEW'
               AND created_at >= :from AND created_at < :to
            """, nativeQuery = true)
    List<Object[]> totals(@Param("instituteId") String instituteId,
                          @Param("from") Timestamp from,
                          @Param("to") Timestamp to);
}
