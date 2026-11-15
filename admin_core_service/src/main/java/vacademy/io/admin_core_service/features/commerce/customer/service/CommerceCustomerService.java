package vacademy.io.admin_core_service.features.commerce.customer.service;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.commerce.customer.CommercePhones;
import vacademy.io.admin_core_service.features.commerce.customer.entity.CommerceCustomer;
import vacademy.io.admin_core_service.features.commerce.customer.entity.CommerceCustomerAddress;
import vacademy.io.admin_core_service.features.commerce.customer.repository.CommerceCustomerAddressRepository;
import vacademy.io.admin_core_service.features.commerce.customer.repository.CommerceCustomerRepository;
import vacademy.io.admin_core_service.features.commerce.order.pincode.PincodeStates;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.util.Date;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

/**
 * The shop's customers and their address books. A customer is
 * found by phone inside one institute. Nothing here talks to another service, so every method
 * may run inside the order transaction.
 */
@Service
@RequiredArgsConstructor
public class CommerceCustomerService {

    /** Addresses one customer may keep. */
    public static final int MAX_ADDRESSES = 10;

    private final CommerceCustomerRepository customerRepository;
    private final CommerceCustomerAddressRepository addressRepository;

    /** What an address needs; the caller has trimmed and capped the texts. */
    public record AddressInput(String label, String name, String phone, String line1, String line2, String landmark,
                               String city, String stateCode, String pincode, boolean makeDefault) {
    }

    // Not read-only: a read-only transaction goes to the replica, which may not have a customer
    // that a checkout created a moment ago.
    @Transactional
    public Optional<CommerceCustomer> findByPhone(String instituteId, String phone) {
        if (instituteId == null || phone == null) {
            return Optional.empty();
        }
        return customerRepository.findByInstituteIdAndPhone(instituteId, phone);
    }

    /**
     * The customer of a phone, created when the shop has not seen the phone before. A known
     * customer keeps its name, e-mail and user; only what was missing is filled in.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public CommerceCustomer upsert(String instituteId, String userId, String phone, String name, String email) {
        if (instituteId == null || phone == null) {
            throw new InvalidRequestException("a customer needs an institute and a phone");
        }
        customerRepository.upsert(UUID.randomUUID().toString(), instituteId, userId, phone, name, email);
        return customerRepository.findByInstituteIdAndPhone(instituteId, phone)
                .orElseThrow(() -> new IllegalStateException("customer row missing after upsert"));
    }

    /**
     * The customer of a phone for a shopper who has not proved the phone. An existing row is
     * returned as it is and nothing on it changes; a phone the shop has not seen gets a row
     * with the phone alone: no account, no name, no e-mail. Those are filled by the first
     * checkout that proves the phone ({@link #upsert}).
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public CommerceCustomer findOrCreateUnverified(String instituteId, String phone) {
        if (instituteId == null || phone == null) {
            throw new InvalidRequestException("a customer needs an institute and a phone");
        }
        customerRepository.insertIfAbsent(UUID.randomUUID().toString(), instituteId, phone);
        return customerRepository.findByInstituteIdAndPhone(instituteId, phone)
                .orElseThrow(() -> new IllegalStateException("customer row missing after insert"));
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void recordConsent(CommerceCustomer customer, String source) {
        if (Boolean.TRUE.equals(customer.getMarketingConsent())) {
            return;
        }
        customer.setMarketingConsent(true);
        customer.setConsentAt(new Date());
        customer.setConsentSource(source);
        customerRepository.save(customer);
    }

    /**
     * The buyer's own choice from the account page: true records consent with time and source,
     * false withdraws it (and keeps when it was withdrawn).
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void setConsent(CommerceCustomer customer, boolean consent, String source) {
        if (consent) {
            recordConsent(customer, source);
            return;
        }
        if (!Boolean.TRUE.equals(customer.getMarketingConsent()) && customer.getConsentAt() != null) {
            return;
        }
        customer.setMarketingConsent(false);
        customer.setConsentAt(new Date());
        customer.setConsentSource(source);
        customerRepository.save(customer);
    }

    @Transactional
    public List<CommerceCustomerAddress> addresses(String instituteId, String customerId) {
        return addressRepository.findByInstituteIdAndCustomerIdAndStatusOrderByIsDefaultDescCreatedAtDesc(
                instituteId, customerId, CommerceCustomerAddress.STATUS_ACTIVE);
    }

    /**
     * Keeps an address in the book unless the same one is there already or the book is full
     * (then nothing is kept and no error is raised: the order is what matters).
     *
     * @return the stored or matching address, or null when the book is full
     */
    @Transactional
    public CommerceCustomerAddress remember(String instituteId, String customerId, AddressInput input) {
        List<CommerceCustomerAddress> existing = addresses(instituteId, customerId);
        for (CommerceCustomerAddress address : existing) {
            if (same(address, input)) {
                return address;
            }
        }
        if (existing.size() >= MAX_ADDRESSES) {
            return null;
        }
        return insert(instituteId, customerId, input, existing.isEmpty() || input.makeDefault());
    }

    /** Adds an address from the buyer's account. */
    @Transactional
    public CommerceCustomerAddress add(String instituteId, String customerId, AddressInput input) {
        requireValid(input);
        long count = addressRepository.countByInstituteIdAndCustomerIdAndStatus(instituteId, customerId,
                CommerceCustomerAddress.STATUS_ACTIVE);
        if (count >= MAX_ADDRESSES) {
            throw new InvalidRequestException("An address book holds at most " + MAX_ADDRESSES + " addresses");
        }
        return insert(instituteId, customerId, input, count == 0 || input.makeDefault());
    }

    @Transactional
    public CommerceCustomerAddress update(String instituteId, String customerId, String addressId,
                                          AddressInput input) {
        requireValid(input);
        CommerceCustomerAddress address = own(instituteId, customerId, addressId);
        if (input.makeDefault() && !Boolean.TRUE.equals(address.getIsDefault())) {
            addressRepository.clearDefault(instituteId, customerId);
            address.setIsDefault(true);
        }
        fill(address, input);
        return addressRepository.save(address);
    }

    /** Hides an address. Orders placed with it keep their own copy. */
    @Transactional
    public void delete(String instituteId, String customerId, String addressId) {
        CommerceCustomerAddress address = own(instituteId, customerId, addressId);
        address.setStatus(CommerceCustomerAddress.STATUS_DELETED);
        address.setIsDefault(false);
        addressRepository.save(address);
    }

    private CommerceCustomerAddress own(String instituteId, String customerId, String addressId) {
        return addressRepository.findByIdAndInstituteIdAndCustomerId(addressId, instituteId, customerId)
                .filter(a -> CommerceCustomerAddress.STATUS_ACTIVE.equals(a.getStatus()))
                .orElseThrow(() -> new InvalidRequestException("Address not found"));
    }

    private CommerceCustomerAddress insert(String instituteId, String customerId, AddressInput input,
                                           boolean makeDefault) {
        if (makeDefault) {
            addressRepository.clearDefault(instituteId, customerId);
        }
        CommerceCustomerAddress address = new CommerceCustomerAddress();
        address.setInstituteId(instituteId);
        address.setCustomerId(customerId);
        address.setIsDefault(makeDefault);
        address.setStatus(CommerceCustomerAddress.STATUS_ACTIVE);
        fill(address, input);
        return addressRepository.save(address);
    }

    private static void fill(CommerceCustomerAddress address, AddressInput input) {
        address.setLabel(input.label());
        address.setName(input.name());
        address.setPhone(input.phone());
        address.setLine1(input.line1());
        address.setLine2(input.line2());
        address.setLandmark(input.landmark());
        address.setCity(input.city());
        address.setStateCode(input.stateCode());
        address.setPincode(input.pincode());
    }

    private static boolean same(CommerceCustomerAddress address, AddressInput input) {
        return Objects.equals(address.getPincode(), input.pincode())
                && equalsIgnoreCase(address.getLine1(), input.line1())
                && equalsIgnoreCase(address.getLine2(), input.line2())
                && equalsIgnoreCase(address.getName(), input.name());
    }

    private static boolean equalsIgnoreCase(String a, String b) {
        return a == null ? b == null : a.equalsIgnoreCase(b);
    }

    private static void requireValid(AddressInput input) {
        if (input == null || input.line1() == null || input.line1().isBlank()) {
            throw new InvalidRequestException("An address needs its first line");
        }
        if (input.pincode() == null || !input.pincode().matches("[1-9][0-9]{5}")) {
            throw new InvalidRequestException("A pincode has six digits");
        }
        if (input.stateCode() != null && !PincodeStates.isStateCode(input.stateCode())) {
            throw new InvalidRequestException("state_code is not a GST state code");
        }
        if (input.phone() != null && CommercePhones.normalise(input.phone()) == null) {
            throw new InvalidRequestException("The phone number of the address is not valid");
        }
    }
}
