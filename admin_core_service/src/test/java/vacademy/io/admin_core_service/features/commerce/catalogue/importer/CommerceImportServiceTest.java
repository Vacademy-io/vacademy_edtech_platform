package vacademy.io.admin_core_service.features.commerce.catalogue.importer;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.transaction.PlatformTransactionManager;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.dto.ImportJobResponse;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.dto.ImportValidationResponse;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.entity.CommerceImportJob;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.entity.CommerceImportJobFile;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ImportColumn;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ImportFileParser;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ImportLimits;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ImportRow;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ParsedImportFile;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan.ImportPlanner;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.repository.CommerceImportJobFileRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.repository.CommerceImportJobRepository;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.ResourceNotFoundException;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static vacademy.io.admin_core_service.features.commerce.catalogue.importer.ImportTestSupport.INSTITUTE;
import static vacademy.io.admin_core_service.features.commerce.catalogue.importer.ImportTestSupport.SAMPLE_CSV;
import static vacademy.io.admin_core_service.features.commerce.catalogue.importer.ImportTestSupport.reference;
import static vacademy.io.admin_core_service.features.commerce.catalogue.importer.ImportTestSupport.utf8;

class CommerceImportServiceTest {

    private static final String WITH_ERRORS = String.join("\n",
            "handle,name_en,tax_class_code,sku,price,mrp",
            "kurta,Kurta,,K-1,100,",
            "saree,=Saree,nope,S-1,200,150",
            "saree,,,,,",
            "");

    private CommerceImportJobRepository jobRepository;
    private CommerceImportJobFileRepository fileRepository;
    private ImportReferenceLoader loader;
    private CommerceAuditService auditService;
    private CommerceImportJobRunner runner;
    private CommerceImportService service;

    @BeforeEach
    void setUp() {
        jobRepository = mock(CommerceImportJobRepository.class);
        fileRepository = mock(CommerceImportJobFileRepository.class);
        loader = mock(ImportReferenceLoader.class);
        auditService = mock(CommerceAuditService.class);
        runner = mock(CommerceImportJobRunner.class);
        service = new CommerceImportService(new ImportFileParser(), loader, new ImportPlanner(), jobRepository,
                fileRepository, auditService, runner, mock(PlatformTransactionManager.class));
        when(loader.load(INSTITUTE)).thenReturn(reference());
        when(jobRepository.findFirstByInstituteIdAndKindAndStatusIn(any(), any(), any())).thenReturn(Optional.empty());
        when(jobRepository.saveAndFlush(any())).thenAnswer(inv -> {
            CommerceImportJob job = inv.getArgument(0);
            job.setId("job-1");
            return job;
        });
    }

    // ---------------------------------------------------------------- validate

    @Test
    void validateCountsWhatACommitWouldDoAndWritesNothing() {
        ImportValidationResponse response = service.validate(INSTITUTE, "C:\\files\\products.csv", utf8(SAMPLE_CSV));

        assertEquals("products.csv", response.getFileName());
        assertEquals("CSV", response.getFileFormat());
        assertEquals(3, response.getRowsTotal());
        assertEquals(1, response.getRowsSkipped());
        assertEquals(2, response.getProductsTotal());
        assertEquals(2, response.getProductsToCreate());
        assertEquals(0, response.getProductsToUpdate());
        assertEquals(3, response.getVariantsToCreate());
        assertEquals(0, response.getProductsWithErrors());
        assertEquals(0, response.getErrorCount());
        assertTrue(response.getWarningCount() > 0);
        assertFalse(response.getIssuesTruncated());

        verifyNoInteractions(jobRepository, fileRepository, auditService, runner);
    }

    @Test
    void validateListsErrorsFirstAndCountsTheBlockedRows() {
        ImportValidationResponse response = service.validate(INSTITUTE, "p.csv", utf8(WITH_ERRORS));

        assertEquals(1, response.getProductsToCreate());
        assertEquals(1, response.getProductsWithErrors());
        assertEquals(2, response.getRowsWithErrors(), "both rows of the saree are held back");
        assertEquals(2, response.getErrorCount());
        assertEquals("ERROR", response.getIssues().get(0).getSeverity());
        assertEquals("ERROR", response.getIssues().get(1).getSeverity());
        assertEquals("WARNING", response.getIssues().get(response.getIssues().size() - 1).getSeverity());
        verifyNoInteractions(jobRepository, fileRepository, auditService, runner);
    }

    @Test
    void theIssueListIsCappedButTheCountIsExact() {
        StringBuilder csv = new StringBuilder("handle,name_en,sku,price\n");
        for (int i = 0; i < ImportLimits.MAX_ISSUES + 50; i++) {
            csv.append("p").append(i).append(",Name,S").append(i).append(",bad\n");
        }
        ImportValidationResponse response = service.validate(INSTITUTE, "p.csv", utf8(csv.toString()));

        assertEquals(ImportLimits.MAX_ISSUES + 50, response.getErrorCount());
        assertEquals(ImportLimits.MAX_ISSUES, response.getIssues().size());
        assertTrue(response.getIssuesTruncated());
    }

    @Test
    void theErrorRowsFileHoldsTheBlockedRowsWithTheirReasonAndIsFormulaSafe() {
        byte[] file = service.validationErrorRows(INSTITUTE, "p.csv", utf8(WITH_ERRORS));

        String text = new String(file, java.nio.charset.StandardCharsets.UTF_8);
        assertTrue(text.contains("'=Saree"), "a name that starts with = is guarded on the way out");
        ParsedImportFile back = new ImportFileParser().parse("errors.csv", file);
        assertEquals(2, back.rows().size(), "the kurta is fine and is left out");
        ImportRow saree = back.rows().get(0);
        assertEquals("saree", saree.get(ImportColumn.HANDLE));
        assertEquals("=Saree", saree.get(ImportColumn.NAME_EN));
        assertTrue(text.contains("tax_class_code: there is no tax class with the code nope"));
        assertTrue(text.contains("mrp: mrp cannot be below the price"));
        assertTrue(text.contains("not imported: another row of this product has an error"));
    }

    // ------------------------------------------------------------------ commit

    @Test
    void commitStoresTheJobTheFileAndAnAuditRowThenHandsTheJobToTheRunner() {
        ImportJobResponse response = service.start(INSTITUTE, "user-1", "products.csv", utf8(SAMPLE_CSV));

        assertEquals("job-1", response.getJobId());
        assertEquals("QUEUED", response.getStatus());
        assertEquals(3, response.getRowsTotal());
        assertEquals(0, response.getRowsDone());

        ArgumentCaptor<CommerceImportJob> job = ArgumentCaptor.forClass(CommerceImportJob.class);
        verify(jobRepository).saveAndFlush(job.capture());
        assertEquals(INSTITUTE, job.getValue().getInstituteId());
        assertEquals("PRODUCTS", job.getValue().getKind());
        assertEquals("user-1", job.getValue().getCreatedByUserId());
        assertEquals(64, job.getValue().getFileSha256().length());
        assertEquals(0, job.getValue().getAttempt());
        assertEquals(0, job.getValue().getNextGroupIndex());

        ArgumentCaptor<CommerceImportJobFile> file = ArgumentCaptor.forClass(CommerceImportJobFile.class);
        verify(fileRepository).save(file.capture());
        assertEquals("job-1", file.getValue().getJobId());
        assertEquals(INSTITUTE, file.getValue().getInstituteId());
        assertEquals(utf8(SAMPLE_CSV).length, file.getValue().getContent().length);

        InOrder order = inOrder(fileRepository, jobRepository, auditService, runner);
        order.verify(fileRepository).purgeOlderThan(eq(INSTITUTE), any());
        order.verify(jobRepository).saveAndFlush(any());
        order.verify(auditService).record(eq(INSTITUTE), eq("user-1"), eq("IMPORT_STARTED"), eq("IMPORT_JOB"),
                eq("job-1"), anyString());
        order.verify(runner).dispatch("job-1");
    }

    @Test
    void oneImportAtATimePerInstitute() {
        CommerceImportJob active = new CommerceImportJob();
        active.setId("job-0");
        when(jobRepository.findFirstByInstituteIdAndKindAndStatusIn(eq(INSTITUTE), eq("PRODUCTS"), any()))
                .thenReturn(Optional.of(active));

        ConflictException e = assertThrows(ConflictException.class,
                () -> service.start(INSTITUTE, "user-1", "products.csv", utf8(SAMPLE_CSV)));
        assertTrue(e.getMessage().contains("job-0"));
        verify(jobRepository, never()).saveAndFlush(any());
        verifyNoInteractions(runner, auditService);
    }

    @Test
    void aRaceOnTheActiveJobIndexIsAConflictAndNothingIsDispatched() {
        doThrow(new DataIntegrityViolationException("uq_commerce_import_job_active"))
                .when(jobRepository).saveAndFlush(any());

        assertThrows(ConflictException.class,
                () -> service.start(INSTITUTE, "user-1", "products.csv", utf8(SAMPLE_CSV)));
        verifyNoInteractions(runner);
    }

    @Test
    void aFileThatCannotBeReadOrHasNoRowsNeverBecomesAJob() {
        assertThrows(InvalidRequestException.class,
                () -> service.start(INSTITUTE, "user-1", "products.pdf", utf8("x")));
        assertThrows(InvalidRequestException.class,
                () -> service.start(INSTITUTE, "user-1", "products.csv", utf8("handle,sku\n")));
        assertThrows(InvalidRequestException.class,
                () -> service.start(INSTITUTE, "user-1", "big.csv", new byte[ImportLimits.MAX_FILE_BYTES + 1]));
        verify(jobRepository, never()).saveAndFlush(any());
        verifyNoInteractions(runner);
    }

    // -------------------------------------------------------------------- jobs

    @Test
    void aJobIsOnlyFoundInsideItsInstitute() {
        when(jobRepository.findByInstituteIdAndId("other-inst", "job-1")).thenReturn(Optional.empty());
        assertThrows(ResourceNotFoundException.class, () -> service.get("other-inst", "job-1"));
        assertThrows(ResourceNotFoundException.class, () -> service.jobErrorRows("other-inst", "job-1"));
    }

    @Test
    void aFinishedJobOffersItsErrorRowsWhileTheFileIsKept() {
        CommerceImportJob job = new CommerceImportJob();
        job.setId("job-1");
        job.setInstituteId(INSTITUTE);
        job.setStatus(CommerceImportJob.COMPLETED_WITH_ERRORS);
        job.setFileFormat("CSV");
        job.setRowsFailed(2);
        job.setErrorCount(1);
        job.setFailedRowsJson("[3,4]");
        job.setIssuesJson("[{\"row\":3,\"column\":\"sku\",\"severity\":\"ERROR\",\"code\":\"DUPLICATE_SKU\","
                + "\"message\":\"another variant in the shop already uses this sku\",\"handle\":\"saree\"}]");
        when(jobRepository.findByInstituteIdAndId(INSTITUTE, "job-1")).thenReturn(Optional.of(job));
        when(fileRepository.existsByInstituteIdAndJobId(INSTITUTE, "job-1")).thenReturn(true);
        CommerceImportJobFile file = new CommerceImportJobFile();
        file.setContent(utf8(WITH_ERRORS));
        when(fileRepository.findByInstituteIdAndJobId(INSTITUTE, "job-1")).thenReturn(Optional.of(file));

        ImportJobResponse response = service.get(INSTITUTE, "job-1");
        assertTrue(response.getErrorRowsAvailable());
        assertEquals(1, response.getIssues().size());
        assertEquals("DUPLICATE_SKU", response.getIssues().get(0).getCode());

        String text = new String(service.jobErrorRows(INSTITUTE, "job-1"), java.nio.charset.StandardCharsets.UTF_8);
        assertTrue(text.contains("sku: another variant in the shop already uses this sku"));
        assertEquals(2, new ImportFileParser().parse("e.csv", utf8(text)).rows().size());

        when(fileRepository.findByInstituteIdAndJobId(INSTITUTE, "job-1")).thenReturn(Optional.empty());
        when(fileRepository.existsByInstituteIdAndJobId(INSTITUTE, "job-1")).thenReturn(false);
        assertFalse(service.get(INSTITUTE, "job-1").getErrorRowsAvailable());
        assertThrows(InvalidRequestException.class, () -> service.jobErrorRows(INSTITUTE, "job-1"));
    }

    @Test
    void errorRowsOfARunningJobAreRefusedAndTheListIsCapped() {
        CommerceImportJob job = new CommerceImportJob();
        job.setStatus(CommerceImportJob.RUNNING);
        when(jobRepository.findByInstituteIdAndId(INSTITUTE, "job-1")).thenReturn(Optional.of(job));
        assertThrows(InvalidRequestException.class, () -> service.jobErrorRows(INSTITUTE, "job-1"));

        assertThrows(InvalidRequestException.class, () -> service.list(INSTITUTE, 0, CommerceImportService.MAX_PAGE_SIZE + 1));
        assertThrows(InvalidRequestException.class, () -> service.list(INSTITUTE, -1, 10));
    }

    // ------------------------------------------------------------------- other

    @Test
    void fileNamesAreReducedToTheirLastSegment() {
        assertEquals("products.csv", CommerceImportService.cleanFileName("../../etc/products.csv"));
        assertEquals("products.csv", CommerceImportService.cleanFileName("C:\\Users\\me\\products.csv"));
        assertEquals("ab.csv", CommerceImportService.cleanFileName("a\r\nb.csv"));
        assertNull(CommerceImportService.cleanFileName("  "));
        assertNull(CommerceImportService.cleanFileName(null));
        assertEquals(255, CommerceImportService.cleanFileName("x".repeat(300) + ".csv").length());
    }

    @Test
    void theTemplateComesInBothFormatsAndTheGuideListsEveryColumn() {
        assertEquals(ImportColumn.values().length, service.columns().size());
        assertEquals("handle", service.columns().get(0).getColumn());
        assertTrue(service.columns().get(0).getRequired());
        assertTrue(service.template("csv").length > 100);
        assertEquals('P', service.template("XLSX")[0]);
        assertThrows(InvalidRequestException.class, () -> service.template("pdf"));
    }
}
