import fs from 'node:fs';
import path from 'node:path';
import type { TFunction } from 'i18next';

/**
 * Tests only: a `t` that reads the real English (or Hindi) commerce strings and
 * fills their {{placeholders}}, so a test can assert what a person reads
 * ("2.5 m × ₹123.40 / m"); a `count` picks `key_one` / `key_other` as i18next
 * does. Unknown keys come back as the key.
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
    const plural = new Intl.PluralRules(lng);
    const t = (key: string, options: Record<string, unknown> = {}) => {
        // i18next plurals: `key_one` / `key_other` when a count is given, else the key itself.
        const count = typeof options.count === 'number' ? options.count : null;
        const text = (count !== null ? lookup(`${key}_${plural.select(count)}`) : undefined) ?? lookup(key);
        if (text === undefined) return key;
        return text.replace(/{{\s*(\w+)\s*}}/g, (_, name: string) => String(options[name] ?? ''));
    };
    return t as unknown as TFunction;
}
