package vacademy.io.admin_core_service.features.commerce.catalogue.importer;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.entity.CommerceImportJob;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.entity.CommerceImportJobFile;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ImportFileParser;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ImportLimits;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ImportRow;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ParsedImportFile;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan.ImportIssue;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan.ImportPlan;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan.ImportPlanner;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan.ImportReferenceData;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan.ProductPlan;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.repository.CommerceImportJobFileRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.repository.CommerceImportJobRepository;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.ResourceNotFoundException;
import vacademy.io.common.exceptions.VacademyException;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;

/**
 * Runs one claimed import job to its end, on the calling thread.
 *
 * <p>The file is planned again from the stored bytes, then each product from
 * next_group_index on is written in its own transaction and the progress is saved. A product
 * that fails, in the plan or in the write, is recorded with its rows and the job goes on.
 *
 * <p>Resuming is safe because the work is idempotent: a product that was written before the
 * worker stopped is found again by external_ref or handle and updated to the same values.
 * A worker writes progress only while the job still carries its attempt number, so a worker
 * that was replaced stops at its next product.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class CommerceImportJobProcessor {

    static final int MAX_CREATED_IDS = 200;
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final CommerceImportJobRepository jobRepository;
    private final CommerceImportJobFileRepository fileRepository;
    private final ImportFileParser parser;
    private final ImportReferenceLoader referenceLoader;
    private final ImportPlanner planner;
    private final CommerceImportProductWriter writer;
    private final CommerceAuditService auditService;

    /** The job must be RUNNING and claimed by the caller. Never throws. */
    public void run(String jobId) {
        CommerceImportJob job = jobRepository.findById(jobId).orElse(null);
        if (job == null || !CommerceImportJob.RUNNING.equals(job.getStatus())) {
            return;
        }
        int attempt = job.getAttempt();
        try {
            process(job, attempt);
        } catch (InvalidRequestException e) {
            // The file itself cannot be read; another attempt would fail the same way.
            log.warn("commerce import job {} failed: {}", jobId, e.getMessage());
            end(job, attempt, CommerceImportJob.FAILED, e.getMessage(), null);
        } catch (Exception e) {
            // Left RUNNING on purpose: the sweep takes it up again from the saved position.
            log.error("commerce import job {} stopped and will be retried: {}", jobId, e.getMessage(), e);
        }
    }

    private void process(CommerceImportJob job, int attempt) {
        String jobId = job.getId();
        String instituteId = job.getInstituteId();
        CommerceImportJobFile file = fileRepository.findById(jobId)
                .orElseThrow(() -> new InvalidRequestException("the uploaded file is no longer stored"));
        ParsedImportFile parsed = parser.parse("import." + job.getFileFormat().toLowerCase(), file.getContent());
        ImportReferenceData reference = referenceLoader.load(instituteId);
        ImportPlan plan = planner.plan(parsed.rows(), reference);
        List<ProductPlan> products = plan.products();

        if (jobRepository.saveTotals(jobId, attempt, plan.rowsTotal(), products.size(), LocalDateTime.now()) == 0) {
            log.info("commerce import job {} was taken over by another worker", jobId);
            return;
        }
        Progress progress = Progress.of(job);
        for (int i = progress.nextGroupIndex; i < products.size(); i++) {
            handle(job, products.get(i), progress);
            progress.nextGroupIndex = i + 1;
            if (save(jobId, attempt, progress) == 0) {
                log.info("commerce import job {} was taken over by another worker", jobId);
                return;
            }
        }
        end(job, attempt, progress.productsFailed > 0 ? CommerceImportJob.COMPLETED_WITH_ERRORS
                : CommerceImportJob.COMPLETED, null, progress);
    }

    private void handle(CommerceImportJob job, ProductPlan product, Progress progress) {
        int rows = product.getRows().size();
        if (product.hasErrors()) {
            progress.fail(product, null);
            return;
        }
        try {
            CommerceImportProductWriter.Result result = writer.write(job.getInstituteId(),
                    job.getCreatedByUserId(), job.getId(), product);
            progress.rowsDone += rows;
            if (result.created()) {
                progress.productsCreated++;
                if (progress.createdPackageIds.size() < MAX_CREATED_IDS) {
                    progress.createdPackageIds.add(result.packageId());
                }
            } else {
                progress.productsUpdated++;
            }
            progress.variantsCreated += product.getVariantsToCreate();
            progress.variantsUpdated += product.getVariantsToUpdate();
            progress.imageUrlsQueued += result.imageUrlsQueued();
            product.getIssues().forEach(progress::add);
        } catch (Exception e) {
            String message;
            if (isUserFacing(e)) {
                message = e.getMessage();
            } else {
                message = "the product could not be saved; nothing of it was written";
                log.warn("commerce import job {}: product on row {} could not be saved: {}", job.getId(),
                        product.firstRowNumber(), e.getMessage(), e);
            }
            progress.fail(product, new ImportIssue(product.firstRowNumber(), null, ImportIssue.ERROR,
                    "WRITE_FAILED", message, product.getHandle()));
        }
    }

    /** The refusals of the catalogue services carry a message written for the user. */
    private static boolean isUserFacing(Exception e) {
        return e.getMessage() != null && (e instanceof InvalidRequestException || e instanceof ConflictException
                || e instanceof ResourceNotFoundException || e instanceof ForbiddenException
                || e instanceof VacademyException);
    }

    private int save(String jobId, int attempt, Progress p) {
        return jobRepository.saveProgress(jobId, attempt, p.rowsDone, p.rowsFailed, p.productsCreated,
                p.productsUpdated, p.productsFailed, p.variantsCreated, p.variantsUpdated, p.imageUrlsQueued,
                p.nextGroupIndex, p.errorCount, json(p.issues), json(p.failedRows), json(p.createdPackageIds),
                LocalDateTime.now());
    }

    private void end(CommerceImportJob job, int attempt, String status, String failureMessage, Progress progress) {
        if (jobRepository.finish(job.getId(), attempt, status, failureMessage, LocalDateTime.now()) == 0) {
            return;
        }
        try {
            Map<String, Object> detail = new LinkedHashMap<>();
            detail.put("status", status);
            detail.put("file_name", job.getFileName());
            if (progress != null) {
                detail.put("rows_done", progress.rowsDone);
                detail.put("rows_failed", progress.rowsFailed);
                detail.put("products_created", progress.productsCreated);
                detail.put("products_updated", progress.productsUpdated);
                detail.put("products_failed", progress.productsFailed);
            }
            auditService.record(job.getInstituteId(), job.getCreatedByUserId(), "IMPORT_FINISHED", "IMPORT_JOB",
                    job.getId(), json(detail));
            if (progress != null && progress.productsFailed == 0) {
                // No error rows to offer, so the upload is not kept.
                fileRepository.deleteByJob(job.getId());
            }
        } catch (Exception e) {
            log.error("commerce import job {} ended as {} but its audit row or file clean-up failed: {}",
                    job.getId(), status, e.getMessage(), e);
        }
    }

    /** The counters of a job, starting from what an earlier worker saved. */
    static final class Progress {
        int rowsDone;
        int rowsFailed;
        int productsCreated;
        int productsUpdated;
        int productsFailed;
        int variantsCreated;
        int variantsUpdated;
        int imageUrlsQueued;
        int nextGroupIndex;
        int errorCount;
        List<ImportIssue> issues = new ArrayList<>();
        TreeSet<Integer> failedRows = new TreeSet<>();
        List<String> createdPackageIds = new ArrayList<>();

        static Progress of(CommerceImportJob job) {
            Progress p = new Progress();
            p.rowsDone = orZero(job.getRowsDone());
            p.rowsFailed = orZero(job.getRowsFailed());
            p.productsCreated = orZero(job.getProductsCreated());
            p.productsUpdated = orZero(job.getProductsUpdated());
            p.productsFailed = orZero(job.getProductsFailed());
            p.variantsCreated = orZero(job.getVariantsCreated());
            p.variantsUpdated = orZero(job.getVariantsUpdated());
            p.imageUrlsQueued = orZero(job.getImageUrlsQueued());
            p.nextGroupIndex = orZero(job.getNextGroupIndex());
            p.errorCount = orZero(job.getErrorCount());
            p.issues = new ArrayList<>(readIssues(job.getIssuesJson()));
            p.failedRows = new TreeSet<>(readList(job.getFailedRowsJson(), new TypeReference<List<Integer>>() { }));
            p.createdPackageIds = new ArrayList<>(
                    readList(job.getCreatedPackageIdsJson(), new TypeReference<List<String>>() { }));
            return p;
        }

        void fail(ProductPlan product, ImportIssue writeFailure) {
            productsFailed++;
            rowsFailed += product.getRows().size();
            for (ImportRow row : product.getRows()) {
                failedRows.add(row.rowNumber());
            }
            product.getIssues().forEach(this::add);
            if (writeFailure != null) {
                add(writeFailure);
            }
        }

        /** The count of errors is exact; the stored list stops at the cap. */
        void add(ImportIssue issue) {
            if (issue.isError()) {
                errorCount++;
            }
            if (issues.size() < ImportLimits.MAX_ISSUES) {
                issues.add(issue);
            }
        }

        private static int orZero(Integer value) {
            return value == null ? 0 : value;
        }
    }

    static List<ImportIssue> readIssues(String json) {
        return readList(json, new TypeReference<List<ImportIssue>>() { });
    }

    static <T> List<T> readList(String json, TypeReference<List<T>> type) {
        if (json == null || json.isBlank()) {
            return List.of();
        }
        try {
            return MAPPER.readValue(json, type);
        } catch (Exception e) {
            return List.of();
        }
    }

    static String json(Object value) {
        try {
            return MAPPER.writeValueAsString(value);
        } catch (Exception e) {
            throw new IllegalStateException("commerce import: value is not serialisable", e);
        }
    }
}
