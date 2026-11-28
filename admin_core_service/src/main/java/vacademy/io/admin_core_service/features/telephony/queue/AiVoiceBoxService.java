package vacademy.io.admin_core_service.features.telephony.queue;

import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.live_session.provider.entity.AppConfig;
import vacademy.io.admin_core_service.features.live_session.provider.repository.AppConfigRepository;
import vacademy.io.admin_core_service.features.telephony.enums.ProviderType;
import vacademy.io.admin_core_service.features.telephony.queue.dto.AiCallQueueDTOs.BoxUpsertRequest;
import vacademy.io.admin_core_service.features.telephony.queue.dto.AiCallQueueDTOs.BoxView;
import vacademy.io.admin_core_service.features.telephony.queue.dto.AiCallQueueDTOs.CapacityView;
import vacademy.io.admin_core_service.features.telephony.queue.entity.AiVoiceBox;
import vacademy.io.admin_core_service.features.telephony.queue.repository.AiCallQueueItemRepository;
import vacademy.io.admin_core_service.features.telephony.queue.repository.AiVoiceBoxRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.Date;
import java.util.List;

/**
 * Managing the capacity pool: the boxes themselves and the handful of runtime knobs
 * that sit beside them in {@code app_config}.
 *
 * <p>Capacity is server-wide, so everything here is a super-admin action — one
 * institute must not be able to change how many lines the whole fleet has, nor how
 * many of them it is allowed to hold.
 */
@Service
@RequiredArgsConstructor
public class AiVoiceBoxService {

    private static final Logger log = LoggerFactory.getLogger(AiVoiceBoxService.class);

    private final AiVoiceBoxRepository boxRepository;
    private final AiCallQueueItemRepository queueRepository;
    private final AiCallCapacityService capacityService;
    private final AppConfigRepository appConfigRepository;

    // ── boxes ───────────────────────────────────────────────────────────────────

    public List<BoxView> listBoxes() {
        List<BoxView> out = new ArrayList<>();
        for (AiVoiceBox box : boxRepository.findAllByOrderByPriorityAscSlugAsc()) out.add(toView(box));
        return out;
    }

    @Transactional
    public BoxView upsertBox(String id, BoxUpsertRequest body) {
        if (body == null) throw new VacademyException("A box definition is required.");
        AiVoiceBox box;
        if (id == null || id.isBlank()) {
            if (body.getSlug() == null || body.getSlug().isBlank()) {
                throw new VacademyException("A box needs a slug (e.g. \"mumbai-2\").");
            }
            if (boxRepository.existsBySlug(body.getSlug().trim())) {
                throw new VacademyException("A voice box with that slug already exists.");
            }
            box = AiVoiceBox.builder()
                    .slug(body.getSlug().trim())
                    .baseUrl(AiVoiceBox.UNCONFIGURED_URL)
                    .maxConcurrent(3)
                    .priority(1)
                    .enabled(true)
                    .healthStatus(AiVoiceBox.HEALTH_UNKNOWN)
                    .build();
        } else {
            box = boxRepository.findById(id)
                    .orElseThrow(() -> new VacademyException("No such voice box."));
        }

        if (body.getBaseUrl() != null && !body.getBaseUrl().isBlank()) {
            box.setBaseUrl(body.getBaseUrl().trim().replaceAll("/$", ""));
            // A URL change invalidates what we know about the box: the next poll decides.
            box.setHealthStatus(AiVoiceBox.HEALTH_UNKNOWN);
            box.setActiveCalls(null);
            box.setLastHealthCheck(null);
        }
        if (body.getMaxConcurrent() != null) {
            if (body.getMaxConcurrent() < 0) {
                throw new VacademyException("A box cannot carry a negative number of calls.");
            }
            box.setMaxConcurrent(body.getMaxConcurrent());
        }
        if (body.getPriority() != null) box.setPriority(body.getPriority());
        if (body.getEnabled() != null) box.setEnabled(body.getEnabled());
        if (body.getNotes() != null) box.setNotes(body.getNotes());

        boxRepository.save(box);
        log.info("ai voice box saved: slug={} maxConcurrent={} enabled={} — fleet capacity is now {}",
                box.getSlug(), box.getMaxConcurrent(), box.isEnabled(),
                capacityService.fleetCapacity(ProviderType.VACADEMY_AI));
        return toView(box);
    }

    @Transactional
    public void deleteBox(String id) {
        AiVoiceBox box = boxRepository.findById(id)
                .orElseThrow(() -> new VacademyException("No such voice box."));
        boxRepository.delete(box);
        log.warn("ai voice box deleted: slug={} — fleet capacity is now {}",
                box.getSlug(), capacityService.fleetCapacity(ProviderType.VACADEMY_AI));
    }

    private BoxView toView(AiVoiceBox box) {
        return BoxView.builder()
                .id(box.getId())
                .slug(box.getSlug())
                .baseUrl(box.getBaseUrl())
                .maxConcurrent(box.getMaxConcurrent())
                .priority(box.getPriority())
                .enabled(box.isEnabled())
                .healthStatus(box.getHealthStatus())
                .activeCalls(box.getActiveCalls())
                .lastHealthCheck(box.getLastHealthCheck() == null ? null
                        : box.getLastHealthCheck().toString())
                .notes(box.getNotes())
                .countsTowardCapacity(box.countsTowardCapacity())
                .build();
    }

    // ── fleet view ──────────────────────────────────────────────────────────────

    public CapacityView capacity() {
        return capacity(capacityService.snapshot());
    }

    /** As above, against a snapshot the caller already holds. */
    public CapacityView capacity(AiCallCapacityService.Snapshot snap) {
        int lanes = snap.lanesWithWork();
        int vacademyCapacity = snap.capacityFor(ProviderType.VACADEMY_AI);
        return CapacityView.builder()
                .vacademyAiCapacity(vacademyCapacity)
                .vacademyAiInFlight(snap.inFlightFor(ProviderType.VACADEMY_AI))
                .aavtaarCapacity(snap.capacityFor(ProviderType.AAVTAAR))
                .aavtaarInFlight(snap.inFlightFor(ProviderType.AAVTAAR))
                .physicalCapacity(capacityService.physicalCapacity())
                .fleetLimit(capacityService.fleetLimit())
                .concurrencyLimitBypassed(!capacityService.capacityEnabled())
                .totalQueued(queueRepository.countQueuedTotal())
                .lanesWithWork(lanes)
                // Shown so the number an institute is actually subject to is visible
                // without opening its lane: with no override this IS its ceiling.
                .dynamicLaneCapacity(snap.defaultLaneCapacity(ProviderType.VACADEMY_AI))
                .avgCallSeconds(capacityService.avgCallSeconds())
                .reservedInteractiveSlots(capacityService.reservedInteractiveSlots())
                .boxes(listBoxes())
                .build();
    }

    /**
     * Set (or clear) the ops ceiling on simultaneous AI calls.
     *
     * <p>A purpose-built endpoint rather than another key on {@link #updateSetting}
     * because this is the one capacity control an operator reaches for under pressure,
     * and it deserves validation and a straight answer instead of a generic
     * string-valued key/value write.
     *
     * @param maxConcurrentCalls the ceiling; {@code null} clears it and returns the
     *        fleet to whatever the hardware provides; {@code 0} pauses dialing (the
     *        queue keeps accepting, so nothing is lost).
     */
    @Transactional
    public CapacityView setFleetLimit(Integer maxConcurrentCalls) {
        if (maxConcurrentCalls != null && maxConcurrentCalls < 0) {
            throw new VacademyException("A call limit cannot be negative. Use 0 to pause dialing.");
        }
        String value = maxConcurrentCalls == null ? "" : String.valueOf(maxConcurrentCalls);
        AppConfig config = appConfigRepository.findByConfigKey(AiCallCapacityService.KEY_FLEET_LIMIT)
                .orElseGet(() -> AppConfig.builder()
                        .configKey(AiCallCapacityService.KEY_FLEET_LIMIT).build());
        config.setConfigValue(value);
        config.setUpdatedAt(new Date());
        appConfigRepository.save(config);

        CapacityView after = capacity();
        // WARN, not INFO: this changes how hard we drive hardware that live callers are
        // talking to, and it is the first thing anyone will look for afterwards.
        log.warn("AI call fleet limit set to {} — hardware can carry {}, now enforcing {}",
                maxConcurrentCalls == null ? "no limit" : maxConcurrentCalls,
                after.getPhysicalCapacity(), after.getVacademyAiCapacity());
        return after;
    }

    // ── runtime knobs ───────────────────────────────────────────────────────────

    /**
     * The keys this endpoint will write. An allow-list, not a pass-through: {@code
     * app_config} is shared with unrelated features (the BBB server pool reads it too),
     * and a telephony endpoint has no business writing their keys.
     */
    private static final List<String> WRITABLE_KEYS = List.of(
            AiCallCapacityService.KEY_CAPACITY_ENABLED,
            AiCallCapacityService.KEY_AAVTAAR_MAX,
            AiCallCapacityService.KEY_STUCK_GRACE,
            AiCallCapacityService.KEY_TTL_HOURS,
            AiCallCapacityService.KEY_AVG_SECS,
            AiCallCapacityService.KEY_RESERVED_INTERACTIVE,
            AiCallCapacityService.KEY_DRAIN_BATCH);

    @Transactional
    public CapacityView updateSetting(String key, String value) {
        if (key == null || !WRITABLE_KEYS.contains(key)) {
            throw new VacademyException("Not an AI call queue setting: " + key);
        }
        if (value == null || value.isBlank()) {
            throw new VacademyException("A value is required.");
        }
        AppConfig config = appConfigRepository.findByConfigKey(key)
                .orElseGet(() -> AppConfig.builder().configKey(key).build());
        config.setConfigValue(value.trim());
        config.setUpdatedAt(new Date());
        appConfigRepository.save(config);
        log.warn("ai call queue setting changed: {} = {}", key, value.trim());
        return capacity();
    }
}
