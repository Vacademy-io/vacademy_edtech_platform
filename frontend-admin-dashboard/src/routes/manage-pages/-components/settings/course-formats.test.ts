import { describe, expect, it } from 'vitest';
import {
    addFormat,
    carryLabelTranslations,
    moveFormat,
    newFormatIssue,
    orderedFormatIds,
    removeFormat,
    setFormatLabel,
    suggestFormatId,
} from './course-formats';

const FORMATS = {
    ebook: { label: 'E-books', levels: ['eBook'] },
    live: { label: 'Live sessions' },
    video: { label: 'Video', tags: ['recorded'] },
};

describe('course formats helpers', () => {
    it('lists the order first (case-insensitive), then the rest in authoring order', () => {
        expect(orderedFormatIds(FORMATS, ['Video'])).toEqual(['video', 'ebook', 'live']);
        expect(orderedFormatIds(FORMATS, undefined)).toEqual(['ebook', 'live', 'video']);
    });

    it('renames one format and keeps its levels and the other formats', () => {
        expect(setFormatLabel(FORMATS, 'ebook', 'Books')).toEqual({
            courseFormats: { ...FORMATS, ebook: { label: 'Books', levels: ['eBook'] } },
        });
    });

    it('moving writes only the order, keeping entries that name no format', () => {
        expect(moveFormat(FORMATS, ['live', 'gone'], 'ebook', -1)).toEqual({
            courseFormatOrder: ['ebook', 'live', 'video', 'gone'],
        });
        expect(moveFormat(FORMATS, undefined, 'ebook', -1)).toBeNull();
    });

    it('removing drops the format, and from the order only when listed', () => {
        expect(removeFormat(FORMATS, undefined, 'live')).toEqual({
            courseFormats: { ebook: FORMATS.ebook, video: FORMATS.video },
        });
        expect(removeFormat(FORMATS, ['live', 'ebook'], 'live').courseFormatOrder).toEqual([
            'ebook',
        ]);
    });

    it('adds last, to the order too when the site has one', () => {
        expect(addFormat(FORMATS, undefined, 'audio-book', ' Audio Book ')).toEqual({
            courseFormats: { ...FORMATS, 'audio-book': { label: 'Audio Book' } },
        });
        expect(addFormat(FORMATS, ['ebook'], 'pdf', 'PDF').courseFormatOrder).toEqual([
            'ebook',
            'pdf',
        ]);
    });

    it('adding an id that is already in the order (a stale entry) puts it last, once', () => {
        expect(
            addFormat(FORMATS, ['ebook', 'Podcast', 'live'], 'podcast', 'Podcast').courseFormatOrder
        ).toEqual(['ebook', 'live', 'podcast']);
    });

    it('a rename copies each language’s translation to the new name, keeping the old entry', () => {
        const i18n = {
            defaultLocale: 'en',
            strings: { hi: { 'E-books': 'ई-पुस्तकें' }, fr: { Video: 'Vidéo' } },
        };
        expect(carryLabelTranslations(i18n, 'E-books', ' E-Books ')).toEqual({
            defaultLocale: 'en',
            strings: {
                hi: { 'E-books': 'ई-पुस्तकें', 'E-Books': 'ई-पुस्तकें' },
                fr: { Video: 'Vidéo' },
            },
        });
        // Nothing to carry, or the new name already has its own translation.
        expect(carryLabelTranslations(i18n, 'Live sessions', 'Live')).toBeNull();
        expect(carryLabelTranslations(i18n, 'E-books', 'E-books')).toBeNull();
        expect(
            carryLabelTranslations({ strings: { hi: { A: 'क', B: 'ख' } } }, 'A', 'B')
        ).toBeNull();
        expect(carryLabelTranslations(undefined, 'E-books', 'Books')).toBeNull();
    });

    it('suggests an id from the name and checks it', () => {
        expect(suggestFormatId('Short film / Animation')).toBe('short-film-animation');
        expect(suggestFormatId('ऑडियो बुक')).toBe('');
        expect(newFormatIssue(FORMATS, '', 'ऑडियो बुक')).toBe('noId');
        expect(newFormatIssue(FORMATS, 'Live', 'Live')).toBe('badId');
        expect(newFormatIssue(FORMATS, 'live', 'Live')).toBe('taken');
        expect(newFormatIssue(FORMATS, 'pdf', '')).toBe('noName');
        expect(newFormatIssue(FORMATS, 'pdf', 'PDF')).toBeNull();
    });
});
