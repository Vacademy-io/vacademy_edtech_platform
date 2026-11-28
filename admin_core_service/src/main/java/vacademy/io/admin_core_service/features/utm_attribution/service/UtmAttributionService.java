package vacademy.io.admin_core_service.features.utm_attribution.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.utm_attribution.dto.UtmAttributionResponse;
import vacademy.io.admin_core_service.features.utm_attribution.dto.UtmCampaignSummaryResponse;
import vacademy.io.admin_core_service.features.utm_attribution.dto.UtmTrackRequest;
import vacademy.io.admin_core_service.features.utm_attribution.entity.UtmAttribution;
import vacademy.io.admin_core_service.features.utm_attribution.repository.UtmAttributionRepository;

import java.net.URI;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

@Service
public class UtmAttributionService {

    private static final Logger logger = LoggerFactory.getLogger(UtmAttributionService.class);

    private static final Set<String> ALLOWED_SOURCE_TYPES = Set.of(
            "AUDIENCE", "LIVE_SESSION", "ASSESSMENT", "ENROLL_INVITE", "PRODUCT_PAGE", "CATALOGUE");

    /**
     * A double-clicked submit button, or a retry after a network blip, must not
     * become two touches. Long enough to cover both; short enough that a person
     * genuinely arriving twice in an afternoon is still two rows.
     */
    private static final long DEDUPE_WINDOW_MINUTES = 10;

    @Autowired
    private UtmAttributionRepository repository;

    /**
     * Record one campaign touch.
     *
     * NEVER throws. Every caller is on a path where the important work — a lead
     * created, an enrolment paid for — has already succeeded; losing the
     * attribution is a bad day for a report, while an exception here would undo
     * or fail the thing the learner actually came to do.
     *
     * @return the saved row, or null when nothing was worth saving
     */
    @Transactional
    public UtmAttribution record(UtmTrackRequest request) {
        try {
            if (request == null || isBlank(request.getInstituteId())) return null;

            String sourceType = normaliseSourceType(request.getSourceType());
            if (sourceType == null) return null;

            String utmSource = trim(request.getUtmSource(), 128);
            String utmMedium = trim(request.getUtmMedium(), 128);
            String utmCampaign = trim(request.getUtmCampaign(), 191);
            String utmContent = trim(request.getUtmContent(), 191);
            String utmTerm = trim(request.getUtmTerm(), 191);

            // An untagged arrival is not attribution — it is the absence of it.
            // Storing those would bury the real campaigns under a wall of blank
            // rows and make "how many came from a campaign" unanswerable.
            if (utmSource == null && utmMedium == null && utmCampaign == null
                    && utmContent == null && utmTerm == null) {
                return null;
            }

            String userId = trim(request.getUserId(), 255);
            String email = lower(trim(request.getEmail(), 255));
            String mobile = trim(request.getMobileNumber(), 32);
            String sourceId = trim(request.getSourceId(), 255);

            if (userId == null && email == null && mobile == null) {
                // Nothing to attach the touch to. Anonymous campaign traffic
                // belongs in catalogue_page_event, not here.
                return null;
            }

            Timestamp since = Timestamp.from(Instant.now().minus(DEDUPE_WINDOW_MINUTES, ChronoUnit.MINUTES));
            if (repository.countRecentDuplicates(request.getInstituteId(), userId, email, mobile,
                    sourceType, sourceId, utmCampaign, utmSource, since) > 0) {
                return null;
            }

            UtmAttribution saved = repository.save(UtmAttribution.builder()
                    .instituteId(trim(request.getInstituteId(), 36))
                    .userId(userId)
                    .email(email)
                    .mobileNumber(mobile)
                    .sourceType(sourceType)
                    .sourceId(sourceId)
                    .utmSource(utmSource)
                    .utmMedium(utmMedium)
                    .utmCampaign(utmCampaign)
                    .utmContent(utmContent)
                    .utmTerm(utmTerm)
                    .referrerHost(referrerHost(request.getReferrer()))
                    .landingPath(landingPath(request.getLandingUrl()))
                    .build());

            return saved;
        } catch (Exception e) {
            logger.warn("[utm-attribution] dropped touch: {}", e.getMessage());
            return null;
        }
    }

    /**
     * Convenience overload for server-side callers that already hold the UTM
     * values as the flat {@code utm_source -> value} map the learner app sends.
     */
    public UtmAttribution record(String instituteId,
                                 String userId,
                                 String email,
                                 String mobileNumber,
                                 String sourceType,
                                 String sourceId,
                                 Map<String, String> utmParams) {
        if (utmParams == null || utmParams.isEmpty()) return null;
        return record(UtmTrackRequest.builder()
                .instituteId(instituteId)
                .userId(userId)
                .email(email)
                .mobileNumber(mobileNumber)
                .sourceType(sourceType)
                .sourceId(sourceId)
                .utmSource(utmParams.get("utm_source"))
                .utmMedium(utmParams.get("utm_medium"))
                .utmCampaign(utmParams.get("utm_campaign"))
                .utmContent(utmParams.get("utm_content"))
                .utmTerm(utmParams.get("utm_term"))
                .build());
    }

    /**
     * Every touch for one learner, oldest first.
     *
     * Takes the contact details as well as the user id because three of the six
     * capture surfaces never learn a user id at submit time. Matching on user id
     * alone left those rows unreachable, so the side-view card was permanently
     * empty for audience, live-session and catalogue leads — the very surfaces
     * the feature exists to measure.
     */
    public List<UtmAttributionResponse> findForUser(String instituteId, String userId,
                                                    String email, String mobileNumber) {
        if (isBlank(instituteId)) return List.of();
        String user = trim(userId, 255);
        String mail = lower(trim(email, 255));
        // A bare country code is not an identity. Optional phone fields in this
        // product save as "+91", so matching on one would join together every
        // learner who skipped the field.
        String mobile = matchableMobile(trim(mobileNumber, 32));
        // Nothing to match on: answer empty rather than scanning the institute.
        if (user == null && mail == null && mobile == null) return List.of();
        return repository.findForLearner(instituteId, user, mail, mobile)
                .stream()
                .map(this::toResponse)
                .toList();
    }

    public List<UtmCampaignSummaryResponse> summarise(String instituteId, Timestamp from, Timestamp to) {
        if (isBlank(instituteId)) return List.of();
        List<UtmCampaignSummaryResponse> out = new ArrayList<>();
        for (Object[] row : repository.summarise(instituteId, from, to)) {
            out.add(UtmCampaignSummaryResponse.builder()
                    .utmSource((String) row[0])
                    .utmMedium((String) row[1])
                    .utmCampaign((String) row[2])
                    .sourceType((String) row[3])
                    .count(row[4] == null ? 0L : ((Number) row[4]).longValue())
                    .build());
        }
        return out;
    }

    private UtmAttributionResponse toResponse(UtmAttribution entity) {
        return UtmAttributionResponse.builder()
                .id(entity.getId())
                .sourceType(entity.getSourceType())
                .sourceId(entity.getSourceId())
                .utmSource(entity.getUtmSource())
                .utmMedium(entity.getUtmMedium())
                .utmCampaign(entity.getUtmCampaign())
                .utmContent(entity.getUtmContent())
                .utmTerm(entity.getUtmTerm())
                .referrerHost(entity.getReferrerHost())
                .landingPath(entity.getLandingPath())
                .createdAt(entity.getCreatedAt())
                .build();
    }

    /**
     * A mobile number is only usable as a match key when it actually carries a
     * subscriber number. Anything with fewer than 8 digits is a country code, a
     * placeholder, or a typo, and using it would match unrelated learners.
     */
    private static String matchableMobile(String mobile) {
        if (mobile == null) return null;
        int digits = 0;
        for (int i = 0; i < mobile.length(); i++) {
            if (Character.isDigit(mobile.charAt(i))) digits++;
        }
        return digits >= 8 ? mobile : null;
    }

    private String normaliseSourceType(String raw) {
        if (isBlank(raw)) return null;
        String upper = raw.trim().toUpperCase(Locale.ROOT);
        return ALLOWED_SOURCE_TYPES.contains(upper) ? upper : null;
    }

    /**
     * Host only. A referring URL's path and query routinely carry search terms
     * and occasionally personal data; the host answers "where did they come
     * from" without keeping any of it.
     */
    private String referrerHost(String referrer) {
        if (isBlank(referrer)) return null;
        try {
            String host = URI.create(referrer.trim()).getHost();
            return trim(host, 255);
        } catch (Exception e) {
            return null;
        }
    }

    /** Path only — the query string is where the PII would be. */
    private String landingPath(String landingUrl) {
        if (isBlank(landingUrl)) return null;
        try {
            String path = URI.create(landingUrl.trim()).getPath();
            return trim(path, 512);
        } catch (Exception e) {
            // Already a bare path in most callers.
            String raw = landingUrl.trim();
            int q = raw.indexOf('?');
            return trim(q >= 0 ? raw.substring(0, q) : raw, 512);
        }
    }

    private static String trim(String value, int max) {
        if (value == null) return null;
        String trimmed = value.trim();
        if (trimmed.isEmpty()) return null;
        return trimmed.length() > max ? trimmed.substring(0, max) : trimmed;
    }

    private static String lower(String value) {
        return value == null ? null : value.toLowerCase(Locale.ROOT);
    }

    private static boolean isBlank(String value) {
        return value == null || value.trim().isEmpty();
    }
}
