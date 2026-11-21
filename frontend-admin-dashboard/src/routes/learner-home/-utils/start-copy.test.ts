import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { LIMITS } from './publish-checks';
import { conversionCopy, templateCopy } from './start-copy';
import {
    buildTemplate,
    clipTemplateCopy,
    DEFAULT_TEMPLATE_COPY,
    STARTER_TEMPLATES,
} from './templates';
import { blockPayload } from './payload';

const LOCALES = ['en', 'hi', 'fr', 'ar'];

function translator(locale: string) {
    const file = path.resolve(__dirname, `../../../../public/locales/${locale}/learnerHome.json`);
    const json = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    return (key: string) => {
        const value = key
            .split('.')
            .reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], json);
        if (typeof value !== 'string') throw new Error(`${locale}: missing ${key}`);
        return value;
    };
}

describe('template sample text', () => {
    it.each(LOCALES)(
        '%s: every translated tile label and heading already fits the server limits',
        (locale) => {
            // Checked on the raw translations, so a long one is fixed at the source, not clipped.
            const t = translator(locale);
            for (const key of [
                'link.features.COURSES',
                'link.features.LIVE_CLASSES',
                'link.features.ASSESSMENTS',
                'link.features.DOUBTS',
                'link.features.HOMEWORK',
                'link.features.ATTENDANCE',
                'link.features.NOTEBOOK',
                'link.features.REPORTS',
                'shelf.sources.FREE',
                'link.features.STORE_MEMBERSHIPS',
                'link.features.REFERRAL',
            ]) {
                expect(t(key).length, `${locale} ${key}`).toBeLessThanOrEqual(
                    LIMITS.shortcuts.label
                );
            }
            expect(t('start.sample.ackLabel').length).toBeLessThanOrEqual(LIMITS.notice.ackLabel);
            expect(t('start.sample.open').length).toBeLessThanOrEqual(LIMITS.ctaLabel);
            expect(conversionCopy(t).importedLabel.length).toBeLessThanOrEqual(LIMITS.adminLabel);
        }
    );

    it.each(LOCALES)('%s: templates built in this language pass the save-time limits', (locale) => {
        const copy = templateCopy(translator(locale));
        for (const key of STARTER_TEMPLATES) {
            for (const block of buildTemplate(key, { copy, hasStoreSite: true }).blocks.map(
                blockPayload
            )) {
                if (block.type === 'SHORTCUTS') {
                    block.config.tiles.forEach((tile) =>
                        expect(tile.label.length).toBeLessThanOrEqual(LIMITS.shortcuts.label)
                    );
                }
                if (block.type === 'COURSE_SHELF') {
                    expect(block.config.title.length).toBeLessThanOrEqual(LIMITS.shelf.title);
                }
            }
        }
    });

    it('clips over-long sample text to the limits', () => {
        const long = clipTemplateCopy({
            ...DEFAULT_TEMPLATE_COPY,
            tiles: {
                ...DEFAULT_TEMPLATE_COPY.tiles,
                memberships: 'Boutique d’abonnements premium',
            },
            welcomeNotice: {
                title: 'x'.repeat(90),
                body: 'y'.repeat(700),
                ackLabel: 'z'.repeat(50),
            },
        });
        expect(long.tiles.memberships.length).toBeLessThanOrEqual(20);
        expect(long.welcomeNotice.title).toHaveLength(80);
        expect(long.welcomeNotice.body).toHaveLength(600);
        expect(long.welcomeNotice.ackLabel).toHaveLength(40);
    });
});
