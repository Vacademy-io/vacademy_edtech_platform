package vacademy.io.admin_core_service.features.commerce.customer.service;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.commerce.customer.CommercePhones;
import vacademy.io.admin_core_service.features.commerce.customer.dto.CustomerDtos;
import vacademy.io.admin_core_service.features.commerce.customer.entity.CommerceCustomerAddress;
import vacademy.io.admin_core_service.features.commerce.customer.repository.CommerceCustomerAddressRepository;
import vacademy.io.admin_core_service.features.commerce.customer.repository.CommerceCustomerRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * The staff customer list and profile (WP-34). Read-only: nothing here writes a row. The caller
 * has passed the commerce access guard for the institute; every query is scoped to it, so another
 * institute's customer answers 404 exactly as a customer that does not exist. Customers are
 * shop-wide (not narrowed by the caller's locations). Nothing about a customer is logged.
 */
@Service
public class CommerceCustomerQueryService {

    public static final int MAX_PAGE_SIZE = 50;
    /** Search text longer than this is cut, as on the order list. */
    public static final int MAX_SEARCH = 64;

    private final CommerceCustomerRepository customerRepository;
    private final CommerceCustomerAddressRepository addressRepository;
    private final TransactionTemplate readOnly;

    public CommerceCustomerQueryService(CommerceCustomerRepository customerRepository,
                                        CommerceCustomerAddressRepository addressRepository,
                                        PlatformTransactionManager transactionManager) {
        this.customerRepository = customerRepository;
        this.addressRepository = addressRepository;
        this.readOnly = new TransactionTemplate(transactionManager);
        this.readOnly.setReadOnly(true);
    }

    /** What a search text becomes: an exact phone (or null) and a LIKE pattern on the name (or null). */
    public record Search(String phone, String namePattern) {
    }

    /**
     * {@code +91 98765 43210} matches the stored phone; any text also matches part of the name,
     * with {@code \}, {@code %} and {@code _} taken literally. Blank text = no filter.
     */
    public static Search search(String raw) {
        if (!StringUtils.hasText(raw)) {
            return new Search(null, null);
        }
        String text = raw.trim();
        if (text.length() > MAX_SEARCH) {
            text = text.substring(0, MAX_SEARCH);
        }
        String pattern = "%" + text.toLowerCase(Locale.ROOT).replace("\\", "\\\\").replace("%", "\\%")
                .replace("_", "\\_") + "%";
        return new Search(CommercePhones.normalise(text), pattern);
    }

    public CustomerDtos.CustomerPage list(String instituteId, String searchText, int page, int pageSize) {
        int size = Math.min(Math.max(pageSize, 1), MAX_PAGE_SIZE);
        int index = Math.max(page, 0);
        Search search = search(searchText);
        return readOnly.execute(tx -> {
            List<CustomerDtos.CustomerRow> rows = new ArrayList<>();
            List<CommerceCustomerRepository.StaffRow> found = customerRepository.staffSearch(instituteId,
                    search.phone(), search.namePattern(), size, (long) index * size);
            if (found != null) {
                for (CommerceCustomerRepository.StaffRow row : found) {
                    rows.add(row(row, false));
                }
            }
            long total = customerRepository.staffCount(instituteId, search.phone(), search.namePattern());
            return CustomerDtos.CustomerPage.builder().customers(rows).page(index).pageSize(size).total(total)
                    .build();
        });
    }

    public CustomerDtos.CustomerProfile profile(String instituteId, String customerId) {
        if (!StringUtils.hasText(customerId) || customerId.length() > 36) {
            throw notFound();
        }
        return readOnly.execute(tx -> {
            CommerceCustomerRepository.StaffRow row = customerRepository.findStaffRow(instituteId, customerId)
                    .orElseThrow(CommerceCustomerQueryService::notFound);
            List<CustomerDtos.AddressView> addresses = new ArrayList<>();
            List<CommerceCustomerAddress> book = addressRepository
                    .findByInstituteIdAndCustomerIdAndStatusOrderByIsDefaultDescCreatedAtDesc(instituteId, customerId,
                            CommerceCustomerAddress.STATUS_ACTIVE);
            if (book != null) {
                for (CommerceCustomerAddress a : book) {
                    addresses.add(CustomerDtos.AddressView.builder().id(a.getId()).label(a.getLabel())
                            .name(a.getName()).phone(a.getPhone()).line1(a.getLine1()).line2(a.getLine2())
                            .landmark(a.getLandmark()).city(a.getCity()).stateCode(a.getStateCode())
                            .pincode(a.getPincode()).isDefault(Boolean.TRUE.equals(a.getIsDefault())).build());
                }
            }
            return CustomerDtos.CustomerProfile.builder().customer(row(row, true)).addresses(addresses).build();
        });
    }

    private static CustomerDtos.CustomerRow row(CommerceCustomerRepository.StaffRow r, boolean profile) {
        CustomerDtos.CustomerRow.CustomerRowBuilder b = CustomerDtos.CustomerRow.builder()
                .id(r.getId())
                .name(r.getName())
                .phone(r.getPhone())
                .email(r.getEmail())
                .ordersCount(r.getOrdersCount() == null ? 0L : r.getOrdersCount())
                .totalSpent(r.getTotalSpent() == null ? java.math.BigDecimal.ZERO : r.getTotalSpent())
                .dues(r.getDues() == null ? java.math.BigDecimal.ZERO : r.getDues())
                .lastOrderAt(instant(r.getLastOrderAt()))
                .codRefusals(r.getCodRefusals() == null ? 0 : r.getCodRefusals())
                .marketingConsent(Boolean.TRUE.equals(r.getMarketingConsent()))
                .anonymised(r.getAnonymisedAt() != null)
                .createdAt(instant(r.getCreatedAt()));
        if (profile) {
            b.notes(r.getNotes()).consentAt(instant(r.getConsentAt())).consentSource(r.getConsentSource());
        }
        return b.build();
    }

    /** The JVM and the database are in UTC. */
    private static String instant(Date value) {
        return value == null ? null : value.toInstant().toString();
    }

    private static VacademyException notFound() {
        return new VacademyException(HttpStatus.NOT_FOUND, "CUSTOMER_NOT_FOUND: no such customer");
    }
}
