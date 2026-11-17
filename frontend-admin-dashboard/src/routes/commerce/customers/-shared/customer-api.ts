import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { instituteParams } from '@/routes/commerce/-shared/commerce-api';
import { COMMERCE_CUSTOMER_BY_ID, COMMERCE_CUSTOMERS } from '@/routes/commerce/-shared/commerce-urls';
import { customerListParams, normalizeCustomerPage, normalizeCustomerProfile } from './customer-logic';
import type { CustomerListFilters, CustomerPage, CustomerProfile } from './customer-types';

/** Customers read API (backend B2): store manager, accountant, institute ADMIN. */

export async function fetchCustomers(filters: CustomerListFilters = {}): Promise<CustomerPage> {
    const params = customerListParams(filters);
    const res = await authenticatedAxiosInstance.get<unknown>(COMMERCE_CUSTOMERS, {
        params: { ...instituteParams(), ...params },
    });
    return normalizeCustomerPage(res.data, Number(params.pageSize));
}

export async function fetchCustomer(customerId: string): Promise<CustomerProfile> {
    const res = await authenticatedAxiosInstance.get<unknown>(COMMERCE_CUSTOMER_BY_ID(customerId), {
        params: instituteParams(),
    });
    return normalizeCustomerProfile(res.data);
}
