package vacademy.io.admin_core_service.features.commerce.catalogue.importer;

import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.dto.ImportColumnResponse;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.dto.ImportJobResponse;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.dto.ImportValidationResponse;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.entity.CommerceImportJob;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.entity.CommerceImportJobFile;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ImportColumn;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ImportFileParser;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ImportLimits;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ImportRow;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ImportSheetWriter;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ParsedImportFile;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan.ImportIssue;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan.ImportPlan;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan.ImportPlanner;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan.ProductPlan;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.repository.CommerceImportJobFileRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.repository.CommerceImportJobRepository;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.ResourceNotFoundException;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Product import: validate, commit as a background job, job progress
 * and the error-rows file. Every method takes the institute id the access guard has already
 * checked; a job id is always looked up together with it.
 */
@Slf4j
@Service
public class CommerceImportService {

    static final int MAX_PAGE_SIZE = 50;
    /** Uploads kept for the error-rows download are removed after this many days. */
    static final int FILE_RETENTION_DAYS = 30;
    private static final List<String> ACTIVE = List.of(CommerceImportJob.QUEUED, CommerceImportJob.RUNNING);

    private final ImportFileParser parser;
    private final ImportReferenceLoader referenceLoader;
    private final ImportPlanner planner;
    private final CommerceImportJobRepository jobRepository;
    private final CommerceImportJobFileRepository fileRepository;
    private final CommerceAuditService auditService;
    private final CommerceImportJobRunner runner;
    private final TransactionTemplate transaction;

    public CommerceImportService(ImportFileParser parser,
                                 ImportReferenceLoader referenceLoader,
                                 ImportPlanner planner,
                                 CommerceImportJobRepository jobRepository,
                                 CommerceImportJobFileRepository fileRepository,
                                 CommerceAuditService auditService,
                                 CommerceImportJobRunner runner,
                                 PlatformTransactionManager transactionManager) {
        this.parser = parser;
        this.referenceLoader = referenceLoader;
        this.planner = planner;
        this.jobRepository = jobRepository;
        this.fileRepository = fileRepository;
        this.auditService = auditService;
        this.runner = runner;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    // ---------------------------------------------------------------- validate

    /** Checks every row and writes nothing. */
    public ImportValidationResponse validate(String instituteId, String fileName, byte[] content) {
        ParsedImportFile parsed = parser.parse(fileName, content);
        ImportPlan plan = planner.plan(parsed.rows(), referenceLoader.load(instituteId));

        List<ImportIssue> errors = new ArrayList<>();
        List<ImportIssue> warnings = new ArrayList<>();
        for (ImportIssue issue : plan.issues()) {
            (issue.isError() ? errors : warnings).add(issue);
        }
        List<ImportIssue> issues = new ArrayList<>(errors);
        issues.addAll(warnings);
        boolean truncated = issues.size() > ImportLimits.MAX_ISSUES;
        if (truncated) {
            issues = new ArrayList<>(issues.subList(0, ImportLimits.MAX_ISSUES));
        }
        return ImportValidationResponse.builder()
                .fileName(cleanFileName(fileName))
                .fileFormat(parsed.format())
                .rowsTotal(parsed.rows().size())
                .rowsSkipped(parsed.blankRows())
                .productsTotal(plan.products().size())
                .productsToCreate(plan.productsToCreate())
                .productsToUpdate(plan.productsToUpdate())
                .variantsToCreate(plan.variantsToCreate())
                .variantsToUpdate(plan.variantsToUpdate())
                .productsWithErrors((int) plan.products().stream().filter(ProductPlan::hasErrors).count())
                .rowsWithErrors(plan.blockedRows().size())
                .errorCount(errors.size())
                .warningCount(warnings.size())
                .issues(issues)
                .issuesTruncated(truncated)
                .build();
    }

    /** The rows a commit of this file would leave out, with a last column that says why. */
    public byte[] validationErrorRows(String instituteId, String fileName, byte[] content) {
        ParsedImportFile parsed = parser.parse(fileName, content);
        ImportPlan plan = planner.plan(parsed.rows(), referenceLoader.load(instituteId));
        return errorRows(parsed.rows(), plan.blockedRows(), plan.messagesByRow());
    }

    // ------------------------------------------------------------------ commit

    /**
     * Stores the file and queues the job; the rows are written by the worker. One import runs
     * per institute at a time, so two files cannot race on the same SKU.
     */
    public ImportJobResponse start(String instituteId, String actorUserId, String fileName, byte[] content) {
        ParsedImportFile parsed = parser.parse(fileName, content);
        if (parsed.rows().isEmpty()) {
            throw new InvalidRequestException("the file has no data rows");
        }
        requireNoActiveJob(instituteId);

        CommerceImportJob job;
        try {
            job = transaction.execute(status -> {
                fileRepository.purgeOlderThan(instituteId, LocalDateTime.now().minusDays(FILE_RETENTION_DAYS));

                CommerceImportJob created = new CommerceImportJob();
                created.setInstituteId(instituteId);
                created.setKind(CommerceImportJob.KIND_PRODUCTS);
                created.setStatus(CommerceImportJob.QUEUED);
                created.setFileName(cleanFileName(fileName));
                created.setFileFormat(parsed.format());
                created.setFileSha256(sha256(content));
                created.setFileSize(content.length);
                created.setRowsTotal(parsed.rows().size());
                created.setRowsDone(0);
                created.setRowsFailed(0);
                created.setProductsTotal(0);
                created.setProductsCreated(0);
                created.setProductsUpdated(0);
                created.setProductsFailed(0);
                created.setVariantsCreated(0);
                created.setVariantsUpdated(0);
                created.setImageUrlsQueued(0);
                created.setNextGroupIndex(0);
                created.setAttempt(0);
                created.setErrorCount(0);
                created.setCreatedByUserId(actorUserId);
                // Also the clock of a job no worker ever took: the sweep picks it up once this is old.
                created.setHeartbeatAt(LocalDateTime.now());
                created = jobRepository.saveAndFlush(created);

                CommerceImportJobFile file = new CommerceImportJobFile();
                file.setJobId(created.getId());
                file.setInstituteId(instituteId);
                file.setContent(content);
                fileRepository.save(file);

                Map<String, Object> detail = new LinkedHashMap<>();
                detail.put("file_name", created.getFileName());
                detail.put("file_sha256", created.getFileSha256());
                detail.put("rows", created.getRowsTotal());
                auditService.record(instituteId, actorUserId, "IMPORT_STARTED", "IMPORT_JOB", created.getId(),
                        CommerceImportJobProcessor.json(detail));
                return created;
            });
        } catch (DataIntegrityViolationException e) {
            // The unique index on the active job of an institute: another upload won the race.
            throw new ConflictException("An import is already running for this shop; wait for it to finish");
        }
        runner.dispatch(job.getId());
        return toResponse(job, true);
    }

    private void requireNoActiveJob(String instituteId) {
        jobRepository.findFirstByInstituteIdAndKindAndStatusIn(instituteId, CommerceImportJob.KIND_PRODUCTS, ACTIVE)
                .ifPresent(active -> {
                    throw new ConflictException("An import is already running for this shop (job "
                            + active.getId() + "); wait for it to finish");
                });
    }

    // -------------------------------------------------------------------- jobs

    public ImportJobResponse get(String instituteId, String jobId) {
        CommerceImportJob job = requireJob(instituteId, jobId);
        return toResponse(job, job.isActive() || fileRepository.existsByInstituteIdAndJobId(instituteId, jobId));
    }

    /** Newest first, without the issue lists. */
    public Page<ImportJobResponse> list(String instituteId, int page, int size) {
        if (page < 0) {
            throw new InvalidRequestException("page cannot be negative");
        }
        if (size < 1 || size > MAX_PAGE_SIZE) {
            throw new InvalidRequestException("size must be between 1 and " + MAX_PAGE_SIZE);
        }
        return jobRepository.findByInstituteIdAndKind(instituteId, CommerceImportJob.KIND_PRODUCTS,
                        PageRequest.of(page, size, Sort.by(Sort.Order.desc("createdAt"), Sort.Order.asc("id"))))
                .map(job -> {
                    ImportJobResponse response = toResponse(job, false);
                    response.setIssues(null);
                    response.setIssuesTruncated(null);
                    response.setCreatedPackageIds(null);
                    response.setErrorRowsAvailable(null);
                    return response;
                });
    }

    /** The rows the job did not write, with a last column that says why. */
    public byte[] jobErrorRows(String instituteId, String jobId) {
        CommerceImportJob job = requireJob(instituteId, jobId);
        if (job.isActive()) {
            throw new InvalidRequestException("the import is still running");
        }
        Set<Integer> failedRows = new HashSet<>(CommerceImportJobProcessor.readList(job.getFailedRowsJson(),
                new com.fasterxml.jackson.core.type.TypeReference<List<Integer>>() { }));
        if (failedRows.isEmpty()) {
            throw new InvalidRequestException("the import has no failed rows");
        }
        CommerceImportJobFile file = fileRepository.findByInstituteIdAndJobId(instituteId, jobId)
                .orElseThrow(() -> new InvalidRequestException(
                        "the uploaded file of this import is no longer stored; upload it again and validate"));
        ParsedImportFile parsed = parser.parse("import." + job.getFileFormat().toLowerCase(), file.getContent());
        return errorRows(parsed.rows(), failedRows,
                ImportPlan.messagesByRow(CommerceImportJobProcessor.readIssues(job.getIssuesJson())));
    }

    private CommerceImportJob requireJob(String instituteId, String jobId) {
        // Looked up by institute and id together, so a job of another institute is simply not found.
        return jobRepository.findByInstituteIdAndId(instituteId, jobId)
                .orElseThrow(() -> new ResourceNotFoundException("Import job not found"));
    }

    // ----------------------------------------------------------------- template

    public List<ImportColumnResponse> columns() {
        return Arrays.stream(ImportColumn.values()).map(column -> ImportColumnResponse.builder()
                .column(column.header())
                .level(column.level().name())
                .required(column.required())
                .description(column.description())
                .example(column.example())
                .build()).toList();
    }

    public byte[] template(String format) {
        boolean xlsx = "xlsx".equalsIgnoreCase(format);
        if (!xlsx && format != null && !"csv".equalsIgnoreCase(format)) {
            throw new InvalidRequestException("format must be csv or xlsx");
        }
        try (ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            if (xlsx) {
                ImportSheetWriter.writeTemplateXlsx(out);
            } else {
                ImportSheetWriter.writeTemplateCsv(out);
            }
            return out.toByteArray();
        } catch (IOException e) {
            throw new IllegalStateException("commerce import: the template could not be written", e);
        }
    }

    // ------------------------------------------------------------------ helpers

    private static byte[] errorRows(List<ImportRow> rows, Set<Integer> failedRows,
                                    Map<Integer, List<String>> messages) {
        try (ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            try (ImportSheetWriter writer = ImportSheetWriter.csvWithErrors(out)) {
                for (ImportRow row : rows) {
                    if (!failedRows.contains(row.rowNumber())) {
                        continue;
                    }
                    List<String> own = messages.get(row.rowNumber());
                    writer.writeRow(row, own == null || own.isEmpty()
                            ? "not imported: another row of this product has an error"
                            : String.join("; ", own));
                }
            }
            return out.toByteArray();
        } catch (IOException e) {
            throw new IllegalStateException("commerce import: the error rows could not be written", e);
        }
    }

    private static ImportJobResponse toResponse(CommerceImportJob job, boolean fileStored) {
        List<ImportIssue> issues = CommerceImportJobProcessor.readIssues(job.getIssuesJson());
        int failedRows = job.getRowsFailed() == null ? 0 : job.getRowsFailed();
        return ImportJobResponse.builder()
                .jobId(job.getId())
                .status(job.getStatus())
                .fileName(job.getFileName())
                .fileFormat(job.getFileFormat())
                .rowsTotal(job.getRowsTotal())
                .rowsDone(job.getRowsDone())
                .rowsFailed(job.getRowsFailed())
                .productsTotal(job.getProductsTotal())
                .productsCreated(job.getProductsCreated())
                .productsUpdated(job.getProductsUpdated())
                .productsFailed(job.getProductsFailed())
                .variantsCreated(job.getVariantsCreated())
                .variantsUpdated(job.getVariantsUpdated())
                .imageUrlsQueued(job.getImageUrlsQueued())
                .errorCount(job.getErrorCount())
                .issues(issues)
                .issuesTruncated(issues.size() >= ImportLimits.MAX_ISSUES)
                .createdPackageIds(CommerceImportJobProcessor.readList(job.getCreatedPackageIdsJson(),
                        new com.fasterxml.jackson.core.type.TypeReference<List<String>>() { }))
                .errorRowsAvailable(!job.isActive() && failedRows > 0 && fileStored)
                .failureMessage(job.getFailureMessage())
                .createdByUserId(job.getCreatedByUserId())
                .createdAt(job.getCreatedAt())
                .startedAt(job.getStartedAt())
                .finishedAt(job.getFinishedAt())
                .build();
    }

    /** The last path segment without control characters, at most 255 long. Never used as a path. */
    static String cleanFileName(String fileName) {
        if (fileName == null) {
            return null;
        }
        String name = fileName.replace('\\', '/');
        name = name.substring(name.lastIndexOf('/') + 1).replaceAll("\\p{Cntrl}", "").trim();
        if (name.length() > 255) {
            name = name.substring(name.length() - 255);
        }
        return name.isEmpty() ? null : name;
    }

    private static String sha256(byte[] content) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(content));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
