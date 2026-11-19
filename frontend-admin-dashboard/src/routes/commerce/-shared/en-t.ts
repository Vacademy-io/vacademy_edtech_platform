import fs from 'node:fs';
import path from 'node:path';
import type { TFunction } from 'i18next';

/**
 * Tests only: a `t` that reads the real English (or Hindi) commerce strings and
 * fills their {{placeholders}}, so a test can assert what a person reads
 * ("2.5 m × ₹123.40 / m"). Unknown keys come back as the key.
 */
type Tree = { [key: string]: Tree | string };

const load = (lng: 'en' | 'hi'): Tree =>
    JSON.parse(
        fs.readFileSync(path.resolve(__dirname, '../../../../public/locales', lng, 'commerce.json'), 'utf8')
    ) as Tree;

export function localeT(lng: 'en' | 'hi' = 'en'): TFunction {
    const tree = load(lng);
    const lookup = (key: string): string | undefined => {
        let node: Tree | string | undefined = tree;
        for (const part of key.replace(/^commerce:/, '').split('.')) {
            if (!node || typeof node === 'string') return undefined;
            node = node[part];
        }
        return typeof node === 'string' ? node : undefined;
    };
    const t = (key: string, options: Record<string, unknown> = {}) => {
        const text = lookup(key);
        if (text === undefined) return key;
        return text.replace(/{{\s*(\w+)\s*}}/g, (_, name: string) => String(options[name] ?? ''));
    };
    return t as unknown as TFunction;
}
