import {
    ArrowUUpLeft,
    BellRinging,
    Browser,
    Buildings,
    CashRegister,
    CreditCard,
    FileText,
    type IconProps,
    MapPin,
    Percent,
    Printer,
    Truck,
    UsersThree,
} from '@phosphor-icons/react';
import { COMMERCE_FEATURE, type CommerceFeatureKey } from '@/lib/commerce/commerce-access';

/**
 * The Commerce Settings cards. A card with a `to` opens a page
 * that has a backend today; a card without one is designed but its endpoints are
 * not built, and is drawn as "coming soon" so nobody clicks into a dead screen.
 * Titles and descriptions live in the `commerce` strings under `settings.cards`.
 */
export interface SettingsCard {
    id: string;
    icon: React.FC<IconProps>;
    /** Route of the card's page; undefined = coming soon. */
    to?: string;
    /**
     * Features the page's endpoints check (ANY). The card is shown as not
     * available, with the reason, when the institute has none of them.
     */
    anyFeature?: readonly CommerceFeatureKey[];
}

export const SETTINGS_CARDS: readonly SettingsCard[] = [
    {
        id: 'business',
        icon: Buildings,
        to: '/commerce/settings/business',
        anyFeature: [COMMERCE_FEATURE.TAX_REPORTS],
    },
    {
        id: 'taxClasses',
        icon: Percent,
        to: '/commerce/settings/tax-classes',
        anyFeature: [COMMERCE_FEATURE.TAX_REPORTS],
    },
    {
        id: 'locations',
        icon: MapPin,
        to: '/commerce/settings/locations',
        anyFeature: [COMMERCE_FEATURE.STOCK],
    },
    {
        id: 'staff',
        icon: UsersThree,
        to: '/commerce/settings/staff',
        anyFeature: [COMMERCE_FEATURE.STOCK, COMMERCE_FEATURE.POS],
    },
    // Settings routes accept any commerce feature, so no anyFeature here.
    { id: 'notifications', icon: BellRinging, to: '/commerce/settings/notifications' },
    { id: 'registers', icon: CashRegister },
    { id: 'shipping', icon: Truck },
    { id: 'payments', icon: CreditCard },
    { id: 'documents', icon: FileText },
    { id: 'returns', icon: ArrowUUpLeft },
    { id: 'labels', icon: Printer },
    { id: 'storefront', icon: Browser },
];
