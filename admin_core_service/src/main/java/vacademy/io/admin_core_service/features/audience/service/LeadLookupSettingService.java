package vacademy.io.admin_core_service.features.audience.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;

import java.time.Duration;

/**
 * Per-institute settings for the lead lookup — the "is this number already ours?"
 * probe a counsellor runs before calling someone.
 *
 * Read from the {@code LEAD_SETTING} institute setting:
 *
 * <pre>
 * institute.setting → setting → LEAD_SETTING → data → leadLookup → {
 *     enabled: false,
 *     fields: { name, email, phone, counsellor, source, campaign, status, course,
 *               branch, enquiredBy },
 *     courseFieldId: "",
 *     branchFieldId: ""
 * }
 * </pre>
 *
 * Everything defaults to <b>off</b>. An institute that has never configured this
 * gets no lookup at all, and one that enables it still shows nothing until it
 * ticks the fields it wants — the counsellor sees exactly what the institute
 * chose to share about someone else's lead, and nothing more.
 *
 * <p><b>The field list governs counsellors only.</b> An ADMIN-role caller is not
 * scoped out of anything in the leads UI to begin with, so masking the lookup for
 * them would just make the same data harder to reach; admins get every field.
 * So does the counsellor the lead is assigned to — it is their own lead.
 * The caller's role is resolved at the call site, not here.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class LeadLookupSettingService {

    /** Which columns a counsellor may see about another counsellor's lead. */
    public record Fields(boolean name, boolean email, boolean phone, boolean counsellor,
                         boolean source, boolean campaign, boolean status, boolean course,
                         boolean branch, boolean enquiredBy) {

        /** Nothing shared — what every institute gets until it says otherwise. */
        static final Fields NONE = new Fields(false, false, false, false, false, false, false, false,
                false, false);

        /** Admins are not scoped out of lead data anywhere else either. */
        public static final Fields ALL = new Fields(true, true, true, true, true, true, true, true,
                true, true);

        /** True when the institute ticked nothing — the lookup would answer with a blank card. */
        public boolean isEmpty() {
            return !(name || email || phone || counsellor || source || campaign || status || course
                    || branch || enquiredBy);
        }
    }

    /**
     * @param searchByName lets a counsellor look someone up by their full name.
     *        OFF by default and deliberately so: phone and email are things the
     *        caller already has in front of them, a name is something they can
     *        guess. Even switched on the match is exact, never a prefix, so it
     *        cannot be walked one letter at a time.
     */
    public record LookupSettings(boolean enabled, Fields fields, String courseFieldId,
                                 String branchFieldId, boolean searchByName) {
    }

    private static final LookupSettings DEFAULTS = new LookupSettings(false, Fields.NONE, null, null, false);

    private final InstituteRepository instituteRepository;
    private final ObjectMapper objectMapper;

    private final Cache<String, LookupSettings> byInstituteId = Caffeine.newBuilder()
            .maximumSize(2000)
            .expireAfterWrite(Duration.ofMinutes(5))
            .build();

    /** Cached 5-min; defaults to disabled with nothing shared. */
    public LookupSettings get(String instituteId) {
        if (instituteId == null || instituteId.isBlank()) return DEFAULTS;
        return byInstituteId.get(instituteId, this::load);
    }

    private LookupSettings load(String instituteId) {
        try {
            String settingJson = instituteRepository.findById(instituteId)
                    .map(i -> i.getSetting())
                    .orElse(null);
            if (settingJson == null || settingJson.isBlank()) return DEFAULTS;

            JsonNode root = objectMapper.readTree(settingJson);
            JsonNode lookup = root.path("setting").path("LEAD_SETTING").path("data").path("leadLookup");
            if (!lookup.isObject()) return DEFAULTS;

            JsonNode fields = lookup.path("fields");
            Fields parsed = new Fields(
                    fields.path("name").asBoolean(false),
                    fields.path("email").asBoolean(false),
                    fields.path("phone").asBoolean(false),
                    fields.path("counsellor").asBoolean(false),
                    fields.path("source").asBoolean(false),
                    fields.path("campaign").asBoolean(false),
                    fields.path("status").asBoolean(false),
                    fields.path("course").asBoolean(false),
                    fields.path("branch").asBoolean(false),
                    fields.path("enquiredBy").asBoolean(false));

            return new LookupSettings(lookup.path("enabled").asBoolean(false), parsed,
                    fieldId(lookup, "courseFieldId"), fieldId(lookup, "branchFieldId"),
                    lookup.path("searchByName").asBoolean(false));
        } catch (Exception e) {
            log.warn("Failed to read lead lookup settings for institute {} — using defaults: {}",
                    instituteId, e.getMessage());
            return DEFAULTS;
        }
    }

    /** A custom-field id, or null when unset or blank. */
    private static String fieldId(JsonNode lookup, String key) {
        String id = lookup.path(key).asText(null);
        return (id == null || id.isBlank()) ? null : id;
    }
}
