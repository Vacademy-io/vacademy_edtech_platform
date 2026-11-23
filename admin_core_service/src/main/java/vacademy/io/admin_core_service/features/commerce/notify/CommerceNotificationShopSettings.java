package vacademy.io.admin_core_service.features.commerce.notify;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.catalog_api.website.InstituteWebsiteService;
import vacademy.io.admin_core_service.features.catalog_api.website.WebsiteHosts;
import vacademy.io.admin_core_service.features.commerce.stock.service.CommerceStockSettings;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;

import java.net.URI;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * The shop-wide values of the buyer messages, {@code COMMERCE_SETTING.notifications}:
 * <pre>{ "linkBaseUrl": null, "linkDays": 14, "shopName": {"hi": null, "en": null} }</pre>
 * A missing or bad value takes its default. The link base of the order links is the stored
 * one while its host is still a verified website of the institute; with none stored and exactly
 * one verified website, that website; else none (messages then go without a link).
 */
@Slf4j
@Component
public class CommerceNotificationShopSettings {

    public static final String KEY = "notifications";
    public static final int DEFAULT_LINK_DAYS = 14;
    public static final int MIN_LINK_DAYS = 1;
    public static final int MAX_LINK_DAYS = 30;
    public static final int MAX_SHOP_NAME = 60;

    /** As stored (defaults where missing or bad). */
    public record Shop(String linkBaseUrl, int linkDays, Map<String, String> shopName) {
        public static Shop defaults() {
            Map<String, String> names = new LinkedHashMap<>();
            names.put("hi", null);
            names.put("en", null);
            return new Shop(null, DEFAULT_LINK_DAYS, names);
        }
    }

    private final InstituteSettingService instituteSettingService;
    private final InstituteWebsiteService websiteService;
    private final ObjectMapper objectMapper;

    public CommerceNotificationShopSettings(InstituteSettingService instituteSettingService,
                                            InstituteWebsiteService websiteService, ObjectMapper objectMapper) {
        this.instituteSettingService = instituteSettingService;
        this.websiteService = websiteService;
        this.objectMapper = objectMapper;
    }

    public Shop read(String instituteId) {
        try {
            Object data = instituteSettingService.getSettingByInstituteIdAndKey(instituteId,
                    CommerceStockSettings.SETTING_KEY);
            if (data == null) {
                return Shop.defaults();
            }
            JsonNode tree = objectMapper.valueToTree(data);
            return parse(tree == null ? null : tree.get(KEY));
        } catch (RuntimeException e) {
            log.warn("Could not read the message settings of institute {}; defaults apply: {}", instituteId,
                    e.getClass().getSimpleName());
            return Shop.defaults();
        }
    }

    /** The stored node, each bad value replaced by its default. */
    public static Shop parse(JsonNode node) {
        Shop defaults = Shop.defaults();
        if (node == null || !node.isObject()) {
            return defaults;
        }
        String base = null;
        JsonNode stored = node.get("linkBaseUrl");
        if (stored != null && stored.isTextual()) {
            try {
                base = shape(stored.asText());
            } catch (IllegalArgumentException e) {
                base = null;
            }
        }
        int days = DEFAULT_LINK_DAYS;
        JsonNode d = node.get("linkDays");
        if (d != null && d.isInt() && d.asInt() >= MIN_LINK_DAYS && d.asInt() <= MAX_LINK_DAYS) {
            days = d.asInt();
        }
        Map<String, String> names = new LinkedHashMap<>(defaults.shopName());
        JsonNode n = node.get("shopName");
        if (n != null && n.isObject()) {
            for (String locale : CommerceNotificationTexts.LOCALES) {
                JsonNode v = n.get(locale);
                if (v != null && v.isTextual() && !v.asText().isBlank() && v.asText().length() <= MAX_SHOP_NAME
                        && !v.asText().contains("\n")) {
                    names.put(locale, v.asText().trim());
                }
            }
        }
        return new Shop(base, days, names);
    }

    /**
     * The link base in its stored form: {@code https://} only, no user info, query or fragment,
     * no trailing slash; a path (the site's tag) may follow the host.
     *
     * @throws IllegalArgumentException when it is not of that shape
     */
    public static String shape(String raw) {
        if (raw == null || raw.isBlank() || raw.length() > 200) {
            throw new IllegalArgumentException("link_base_url is an https address of at most 200 characters");
        }
        String value = raw.trim();
        URI uri;
        try {
            uri = new URI(value);
        } catch (Exception e) {
            throw new IllegalArgumentException("link_base_url is not an address");
        }
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getRawUserInfo() != null || uri.getRawQuery() != null
                || uri.getRawFragment() != null || uri.getHost() == null || uri.getPort() != -1
                || value.contains("?") || value.contains("#") || value.contains("@")) {
            throw new IllegalArgumentException("link_base_url is https://host or https://host/path, with no user, "
                    + "port, query or fragment");
        }
        String path = uri.getRawPath() == null ? "" : uri.getRawPath();
        if (path.endsWith("/")) {
            throw new IllegalArgumentException("link_base_url has no trailing slash");
        }
        if (!path.isEmpty() && !path.matches("(/[A-Za-z0-9._~-]+)+")) {
            throw new IllegalArgumentException("link_base_url has a plain path");
        }
        return "https://" + uri.getHost().toLowerCase(Locale.ROOT) + path;
    }

    /** The host of a link base in its stored form. */
    public static String hostOf(String linkBase) {
        return URI.create(linkBase).getHost().toLowerCase(Locale.ROOT);
    }

    /** Whether a link base's host is covered by the institute's verified websites. */
    public boolean verified(String instituteId, String linkBase) {
        try {
            return WebsiteHosts.coveredByAny(websiteService.verifiedHosts(instituteId), hostOf(linkBase));
        } catch (RuntimeException e) {
            return false;
        }
    }

    /** {@code https://<host>} of every verified website, sorted. */
    public List<String> candidates(String instituteId) {
        Set<String> hosts;
        try {
            hosts = websiteService.verifiedHosts(instituteId);
        } catch (RuntimeException e) {
            log.warn("Could not read the verified websites of institute {}: {}", instituteId,
                    e.getClass().getSimpleName());
            return List.of();
        }
        List<String> out = new ArrayList<>();
        for (String host : hosts) {
            out.add("https://" + host);
        }
        out.sort(String::compareTo);
        return out;
    }

    /** The link base in force, or null (no link in the messages). */
    public String linkBase(String instituteId, Shop shop) {
        if (shop.linkBaseUrl() != null) {
            return verified(instituteId, shop.linkBaseUrl()) ? shop.linkBaseUrl() : null;
        }
        List<String> candidates = candidates(instituteId);
        return candidates.size() == 1 ? candidates.get(0) : null;
    }
}
