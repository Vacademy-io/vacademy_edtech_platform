package vacademy.io.admin_core_service.features.commerce.security;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.commerce.accounts.AccountsAuditKinds;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.security.entity.CommerceStaffLocation;
import vacademy.io.admin_core_service.features.commerce.security.entity.CommerceStaffScope;
import vacademy.io.admin_core_service.features.commerce.security.repository.CommerceStaffLocationRepository;
import vacademy.io.admin_core_service.features.commerce.security.repository.CommerceStaffScopeRepository;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;

/** Location assignment and PIN set-up for commerce staff. Callers pass a guarded institute id. */
@Service
public class CommerceStaffService {

    public static final String AUDIT_LOCATIONS_ASSIGNED = "STAFF_LOCATION_ASSIGN";
    public static final String AUDIT_PIN_SET = "STAFF_PIN_SET";
    private static final String REFERENCE_STAFF = "STAFF";
    private static final int MAX_LOCATIONS = 200;
    private static final int MAX_ID_LENGTH = 36;
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final CommerceStaffLocationRepository staffLocationRepository;
    private final CommercePinService pinService;
    private final CommerceAuditService auditService;
    /** Institute-wide scope rows; null in services built by hand without them. */
    private final CommerceStaffScopeRepository staffScopeRepository;

    public CommerceStaffService(CommerceStaffLocationRepository staffLocationRepository,
                                CommercePinService pinService, CommerceAuditService auditService) {
        this(staffLocationRepository, pinService, auditService, null);
    }

    @Autowired
    public CommerceStaffService(CommerceStaffLocationRepository staffLocationRepository,
                                CommercePinService pinService, CommerceAuditService auditService,
                                CommerceStaffScopeRepository staffScopeRepository) {
        this.staffLocationRepository = staffLocationRepository;
        this.pinService = pinService;
        this.auditService = auditService;
        this.staffScopeRepository = staffScopeRepository;
    }

    @Transactional(readOnly = true)
    public List<String> locationIds(String instituteId, String staffUserId) {
        requireId(staffUserId, "user_id");
        return new ArrayList<>(currentIds(
                staffLocationRepository.findByInstituteIdAndUserId(instituteId, staffUserId.trim())));
    }

    /**
     * The rule for a store manager who is not an institute ADMIN (a manager too acts only at
     * assigned locations): the target is someone else, and every
     * location the request adds or removes is one the manager holds.
     *
     * @throws CommerceAccessDeniedException 403 ROLE_NOT_ALLOWED for their own list,
     *                                       LOCATION_NOT_ALLOWED for a location they do not hold
     */
    @Transactional(readOnly = true)
    public void requireManagerMayAssign(String instituteId, String managerUserId, String staffUserId,
                                        Collection<String> locationIds) {
        requireId(staffUserId, "user_id");
        if (locationIds == null) {
            throw new InvalidRequestException("location_ids is required");
        }
        String staffId = staffUserId.trim();
        if (staffId.equals(managerUserId)) {
            throw new CommerceAccessDeniedException(CommerceAccessDeniedException.ROLE_NOT_ALLOWED,
                    "a store manager cannot change their own locations; an institute admin does that");
        }
        Set<String> own = currentIds(staffLocationRepository.findByInstituteIdAndUserId(instituteId, managerUserId));
        Set<String> before = currentIds(staffLocationRepository.findByInstituteIdAndUserId(instituteId, staffId));
        Set<String> wanted = new TreeSet<>();
        for (String locationId : locationIds) {
            requireId(locationId, "location_ids");
            wanted.add(locationId.trim());
        }
        Set<String> changed = new TreeSet<>(wanted);
        changed.removeAll(before);
        Set<String> removed = new TreeSet<>(before);
        removed.removeAll(wanted);
        changed.addAll(removed);
        if (!own.containsAll(changed)) {
            throw new CommerceAccessDeniedException(CommerceAccessDeniedException.LOCATION_NOT_ALLOWED,
                    "you can assign or remove only locations you are assigned to yourself");
        }
    }

    /** Replaces the staff member's locations with {@code locationIds} and audits old and new. */
    @Transactional
    public List<String> setLocations(String instituteId, String actorUserId, String staffUserId,
                                     Collection<String> locationIds) {
        requireId(staffUserId, "user_id");
        String staffId = staffUserId.trim();
        if (locationIds == null) {
            throw new InvalidRequestException("location_ids is required");
        }
        if (locationIds.size() > MAX_LOCATIONS) {
            throw new InvalidRequestException("At most " + MAX_LOCATIONS + " locations per staff member");
        }
        Set<String> wanted = new TreeSet<>();
        for (String locationId : locationIds) {
            requireId(locationId, "location_ids");
            wanted.add(locationId.trim());
        }
        List<CommerceStaffLocation> existing =
                staffLocationRepository.findByInstituteIdAndUserId(instituteId, staffId);
        Set<String> before = currentIds(existing);
        if (before.equals(wanted)) {
            return new ArrayList<>(wanted);
        }
        List<CommerceStaffLocation> removed = existing.stream()
                .filter(row -> !wanted.contains(row.getLocationId())).toList();
        staffLocationRepository.deleteAll(removed);
        for (String locationId : wanted) {
            if (!before.contains(locationId)) {
                CommerceStaffLocation row = new CommerceStaffLocation();
                row.setInstituteId(instituteId);
                row.setUserId(staffId);
                row.setLocationId(locationId);
                row.setCreatedBy(actorUserId);
                staffLocationRepository.save(row);
            }
        }
        auditService.record(instituteId, actorUserId, null, AUDIT_LOCATIONS_ASSIGNED, REFERENCE_STAFF,
                staffId, json(before), json(wanted), null);
        return new ArrayList<>(wanted);
    }

    /** The signed-in manager sets their own PIN. The PIN itself is never audited or logged. */
    @Transactional
    public void setOwnPin(String instituteId, String userId, String rawPin) {
        pinService.setPin(instituteId, userId, rawPin);
        auditService.record(instituteId, userId, AUDIT_PIN_SET, REFERENCE_STAFF, userId, null);
    }

    public boolean hasPin(String instituteId, String userId) {
        return pinService.hasPin(instituteId, userId);
    }

    /**
     * Whether the staff member acts for every location ({@code all_locations}; false when no row).
     * The id is not checked against auth_service: the guard reads roles from the caller's own token,
     * so a row for an unknown id grants nothing.
     */
    @Transactional(readOnly = true)
    public Map<String, Object> scope(String instituteId, String staffUserId) {
        requireId(staffUserId, "user_id");
        String staffId = staffUserId.trim();
        return scopeView(staffId, requireScopeRepository().findByInstituteIdAndUserId(instituteId, staffId));
    }

    /**
     * Sets {@code all_locations} for a staff member (insert or update in one statement) and audits
     * the old and new value. Writing the value it already has changes nothing and audits nothing.
     */
    @Transactional
    public Map<String, Object> setScope(String instituteId, String actorUserId, String staffUserId,
                                        Boolean allLocations) {
        requireId(staffUserId, "user_id");
        if (allLocations == null) {
            throw new InvalidRequestException("VALIDATION: all_locations is required");
        }
        String staffId = staffUserId.trim();
        CommerceStaffScopeRepository repository = requireScopeRepository();
        Optional<CommerceStaffScope> before = repository.findByInstituteIdAndUserId(instituteId, staffId);
        boolean old = before.map(CommerceStaffScope::isAllLocations).orElse(false);
        if (before.isPresent() && old == allLocations) {
            return scopeView(staffId, before);
        }
        if (before.isEmpty() && !allLocations) {
            // No row means "not institute-wide" already.
            return scopeView(staffId, before);
        }
        Optional<CommerceStaffScope> after;
        if (before.isPresent()) {
            CommerceStaffScope row = before.get();
            row.setAllLocations(allLocations);
            row.setSetBy(actorUserId);
            after = Optional.of(repository.saveAndFlush(row));
        } else {
            // One statement, so two first writes for the same user never collide on the unique key.
            repository.upsert(UUID.randomUUID().toString(), instituteId, staffId, allLocations, actorUserId);
            after = repository.findByInstituteIdAndUserId(instituteId, staffId);
        }
        auditService.record(instituteId, actorUserId, null, AccountsAuditKinds.STAFF_SCOPE_EDIT,
                AccountsAuditKinds.REF_STAFF, staffId, scopeJson(old), scopeJson(allLocations), null);
        Map<String, Object> out = scopeView(staffId, after);
        out.put("all_locations", allLocations);
        out.put("set_by", actorUserId);
        return out;
    }

    private CommerceStaffScopeRepository requireScopeRepository() {
        if (staffScopeRepository == null) {
            throw new IllegalStateException("staff scope repository is not available");
        }
        return staffScopeRepository;
    }

    private static Map<String, Object> scopeView(String staffId, Optional<CommerceStaffScope> row) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("user_id", staffId);
        out.put("all_locations", row.map(CommerceStaffScope::isAllLocations).orElse(false));
        out.put("set_by", row.map(CommerceStaffScope::getSetBy).orElse(null));
        out.put("updated_at", row.map(CommerceStaffScope::getUpdatedAt).orElse(null));
        return out;
    }

    private static String scopeJson(boolean allLocations) {
        try {
            return MAPPER.writeValueAsString(Map.of("all_locations", allLocations));
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("could not write the scope as JSON", e);
        }
    }

    private static Set<String> currentIds(List<CommerceStaffLocation> rows) {
        Set<String> ids = new TreeSet<>();
        rows.forEach(row -> ids.add(row.getLocationId()));
        return ids;
    }

    private static void requireId(String value, String field) {
        if (value == null || value.isBlank() || value.trim().length() > MAX_ID_LENGTH) {
            throw new InvalidRequestException(field + " must be an id of at most " + MAX_ID_LENGTH + " characters");
        }
    }

    private static String json(Set<String> ids) {
        try {
            return MAPPER.writeValueAsString(ids);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("could not write location ids as JSON", e);
        }
    }
}
