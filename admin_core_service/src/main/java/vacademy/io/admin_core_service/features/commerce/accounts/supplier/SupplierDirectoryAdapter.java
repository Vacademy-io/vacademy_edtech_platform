package vacademy.io.admin_core_service.features.commerce.accounts.supplier;

import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.commerce.accounts.enums.SupplierStatus;
import vacademy.io.admin_core_service.features.commerce.accounts.repository.CommerceSupplierRepository;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockSupplierDirectory;

/** Goods receipts from a supplier name an ACTIVE supplier of the same institute. */
@Component
public class SupplierDirectoryAdapter implements StockSupplierDirectory {

    private final CommerceSupplierRepository supplierRepository;

    public SupplierDirectoryAdapter(CommerceSupplierRepository supplierRepository) {
        this.supplierRepository = supplierRepository;
    }

    @Override
    public boolean isSupplierOf(String instituteId, String supplierId) {
        return instituteId != null && supplierId != null && !supplierId.isBlank()
                && supplierRepository.existsByInstituteIdAndIdAndStatus(instituteId, supplierId.trim(),
                        SupplierStatus.ACTIVE.name());
    }
}
