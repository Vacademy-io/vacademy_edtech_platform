package vacademy.io.admin_core_service.features.invoice.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.invoice.dto.InvoiceNumberAllocation;
import vacademy.io.admin_core_service.features.invoice.dto.InvoiceNumberConfig;
import vacademy.io.admin_core_service.features.invoice.dto.InvoiceNumberContext;
import vacademy.io.admin_core_service.features.invoice.dto.InvoiceNumberingDTOs;
import vacademy.io.admin_core_service.features.invoice.repository.InvoiceRepository;
import vacademy.io.admin_core_service.features.invoice.util.InvoiceNumberFormatter;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Allocates and renders invoice numbers according to the institute's configured strategy
 * ({@code INVOICE_SETTING.numbering}).
 *
 * <p>The counter is {@code MAX(invoice.seq_no) + 1} for the (institute, reset window) — it
 * lives on the invoice rows themselves, not in a side table, so it can never drift from the
 * invoice list and a number is only ever consumed by an invoice that actually exists (no
 * gaps). Concurrency is settled by the {@code uq_invoice_institute_number} constraint at
 * INSERT time rather than by reserving up front; see
 * {@link #nextAfterCollision} for the retry contract.
 *
 * <p>Kept as its own bean rather than more methods on {@code InvoiceService}: the fee-receipt
 * services need it too, and {@code InvoiceService} is already ~4.7k lines.
 */
@Slf4j
@Service
public class InvoiceNumberService {

    /**
     * How many candidates to skip past before giving up and using a random suffix. Only
     * legacy (pre-V432, {@code seq_no IS NULL}) numbers can collide deterministically, so
     * this only needs to clear a short run of them.
     */
    private static final int MAX_CANDIDATE_PROBES = 25;

    @Autowired
    private InvoiceRepository invoiceRepository;

    /** Reads {@code invoice_released_number} (V531). Null in unit tests that build this by hand. */
    @PersistenceContext
    private EntityManager entityManager;

    /**
     * Allocate the next invoice number for this institute.
     *
     * <p>Does a cheap indexed pre-check and skips forward past any number already taken —
     * this absorbs collisions against legacy numbers WITHOUT the caller having to re-render
     * a PDF. Genuine concurrent collisions (two webhooks computing the same MAX at the same
     * instant) are not visible here and surface as a unique-constraint violation on INSERT;
     * the caller handles those via {@link #nextAfterCollision}.
     *
     * <p>Never throws: an invalid stored format falls back to the legacy
     * {@code INV-yyyyMMdd-NNNN} shape rather than blocking a payment from producing an
     * invoice.
     */
    public InvoiceNumberAllocation generate(InvoiceNumberConfig config, InvoiceNumberContext context) {
        InvoiceNumberConfig effective = resolveUsableConfig(selectSeries(config, context));
        String scopeKey = scopeKeyFor(effective, context);
        InvoiceNumberAllocation reused = reuseReleased(effective, context, scopeKey);
        if (reused != null) {
            return reused;
        }
        return renderFrom(effective, context, scopeKey, nextSeq(effective, context.getInstituteId(), scopeKey), 0);
    }

    /**
     * A position freed by a permanent invoice delete in THIS series, if one is waiting — the
     * lowest first, so the series closes its gaps in order. Returns null (and generation counts on
     * from MAX as always) when nothing was freed, when the freed position sits below the
     * institute's start-number floor, or when its rendered number is somehow taken.
     *
     * <p>Only positions recorded by {@code PaymentDeletionService} are considered, never arbitrary
     * gaps: an admin who set the start number to 100 after issuing 1-5 must not get 6-99 back.
     * A concurrent issuer taking the same position is settled the usual way — the unique number
     * constraint fails one INSERT and that caller retries via {@link #nextAfterCollision}.
     */
    private InvoiceNumberAllocation reuseReleased(InvoiceNumberConfig config, InvoiceNumberContext context,
                                                  String scopeKey) {
        if (entityManager == null || !StringUtils.hasText(context.getInstituteId())) {
            return null;
        }
        try {
            List<?> rows = entityManager.createNativeQuery(
                            "SELECT r.seq_no FROM invoice_released_number r "
                                    + "WHERE r.institute_id = ?1 AND r.seq_scope_key = ?2 AND r.seq_no >= ?3 "
                                    + "AND NOT EXISTS (SELECT 1 FROM invoice i WHERE i.institute_id = r.institute_id "
                                    + "AND i.seq_scope_key = r.seq_scope_key AND i.seq_no = r.seq_no) "
                                    + "ORDER BY r.seq_no LIMIT 1")
                    .setParameter(1, context.getInstituteId())
                    .setParameter(2, scopeKey)
                    .setParameter(3, config.getStartFrom())
                    .getResultList();
            if (rows.isEmpty() || !(rows.get(0) instanceof Number seq)) {
                return null;
            }
            String number = InvoiceNumberFormatter.render(config.getFormat(), config, context, seq.longValue());
            if (!StringUtils.hasText(number)
                    || invoiceRepository.existsByInstituteIdAndInvoiceNumber(context.getInstituteId(), number)) {
                return null;
            }
            return new InvoiceNumberAllocation(number, seq.longValue(), scopeKey);
        } catch (Exception e) {
            // An unexpected result falls back to counting on from MAX, which is always valid. (A SQL
            // error would still abort the caller's transaction in Postgres; the only one plausible
            // here is a missing V531 table, and Flyway creates it before the app serves requests.)
            log.warn("Could not look up released invoice numbers for institute {}: {}",
                    context.getInstituteId(), e.getMessage());
            return null;
        }
    }

    /**
     * The next candidate after a number lost an INSERT race.
     *
     * <p>MUST be used instead of re-calling {@link #generate}: a clash against a legacy
     * invoice ({@code seq_no IS NULL}) leaves {@code MAX(seq_no)} unchanged, so recomputing
     * would return the same candidate forever. {@code attempt} is the caller's 1-based retry
     * count and is what guarantees forward progress.
     */
    public InvoiceNumberAllocation nextAfterCollision(InvoiceNumberConfig config,
                                                      InvoiceNumberContext context,
                                                      int attempt) {
        InvoiceNumberConfig effective = resolveUsableConfig(selectSeries(config, context));
        String scopeKey = scopeKeyFor(effective, context);
        long start = nextSeq(effective, context.getInstituteId(), scopeKey);
        return renderFrom(effective, context, scopeKey, start + attempt, attempt);
    }

    /**
     * Next sequence position: one past the highest issued in this window, but never below the
     * institute's configured {@code startFrom} floor.
     *
     * <p>{@code startFrom} is a FLOOR, not a hard set — that is what makes it safe to expose to
     * admins. Setting it below what has already been issued is silently ignored rather than
     * reusing a number that is already on a customer's tax document.
     */
    private long nextSeq(InvoiceNumberConfig config, String instituteId, String scopeKey) {
        long next = invoiceRepository.highestSeqNo(instituteId, scopeKey) + 1;
        return Math.max(next, config.getStartFrom());
    }

    /**
     * Walk forward from {@code startSeq} until the rendered number is free, then return it.
     * The probe is a cheap indexed existence check; the authoritative uniqueness decision is
     * still the INSERT.
     */
    private InvoiceNumberAllocation renderFrom(InvoiceNumberConfig config, InvoiceNumberContext context,
                                               String scopeKey, long startSeq, int attempt) {
        String instituteId = context.getInstituteId();

        for (int probe = 0; probe < MAX_CANDIDATE_PROBES; probe++) {
            long seq = startSeq + probe;
            String number = InvoiceNumberFormatter.render(config.getFormat(), config, context, seq);
            if (!StringUtils.hasText(number)) {
                // Pathological format (every token resolved empty). Don't persist a blank.
                number = "INV-" + seq;
            }
            if (!invoiceRepository.existsByInstituteIdAndInvoiceNumber(instituteId, number)) {
                return new InvoiceNumberAllocation(number, seq, scopeKey);
            }
        }

        // A long unbroken run of taken numbers means the institute's format collides with its
        // own history (e.g. it was switched to a format it used years ago). Fall back to
        // something guaranteed unique rather than fail the invoice, and leave seqNo null so
        // this oddity never moves the real counter. ERROR because it needs an admin's eyes.
        String fallback = "INV-" + scopeKey + "-"
                + UUID.randomUUID().toString().substring(0, 8).toUpperCase();
        log.error("Could not find a free invoice number for institute {} after {} probes from #{} "
                        + "with format \"{}\" (retry attempt {}). Falling back to {}.",
                instituteId, MAX_CANDIDATE_PROBES, startSeq, config.getFormat(), attempt, fallback);
        return InvoiceNumberAllocation.unsequenced(fallback);
    }

    /**
     * The number the institute WOULD issue next, without reserving anything.
     *
     * <p>Nothing is consumed by design — the admin create-invoice preview re-renders on every
     * keystroke, and the settings screen previews continuously.
     */
    public String preview(InvoiceNumberConfig config, InvoiceNumberContext context) {
        InvoiceNumberConfig effective = resolveUsableConfig(selectSeries(config, context));
        String scopeKey = scopeKeyFor(effective, context);
        // Same rule as generate(), so the number the create-invoice screen shows is the one issued.
        InvoiceNumberAllocation reused = reuseReleased(effective, context, scopeKey);
        if (reused != null) {
            return reused.number();
        }
        long next = nextSeq(effective, context.getInstituteId(), scopeKey);
        return InvoiceNumberFormatter.render(effective.getFormat(), effective, context, next);
    }

    /** The position the next invoice in this window would take (1-based). */
    public long peekNextSequence(InvoiceNumberConfig config, String instituteId, LocalDate date) {
        InvoiceNumberConfig effective = resolveUsableConfig(config);
        LocalDate on = date != null ? date : LocalDate.now();
        return nextSeq(effective, instituteId, effective.getSeqScope().scopeKey(on));
    }

    /**
     * Highest position already issued in this window, ignoring the {@code startFrom} floor —
     * the settings UI needs this to warn when a floor is being set below issued numbers (where
     * it would be silently ignored).
     */
    public long highestIssuedSequence(InvoiceNumberConfig config, String instituteId, LocalDate date) {
        InvoiceNumberConfig effective = resolveUsableConfig(config);
        LocalDate on = date != null ? date : LocalDate.now();
        return invoiceRepository.highestSeqNo(instituteId, effective.getSeqScope().scopeKey(on));
    }

    /**
     * Validate a candidate format and render a few consecutive examples, for the settings
     * screen. Validation errors are returned rather than thrown so the UI can show all of
     * them at once next to the field.
     *
     * <p>Renders through the same {@link InvoiceNumberFormatter#render} that real generation
     * uses, so a preview can never disagree with what gets issued.
     */
    public InvoiceNumberingDTOs.PreviewResponse previewSamples(InvoiceNumberConfig candidate,
                                                               InvoiceNumberContext context,
                                                               int sampleCount) {
        var validation = InvoiceNumberFormatter.validate(candidate.getFormat(), candidate.getSeqPadding());
        long nextSequence = peekNextSequence(candidate, context.getInstituteId(), context.getDate());

        List<String> samples = new ArrayList<>();
        if (validation.isValid()) {
            for (int i = 0; i < Math.max(1, sampleCount); i++) {
                samples.add(InvoiceNumberFormatter.render(
                        candidate.getFormat(), candidate, context, nextSequence + i));
            }
        }

        long highestIssued = highestIssuedSequence(candidate, context.getInstituteId(), context.getDate());
        List<String> warnings = new ArrayList<>(validation.warnings());
        // A floor at or below what has already been issued does nothing — say so, rather than
        // letting the admin believe they changed the next number.
        if (candidate.getStartFrom() > 0 && candidate.getStartFrom() <= highestIssued) {
            warnings.add("This institute has already issued up to #" + highestIssued
                    + " in the current period, so a start number of " + candidate.getStartFrom()
                    + " is ignored — numbering continues from #" + nextSequence
                    + ". Numbers are never reused.");
        }

        return InvoiceNumberingDTOs.PreviewResponse.builder()
                .valid(validation.isValid())
                .samples(samples)
                .errors(validation.errors())
                .warnings(warnings)
                .nextSequence(nextSequence)
                .highestIssuedSequence(highestIssued)
                .maxLength(validation.maxLength())
                .build();
    }

    /**
     * The {@code invoice.seq_scope_key} this allocation counts within.
     *
     * <p>A context carrying a {@link InvoiceNumberContext#getSeqNamespace() seqNamespace}
     * gets {@code "<namespace>:<scopeKey>"}, which is simply a scope key no date can ever
     * produce — so that document kind counts on its own and leaves the institute's main
     * series untouched. Every read of the counter goes through here, so preview,
     * allocation and collision-retry all agree on which series they are in.
     */
    private String scopeKeyFor(InvoiceNumberConfig config, InvoiceNumberContext context) {
        LocalDate date = context.getDate() != null ? context.getDate() : LocalDate.now();
        String scopeKey = config.getSeqScope().scopeKey(date);
        String namespace = context.getSeqNamespace();
        return StringUtils.hasText(namespace) ? namespace + ":" + scopeKey : scopeKey;
    }

    /**
     * The series this document numbers from. When a configured series matches the learner,
     * returns its config and points the context at that series' own counter
     * ({@code SERIES_<key>} namespace, so it never touches the main counter); otherwise the
     * config unchanged. A context that already has a namespace (proformas) is left alone.
     * Never throws: a failed lookup keeps the main series rather than blocking the invoice.
     */
    static InvoiceNumberConfig selectSeries(InvoiceNumberConfig config, InvoiceNumberContext context) {
        if (config == null || context == null || config.getSeries() == null || config.getSeries().isEmpty()
                || StringUtils.hasText(context.getSeqNamespace()) || context.getLearnerFieldLookup() == null) {
            return config;
        }
        java.util.Map<String, String> valueByField = new java.util.HashMap<>();
        for (InvoiceNumberConfig.Series s : config.getSeries()) {
            String value;
            try {
                value = valueByField.computeIfAbsent(s.getLearnerFieldId(),
                        id -> java.util.Objects.toString(context.getLearnerFieldLookup().apply(id), ""));
            } catch (Exception e) {
                log.error("Could not read learner field {} for invoice series {} (institute {}); "
                                + "using the main series.", s.getLearnerFieldId(), s.getKey(),
                        context.getInstituteId(), e);
                return config;
            }
            if (s.matches(value)) {
                context.setSeqNamespace(SERIES_NAMESPACE_PREFIX + s.getKey());
                return config.forSeries(s);
            }
        }
        return config;
    }

    /** Counter namespace of a numbering series; distinct from the proforma one. */
    static final String SERIES_NAMESPACE_PREFIX = "SERIES_";

    /**
     * Guard against a stored format that no longer validates. The settings endpoint rejects
     * bad formats on save, but settings JSON can also be edited directly in the DB, and a
     * token could be retired in a future release — in either case issuing a legacy-shaped
     * number beats throwing inside a payment webhook.
     */
    private InvoiceNumberConfig resolveUsableConfig(InvoiceNumberConfig config) {
        if (config == null) {
            return InvoiceNumberConfig.legacyDefault();
        }
        var validation = InvoiceNumberFormatter.validate(config.getFormat(), config.getSeqPadding());
        if (validation.isValid()) {
            return config;
        }
        log.error("Invalid invoice number format \"{}\" in INVOICE_SETTING.numbering ({}). "
                        + "Falling back to the default format.",
                config.getFormat(), String.join("; ", validation.errors()));
        InvoiceNumberConfig fallback = InvoiceNumberConfig.legacyDefault();
        // Keep the admin's scope so the counter they have been using stays the one we read.
        fallback.setSeqScope(config.getSeqScope() != null
                ? config.getSeqScope() : fallback.getSeqScope());
        return fallback;
    }
}
