package vacademy.io.admin_core_service.features.commerce.accounts.supplier;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.accounts.repository.CommerceSupplierRepository;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class SupplierDirectoryAdapterTest {

    private final CommerceSupplierRepository suppliers = mock(CommerceSupplierRepository.class);
    private final SupplierDirectoryAdapter directory = new SupplierDirectoryAdapter(suppliers);

    @Test
    void activeSupplierOfTheInstituteOnly() {
        when(suppliers.existsByInstituteIdAndIdAndStatus("inst-1", "sup-active", "ACTIVE")).thenReturn(true);
        when(suppliers.existsByInstituteIdAndIdAndStatus("inst-1", "sup-inactive", "ACTIVE")).thenReturn(false);
        when(suppliers.existsByInstituteIdAndIdAndStatus("inst-2", "sup-active", "ACTIVE")).thenReturn(false);
        assertTrue(directory.isSupplierOf("inst-1", "sup-active"));
        assertFalse(directory.isSupplierOf("inst-1", "sup-inactive"));
        assertFalse(directory.isSupplierOf("inst-2", "sup-active"));
    }

    @Test
    void blankIdIsNoSupplierAndAsksNothing() {
        assertFalse(directory.isSupplierOf("inst-1", null));
        assertFalse(directory.isSupplierOf("inst-1", " "));
        assertFalse(directory.isSupplierOf(null, "sup-active"));
        verify(suppliers, never()).existsByInstituteIdAndIdAndStatus(any(), any(), any());
    }
}
