package vacademy.io.admin_core_service.features.commerce.stock.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.security.entity.CommerceStaffLocation;
import vacademy.io.admin_core_service.features.commerce.security.repository.CommerceStaffLocationRepository;
import vacademy.io.admin_core_service.features.commerce.stock.dto.LocationRequest;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockLocation;
import vacademy.io.admin_core_service.features.commerce.stock.enums.LocationStatus;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLevelRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLevelRepository.LevelQuantity;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLocationRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLocationRepository.LocationFacts;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockTransferRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.VacademyException;

import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Stock locations. Callers pass an institute id that the access guard
 * has already checked; every read and write here is filtered by it.
 */
@Slf4j
@Service
public class StockLocationService {

    public static final String AUDIT_LOCATION_CREATE = "LOCATION_CREATE";
    public static final String AUDIT_LOCATION_UPDATE = "LOCATION_UPDATE";
    public static final String AUDIT_LOCATION_ONLINE = "LOCATION_SELLS_ONLINE";
    private static final String REFERENCE_LOCATION = "STOCK_LOCATION";
    private static final int MAX_LOCATIONS_PER_INSTITUTE = 500;
    private static final Pattern CODE = Pattern.compile("[A-Z0-9][A-Z0-9_-]{0,31}");
    private static final Pattern GSTIN = Pattern.compile("[0-9]{2}[A-Z0-9]{13}");
    private static final Pattern STATE_CODE = Pattern.compile("[0-9]{2}");
    private static final Pattern PINCODE = Pattern.compile("[0-9]{6}");
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final StockLocationRepository locationRepository;
    private final StockLevelRepository levelRepository;
    private final PackageSessionRepository packageSessionRepository;
    private final CommerceStaffLocationRepository staffLocationRepository;
    private final CommerceAuditService auditService;

    /** Transfers (WP-40), for the in-transit check; absent in tests built by hand. */
    private StockTransferRepository transferRepository;

    @Autowired(required = false)
    public void setTransferRepository(StockTransferRepository transferRepository) {
        this.transferRepository = transferRepository;
    }

    public StockLocationService(StockLocationRepository locationRepository,
                                StockLevelRepository levelRepository,
                                PackageSessionRepository packageSessionRepository,
                                CommerceStaffLocationRepository staffLocationRepository,
                                CommerceAuditService auditService) {
        this.locationRepository = locationRepository;
        this.levelRepository = levelRepository;
        this.packageSessionRepository = packageSessionRepository;
        this.staffLocationRepository = staffLocationRepository;
        this.auditService = auditService;
    }

    @Transactional(readOnly = true)
    public List<StockLocation> list(String instituteId) {
        return locationRepository.findByInstituteIdOrderByCodeAsc(instituteId);
    }

    @Transactional(readOnly = true)
    public StockLocation get(String instituteId, String locationId) {
        return locationRepository.findByInstituteIdAndId(instituteId, locationId)
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "Location not found"));
    }

    /**
     * Refuses any id that is not a location of this institute (400). Used wherever a client
     * sends location ids, for example when a manager assigns staff to locations.
     */
    @Transactional(readOnly = true)
    public void requireLocationsOfInstitute(String instituteId, Collection<String> locationIds) {
        if (locationIds == null || locationIds.isEmpty()) {
            return;
        }
        Set<String> wanted = new LinkedHashSet<>();
        for (String id : locationIds) {
            if (id != null && !id.isBlank()) {
                wanted.add(id.trim());
            }
        }
        if (wanted.isEmpty()) {
            return;
        }
        Set<String> own = new LinkedHashSet<>(locationRepository.findIdsOfInstitute(instituteId, wanted));
        if (!own.containsAll(wanted)) {
            throw new InvalidRequestException("LOCATION_NOT_FOUND: a location id does not belong to this institute");
        }
    }

    /**
     * Creates a location. A creator who is not an institute ADMIN is assigned to it, because a
     * store manager too may act only at locations they are assigned to.
     */
    @Transactional
    public StockLocation create(String instituteId, String actorUserId, boolean actorIsAdmin,
                                LocationRequest request) {
        if (request == null) {
            throw new InvalidRequestException("Request body is required");
        }
        String code = normaliseCode(request.getCode());
        if (locationRepository.existsByInstituteIdAndCode(instituteId, code)) {
            throw new ConflictException("LOCATION_CODE_TAKEN: a location with code " + code + " already exists");
        }
        if (locationRepository.findByInstituteIdOrderByCodeAsc(instituteId).size() >= MAX_LOCATIONS_PER_INSTITUTE) {
            throw new InvalidRequestException("At most " + MAX_LOCATIONS_PER_INSTITUTE + " locations per institute");
        }
        StockLocation location = new StockLocation();
        location.setInstituteId(instituteId);
        location.setCode(code);
        location.setStatus(LocationStatus.ACTIVE.name());
        apply(location, request, true);
        boolean online = Boolean.TRUE.equals(request.getSellsOnline());
        if (online) {
            requireNoOtherOnlineLocation(instituteId, "");
        }
        // A new location holds no stock, so the sellable counters need no change.
        location.setSellsOnline(online);
        location = locationRepository.saveAndFlush(location);
        if (!actorIsAdmin) {
            CommerceStaffLocation assignment = new CommerceStaffLocation();
            assignment.setInstituteId(instituteId);
            assignment.setUserId(actorUserId);
            assignment.setLocationId(location.getId());
            assignment.setCreatedBy(actorUserId);
            staffLocationRepository.save(assignment);
        }
        auditService.record(instituteId, actorUserId, location.getId(), AUDIT_LOCATION_CREATE, REFERENCE_LOCATION,
                location.getId(), null, json(view(location)), null);
        return location;
    }

    @Transactional
    public StockLocation update(String instituteId, String actorUserId, String locationId, LocationRequest request) {
        if (request == null) {
            throw new InvalidRequestException("Request body is required");
        }
        StockLocation location = get(instituteId, locationId);
        if (request.getCode() != null && !normaliseCode(request.getCode()).equals(location.getCode())) {
            throw new InvalidRequestException("The code of a location cannot be changed");
        }
        String before = json(view(location));
        boolean wasActive = LocationStatus.ACTIVE.name().equals(location.getStatus());
        apply(location, request, false);
        if (wasActive && LocationStatus.INACTIVE.name().equals(location.getStatus()) && transferRepository != null) {
            // The row lock first: a dispatch holds it shared until it commits, so it is seen here.
            locationRepository.lockForChange(instituteId, locationId);
            List<String> onTheWay = transferRepository.findDispatchedTouching(instituteId, locationId);
            if (!onTheWay.isEmpty()) {
                throw new ConflictException("LOCATION_HAS_TRANSFER_IN_TRANSIT: transfer " + onTheWay.get(0)
                        + " to or from this location is on the way");
            }
        }
        if (LocationStatus.INACTIVE.name().equals(location.getStatus()) && location.isSellsOnline()) {
            throw new ConflictException("LOCATION_SELLS_ONLINE: stop selling online from this location first");
        }
        location = locationRepository.saveAndFlush(location);
        if (request.getSellsOnline() != null && request.getSellsOnline() != location.isSellsOnline()) {
            setSellsOnline(instituteId, actorUserId, locationId, request.getSellsOnline());
            location = get(instituteId, locationId);
        }
        auditService.record(instituteId, actorUserId, locationId, AUDIT_LOCATION_UPDATE, REFERENCE_LOCATION,
                locationId, before, json(view(location)), null);
        return location;
    }

    /**
     * Switches whether the website sells this location's stock, and moves the sellable
     * counters with it: switching on adds the on-hand quantity of every variant here to
     * {@code max_seats} and {@code available_slots}; switching off takes it away, and is
     * refused (409 LOCATION_HAS_OPEN_ORDERS) while units here are held in a checkout or sold
     * online and not shipped.
     *
     * <p>The location row is locked FOR UPDATE, which waits for postings in flight (they hold
     * it FOR SHARE), then the level rows in package-session order, then each package session.
     * Phase 1 allows one online location per institute.
     */
    @Transactional
    public void setSellsOnline(String instituteId, String actorUserId, String locationId, boolean sellsOnline) {
        LocationFacts facts = locationRepository.lockForChange(instituteId, locationId)
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "Location not found"));
        if (Boolean.TRUE.equals(facts.getSellsOnline()) == sellsOnline) {
            return;
        }
        if (sellsOnline) {
            if (!LocationStatus.ACTIVE.name().equals(facts.getStatus())) {
                throw new ConflictException("LOCATION_INACTIVE: only an active location can sell online");
            }
            requireNoOtherOnlineLocation(instituteId, locationId);
        } else if (locationRepository.countVariantsShortForOnlineOrders(instituteId) > 0) {
            // Units promised online have left this location (damage, transfer) and are still
            // owed to open orders, even where nothing is on the shelf any more.
            throw new ConflictException("LOCATION_HAS_OPEN_ORDERS: some items are short for online orders "
                    + "that are not shipped yet; ship or cancel those orders before you stop selling "
                    + "online from here");
        }
        List<LevelQuantity> levels = levelRepository.lockStockedLevelsOfLocation(instituteId, locationId);
        for (LevelQuantity level : levels) {
            int onHand = level.getOnHand() == null ? 0 : level.getOnHand();
            if (onHand <= 0) {
                continue;
            }
            String packageSessionId = level.getPackageSessionId();
            var counters = packageSessionRepository.lockCommerceStockCounters(packageSessionId);
            if (counters.isEmpty()) {
                continue; // an UNTRACKED variant has no counters to keep
            }
            if (sellsOnline) {
                packageSessionRepository.commerceStockIn(packageSessionId, onHand, onHand);
            } else {
                // Fewer unpromised units than are on the shelf here means some are held in a
                // checkout or sold online and not shipped. Taking the stock away now would leave
                // the counters wrong once that hold is released or that order ships (the release
                // gives units back to a location that no longer sells online), so the switch
                // waits. The exception rolls back the counters already moved in this call.
                Integer available = counters.get().getAvailableSlots();
                if (available == null || available < onHand) {
                    throw new ConflictException("LOCATION_HAS_OPEN_ORDERS: some units at this location are in an "
                            + "online checkout or sold online and not shipped yet; ship or cancel those orders, "
                            + "or wait for the checkouts to end, before you stop selling online from here");
                }
                packageSessionRepository.commerceStockOutFloored(packageSessionId, onHand);
            }
        }
        locationRepository.setSellsOnline(instituteId, locationId, sellsOnline);
        Map<String, Object> change = new LinkedHashMap<>();
        change.put("sells_online", sellsOnline);
        change.put("variants_moved", levels.size());
        auditService.record(instituteId, actorUserId, locationId, AUDIT_LOCATION_ONLINE, REFERENCE_LOCATION,
                locationId, null, json(change), null);
    }

    /** The JSON shape of a location in every response. */
    public static Map<String, Object> view(StockLocation location) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", location.getId());
        out.put("code", location.getCode());
        out.put("name", location.getName());
        out.put("address_line1", location.getAddressLine1());
        out.put("address_line2", location.getAddressLine2());
        out.put("city", location.getCity());
        out.put("pincode", location.getPincode());
        out.put("state_code", location.getStateCode());
        out.put("gstin", location.getGstin());
        out.put("is_store", location.isStore());
        out.put("is_warehouse", location.isWarehouse());
        out.put("is_source", location.isSource());
        out.put("is_temporary", location.isTemporary());
        out.put("starts_on", location.getStartsOn() == null ? null : location.getStartsOn().toString());
        out.put("ends_on", location.getEndsOn() == null ? null : location.getEndsOn().toString());
        out.put("sells_online", location.isSellsOnline());
        out.put("is_pos_enabled", location.isPosEnabled());
        out.put("status", location.getStatus());
        return out;
    }

    private void requireNoOtherOnlineLocation(String instituteId, String exceptId) {
        if (!locationRepository.findOtherOnlineLocationIds(instituteId, exceptId).isEmpty()) {
            throw new ConflictException("ONLINE_LOCATION_EXISTS: another location already sells online; "
                    + "one location ships website orders");
        }
    }

    private static void apply(StockLocation location, LocationRequest request, boolean creating) {
        if (creating || request.getName() != null) {
            String name = trimToNull(request.getName());
            if (name == null || name.length() > 255) {
                throw new InvalidRequestException("name is required, at most 255 characters");
            }
            location.setName(name);
        }
        if (request.getAddressLine1() != null) {
            location.setAddressLine1(limited(request.getAddressLine1(), 255, "address_line1"));
        }
        if (request.getAddressLine2() != null) {
            location.setAddressLine2(limited(request.getAddressLine2(), 255, "address_line2"));
        }
        if (request.getCity() != null) {
            location.setCity(limited(request.getCity(), 100, "city"));
        }
        if (request.getPincode() != null) {
            location.setPincode(matching(request.getPincode(), PINCODE, "pincode must be 6 digits"));
        }
        if (request.getStateCode() != null) {
            location.setStateCode(matching(request.getStateCode(), STATE_CODE, "state_code must be the 2-digit GST state code"));
        }
        if (request.getGstin() != null) {
            String gstin = trimToNull(request.getGstin());
            location.setGstin(gstin == null ? null
                    : matching(gstin.toUpperCase(Locale.ROOT), GSTIN, "gstin must be 15 characters"));
        }
        if (location.getGstin() != null && location.getStateCode() != null
                && !location.getGstin().startsWith(location.getStateCode())) {
            throw new InvalidRequestException("gstin does not belong to state_code");
        }
        if (request.getIsStore() != null) {
            location.setStore(request.getIsStore());
        }
        if (request.getIsWarehouse() != null) {
            location.setWarehouse(request.getIsWarehouse());
        }
        if (request.getIsSource() != null) {
            location.setSource(request.getIsSource());
        }
        if (request.getIsTemporary() != null) {
            location.setTemporary(request.getIsTemporary());
        }
        if (request.getStartsOn() != null) {
            location.setStartsOn(request.getStartsOn());
        }
        if (request.getEndsOn() != null) {
            location.setEndsOn(request.getEndsOn());
        }
        if (location.getStartsOn() != null && location.getEndsOn() != null
                && location.getEndsOn().isBefore(location.getStartsOn())) {
            throw new InvalidRequestException("ends_on is before starts_on");
        }
        if (request.getIsPosEnabled() != null) {
            location.setPosEnabled(request.getIsPosEnabled());
        }
        if (!creating && request.getStatus() != null) {
            String status = request.getStatus().trim().toUpperCase(Locale.ROOT);
            try {
                LocationStatus.valueOf(status);
            } catch (IllegalArgumentException e) {
                throw new InvalidRequestException("status must be ACTIVE or INACTIVE");
            }
            location.setStatus(status);
        }
        if (!location.isStore() && !location.isWarehouse() && !location.isSource()) {
            throw new InvalidRequestException("A location is a store, a warehouse, a source, or a mix of these");
        }
    }

    private static String normaliseCode(String raw) {
        String code = raw == null ? "" : raw.trim().toUpperCase(Locale.ROOT);
        if (!CODE.matcher(code).matches()) {
            throw new InvalidRequestException("code is required: up to 32 letters, digits, - or _");
        }
        return code;
    }

    private static String matching(String raw, Pattern pattern, String message) {
        String value = trimToNull(raw);
        if (value == null) {
            return null;
        }
        if (!pattern.matcher(value).matches()) {
            throw new InvalidRequestException(message);
        }
        return value;
    }

    private static String limited(String raw, int max, String field) {
        String value = trimToNull(raw);
        if (value != null && value.length() > max) {
            throw new InvalidRequestException(field + " is longer than " + max + " characters");
        }
        return value;
    }

    private static String trimToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private static String json(Object value) {
        try {
            return MAPPER.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("could not write a location as JSON", e);
        }
    }
}
