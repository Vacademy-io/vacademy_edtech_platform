package vacademy.io.auth_service.feature.panel.phase2.partner;

import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import vacademy.io.auth_service.feature.panel.service.PanelInstituteDirectory;

import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/**
 * Fills a school's name on an installer link after the request that created it. The institute is
 * known only after a repository call, and the open-in-view session would hold that request's
 * connection through any HTTP wait, so the name lookup runs here on one dedicated thread instead,
 * the same pattern as the panel branding refresh. A failure or a full queue leaves the name empty;
 * the next listing asks again.
 */
@Component
public class PanelPartnerNames {

    private static final Logger log = LoggerFactory.getLogger(PanelPartnerNames.class);
    private static final int QUEUE_SIZE = 32;

    private final PanelInstituteDirectory directory;
    private final PanelPartnerRepository repository;
    private final ThreadPoolExecutor worker;

    public PanelPartnerNames(PanelInstituteDirectory directory, PanelPartnerRepository repository) {
        this.directory = directory;
        this.repository = repository;
        this.worker = new ThreadPoolExecutor(1, 1, 0, TimeUnit.MILLISECONDS, new ArrayBlockingQueue<>(QUEUE_SIZE),
                runnable -> {
                    Thread thread = new Thread(runnable, "panel-partner-names");
                    thread.setDaemon(true);
                    return thread;
                });
    }

    /** Call after the transaction that wrote the link has committed. Never waits. */
    public void fillAsync(String linkId, String instituteId) {
        try {
            worker.execute(() -> {
                try {
                    directory.get(instituteId)
                            .ifPresent(snapshot -> repository.fillLinkName(linkId, snapshot.instituteName()));
                } catch (RuntimeException e) {
                    log.warn("Installer link name lookup failed: {}", e.getClass().getSimpleName());
                }
            });
        } catch (RejectedExecutionException e) {
            log.debug("Installer link name queue full; lookup skipped");
        }
    }

    @PreDestroy
    void shutdown() {
        worker.shutdownNow();
    }
}
