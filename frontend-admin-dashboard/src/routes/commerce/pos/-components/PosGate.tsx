import type { ReactNode } from 'react';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { useCommerceAccess } from '@/lib/commerce/use-commerce-access';
import { CommerceGate } from '@/routes/commerce/-components/CommercePage';

/**
 * The till's gate (P1–P6). The till is full screen, without the admin frame;
 * a person the till refuses (module off or no counter role) gets the refusal
 * inside the admin frame instead, so the sidebar leads somewhere else rather
 * than leaving only the browser's Back button.
 */
export function PosGate({ children }: { children: ReactNode }) {
    const access = useCommerceAccess();
    const refused = access.isResolved && access.denialFor('commerce-pos') !== null;
    if (refused) {
        return (
            <LayoutContainer>
                <CommerceGate navId="commerce-pos">{children}</CommerceGate>
            </LayoutContainer>
        );
    }
    return <CommerceGate navId="commerce-pos">{children}</CommerceGate>;
}
