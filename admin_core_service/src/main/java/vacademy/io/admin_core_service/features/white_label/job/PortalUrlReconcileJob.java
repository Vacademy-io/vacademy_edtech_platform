package vacademy.io.admin_core_service.features.white_label.job;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.domain_routing.entity.InstituteDomainRouting;
import vacademy.io.admin_core_service.features.domain_routing.repository.InstituteDomainRoutingRepository;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.white_label.service.CloudflareService;
import vacademy.io.admin_core_service.features.white_label.service.PortalUrlReconciler;
import vacademy.io.common.institute.entity.Institute;

import java.util.List;
import java.util.Map;

/**
 * Daily sweep that adopts every white-label host that has gone live into its
 * institute's {@code learner_portal_base_url} / {@code admin_portal_base_url} /
 * {@code teacher_portal_base_url}.
 *
 * <p><b>Why a job and not just the request path.</b> {@link PortalUrlReconciler}
 * already makes the right decision, but it only ever ran from
 * {@code WhiteLabelService.setup()} and {@code getStatus()} — both reached only by
 * an admin opening the white-label settings page. Adoption is gated on Cloudflare
 * reporting the host ACTIVE, and a Pages custom domain is {@code pending} until the
 * customer's CNAME lands, which is typically hours after the admin finished setup
 * and closed the page. So the common case was: the portal goes live, and nothing
 * ever looks again. Measured on prod 2026-09-09, 13 (institute, role) pairs were
 * sitting on a blank or platform-default column while their configured host was
 * ACTIVE on Cloudflare — including live customers whose learners were being mailed
 * {@code learner.vacademy.io} links instead of their own portal.
 *
 * <p>Those columns are the origin of every link the platform mails a human, so the
 * cost of the gap is unbranded — and for sub-orgs, wrong — links in real email.
 *
 * <p><b>What it will not do.</b> Nothing here relaxes the reconciler's rules: a
 * curated URL that is not among the institute's configured hosts is never
 * overwritten, a live incumbent is never swapped for an equally live sibling, and
 * a host that is not ACTIVE is not adopted. The sweep only supplies the "look
 * again" the feature was missing.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class PortalUrlReconcileJob {

    private final InstituteRepository instituteRepository;
    private final InstituteDomainRoutingRepository routingRepository;
    private final PortalUrlReconciler portalUrlReconciler;
    private final CloudflareService cloudflareService;

    /**
     * 03:45 UTC daily. Cloudflare activation is not time-critical — a domain that
     * goes live at noon is adopted that night, and the settings page still adopts
     * it immediately for an admin who is watching.
     */
    @Scheduled(cron = "0 45 3 * * *", zone = "UTC")
    @SchedulerLock(name = "PortalUrlReconcileJob", lockAtMostFor = "PT30M", lockAtLeastFor = "PT1M")
    public void run() {
        runOnce();
    }

    /**
     * Exposed so it can be triggered manually (tests, or a one-off after a deploy).
     *
     * <p>Deliberately <b>not</b> {@code @Transactional}, for the same reason
     * {@code getStatus} isn't: a writable transaction is routed to the primary by
     * {@code ReplicationRoutingDataSource}, and this method spends its time in
     * Cloudflare HTTP calls. Holding one small-pool primary connection open across
     * every institute on the platform is the shape of outage this codebase has
     * already had once. Each institute's write is instead its own short transaction
     * inside {@code save()}, so a failure on one institute cannot roll back the
     * adoptions already made for the others.
     *
     * @return the number of institutes whose portal URLs changed
     */
    public int runOnce() {
        // The same gate WhiteLabelService.setup() and getStatus() open with. Without
        // it this job is a way around the feature's own kill switch: on a deployment
        // with no Cloudflare configured those two endpoints refuse outright, so a
        // portal URL could never be adopted — but an unattended sweep would still
        // run, take the legacy DNS-only path (which reads any in-zone *.vacademy.io
        // host as live), and start writing columns nothing else on that deployment
        // would have written.
        if (!cloudflareService.isEnabled() && !cloudflareService.isPagesEnabled()) {
            log.debug("[WhiteLabel] Portal URL sweep skipped — Cloudflare is not configured");
            return 0;
        }

        List<String> instituteIds = routingRepository.findDistinctInstituteIds();
        if (instituteIds.isEmpty()) {
            return 0;
        }

        // One probe for the whole sweep, pre-loaded with each Pages project's full
        // custom-domain listing: ~2 paged listings instead of one HTTP call per
        // routing row. Sharing it also fixes each host's status for the duration, so
        // a domain that flips mid-sweep cannot be adopted for one institute and not
        // another.
        PortalUrlReconciler.ActivationProbe probe = portalUrlReconciler.newProbe();
        for (String project : portalUrlReconciler.configuredPagesProjects()) {
            Map<String, String> listing = cloudflareService.listPagesCustomDomains(project);
            if (listing == null) {
                // Listing failed; leave the project un-enumerated so the probe falls
                // back to per-host lookups rather than concluding nothing is attached.
                log.warn("[WhiteLabel] Could not list Pages domains for project {}; " +
                        "falling back to per-host lookups for this sweep", project);
                continue;
            }
            probe.seedProjectListing(project, listing);
        }

        int changed = 0;
        for (String instituteId : instituteIds) {
            try {
                if (reconcileOne(instituteId, probe)) {
                    changed++;
                }
            } catch (Exception e) {
                // One institute's bad data or failed write must not end the sweep.
                log.error("[WhiteLabel] Portal URL reconcile failed for institute {}: {}",
                        instituteId, e.getMessage());
            }
        }

        if (changed > 0) {
            log.info("[WhiteLabel] Portal URL sweep adopted new URLs for {} of {} configured institute(s)",
                    changed, instituteIds.size());
        }
        return changed;
    }

    /** @return true when the institute row was updated */
    private boolean reconcileOne(String instituteId, PortalUrlReconciler.ActivationProbe probe) {
        Institute institute = instituteRepository.findById(instituteId).orElse(null);
        if (institute == null) {
            // A routing row outliving its institute; nothing to adopt into.
            return false;
        }
        List<InstituteDomainRouting> routings = routingRepository.findByInstituteId(instituteId);

        PortalUrlReconciler.ReconcileResult result =
                portalUrlReconciler.reconcile(institute, routings, probe);
        if (!result.isChanged()) {
            return false;
        }

        // Re-read before writing, the way getStatus does. The entity above is
        // detached — every repository call here is its own transaction — so saving it
        // merges all of its fields, not just the portal URLs. That window is normally
        // microseconds, but when a project listing failed the reconcile falls back to
        // per-host Cloudflare lookups and can hold it for seconds, which is long
        // enough to overwrite an unrelated institute edit made in the admin UI
        // meanwhile. Apply only what this pass actually decided.
        Institute fresh = instituteRepository.findById(instituteId).orElse(null);
        if (fresh == null) {
            return false;
        }
        result.getAdoptedUrlByRole()
                .forEach((role, url) -> PortalUrlReconciler.setPortalUrl(fresh, role, url));
        instituteRepository.save(fresh);
        return true;
    }
}
