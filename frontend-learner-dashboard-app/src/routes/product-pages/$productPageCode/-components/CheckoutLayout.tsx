import { useProductPageStore } from '../-stores/product-page-store';
import { StepRailBar } from './StepRailBar';
import { OrderSummaryPanel } from './OrderSummaryPanel';
import { HeaderBlock, NewHeaderBlock, FooterBlock, NewFooterBlock } from './PageRenderer';
import type { ProductPageData, PageJson, ProductPageSettings } from '../-types/product-page-types';

interface CheckoutLayoutProps {
    pageData: ProductPageData;
    pageJson: PageJson;
    settings: ProductPageSettings;
    primaryColor: string;
    children: React.ReactNode;
}

/**
 * Shell for every checkout step: step rail on top, step content on the left,
 * and a live order summary that stays put on the right as the visitor moves
 * from cart to details to payment. Individual steps must not render their own
 * summary — the panel here is the single place the running total is shown.
 *
 * The cart step is the one exception, and only for the ITEM LIST: there the
 * courses are the content of the wide column, editable at a readable size, so
 * the rail drops to totals alone rather than showing a second, smaller copy of
 * the same cart beside it.
 */
export const CheckoutLayout = ({
    pageData,
    pageJson,
    settings,
    primaryColor,
    children,
}: CheckoutLayoutProps) => {
    const step = useProductPageStore((s) => s.step);
    const summaryVariant = step === 'CART' ? 'totals' : 'full';
    const summaryLast = step === 'CART';

    const comps = pageJson.components.filter((c) => c.enabled);

    const headerComps = comps.filter((c) => c.type === 'Header' || c.type === 'header');
    const footerComp = comps.find((c) => c.type === 'Footer' || c.type === 'footer');

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Render designed header only if explicitly added to the page */}
            {headerComps.length > 0 && headerComps.map((c) =>
                c.type === 'Header'
                    ? <HeaderBlock key={c.id} props={c.props} primaryColor={primaryColor} pageName={pageData.name} />
                    : <NewHeaderBlock key={c.id} props={c.props} primaryColor={primaryColor} pageName={pageData.name} />
            )}

            <StepRailBar primaryColor={primaryColor} />

            {/* Step content + live order summary */}
            <div className="mx-auto max-w-screen-xl px-4 py-6 lg:flex lg:items-start lg:gap-6">
                {/* pb-28 clears MobileCheckoutBar, which is fixed to the bottom
                    of small screens on the cart step only. */}
                <div className={`min-w-0 flex-1${summaryLast ? ' pb-28 lg:pb-0' : ''}`}>
                    {/* Mobile: on the form and payment steps the summary leads, so
                        the total is visible before the visitor scrolls through a
                        long form to find it. On the cart step it follows instead —
                        the cart IS the content there, and the sticky bar already
                        carries the total, so leading with a second copy of it just
                        pushes the courses off the first screen. */}
                    {!summaryLast && (
                        <OrderSummaryPanel
                            pageData={pageData}
                            settings={settings}
                            variant={summaryVariant}
                            className="mb-5 lg:hidden"
                        />
                    )}
                    {/* No overflow-hidden: it clipped the phone field's country
                        dropdown at the card's bottom edge. Steps whose content
                        touches the edge round their own corners instead. */}
                    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
                        {children}
                    </div>
                    {summaryLast && (
                        <OrderSummaryPanel
                            pageData={pageData}
                            settings={settings}
                            variant={summaryVariant}
                            className="mt-5 lg:hidden"
                        />
                    )}
                </div>

                <aside className="hidden lg:block lg:w-80 lg:shrink-0" aria-label="Order summary">
                    <OrderSummaryPanel
                        pageData={pageData}
                        settings={settings}
                        variant={summaryVariant}
                        sticky
                    />
                </aside>
            </div>

            {/* Full designed footer */}
            {footerComp && (
                footerComp.type === 'Footer'
                    ? <FooterBlock props={footerComp.props} />
                    : <NewFooterBlock props={footerComp.props} />
            )}
        </div>
    );
};
