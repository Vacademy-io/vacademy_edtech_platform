package vacademy.io.admin_core_service.features.marketing.service;

/**
 * SQL for the ad performance report. Binds: instituteId, tz (IANA zone of the institute),
 * fromTs / toTs (UTC wall clock LocalDateTime bounds of the institute-local window, [from, to)),
 * fromDay / toDay (inclusive DATE bounds for ad_spend_daily).
 *
 * <p>audience_response.submitted_at, user_lead_profile.converted_at and utm_attribution.created_at
 * are TIMESTAMP columns holding UTC wall clock, so days are bucketed with
 * {@code (ts AT TIME ZONE 'UTC' AT TIME ZONE :tz)::date} like the CRM dashboard.
 *
 * <p>Every branch is narrowed by the institute first (audience.institute_id,
 * user_lead_profile.institute_id, utm_attribution.institute_id, ad_spend_daily.institute_id) so the
 * existing per-institute indexes drive the plan.
 */
final class AdPerformanceSql {

    private AdPerformanceSql() {
    }

    /** source_type values that mean "a Meta lead ad". */
    static final String META_SOURCE_TYPES =
            "'META_LEAD_ADS', 'FACEBOOK_ADS', 'INSTAGRAM_ADS', 'FACEBOOK', 'FACEBOOK_LEAD_ADS'";
    /** source_type values that mean "a Google lead ad". */
    static final String GOOGLE_SOURCE_TYPES = "'GOOGLE_LEAD_ADS', 'GOOGLE_ADS'";
    static final String AD_SOURCE_TYPES = META_SOURCE_TYPES + ", " + GOOGLE_SOURCE_TYPES;

    /** Lead visibility shared by both response branches: live, not opted out, not a duplicate. */
    private static final String LIVE_RESPONSE = """
               AND ar.audience_status = 'ACTIVE'
               AND (ar.overall_status IS NULL OR ar.overall_status <> 'OPTED_OUT')
               AND COALESCE(ar.is_duplicate, FALSE) = FALSE
            """;

    /**
     * Enquiries (kind E) and admissions (kind A) per platform, institute-local day and campaign id.
     * platform NULL = not from ads (the "unattributed" context numbers).
     *
     * <ul>
     *   <li>adm: profiles converted in the window (one per person: user_lead_profile is unique on
     *       user_id + institute_id).</li>
     *   <li>resp: responses submitted in the window, plus every other response (any date) of the
     *       admitted people, so an admission is credited to the person's earliest ad response even
     *       when that enquiry predates the window.</li>
     *   <li>cls: one platform + campaign per response. Lead-ad source types decide directly
     *       (campaign = the lead's ad_campaign_id (V672), else a numeric source_id). Other responses take the person's first utm touch in
     *       this institute (at most 10 minutes after the submission); the lookup is skipped for
     *       lead-ad rows. Google campaigns that are VIDEO campaigns in synced spend count as YOUTUBE.</li>
     *   <li>first_ad: per admitted person, the earliest ad-attributed response.</li>
     * </ul>
     */
    static final String ATTRIBUTION = ("""
            WITH adm AS (
                SELECT ulp.user_id,
                       (ulp.converted_at AT TIME ZONE 'UTC' AT TIME ZONE :tz)::date AS day
                  FROM user_lead_profile ulp
                 WHERE ulp.institute_id = :instituteId
                   AND ulp.conversion_status = 'CONVERTED'
                   AND ulp.converted_at >= :fromTs
                   AND ulp.converted_at < :toTs
            ),
            video AS (
                SELECT DISTINCT s.campaign_id
                  FROM ad_spend_daily s
                 WHERE s.institute_id = :instituteId
                   AND s.platform = 'GOOGLE'
                   AND s.channel = 'VIDEO'
            ),
            resp AS (
                SELECT ar.id, ar.user_id, ar.student_user_id, ar.parent_email, ar.parent_mobile,
                       ar.submitted_at, ar.source_type, ar.source_id, ar.ad_campaign_id, TRUE AS in_window
                  FROM audience a
                  JOIN audience_response ar ON ar.audience_id = a.id
                 WHERE a.institute_id = :instituteId
                   AND ar.submitted_at >= :fromTs
                   AND ar.submitted_at < :toTs
            """ + LIVE_RESPONSE + """
                UNION ALL
                SELECT ar.id, ar.user_id, ar.student_user_id, ar.parent_email, ar.parent_mobile,
                       ar.submitted_at, ar.source_type, ar.source_id, ar.ad_campaign_id, FALSE AS in_window
                  FROM adm d
                  JOIN audience_response ar ON ar.user_id = d.user_id
                  JOIN audience a ON a.id = ar.audience_id AND a.institute_id = :instituteId
                 WHERE (ar.submitted_at IS NULL OR ar.submitted_at < :fromTs OR ar.submitted_at >= :toTs)
            """ + LIVE_RESPONSE + """
            ),
            cls AS (
                SELECT r.id, r.user_id, r.submitted_at, r.in_window,
                       (r.submitted_at AT TIME ZONE 'UTC' AT TIME ZONE :tz)::date AS day,
                       CASE
                           WHEN p.platform = 'GOOGLE' AND p.campaign_id IS NOT NULL
                                AND p.campaign_id IN (SELECT v.campaign_id FROM video v) THEN 'YOUTUBE'
                           ELSE p.platform
                       END AS platform,
                       p.campaign_id
                  FROM resp r
                  LEFT JOIN LATERAL (
                      SELECT u.utm_source, u.utm_campaign
                        FROM utm_attribution u
                       WHERE r.source_type NOT IN (%1$s)
                         AND u.institute_id = :instituteId
                         AND ((u.user_id IS NOT NULL AND (u.user_id = r.user_id OR u.user_id = r.student_user_id))
                           OR (u.email IS NOT NULL AND r.parent_email IS NOT NULL AND LOWER(r.parent_email) = u.email)
                           OR (u.mobile_number IS NOT NULL
                               AND r.parent_mobile = u.mobile_number
                               AND LENGTH(REGEXP_REPLACE(u.mobile_number, '[^0-9]', '', 'g')) >= 8))
                         AND u.created_at <= r.submitted_at + INTERVAL '10 minutes'
                       ORDER BY u.created_at
                       LIMIT 1
                  ) t ON TRUE
                  CROSS JOIN LATERAL (
                      SELECT CASE
                                 WHEN r.source_type IN (%2$s) THEN 'META'
                                 WHEN r.source_type IN (%3$s) THEN 'GOOGLE'
                                 WHEN LOWER(t.utm_source) IN ('facebook', 'fb', 'instagram', 'ig', 'meta') THEN 'META'
                                 WHEN LOWER(t.utm_source) IN ('google', 'adwords', 'gads') THEN 'GOOGLE'
                                 WHEN LOWER(t.utm_source) IN ('youtube', 'yt') THEN 'YOUTUBE'
                             END AS platform,
                             CASE
                                 WHEN r.source_type IN (%1$s) THEN
                                     CASE WHEN r.ad_campaign_id ~ '^[0-9]+$' THEN r.ad_campaign_id
                                          WHEN r.source_id ~ '^[0-9]+$' THEN r.source_id END
                                 WHEN t.utm_campaign ~ '^[0-9]+$' THEN t.utm_campaign
                             END AS campaign_id
                  ) p
            ),
            first_ad AS (
                SELECT DISTINCT ON (c.user_id) c.user_id, c.platform, c.campaign_id
                  FROM cls c
                 WHERE c.platform IS NOT NULL
                   AND c.user_id IN (SELECT d.user_id FROM adm d)
                 ORDER BY c.user_id, c.submitted_at NULLS LAST, c.id
            )
            SELECT 'E' AS kind, c.platform, c.day, c.campaign_id, COUNT(*) AS n
              FROM cls c
             WHERE c.in_window
             GROUP BY c.platform, c.day, c.campaign_id
            UNION ALL
            SELECT 'A' AS kind, f.platform, d.day, f.campaign_id, COUNT(*) AS n
              FROM adm d
              LEFT JOIN first_ad f ON f.user_id = d.user_id
             GROUP BY f.platform, d.day, f.campaign_id
            """).formatted(AD_SOURCE_TYPES, META_SOURCE_TYPES, GOOGLE_SOURCE_TYPES);

    /** Synced spend rows in [fromDay, toDay] of the institute ad accounts that are not disconnected. */
    static final String SPEND = """
            SELECT s.ad_account_id, s.platform, s.channel, s.campaign_id, s.campaign_name, s.day,
                   s.currency, s.spend, s.clicks, s.impressions, s.platform_leads
              FROM ad_spend_daily s
              JOIN ad_account aa ON aa.id = s.ad_account_id
             WHERE s.institute_id = :instituteId
               AND s.day >= :fromDay
               AND s.day <= :toDay
               AND aa.institute_id = :instituteId
               AND aa.status <> 'DISCONNECTED'
            """;
}
