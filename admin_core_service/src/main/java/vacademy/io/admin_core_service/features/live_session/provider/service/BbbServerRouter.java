package vacademy.io.admin_core_service.features.live_session.provider.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.live_session.provider.entity.BbbServerPool;
import vacademy.io.admin_core_service.features.live_session.provider.repository.BbbServerPoolRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.Map;

/**
 * Routes BBB meetings to servers using sequential-fill, priority-based strategy.
 *
 * Strategy: Fill up server with priority=1 first (up to its max_meetings),
 * then spill to priority=2, and so on.
 *
 * When a meeting ends (via BBB callback), the active_meetings count is decremented,
 * freeing capacity for new meetings.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class BbbServerRouter {

    private final BbbServerPoolRepository poolRepository;

    /**
     * Pick the best available server for a new meeting.
     * Returns the first RUNNING server (by priority) that has capacity.
     *
     * @throws VacademyException if no servers are available
     */
    public BbbServerPool pickServer() {
        List<BbbServerPool> available = poolRepository.findAvailableOrderByPriority();
        if (available.isEmpty()) {
            log.error("[BBB Router] No available BBB servers! All servers are full or not running.");
            throw new VacademyException(
                    "No BBB servers available. All servers are at capacity or not running. " +
                    "Please try again later or contact support.");
        }

        BbbServerPool selected = available.get(0);
        log.info("[BBB Router] Selected server: {} (priority={}, active={}/{}, domain={})",
                selected.getSlug(), selected.getPriority(),
                selected.getActiveMeetings(), selected.getMaxMeetings(),
                selected.getDomain());

        return selected;
    }

    /**
     * Increment active meeting count after a meeting is created.
     */
    @Transactional
    public void onMeetingCreated(String serverId) {
        poolRepository.incrementActiveMeetings(serverId);
        log.info("[BBB Router] Incremented active meetings for server {}", serverId);
    }

    /**
     * Decrement active meeting count when a meeting ends.
     */
    @Transactional
    public void onMeetingEnded(String serverId) {
        poolRepository.decrementActiveMeetings(serverId);
        log.info("[BBB Router] Decremented active meetings for server {}", serverId);
    }

    /**
     * Look up a server by its pool ID.
     * Used when a SessionSchedule already has a bbbServerId assigned.
     *
     * @throws VacademyException if server not found
     */
    public BbbServerPool getServer(String serverId) {
        return poolRepository.findById(serverId)
                .orElseThrow(() -> new VacademyException("BBB server not found: " + serverId));
    }

    /**
     * Get server config (apiUrl + secret) as a Map — matches the format
     * expected by BbbMeetingManager helper methods.
     */
    public Map<String, Object> getServerConfigMap(BbbServerPool server) {
        return Map.of(
                "apiUrl", server.getApiUrl(),
                "secret", server.getSecret()
        );
    }

    /**
     * Get all enabled servers ordered by priority.
     */
    public List<BbbServerPool> getAllEnabledServers() {
        return poolRepository.findByEnabledTrueOrderByPriorityAsc();
    }

    /**
     * Get all running servers.
     */
    public List<BbbServerPool> getRunningServers() {
        return poolRepository.findByStatusAndEnabledTrue("RUNNING");
    }

    /**
     * True when {@code server} is the primary pool server — the lowest-priority
     * enabled row.
     *
     * This matters for per-institute custom live-class domains. An institute has a
     * single A record for its domain and it points at exactly one box, the primary.
     * If a meeting spills to a lower-priority server and we still rewrote the join
     * URL to the institute's host, we would send the learner to a server that does
     * not hold their meeting — strictly worse than an off-brand URL that works.
     *
     * Deliberately based on priority rather than status: a server can be the
     * primary while briefly not RUNNING, and the DNS record still points at it.
     *
     * @return false when {@code server} is null or the pool is empty.
     */
    public boolean isPrimary(BbbServerPool server) {
        if (server == null || server.getId() == null) {
            return false;
        }
        return poolRepository.findByEnabledTrueOrderByPriorityAsc().stream()
                .findFirst()
                .map(primary -> primary.getId().equals(server.getId()))
                .orElse(false);
    }
}
