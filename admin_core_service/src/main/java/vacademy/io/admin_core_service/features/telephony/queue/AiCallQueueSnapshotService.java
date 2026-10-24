package vacademy.io.admin_core_service.features.telephony.queue;

import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.telephony.queue.dto.AiCallQueueDTOs.QueueItemView;
import vacademy.io.admin_core_service.features.telephony.queue.dto.AiCallQueueDTOs.QueueSnapshot;
import vacademy.io.admin_core_service.features.telephony.queue.repository.AiCallQueueItemRepository;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Assembles the entire queue — capacity, lanes and the waiting calls — into one
 * payload, from ONE capacity snapshot.
 *
 * <p>That single snapshot is the whole point of this class. Capacity, each lane's share
 * of the fleet, and each item's position are all derived from live occupancy, so reading
 * them through three separate calls produces a payload whose parts describe three
 * different instants: a dashboard can then show "3 of 3 lines busy" beside a lane
 * claiming a free slot, and the resulting bug report is about arithmetic rather than
 * about the queue. Taking the snapshot once and passing it down makes that impossible.
 *
 * <p>Serves both the super-admin screen and the machine-to-machine ops feed, so the two
 * can never drift into disagreeing about the same fleet.
 */
@Service
@RequiredArgsConstructor
public class AiCallQueueSnapshotService {

    /** Hard ceiling on rows returned, however large a limit is asked for. */
    private static final int MAX_ITEMS = 200;

    private final AiCallCapacityService capacityService;
    private final AiCallQueueService queueService;
    private final AiVoiceBoxService boxService;
    private final AiCallQueueItemRepository repository;

    /**
     * @param itemLimit how many waiting calls to include. 0 returns capacity + lanes
     *                  only, which is what a landing view needs — the item list is the
     *                  expensive half and most screens page it separately.
     * @param instituteId optional filter for the waiting list; lanes and capacity stay
     *                    fleet-wide either way, because an institute's share only means
     *                    anything against the whole fleet.
     */
    public QueueSnapshot snapshot(int itemLimit, String instituteId) {
        AiCallCapacityService.Snapshot snap = capacityService.snapshot();

        List<QueueItemView> waiting = List.of();
        if (itemLimit > 0) {
            Page<QueueItemView> page = queueService.search(
                    instituteId, AiCallQueueStatus.QUEUED.name(), null, null,
                    0, Math.min(MAX_ITEMS, itemLimit), snap);
            waiting = page.getContent();
        }

        Map<String, Long> totals = new LinkedHashMap<>();
        for (Object[] row : repository.countAllGroupedByStatus()) {
            totals.put((String) row[0], ((Number) row[1]).longValue());
        }

        return QueueSnapshot.builder()
                .generatedAt(Instant.now().toString())
                .capacity(boxService.capacity(snap))
                .lanes(queueService.allLanes(snap))
                .waiting(waiting)
                // Read from the status totals rather than the page: the page is capped,
                // and a UI that infers the backlog from a truncated list under-reports it
                // by exactly the amount that matters most.
                .waitingTotal(totals.getOrDefault(AiCallQueueStatus.QUEUED.name(), 0L))
                .totalsByStatus(totals)
                .build();
    }
}
