package vacademy.io.admin_core_service.features.commerce.audit;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Writes {@code commerce_audit} rows. Every method joins the caller's
 * transaction, so the entry commits or rolls back with the change it describes. The
 * platform's {@code @Auditable} log is not used for commerce: it is asynchronous and purged.
 */
@Service
public class CommerceAuditService {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final int MAX_NAME_LENGTH = 32;

    private final CommerceAuditRepository auditRepository;

    public CommerceAuditService(CommerceAuditRepository auditRepository) {
        this.auditRepository = auditRepository;
    }

    /**
     * Short form. {@code action} is stored as the audit kind, {@code entityType} and
     * {@code entityId} as the reference, {@code detailJson} as the new value.
     */
    @Transactional
    public void record(String instituteId, String actorUserId, String action, String entityType,
                       String entityId, String detailJson) {
        record(instituteId, actorUserId, null, action, entityType, entityId, null, detailJson, null);
    }

    /** Full form: location, old and new value, and the reason the actor gave. */
    @Transactional
    public void record(String instituteId, String actorUserId, String locationId, String kind,
                       String referenceType, String referenceId, String oldValueJson, String newValueJson,
                       String reason) {
        if (instituteId == null || instituteId.isBlank()) {
            throw new IllegalArgumentException("commerce audit: institute id is required");
        }
        if (kind == null || kind.isBlank() || kind.length() > MAX_NAME_LENGTH) {
            throw new IllegalArgumentException("commerce audit: kind must be 1 to 32 characters");
        }
        if (referenceType != null && referenceType.length() > MAX_NAME_LENGTH) {
            throw new IllegalArgumentException("commerce audit: reference type is longer than 32 characters");
        }
        CommerceAudit entry = new CommerceAudit();
        entry.setInstituteId(instituteId);
        entry.setActorUserId(actorUserId);
        entry.setLocationId(locationId);
        entry.setKind(kind);
        entry.setReferenceType(referenceType);
        entry.setReferenceId(referenceId);
        entry.setOldValueJson(requireJson(oldValueJson));
        entry.setNewValueJson(requireJson(newValueJson));
        entry.setReason(reason);
        auditRepository.save(entry);
    }

    /** The columns are JSONB: a malformed value is refused here, not by the database at flush. */
    private static String requireJson(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            MAPPER.readTree(value);
        } catch (JsonProcessingException e) {
            throw new IllegalArgumentException("commerce audit: value is not valid JSON");
        }
        return value;
    }
}
