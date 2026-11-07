/**
 * Keeps the AI service's Python port of this collector (ai_service
 * app/services/site_strings.py, behind website(action='strings')) answering
 * exactly what the Translations panel does. Both sides are pinned to one
 * golden file: this test checks the TypeScript side against it, and
 * ai_service/tests/test_site_strings.py checks the Python side.
 *
 * A deliberate change to the collector or the key classifier: run this file
 * with UPDATE_SITE_STRINGS_GOLDEN=1, review the diff of the golden, and make
 * the same change in the Python port.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CatalogueConfig } from '../../-types/editor-types';
import { isTextKey, looksLikeData } from '../../-utils/catalogue-i18n';
import { collectSiteStrings } from './site-strings';
import goldenJson from '../__fixtures__/site-strings-golden.json';
import bvJson from '../__fixtures__/brahm-varchas-site.json';

/** Run from frontend-admin-dashboard/ (vitest's root) to rewrite the golden. */
const GOLDEN_PATH = 'src/routes/manage-pages/-components/__fixtures__/site-strings-golden.json';

type ClassifierCase = { key: string | number | null; text: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const golden = goldenJson as any;
const bv = bvJson as unknown as CatalogueConfig;

const outputs = () => {
    const synthetic = golden.synthetic.config as CatalogueConfig;
    return {
        synthetic: {
            visible: collectSiteStrings(synthetic),
            includeHidden: collectSiteStrings(synthetic, { includeHidden: true }),
        },
        brahmVarchas: {
            visible: collectSiteStrings(bv),
            includeHidden: collectSiteStrings(bv, { includeHidden: true }),
        },
        classifier: (golden.classifier as ClassifierCase[]).map(({ key, text }) => {
            const textKey = isTextKey(key ?? undefined);
            const dataLike = looksLikeData(text);
            return { textKey, dataLike, translatable: textKey && !dataLike };
        }),
    };
};

describe('site strings: Python port sync golden', () => {
    const actual = outputs();

    if (process.env.UPDATE_SITE_STRINGS_GOLDEN) {
        writeFileSync(resolve(process.cwd(), GOLDEN_PATH), JSON.stringify({ ...golden, expected: actual }, null, 2) + '\n');
    }

    it('collects the synthetic site exactly as the golden says', () => {
        expect(actual.synthetic).toEqual(golden.expected.synthetic);
    });

    it('collects the Brahm Varchas site exactly as the golden says', () => {
        expect(actual.brahmVarchas).toEqual(golden.expected.brahmVarchas);
    });

    it('classifies keys and values exactly as the golden says', () => {
        expect(actual.classifier).toEqual(golden.expected.classifier);
    });
});
