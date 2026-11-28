package vacademy.io.admin_core_service.features.commerce.catalogue.importer;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.PlatformTransactionManager;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductRequest;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductResponse;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.entity.CommerceImportJob;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.entity.CommerceImportJobFile;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ImportFileParser;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan.ImportIssue;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan.ImportPlanner;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan.ImportReferenceData;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan.ImportReferenceData.ProductInfo;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan.ImportReferenceData.VariantInfo;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan.ProductPlan;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.repository.CommerceImportImageQueueRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.repository.CommerceImportJobFileRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.repository.CommerceImportJobRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceProductMediaRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.service.CommerceProductMediaService;
import vacademy.io.admin_core_service.features.commerce.catalogue.service.CommerceProductService;
import vacademy.io.common.exceptions.ConflictException;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static vacademy.io.admin_core_service.features.commerce.catalogue.importer.ImportTestSupport.INSTITUTE;
import static vacademy.io.admin_core_service.features.commerce.catalogue.importer.ImportTestSupport.reference;
import static vacademy.io.admin_core_service.features.commerce.catalogue.importer.ImportTestSupport.utf8;

class CommerceImportJobProcessorTest {

    /** Three products: the second (a product row and a second row) has an unknown tax class. */
    private static final String THREE = String.join("\n",
            "handle,external_ref,name_en,tax_class_code,sku,price",
            "kurta,woo-1,Kurta,,K-1,100",
            "saree,woo-2,Saree,nope,S-1,200",
            "saree,,,,,",
            "dhoti,woo-3,Dhoti,,D-1,300",
            "");

    private CommerceImportJobRepository jobRepository;
    private CommerceImportJobFileRepository fileRepository;
    private ImportReferenceLoader loader;
    private CommerceImportProductWriter writer;
    private CommerceAuditService auditService;
    private CommerceImportJobProcessor processor;
    private CommerceImportJob job;
    /** The arguments of every saveProgress call, in order. */
    private final List<Object[]> saved = new ArrayList<>();

    @BeforeEach
    void setUp() {
        jobRepository = mock(CommerceImportJobRepository.class);
        fileRepository = mock(CommerceImportJobFileRepository.class);
        loader = mock(ImportReferenceLoader.class);
        writer = mock(CommerceImportProductWriter.class);
        auditService = mock(CommerceAuditService.class);
        processor = new CommerceImportJobProcessor(jobRepository, fileRepository, new ImportFileParser(), loader,
                new ImportPlanner(), writer, auditService);

        job = job();
        when(jobRepository.findById("job-1")).thenReturn(Optional.of(job));
        store(THREE);
        when(loader.load(INSTITUTE)).thenReturn(reference());
        when(jobRepository.saveTotals(anyString(), anyInt(), anyInt(), anyInt(), any())).thenReturn(1);
        stubProgress(jobRepository, saved, 1);
        when(jobRepository.finish(anyString(), anyInt(), anyString(), any(), any())).thenReturn(1);
        when(writer.write(eq(INSTITUTE), eq("user-1"), eq("job-1"), any())).thenAnswer(inv -> {
            ProductPlan plan = inv.getArgument(3);
            return new CommerceImportProductWriter.Result("pkg-" + plan.getHandle(), true, 0);
        });
    }

    @Test
    void oneBadProductDoesNotStopTheOthers() {
        processor.run("job-1");

        verify(jobRepository).saveTotals(eq("job-1"), eq(1), eq(4), eq(3), any());
        verify(writer, times(2)).write(any(), any(), any(), any());
        assertEquals(3, saved.size(), "progress is saved after every product");
        assertEquals(1, saved.get(0)[10], "next product index after the first");
        Object[] last = saved.get(2);
        assertEquals(2, last[2], "rows done");
        assertEquals(2, last[3], "rows failed: both rows of the saree");
        assertEquals(2, last[4], "products created");
        assertEquals(1, last[6], "products failed");
        assertEquals(3, last[10]);
        assertEquals(1, last[11], "errors");
        assertEquals("[3,4]", last[13]);
        assertEquals("[\"pkg-kurta\",\"pkg-dhoti\"]", last[14]);
        List<ImportIssue> issues = CommerceImportJobProcessor.readIssues((String) last[12]);
        assertTrue(issues.stream().anyMatch(i -> i.isError() && "UNKNOWN_TAX_CLASS".equals(i.getCode())
                && i.getRow() == 3 && "tax_class_code".equals(i.getColumn())));

        verify(jobRepository).finish(eq("job-1"), eq(1), eq(CommerceImportJob.COMPLETED_WITH_ERRORS), isNull(), any());
        verify(fileRepository, never()).deleteByJob(any());
        verify(auditService).record(eq(INSTITUTE), eq("user-1"), eq("IMPORT_FINISHED"), eq("IMPORT_JOB"),
                eq("job-1"), anyString());
    }

    @Test
    void aRefusedWriteIsRecordedWithItsReasonAndAnInternalErrorIsNotLeaked() {
        when(writer.write(any(), any(), any(), any()))
                .thenThrow(new ConflictException("Another variant already uses the sku K-1"))
                .thenThrow(new IllegalStateException("ERROR: relation \"payment_plan\" column secret"));

        processor.run("job-1");

        Object[] last = saved.get(2);
        assertEquals(0, last[2]);
        assertEquals(4, last[3]);
        assertEquals(3, last[6]);
        List<ImportIssue> issues = CommerceImportJobProcessor.readIssues((String) last[12]);
        ImportIssue refused = issues.stream().filter(i -> "WRITE_FAILED".equals(i.getCode()) && i.getRow() == 2)
                .findFirst().orElseThrow();
        assertEquals("Another variant already uses the sku K-1", refused.getMessage());
        ImportIssue internal = issues.stream().filter(i -> "WRITE_FAILED".equals(i.getCode()) && i.getRow() == 5)
                .findFirst().orElseThrow();
        assertFalse(internal.getMessage().contains("payment_plan"));
        assertEquals("[2,3,4,5]", last[13]);
        verify(jobRepository).finish(eq("job-1"), eq(1), eq(CommerceImportJob.COMPLETED_WITH_ERRORS), isNull(), any());
    }

    @Test
    void aCleanFileEndsCompletedAndItsUploadIsRemoved() {
        store("handle,name_en,sku,price\nkurta,Kurta,K-1,100\ndhoti,Dhoti,D-1,300\n");

        processor.run("job-1");

        verify(jobRepository).finish(eq("job-1"), eq(1), eq(CommerceImportJob.COMPLETED), isNull(), any());
        verify(fileRepository).deleteByJob("job-1");
        assertEquals(2, saved.get(1)[4]);
        assertEquals(2, saved.get(1)[7], "variants created");
        assertEquals(0, saved.get(1)[11]);
    }

    @Test
    void aResumedJobStartsAtTheSavedProductAndKeepsItsCounters() {
        job.setAttempt(2);
        job.setNextGroupIndex(1);
        job.setRowsDone(1);
        job.setProductsCreated(1);
        job.setCreatedPackageIdsJson("[\"pkg-kurta\"]");

        processor.run("job-1");

        verify(writer, times(1)).write(any(), any(), any(), any());
        assertEquals(2, saved.size(), "only the saree and the dhoti are handled");
        Object[] last = saved.get(1);
        assertEquals(2, last[1], "the attempt of this worker");
        assertEquals(2, last[2]);
        assertEquals(2, last[4]);
        assertEquals(1, last[6]);
        assertEquals("[\"pkg-kurta\",\"pkg-dhoti\"]", last[14]);
        verify(jobRepository).finish(eq("job-1"), eq(2), eq(CommerceImportJob.COMPLETED_WITH_ERRORS), isNull(), any());
    }

    @Test
    void aWorkerThatLostTheJobStopsAtItsNextProduct() {
        stubProgress(jobRepository, saved, 0);
        saved.clear();

        processor.run("job-1");

        verify(writer, times(1)).write(any(), any(), any(), any());
        assertEquals(1, saved.size());
        verify(jobRepository, never()).finish(any(), anyInt(), any(), any(), any());
        verifyNoInteractions(auditService);
    }

    @Test
    void aJobWhoseFileIsGoneFails() {
        when(fileRepository.findById("job-1")).thenReturn(Optional.empty());

        processor.run("job-1");

        verify(jobRepository).finish(eq("job-1"), eq(1), eq(CommerceImportJob.FAILED),
                eq("the uploaded file is no longer stored"), any());
        verifyNoInteractions(writer);
    }

    @Test
    void anUnexpectedStopLeavesTheJobForTheSweep() {
        when(loader.load(INSTITUTE)).thenThrow(new IllegalStateException("database is away"));

        processor.run("job-1");

        verify(jobRepository, never()).finish(any(), anyInt(), any(), any(), any());
        verifyNoInteractions(writer);
    }

    @Test
    void aJobThatIsNotRunningIsNotTouched() {
        job.setStatus(CommerceImportJob.COMPLETED);
        processor.run("job-1");
        processor.run("unknown");
        verifyNoInteractions(fileRepository, writer, auditService);
    }

    /** The acceptance line of WP-07: running the same file again updates and creates nothing. */
    @Test
    void theSameFileASecondTimeUpdatesByExternalRefAndCreatesNothing() {
        CommerceProductService productService = mock(CommerceProductService.class);
        CommerceImportProductWriter realWriter = new CommerceImportProductWriter(productService,
                mock(CommerceProductMediaService.class), mock(CommerceProductMediaRepository.class),
                mock(CommerceImportImageQueueRepository.class), mock(PlatformTransactionManager.class));
        processor = new CommerceImportJobProcessor(jobRepository, fileRepository, new ImportFileParser(), loader,
                new ImportPlanner(), realWriter, auditService);
        store("handle,external_ref,name_hi,sku,price\nkurta,woo-1,कुर्ता,K-1,100\ndhoti,woo-3,धोती,D-1,300\n");
        when(productService.save(eq(INSTITUTE), eq("user-1"), any())).thenAnswer(inv -> {
            ProductRequest request = inv.getArgument(2);
            return ProductResponse.builder().packageId("pkg-" + request.getSlug()).build();
        });

        processor.run("job-1");

        verify(productService, times(2)).save(eq(INSTITUTE), eq("user-1"), any());
        verify(productService, never()).update(any(), any(), any(), any());
        assertEquals(2, saved.get(1)[4], "created on the first run");

        // Second run: the institute now has what the first run wrote.
        ImportReferenceData after = reference()
                .addProduct(new ProductInfo("pkg-kurta", "kurta", "woo-1", null, "QUANTITY", "PCS", 1, "DRAFT", false))
                .addVariant(new VariantInfo("ps-k1", "pkg-kurta", "K-1", null, null, "TRACKED", "ACTIVE"))
                .addProduct(new ProductInfo("pkg-dhoti", "dhoti", "woo-3", null, "QUANTITY", "PCS", 1, "DRAFT", false))
                .addVariant(new VariantInfo("ps-d1", "pkg-dhoti", "D-1", null, null, "TRACKED", "ACTIVE"));
        when(loader.load(INSTITUTE)).thenReturn(after);
        when(productService.get(eq(INSTITUTE), anyString())).thenAnswer(inv ->
                ProductResponse.builder().packageId(inv.getArgument(1)).translations(List.of()).build());
        when(productService.update(eq(INSTITUTE), eq("user-1"), anyString(), any())).thenAnswer(inv ->
                ProductResponse.builder().packageId(inv.getArgument(2)).build());
        saved.clear();

        processor.run("job-1");

        verify(productService, times(2)).save(any(), any(), any());
        verify(productService).update(eq(INSTITUTE), eq("user-1"), eq("pkg-kurta"), any());
        verify(productService).update(eq(INSTITUTE), eq("user-1"), eq("pkg-dhoti"), any());
        Object[] last = saved.get(1);
        assertEquals(0, last[4], "nothing created on the second run");
        assertEquals(2, last[5], "both products updated");
        assertEquals(0, last[7], "no variant created");
        assertEquals(2, last[8], "both variants updated");
        assertEquals("[]", last[14]);
    }

    // ------------------------------------------------------------------ helpers

    private void store(String csv) {
        CommerceImportJobFile file = new CommerceImportJobFile();
        file.setJobId("job-1");
        file.setInstituteId(INSTITUTE);
        file.setContent(utf8(csv));
        when(fileRepository.findById("job-1")).thenReturn(Optional.of(file));
    }

    private static void stubProgress(CommerceImportJobRepository repository, List<Object[]> sink, int result) {
        when(repository.saveProgress(anyString(), anyInt(), anyInt(), anyInt(), anyInt(), anyInt(), anyInt(), anyInt(),
                anyInt(), anyInt(), anyInt(), anyInt(), any(), any(), any(), any())).thenAnswer(inv -> {
                    sink.add(inv.getArguments());
                    return result;
                });
    }

    private static CommerceImportJob job() {
        CommerceImportJob job = new CommerceImportJob();
        job.setId("job-1");
        job.setInstituteId(INSTITUTE);
        job.setKind(CommerceImportJob.KIND_PRODUCTS);
        job.setStatus(CommerceImportJob.RUNNING);
        job.setFileName("products.csv");
        job.setFileFormat("CSV");
        job.setAttempt(1);
        job.setNextGroupIndex(0);
        job.setCreatedByUserId("user-1");
        return job;
    }
}
