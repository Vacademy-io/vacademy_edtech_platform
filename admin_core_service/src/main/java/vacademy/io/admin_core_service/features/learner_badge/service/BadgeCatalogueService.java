package vacademy.io.admin_core_service.features.learner_badge.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.Getter;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.io.ClassPathResource;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.institute.dto.settings.GenericSettingRequest;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;
import vacademy.io.admin_core_service.features.learner_badge.dto.BadgeDefinition;
import vacademy.io.admin_core_service.features.learner_badge.dto.BadgeDefinitionRequest;
import vacademy.io.admin_core_service.features.learner_badge.dto.CatalogueBadgeResponse;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Server-side reader/writer of an institute's badge catalogue — the {@code badges} array of
 * the {@code BADGES_REWARDS_SETTING} institute setting, which until now only the two
 * frontends read and wrote (wholesale).
 *
 * <p>Two jobs:
 * <ul>
 *   <li>{@link #read} / {@link #syncableBadges}: give the award and sync flows a trusted view
 *       of which badges exist, which are enabled, and which are staff-only ({@code manual}),
 *       so a learner app cannot claim a badge the catalogue never lets it unlock.</li>
 *   <li>{@link #upsert}: append ONE badge (or replace one by id) without the client re-saving
 *       the whole blob — every other key of the setting data ({@code enabled}, {@code scoring},
 *       {@code publicShowFullNames}, {@code version}, …) is carried over untouched, and
 *       untouched badge entries are written back as the raw maps they were read as.</li>
 * </ul>
 *
 * <p>Defaults: both frontends substitute the six built-in badges whenever the stored list is
 * empty or the key is absent. The server mirrors that from
 * {@code badges/default-badges.json} (loaded once) — the sync validator accepts the default
 * ids in that state, and the first append materialises the six defaults before adding the
 * new badge so the FE/learner do not suddenly see ONLY the new one.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class BadgeCatalogueService {

    public static final String SETTING_KEY = "BADGES_REWARDS_SETTING";
    public static final String SETTING_NAME = "Badges & Rewards";
    public static final String DEFAULTS_RESOURCE = "badges/default-badges.json";
    public static final String DEFAULT_ICON = "Star";

    private static final int MAX_NAME_LENGTH = 120;
    private static final int MAX_DESCRIPTION_LENGTH = 500;
    private static final int MAX_ICON_LENGTH = 255;

    private final InstituteRepository instituteRepository;
    private final InstituteSettingService instituteSettingService;
    private final ObjectMapper objectMapper;

    /** Loaded lazily, once; immutable. */
    private volatile List<BadgeDefinition> defaults;

    /** A parsed view of the setting data. {@code data} is the raw map (never null). */
    @Getter
    public static class Catalogue {
        private final Map<String, Object> data;
        private final List<BadgeDefinition> badges;
        /** True when the stored list was absent/empty (or wholly unreadable) and {@link #badges} holds the defaults. */
        private final boolean usingDefaults;
        /**
         * Stored entries Jackson could not map to {@link BadgeDefinition} (e.g. a threshold out of
         * numeric range). They are excluded from {@link #badges} but still present in {@link #data},
         * so a server-side append carries them through untouched instead of dropping them.
         */
        private final int unreadableEntries;

        Catalogue(Map<String, Object> data, List<BadgeDefinition> badges, boolean usingDefaults,
                  int unreadableEntries) {
            this.data = data;
            this.badges = badges;
            this.usingDefaults = usingDefaults;
            this.unreadableEntries = unreadableEntries;
        }

        /** Master toggle — strictly {@code enabled === true}; defaults to OFF (opt-in). */
        public boolean isEnabled() {
            return Boolean.TRUE.equals(data.get("enabled"));
        }
    }

    // ------------------------------------------------------------------ reads

    /** The six built-in badges from the classpath fixture (shared with both frontends). */
    public List<BadgeDefinition> defaultBadges() {
        List<BadgeDefinition> loaded = defaults;
        if (loaded == null) {
            synchronized (this) {
                loaded = defaults;
                if (loaded == null) {
                    loaded = loadDefaults();
                    defaults = loaded;
                }
            }
        }
        return loaded;
    }

    private List<BadgeDefinition> loadDefaults() {
        try (InputStream in = new ClassPathResource(DEFAULTS_RESOURCE).getInputStream()) {
            Map<String, Object> root = objectMapper.readValue(in, new TypeReference<Map<String, Object>>() {});
            List<BadgeDefinition> list = objectMapper.convertValue(
                    root.get("badges"), new TypeReference<List<BadgeDefinition>>() {});
            if (list == null || list.isEmpty()) {
                throw new IllegalStateException("no badges in " + DEFAULTS_RESOURCE);
            }
            return Collections.unmodifiableList(list);
        } catch (Exception e) {
            throw new IllegalStateException("Cannot load " + DEFAULTS_RESOURCE + ": " + e.getMessage(), e);
        }
    }

    /** Reads the catalogue for an institute id (throws when the institute does not exist). */
    public Catalogue read(String instituteId) {
        Institute institute = instituteRepository.findById(instituteId)
                .orElseThrow(() -> new VacademyException("Institute Not Found"));
        return read(institute);
    }

    /**
     * Reads the catalogue from the institute entity. Absent key → {@code {version:1,
     * enabled:false, badges:[]}}; absent/empty/unparseable list → defaults (WARN on parse
     * failure). The returned {@code data} map is a mutable copy safe to edit and save.
     */
    public Catalogue read(Institute institute) {
        Map<String, Object> data = new LinkedHashMap<>();
        Object stored = null;
        try {
            stored = instituteSettingService.getSettingData(institute, SETTING_KEY);
        } catch (Exception e) {
            log.warn("Badge catalogue: cannot parse settings of institute {} ({}); treating as absent",
                    institute.getId(), e.getMessage());
        }
        if (stored instanceof Map<?, ?> map) {
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                if (entry.getKey() != null) data.put(String.valueOf(entry.getKey()), entry.getValue());
            }
        } else {
            data.put("version", 1);
            data.put("enabled", false);
            data.put("badges", new ArrayList<>());
        }

        // Parse entry by entry so ONE malformed badge (an FE number input has no upper bound,
        // so a threshold can exceed int range) does not throw the whole list away.
        List<BadgeDefinition> parsed = new ArrayList<>();
        int unreadable = 0;
        Object rawBadges = data.get("badges");
        if (rawBadges instanceof List<?> list) {
            for (Object entry : list) {
                try {
                    BadgeDefinition d = objectMapper.convertValue(entry, BadgeDefinition.class);
                    if (d != null && d.getId() != null && !d.getId().isBlank()) {
                        parsed.add(d);
                    } else {
                        unreadable++;
                    }
                } catch (Exception e) {
                    unreadable++;
                    log.warn("Badge catalogue: unreadable badge entry in institute {} ({}); skipped",
                            institute.getId(), e.getMessage());
                }
            }
        }
        if (parsed.isEmpty()) {
            return new Catalogue(data, defaultBadges(), true, unreadable);
        }
        return new Catalogue(data, parsed, false, unreadable);
    }

    /** Master toggle for an institute (false when the institute or the key is missing). */
    public boolean isEnabled(String instituteId) {
        try {
            return read(instituteId).isEnabled();
        } catch (Exception e) {
            log.warn("Badge catalogue: cannot read master toggle for institute {}: {}", instituteId, e.getMessage());
            return false;
        }
    }

    /**
     * Badges a learner app may legitimately report as auto-unlocked, keyed by id: enabled
     * (not {@code enabled === false}) and not {@code manual}. Falls back to the six defaults
     * when the stored list is absent/empty/unparseable.
     */
    public Map<String, BadgeDefinition> syncableBadges(String instituteId) {
        Map<String, BadgeDefinition> allowed = new LinkedHashMap<>();
        for (BadgeDefinition b : read(instituteId).getBadges()) {
            if (b == null || b.getId() == null || b.getId().isBlank()) continue;
            if (!b.isEffectivelyEnabled() || b.isManual()) continue;
            allowed.putIfAbsent(b.getId(), b);
        }
        return allowed;
    }

    // ----------------------------------------------------------------- writes

    /**
     * Append one badge (or replace the entry with the same id), materialising the six
     * defaults first when the stored list is empty. Every other key of the setting data is
     * preserved. Returns the badge as stored plus the full list after the write.
     */
    // Read-write transaction: the read-modify-write of the settings blob must run on ONE
    // connection routed to the primary (a non-transactional findById would be served by the
    // read replica and could rewrite a stale copy over a concurrent Settings save). Evicts the
    // same institute caches the settings manager evicts, since this bypasses it.
    @Transactional
    @CacheEvict(value = { "openInstituteDetails", "openInstituteDetailsNonBatches" }, key = "#instituteId")
    public CatalogueBadgeResponse upsert(String instituteId, BadgeDefinitionRequest request) {
        if (request == null) throw new VacademyException("Badge is required");
        Institute institute = instituteRepository.findById(instituteId)
                .orElseThrow(() -> new VacademyException("Institute Not Found"));

        BadgeDefinition badge = normalise(request);
        Catalogue current = read(institute);
        Map<String, Object> data = current.getData();

        // Untouched entries are kept as the raw maps they were stored as, so keys this
        // POJO does not know about — and entries it could not even parse — survive a
        // server-side append. Never replace a stored-but-unreadable list with the defaults.
        List<Object> entries = new ArrayList<>();
        if (current.isUsingDefaults() && current.getUnreadableEntries() > 0) {
            throw new VacademyException(
                    "The badge catalogue could not be read; fix it in Settings → Badges & Rewards before adding badges here.");
        }
        if (current.isUsingDefaults()) {
            for (BadgeDefinition d : current.getBadges()) entries.add(toMap(d));
        } else if (data.get("badges") instanceof List<?> stored) {
            entries.addAll(stored);
        }

        boolean replaced = false;
        for (int i = 0; i < entries.size(); i++) {
            if (badge.getId().equals(idOf(entries.get(i)))) {
                entries.set(i, toMap(badge));
                replaced = true;
                break;
            }
        }
        if (!replaced) entries.add(toMap(badge));
        data.put("badges", entries);
        data.putIfAbsent("version", 1);
        data.putIfAbsent("enabled", false);

        GenericSettingRequest settingRequest = GenericSettingRequest.builder()
                .settingName(SETTING_NAME)
                .settingData(data)
                .build();
        instituteSettingService.saveGenericSetting(institute, SETTING_KEY, settingRequest);
        log.info("Badge catalogue: {} badge {} ({}) in institute {}",
                replaced ? "replaced" : "appended", badge.getId(), badge.getName(), instituteId);

        List<BadgeDefinition> after = new ArrayList<>();
        for (Object entry : entries) {
            try {
                BadgeDefinition d = objectMapper.convertValue(entry, BadgeDefinition.class);
                if (d != null) after.add(d);
            } catch (Exception ignored) {
                // an entry that was already unreadable stays in the blob but is not reported back
            }
        }
        return new CatalogueBadgeResponse(badge, after, Boolean.TRUE.equals(data.get("enabled")));
    }

    private BadgeDefinition normalise(BadgeDefinitionRequest r) {
        String name = r.getName() == null ? "" : r.getName().trim();
        if (name.isEmpty()) throw new VacademyException("Badge name is required");
        String trigger = r.getTrigger() == null || r.getTrigger().isBlank()
                ? BadgeDefinition.TRIGGER_MANUAL : r.getTrigger().trim();
        if (!BadgeDefinition.KNOWN_TRIGGERS.contains(trigger)) {
            throw new VacademyException("Unknown badge trigger: " + trigger);
        }
        boolean manual = BadgeDefinition.TRIGGER_MANUAL.equals(trigger);
        long threshold = manual || r.getThreshold() == null ? 0L : Math.max(0L, r.getThreshold());
        String icon = r.getIcon() == null || r.getIcon().isBlank() ? DEFAULT_ICON : r.getIcon().trim();
        String description = r.getDescription() == null ? "" : r.getDescription().trim();
        String id = r.getId() == null || r.getId().isBlank() ? mintId() : r.getId().trim();

        return new BadgeDefinition(
                id,
                truncate(name, MAX_NAME_LENGTH),
                truncate(description, MAX_DESCRIPTION_LENGTH),
                truncate(icon, MAX_ICON_LENGTH),
                trigger,
                threshold,
                r.getEnabled() == null || r.getEnabled(),
                Boolean.TRUE.equals(r.getHidden()));
    }

    static String mintId() {
        return "badge_" + UUID.randomUUID();
    }

    private static String truncate(String s, int max) {
        return s != null && s.length() > max ? s.substring(0, max) : s;
    }

    private static String idOf(Object entry) {
        if (entry instanceof Map<?, ?> m) {
            Object id = m.get("id");
            return id == null ? null : String.valueOf(id);
        }
        if (entry instanceof BadgeDefinition b) return b.getId();
        return null;
    }

    private Map<String, Object> toMap(BadgeDefinition badge) {
        return objectMapper.convertValue(badge, new TypeReference<LinkedHashMap<String, Object>>() {});
    }
}
