package vacademy.io.admin_core_service.features.catalogue_analytics.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.catalogue_analytics.dto.CatalogueEventRequest;
import vacademy.io.admin_core_service.features.catalogue_analytics.entity.CataloguePageEvent;
import vacademy.io.admin_core_service.features.catalogue_analytics.repository.CataloguePageEventRepository;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.util.*;

@Service
public class CatalogueAnalyticsService {

    private static final Logger logger = LoggerFactory.getLogger(CatalogueAnalyticsService.class);

    private static final Set<String> ALLOWED_EVENTS = Set.of("VIEW", "CTA", "LEAD");

    /**
     * Process-lifetime random salt, mixed with the date. Two consequences,
     * both intended: the hash cannot be reversed to an IP even with the
     * algorithm, and it cannot be correlated across days or across restarts.
     * The cost is that a restart splits a day's unique-visitor count — a price
     * worth paying to hold no durable identifier at all.
     */
    private static final String SALT;
    static {
        byte[] b = new byte[32];
        new SecureRandom().nextBytes(b);
        SALT = Base64.getEncoder().encodeToString(b);
    }

    @Autowired
    private CataloguePageEventRepository repository;

    /** Never throws: a beacon must not be able to break a visitor's page. */
    public void record(CatalogueEventRequest req, String ip, String userAgent) {
        try {
            if (req == null || isBlank(req.getInstituteId())) return;
            String type = req.getEventType() == null ? "VIEW" : req.getEventType().toUpperCase(Locale.ROOT);
            if (!ALLOWED_EVENTS.contains(type)) type = "VIEW";

            repository.save(CataloguePageEvent.builder()
                    .instituteId(trim(req.getInstituteId(), 36))
                    .catalogueId(trim(req.getCatalogueId(), 36))
                    .pageRoute(req.getPageRoute() == null ? "" : trim(req.getPageRoute(), 255))
                    .eventType(type)
                    .visitorHash(visitorHash(ip, userAgent))
                    .sessionId(trim(req.getSessionId(), 64))
                    .referrerHost(referrerHost(req.getReferrer()))
                    .utmSource(trim(req.getUtmSource(), 128))
                    .utmMedium(trim(req.getUtmMedium(), 128))
                    .utmCampaign(trim(req.getUtmCampaign(), 191))
                    .device(device(req.getDevice()))
                    .build());
        } catch (Exception e) {
            logger.warn("[catalogue-analytics] dropped event: {}", e.getMessage());
        }
    }

    /** Salted, date-scoped, one-way. Not a stable identifier. */
    private String visitorHash(String ip, String userAgent) {
        if (isBlank(ip)) return null;
        try {
            String material = SALT + '|' + LocalDate.now() + '|' + ip + '|' + (userAgent == null ? "" : userAgent);
            byte[] d = MessageDigest.getInstance("SHA-256").digest(material.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(64);
            for (byte x : d) sb.append(Character.forDigit((x >> 4) & 0xF, 16)).append(Character.forDigit(x & 0xF, 16));
            return sb.toString();
        } catch (Exception e) {
            return null;
        }
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
            return host == null ? null : trim(host.toLowerCase(Locale.ROOT), 255);
        } catch (Exception e) {
            return null;
        }
    }

    private String device(String device) {
        if (device == null) return null;
        String d = device.toLowerCase(Locale.ROOT);
        return d.equals("mobile") || d.equals("tablet") || d.equals("desktop") ? d : null;
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }

    /** Column widths are a contract; an over-long value must not fail an insert. */
    private static String trim(String s, int max) {
        if (s == null) return null;
        String t = s.trim();
        return t.length() <= max ? t : t.substring(0, max);
    }
}
