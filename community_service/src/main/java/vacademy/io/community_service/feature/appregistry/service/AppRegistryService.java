package vacademy.io.community_service.feature.appregistry.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.community_service.feature.appregistry.entity.AppRegistration;
import vacademy.io.community_service.feature.appregistry.repository.AppRegistrationRepository;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * Storage for the app registry.
 *
 * <p>Records are passed through as raw JSON in both directions. The dashboard is the only client
 * and it owns the document shape, so re-declaring ~40 nested fields as Java DTOs would buy nothing
 * but a second place to update whenever a store adds a question — and a silent data-loss bug the
 * first time the two drift.
 */
@Service
public class AppRegistryService {

    @Autowired
    private AppRegistrationRepository repository;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Transactional(readOnly = true)
    public List<JsonNode> listAll() {
        List<JsonNode> out = new ArrayList<>();
        for (AppRegistration row : repository.findAllByOrderByNameAsc()) {
            out.add(parse(row.getPayload(), row.getId()));
        }
        return out;
    }

    /**
     * Read path for the institute-admin-facing status view. Unlike {@link #listAll()} this never
     * returns archived apps — an institute admin should not see a decommissioned registration and
     * wonder why "their app" looks broken.
     */
    @Transactional(readOnly = true)
    public List<JsonNode> listByInstitute(String instituteId) {
        // A blank id is not "every unowned app" — it is a caller that lost the institute somewhere.
        // Answering it would hand whoever asked the ops-only registrations that have no owner.
        if (instituteId == null || instituteId.isBlank()) {
            return List.of();
        }
        List<JsonNode> out = new ArrayList<>();
        for (AppRegistration row : repository.findAllByInstituteIdAndArchivedFalseOrderByNameAsc(instituteId)) {
            out.add(parse(row.getPayload(), row.getId()));
        }
        return out;
    }

    @Transactional(readOnly = true)
    public JsonNode get(String id) {
        AppRegistration row = repository.findById(id)
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "App not found: " + id));
        return parse(row.getPayload(), id);
    }

    @Transactional
    public JsonNode upsert(String id, JsonNode record) {
        return parse(save(id, record).getPayload(), id);
    }

    @Transactional
    public void delete(String id) {
        if (!repository.existsById(id)) {
            throw new VacademyException(HttpStatus.NOT_FOUND, "App not found: " + id);
        }
        repository.deleteById(id);
    }

    /**
     * Bulk replace, backing the dashboard's Import button. Destructive by contract — the whole
     * registry becomes exactly what was uploaded — so it runs in one transaction: a bad payload
     * rolls back rather than leaving the team with a half-imported registry.
     */
    @Transactional
    public List<JsonNode> replaceAll(List<JsonNode> records) {
        if (records == null) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "Expected an array of app records");
        }
        repository.deleteAllInBatch();
        List<JsonNode> out = new ArrayList<>();
        for (JsonNode record : records) {
            String id = textAt(record, "id", null);
            if (id == null || id.isBlank()) {
                throw new VacademyException(HttpStatus.BAD_REQUEST, "Every app record needs an id");
            }
            out.add(parse(save(id, record).getPayload(), id));
        }
        return out;
    }

    /* ------------------------------------------------------------------ internals */

    private AppRegistration save(String id, JsonNode record) {
        if (record == null || !record.isObject()) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "Expected an app record object");
        }

        ObjectNode node = ((ObjectNode) record).deepCopy();
        // The path is authoritative, so a body whose id disagrees can't silently write elsewhere.
        node.put("id", id);
        // The server owns the clock; a client with a skewed one must not win a last-write race.
        node.put("updatedAt", Instant.now().toString());

        JsonNode basics = node.path("basics");
        AppRegistration row = repository.findById(id).orElseGet(() -> AppRegistration.builder().id(id).build());
        row.setName(textAt(basics, "name", ""));
        row.setClientName(textAt(basics, "client", ""));
        row.setPackageName(textAt(basics, "packageName", ""));
        row.setInstituteId(blankToNull(textAt(basics, "instituteId", null)));
        row.setArchived(node.path("archived").asBoolean(false));
        row.setPayload(write(node));
        return repository.save(row);
    }

    /**
     * The dashboard's Institute ID field is optional and arrives as "" when left blank, so storing
     * it verbatim would give every ownerless app the same non-null owner — and any lookup that ever
     * passed an empty string would match all of them at once. Absent means NULL.
     */
    private static String blankToNull(String value) {
        if (value == null) return null;
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private static String textAt(JsonNode node, String field, String fallback) {
        if (node == null) return fallback;
        JsonNode value = node.get(field);
        return value == null || value.isNull() ? fallback : value.asText(fallback);
    }

    private JsonNode parse(String payload, String id) {
        try {
            return objectMapper.readTree(payload);
        } catch (JsonProcessingException e) {
            throw new VacademyException(HttpStatus.INTERNAL_SERVER_ERROR,
                    "Stored app record for " + id + " is not valid JSON");
        }
    }

    private String write(JsonNode node) {
        try {
            return objectMapper.writeValueAsString(node);
        } catch (JsonProcessingException e) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "App record could not be serialised");
        }
    }
}
