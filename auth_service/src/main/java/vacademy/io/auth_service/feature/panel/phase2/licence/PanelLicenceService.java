package vacademy.io.auth_service.feature.panel.phase2.licence;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import vacademy.io.auth_service.feature.institute_oauth.service.InstituteOAuthClientAccessGuard;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.LicenceAdminResponse;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.LicenceEnforcementRequest;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.LicenceEnforcementResponse;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.LicenceGrantCancelRequest;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.LicenceGrantCreateRequest;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.LicenceGrantDetail;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.LicenceGrantView;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.LicenceResponse;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.LicenceRoomActionResponse;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.LicenceRoomRow;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.LicenceTemplateRequest;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.LicenceTemplateResponse;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.RoomRef;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.SyncLicence;
import vacademy.io.auth_service.feature.panel.phase2.PanelCompat;
import vacademy.io.auth_service.feature.panel.phase2.PanelLicenceGate;
import vacademy.io.auth_service.feature.panel.phase2.PanelPhase2Errors;
import vacademy.io.auth_service.feature.panel.phase2.PanelPhase2Properties;
import vacademy.io.auth_service.feature.panel.phase2.licence.PanelLicenceMath.Grant;
import vacademy.io.auth_service.feature.panel.phase2.licence.PanelLicenceMath.Result;
import vacademy.io.auth_service.feature.panel.phase2.licence.PanelLicenceMath.Room;
import vacademy.io.auth_service.feature.panel.phase2.licence.PanelLicenceRepository.GrantRow;
import vacademy.io.auth_service.feature.panel.phase2.licence.PanelLicenceRepository.RoomSeatRow;
import vacademy.io.auth_service.feature.panel.phase2.licence.PanelLicenceRepository.TemplateRow;
import vacademy.io.auth_service.feature.panel.repository.PanelRepository;
import vacademy.io.auth_service.feature.panel.repository.PanelRepository.DeviceRow;
import vacademy.io.auth_service.feature.panel.service.PanelApiException;
import vacademy.io.auth_service.feature.panel.service.PanelTx;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;
import java.util.regex.Pattern;

/**
 * Room seats: the real {@link PanelLicenceGate}, the institute admin's seat page and the platform
 * staff's grant tools. Everything here answers as phase 1 while panel.licence.enabled is false: the
 * gate allows, the sync block is omitted and the endpoints answer 404 FEATURE_OFF.
 *
 * <p>The institute's picture ({@link PanelLicenceMath}) is cached per pod for 60 s and dropped on
 * every seat write here, again after the transaction ends. Another pod can lag up to 60 s. A cached
 * picture never refuses a sign-in on its own: a LIVE refusal is re-read from the database first.
 *
 * <p>Seat writes hold the institute's transaction-scoped advisory lock ("panel_licence:" + id), so
 * two assignments can never oversubscribe. Lock order is always device row, then seat lock, then
 * room row. No method here makes an HTTP call.
 */
@Component
public class PanelLicenceService implements PanelLicenceGate {

    private static final Logger log = LoggerFactory.getLogger(PanelLicenceService.class);

    public static final String SEAT_LOCK = "panel_licence:";
    public static final String AUTO_TRIAL_KEY = "auto_trial";
    static final String AUTO_TRIAL_CREATOR = "auto_trial";
    static final Set<String> KINDS = Set.of("TRIAL", "PAID", "COMPLIMENTARY");

    private static final Duration CACHE_TTL = Duration.ofSeconds(60);
    private static final int CACHE_SIZE = 10_000;
    private static final int MAX_SEATS = 100_000;
    private static final int MAX_GRACE_DAYS = 365;
    private static final int MAX_TEMPLATE_DAYS = 3650;
    private static final Pattern TEMPLATE_KEY = Pattern.compile("[a-z_]{1,32}");

    private final PanelLicenceRepository seats;
    private final PanelRepository panels;
    private final PanelPhase2Properties properties;
    private final PanelCompat compat;
    private final PanelTx tx;
    private final InstituteOAuthClientAccessGuard accessGuard;
    private final Cache<String, Result> cache = Caffeine.newBuilder()
            .maximumSize(CACHE_SIZE)
            .expireAfterWrite(CACHE_TTL)
            .build();
    private final AtomicLong shadowRefusals = new AtomicLong();

    public PanelLicenceService(PanelLicenceRepository seats, PanelRepository panels,
            PanelPhase2Properties properties, PanelCompat compat, PanelTx tx,
            InstituteOAuthClientAccessGuard accessGuard) {
        this.seats = seats;
        this.panels = panels;
        this.properties = properties;
        this.compat = compat;
        this.tx = tx;
        this.accessGuard = accessGuard;
    }

    // ------------------------------------------------------------ snapshot ---

    /** The rows a computation was made from, kept for pages that list them. */
    record Snapshot(Result result, List<RoomSeatRow> rooms, List<GrantRow> grants, Timestamp now) {
        Optional<RoomSeatRow> room(String roomId) {
            return rooms.stream().filter(room -> room.id().equals(roomId)).findFirst();
        }
    }

    String enforcementOf(String instituteId) {
        return seats.findEnforcement(instituteId).orElse(properties.getLicenceDefaultEnforcement());
    }

    Snapshot snapshot(String instituteId) {
        String enforcement = enforcementOf(instituteId);
        List<GrantRow> grants = seats.listGrants(instituteId);
        List<RoomSeatRow> rooms = seats.listRoomSeats(instituteId);
        Timestamp now = seats.dbNow();
        Result result = PanelLicenceMath.compute(enforcement,
                grants.stream().map(PanelLicenceService::grant).toList(),
                rooms.stream().map(room -> new Room(room.id(), PanelInputs.instant(room.licensedAt()))).toList(),
                now.toInstant());
        return new Snapshot(result, rooms, grants, now);
    }

    private static Grant grant(GrantRow row) {
        return new Grant(row.id(), row.kind(), row.seats(), row.startsAt().toInstant(), row.endsAt().toInstant(),
                row.graceDays(), row.status());
    }

    private Result cached(String instituteId) {
        return cached(instituteId, null);
    }

    /**
     * As {@link #cached(String)}, but a picture that does not know this room yet (created since it
     * was cached) is read again rather than answering for a room it has never seen.
     */
    private Result cached(String instituteId, String roomId) {
        Result result = cache.getIfPresent(instituteId);
        if (result == null || (roomId != null && !result.roomStates().containsKey(roomId))) {
            result = snapshot(instituteId).result();
            cache.put(instituteId, result);
        }
        return result;
    }

    /** Drops the cached picture now and again once the surrounding transaction has ended. */
    void evict(String instituteId) {
        cache.invalidate(instituteId);
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCompletion(int status) {
                    cache.invalidate(instituteId);
                }
            });
        }
    }

    /** How many sign-ins SHADOW (or never-block) would have refused on this pod since boot. */
    public long shadowRefusals() {
        return shadowRefusals.get();
    }

    // ---------------------------------------------------------------- gate ---

    /**
     * Session starts only (challenge create and approve for SIGN_IN, password sign-in). Under SHADOW,
     * and under LIVE with panel.licence.never-block, a room that may not start is counted and logged
     * and the sign-in goes ahead.
     */
    @Override
    public void requireCanStart(DeviceRow device) {
        if (!properties.isLicenceEnabled()) {
            return;
        }
        String instituteId = device.instituteId();
        Result result = cached(instituteId, device.roomId());
        if (PanelLicenceMath.OFF.equals(result.enforcement())) {
            return;
        }
        String state = result.roomStates().get(device.roomId());
        if (Result.mayStart(state)) {
            return;
        }
        boolean blocking = PanelLicenceMath.LIVE.equals(result.enforcement()) && !properties.isLicenceNeverBlock();
        if (blocking) {
            // Never refuse on a cached picture: a seat may have been assigned on another pod.
            result = snapshot(instituteId).result();
            state = result.roomStates().get(device.roomId());
            if (Result.mayStart(state)) {
                return;
            }
            blocking = PanelLicenceMath.LIVE.equals(result.enforcement());
        }
        if (!blocking) {
            shadowRefusals.incrementAndGet();
            log.info("Panel seat check (not enforced) would refuse: institute={} room={} state={}", instituteId,
                    device.roomId(), state);
            return;
        }
        throw compat.refusal(device, PanelPhase2Errors.LICENCE_REQUIRED);
    }

    /** A pending installer panel gets its seat when the school approves it, not here. */
    @Override
    public void onActivated(DeviceRow device) {
        if (!properties.isLicenceEnabled()) {
            return;
        }
        autoAssignForDevice(device.id(), device.instituteId(), "AUTO_ACTIVATE", null);
    }

    /**
     * Inside the approval transaction, after approval_state became APPROVED. A panel that has not
     * confirmed yet gets its seat at confirm instead.
     */
    public void onApproved(String deviceId, String instituteId, String actorUserId) {
        if (!properties.isLicenceEnabled()) {
            return;
        }
        autoAssignForDevice(deviceId, instituteId, "AUTO_APPROVE", actorUserId);
    }

    /**
     * Re-reads the device under the seat lock, so a confirm and an approval racing each other both
     * see the other's committed write: whichever finishes second assigns.
     */
    private void autoAssignForDevice(String deviceId, String instituteId, String reason, String actor) {
        panels.lockForTransaction(SEAT_LOCK + instituteId);
        DeviceRow fresh = panels.findDevice(deviceId).orElse(null);
        if (fresh == null || !"ACTIVE".equals(fresh.status())
                || !"APPROVED".equals(fresh.approvalState() == null ? "APPROVED" : fresh.approvalState())) {
            return;
        }
        maybeStartAutoTrial(instituteId);
        Snapshot snapshot = snapshot(instituteId);
        Optional<RoomSeatRow> room = snapshot.room(fresh.roomId());
        if (room.isEmpty() || room.get().licensedAt() != null || snapshot.result().freeSeats() <= 0) {
            return;
        }
        if (seats.assignSeat(fresh.roomId(), actor) == 1) {
            seats.insertEvent(instituteId, fresh.roomId(), "ASSIGNED", reason, actor);
        }
        evict(instituteId);
    }

    /**
     * A first grant from the auto_trial template, when enforcement is on and no grant has started yet
     * (a grant that starts later does not count, so it does not hold back the trial). No template row
     * (the default) means no automatic trial. Call under the seat lock.
     */
    private void maybeStartAutoTrial(String instituteId) {
        if (PanelLicenceMath.OFF.equals(enforcementOf(instituteId)) || seats.countStartedGrants(instituteId) > 0) {
            return;
        }
        Optional<TemplateRow> template = seats.findTemplate(AUTO_TRIAL_KEY).filter(TemplateRow::active);
        if (template.isPresent()) {
            seats.insertGrantFromTemplate(UUID.randomUUID().toString(), instituteId, template.get(),
                    AUTO_TRIAL_CREATOR);
            evict(instituteId);
        }
    }

    /**
     * An archived room gives its seat back. Runs whatever the switch, because it only ever clears a
     * seat that exists: with seats never used it changes nothing.
     */
    @Override
    public void onRoomArchived(String instituteId, String roomId, String actorUserId) {
        if (seats.releaseSeat(roomId) == 1) {
            seats.insertEvent(instituteId, roomId, "RELEASED", "ROOM_ARCHIVED", actorUserId);
            evict(instituteId);
        }
    }

    @Override
    public SyncLicence syncBlock(DeviceRow device) {
        if (!properties.isLicenceEnabled()) {
            return null;
        }
        Result result = cached(device.instituteId(), device.roomId());
        if (PanelLicenceMath.OFF.equals(result.enforcement())) {
            return new SyncLicence(PanelLicenceMath.UNMANAGED, false, null, null);
        }
        String state = result.roomStates().getOrDefault(device.roomId(), PanelLicenceMath.UNLICENSED);
        boolean enforced = PanelLicenceMath.LIVE.equals(result.enforcement()) && !properties.isLicenceNeverBlock();
        return new SyncLicence(state, enforced, PanelInputs.iso(result.endsAt()),
                PanelInputs.iso(result.graceEndsAt()));
    }

    @Override
    public InstituteLicenceView view(String instituteId) {
        if (!properties.isLicenceEnabled()) {
            return InstituteLicenceView.UNMANAGED;
        }
        Result result = cached(instituteId);
        boolean off = PanelLicenceMath.OFF.equals(result.enforcement());
        return new InstituteLicenceView(result.enforcement(), result.state(), result.seats(), result.seatsUsed(),
                result.endsAt(), result.graceEndsAt(), result.endingGrantId(),
                off ? Map.of() : result.roomStates(), result.graceSeats(), result.firstEndsAt(),
                result.graceGrantId());
    }

    // ------------------------------------------------------- school admin ---

    /** The institute's seats as its admin sees them: no grant reference, no note, no partner. */
    public LicenceResponse adminLicence(CustomUserDetails user, String instituteId) {
        properties.requireLicence();
        PanelInputs.instituteId(instituteId);
        return tx.run(() -> {
            accessGuard.requireInstituteAdmin(user, instituteId);
            Snapshot snapshot = snapshot(instituteId);
            Result result = snapshot.result();
            boolean off = PanelLicenceMath.OFF.equals(result.enforcement());
            List<LicenceGrantView> grants = snapshot.grants().stream()
                    .filter(g -> "ACTIVE".equals(g.status()))
                    .map(g -> new LicenceGrantView(g.kind(), g.seats(), PanelInputs.iso(g.startsAt()),
                            PanelInputs.iso(g.endsAt()), g.graceDays()))
                    .toList();
            return new LicenceResponse(result.state(), result.enforcement(), result.seats(), result.seatsUsed(),
                    PanelInputs.iso(result.endsAt()), PanelInputs.iso(result.graceEndsAt()), grants,
                    roomRows(snapshot, off), PanelInputs.iso(result.nextStartsAt()));
        });
    }

    private static List<LicenceRoomRow> roomRows(Snapshot snapshot, boolean hideStates) {
        return snapshot.rooms().stream()
                .map(room -> new LicenceRoomRow(new RoomRef(room.id(), room.name()),
                        hideStates ? null : snapshot.result().roomStates().get(room.id()),
                        PanelInputs.iso(room.licensedAt()), room.deviceId()))
                .toList();
    }

    /** 409 NO_SEAT when every seat is held. Assigning a room that already holds a seat changes nothing. */
    public LicenceRoomActionResponse assign(CustomUserDetails user, String roomId) {
        properties.requireLicence();
        PanelInputs.rowId(roomId, "room");
        return tx.run(() -> {
            RoomSeatRow room = seats.findRoomSeat(roomId).orElseThrow(() -> PanelApiException.notFound("No such room"));
            accessGuard.requireInstituteAdmin(user, room.instituteId());
            if (!"ACTIVE".equals(room.status())) {
                throw PanelApiException.badRequest("This room is archived");
            }
            String instituteId = room.instituteId();
            panels.lockForTransaction(SEAT_LOCK + instituteId);
            Snapshot snapshot = snapshot(instituteId);
            RoomSeatRow current = snapshot.room(roomId).orElseThrow(() -> PanelApiException.notFound("No such room"));
            if (current.licensedAt() == null) {
                if (snapshot.result().freeSeats() <= 0) {
                    throw PanelPhase2Errors.noSeat();
                }
                if (seats.assignSeat(roomId, user.getUserId()) == 1) {
                    seats.insertEvent(instituteId, roomId, "ASSIGNED", "ADMIN", user.getUserId());
                }
                evict(instituteId);
                snapshot = snapshot(instituteId);
            }
            return new LicenceRoomActionResponse(roomId, snapshot.result().roomStates().get(roomId));
        });
    }

    /** Releasing a room that holds no seat changes nothing. A panel in it keeps running its class. */
    public LicenceRoomActionResponse release(CustomUserDetails user, String roomId) {
        properties.requireLicence();
        PanelInputs.rowId(roomId, "room");
        return tx.run(() -> {
            RoomSeatRow room = seats.findRoomSeat(roomId).orElseThrow(() -> PanelApiException.notFound("No such room"));
            accessGuard.requireInstituteAdmin(user, room.instituteId());
            panels.lockForTransaction(SEAT_LOCK + room.instituteId());
            if (seats.releaseSeat(roomId) == 1) {
                seats.insertEvent(room.instituteId(), roomId, "RELEASED", "ADMIN", user.getUserId());
                evict(room.instituteId());
            }
            return new LicenceRoomActionResponse(roomId, PanelLicenceMath.UNLICENSED);
        });
    }

    // ------------------------------------------------------- platform staff ---
    // Callers have already passed SuperAdminAuthUtil.requireSuperAdmin.

    public LicenceEnforcementResponse enforcement(String instituteId) {
        properties.requireLicence();
        PanelInputs.instituteId(instituteId);
        return new LicenceEnforcementResponse(instituteId, enforcementOf(instituteId));
    }

    public LicenceEnforcementResponse setEnforcement(String instituteId, LicenceEnforcementRequest body,
            String actor) {
        properties.requireLicence();
        PanelInputs.instituteId(instituteId);
        String value = body == null || body.enforcement() == null ? ""
                : body.enforcement().trim().toUpperCase(Locale.ROOT);
        if (!PanelPhase2Properties.ENFORCEMENTS.contains(value)) {
            throw PanelApiException.badRequest("enforcement must be OFF, SHADOW or LIVE");
        }
        return tx.run(() -> {
            seats.upsertEnforcement(instituteId, value, actor);
            evict(instituteId);
            return new LicenceEnforcementResponse(instituteId, value);
        });
    }

    /** The full picture for platform staff: every grant with its reference and note, room states always. */
    public LicenceAdminResponse adminDetail(String instituteId) {
        properties.requireLicence();
        PanelInputs.instituteId(instituteId);
        return tx.run(() -> {
            Snapshot snapshot = snapshot(instituteId);
            Result result = snapshot.result();
            return new LicenceAdminResponse(instituteId, result.state(), result.enforcement(), result.seats(),
                    result.seatsUsed(), PanelInputs.iso(result.endsAt()), PanelInputs.iso(result.graceEndsAt()),
                    snapshot.grants().stream().map(PanelLicenceService::detail).toList(), roomRows(snapshot, false),
                    PanelInputs.iso(result.nextStartsAt()));
        });
    }

    public LicenceGrantDetail createGrant(String instituteId, LicenceGrantCreateRequest body, String actor) {
        properties.requireLicence();
        PanelInputs.instituteId(instituteId);
        if (body == null) {
            throw PanelApiException.badRequest("A body is required");
        }
        String kind = kind(body.kind());
        int seatCount = PanelInputs.range(body.seats(), 1, MAX_SEATS, "seats");
        Instant startsAt = PanelInputs.instant(body.startsAt(), "starts_at");
        Instant endsAt = PanelInputs.instant(body.endsAt(), "ends_at");
        if (!endsAt.isAfter(startsAt)) {
            throw PanelApiException.badRequest("ends_at must be after starts_at");
        }
        int graceDays = body.graceDays() == null ? 0 : PanelInputs.range(body.graceDays(), 0, MAX_GRACE_DAYS,
                "grace_days");
        String partnerId = body.partnerId() == null || body.partnerId().isBlank() ? null
                : PanelInputs.rowId(body.partnerId(), "partner");
        String externalRef = PanelInputs.optionalText(body.externalRef(), 120, "external_ref");
        String note = PanelInputs.optionalText(body.note(), 500, "note");
        return tx.run(() -> {
            if (partnerId != null && !seats.partnerExists(partnerId)) {
                throw PanelApiException.notFound("No such partner");
            }
            String id = UUID.randomUUID().toString();
            seats.insertGrant(id, instituteId, kind, seatCount, Timestamp.from(startsAt), Timestamp.from(endsAt),
                    graceDays, partnerId, externalRef, note, actor);
            evict(instituteId);
            return detail(seats.findGrant(id).orElseThrow());
        });
    }

    /** Cancelling a cancelled grant changes nothing and answers the grant as it is. */
    public LicenceGrantDetail cancelGrant(String grantId, LicenceGrantCancelRequest body, String actor) {
        properties.requireLicence();
        PanelInputs.rowId(grantId, "grant");
        String note = body == null ? null : PanelInputs.optionalText(body.note(), 500, "note");
        return tx.run(() -> {
            GrantRow grant = seats.findGrant(grantId).orElseThrow(() -> PanelApiException.notFound("No such grant"));
            if (seats.cancelGrant(grantId, actor, note) == 1) {
                evict(grant.instituteId());
            }
            return detail(seats.findGrant(grantId).orElseThrow());
        });
    }

    public LicenceTemplateResponse template(String key) {
        properties.requireLicence();
        return seats.findTemplate(templateKey(key)).map(PanelLicenceService::templateResponse)
                .orElseThrow(() -> PanelApiException.notFound("No such template"));
    }

    public LicenceTemplateResponse putTemplate(String key, LicenceTemplateRequest body, String actor) {
        properties.requireLicence();
        String clean = templateKey(key);
        if (body == null) {
            throw PanelApiException.badRequest("A body is required");
        }
        String kind = kind(body.kind());
        int seatCount = PanelInputs.range(body.seats(), 1, MAX_SEATS, "seats");
        int days = PanelInputs.range(body.days(), 1, MAX_TEMPLATE_DAYS, "days");
        int graceDays = body.graceDays() == null ? 0 : PanelInputs.range(body.graceDays(), 0, MAX_GRACE_DAYS,
                "grace_days");
        boolean active = body.active() == null || body.active();
        return tx.run(() -> {
            seats.upsertTemplate(clean, kind, seatCount, days, graceDays, active, actor);
            return templateResponse(seats.findTemplate(clean).orElseThrow());
        });
    }

    private static String templateKey(String key) {
        if (key == null || !TEMPLATE_KEY.matcher(key).matches()) {
            throw PanelApiException.notFound("No such template");
        }
        return key;
    }

    private static String kind(String raw) {
        String kind = raw == null ? "" : raw.trim().toUpperCase(Locale.ROOT);
        if (!KINDS.contains(kind)) {
            throw PanelApiException.badRequest("kind must be TRIAL, PAID or COMPLIMENTARY");
        }
        return kind;
    }

    static LicenceGrantDetail detail(GrantRow g) {
        return new LicenceGrantDetail(g.id(), g.instituteId(), g.kind(), g.seats(), PanelInputs.iso(g.startsAt()),
                PanelInputs.iso(g.endsAt()), g.graceDays(), g.status(), g.partnerId(), g.externalRef(), g.note(),
                g.createdBy(), PanelInputs.iso(g.createdAt()), g.cancelledBy(), PanelInputs.iso(g.cancelledAt()));
    }

    private static LicenceTemplateResponse templateResponse(TemplateRow t) {
        return new LicenceTemplateResponse(t.key(), t.kind(), t.seats(), t.days(), t.graceDays(), t.active(),
                t.updatedBy(), PanelInputs.iso(t.updatedAt()));
    }
}
