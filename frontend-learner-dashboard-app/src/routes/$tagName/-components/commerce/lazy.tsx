/**
 * The only commerce code outside the commerce chunk, part 1: lazy handles for the two places
 * that draw shop UI inside existing components (a `commerce*` section in JsonRenderer, the
 * buttons in the site header). Depends on React and config.ts only, so importing it adds a few
 * hundred bytes and nothing else to the components that use it. A site without a shop never
 * triggers the import of the chunk, so the course pages' bundle does not grow.
 */
import React, { Suspense, lazy } from 'react';
import { isCommerceEnabled } from './config';

const entry = () => import('./entry');

const LazyCommerceSection = lazy(() => entry().then((m) => ({ default: m.CommerceSection })));
const LazyCommerceHeaderSlot = lazy(() => entry().then((m) => ({ default: m.CommerceHeaderSlot })));

interface SiteProps {
    instituteId: string;
    tagName: string;
    globalSettings: unknown;
}

/** True for a section type the commerce chunk renders ("commerceProductRail"…). */
export const isCommerceSectionType = (type: unknown): type is string =>
    typeof type === 'string' && /^commerce[A-Z]/.test(type);

/** A `commerce*` section of an authored page. Renders nothing on a site without a shop. */
export const CommerceSectionSlot: React.FC<SiteProps & { type: string; props: Record<string, unknown> }> = (props) => {
    if (!isCommerceEnabled(props.globalSettings)) return null;
    return (
        // The section's place is held while the shop's code loads, so the page below does not
        // jump: a strip is short, a rail or a grid of tiles is a card tall.
        <Suspense fallback={<div className={props.type === 'commerceTrustStrip' ? 'min-h-24' : 'min-h-72'} aria-hidden="true" />}>
            <LazyCommerceSection {...props} />
        </Suspense>
    );
};

/** The shop's buttons in the site header. Renders nothing on a site without a shop. */
export const CommerceHeaderSlot: React.FC<SiteProps & { showLanguage?: boolean; className?: string }> = (props) => {
    if (!props.instituteId || !isCommerceEnabled(props.globalSettings)) return null;
    return (
        // Two 44 px buttons' worth of room, so the header does not shift when they arrive.
        <Suspense fallback={<span className="inline-block h-11 w-24" aria-hidden="true" />}>
            <LazyCommerceHeaderSlot {...props} />
        </Suspense>
    );
};
