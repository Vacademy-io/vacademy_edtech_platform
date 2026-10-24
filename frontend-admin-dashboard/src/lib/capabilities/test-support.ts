/**
 * Test-only helpers for the capability tests: the REAL catalogue the backend
 * serves, and feature resolvers for common plans. Not imported by app code.
 */
import fs from 'node:fs';
import path from 'node:path';
import { type CapabilityCatalog, normalizeCatalog } from './entitlement';

export const CATALOG_PATH = path.resolve(
    __dirname,
    '../../../../admin_core_service/src/main/resources/capabilities/catalog.json'
);

export function loadRealCatalog(): CapabilityCatalog {
    const catalog = normalizeCatalog(JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8')));
    if (!catalog) throw new Error(`catalog.json at ${CATALOG_PATH} did not normalize`);
    return catalog;
}

/** can() for a plan where only the listed modules (plus core) are on, all their features on. */
export function canForModules(catalog: CapabilityCatalog, onModules: string[]) {
    const on = new Set<string>();
    catalog.modules.forEach((m) => {
        if (m.core || onModules.includes(m.key)) m.features.forEach((f) => on.add(f.key));
    });
    return (featureKey: string) => on.has(featureKey);
}

/** can() with every feature on except the listed ones. */
export function canAllExcept(off: string[]) {
    return (featureKey: string) => !off.includes(featureKey);
}

/** The CRM-only preset from the spec (§12.3 `crm_suite`-like): no LMS/AI/ERP. */
export const CRM_ONLY_MODULES = [
    'crm',
    'communications',
    'automation',
    'website',
    'finance',
    'sub_orgs',
    'inventory',
];
