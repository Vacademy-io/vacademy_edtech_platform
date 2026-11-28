import { describe, expect, it } from 'vitest';
import { en } from './messages.en';
import { hi } from './messages.hi';
import { createTranslate, hasMessage, interpolate, localeLabel, messagesFor } from './index';

const placeholders = (text: string): string[] => (text.match(/\{\w+\}/g) || []).sort();

describe('message files', () => {
    it('Hindi carries every key of English, and nothing else', () => {
        expect(Object.keys(hi).sort()).toEqual(Object.keys(en).sort());
    });

    it('no Hindi message is empty or left in English', () => {
        const same = (Object.keys(en) as Array<keyof typeof en>).filter((key) => hi[key] === en[key]);
        // Only strings that are symbols and placeholders in both languages may be equal.
        expect(same).toEqual(['product.option.picked', 'gallery.counter']);
        for (const value of Object.values(hi)) expect(value.trim().length).toBeGreaterThan(0);
    });

    it('both languages use the same placeholders in every message', () => {
        for (const key of Object.keys(en) as Array<keyof typeof en>) {
            expect(placeholders(hi[key]), key).toEqual(placeholders(en[key]));
        }
    });

    it('Hindi is written in Devanagari and keeps numerals Latin', () => {
        const devanagari = Object.values(hi).filter((value) => /[ऀ-ॿ]/.test(value));
        expect(devanagari.length).toBeGreaterThan(Object.keys(hi).length - 5);
        for (const value of Object.values(hi)) expect(value).not.toMatch(/[०-९]/);
    });
});

describe('order links and update notice (WP-33)', () => {
    it('carries the new keys in both languages, Hindi as given', () => {
        expect(hi['order.linkOpening']).toBe('आपका ऑर्डर खुल रहा है…');
        expect(hi['order.linkExpired.title']).toBe('यह लिंक पुराना हो गया है');
        expect(hi['order.linkExpired.body']).toBe(
            'आपकी सुरक्षा के लिए ऑर्डर के लिंक कुछ समय बाद काम करना बंद कर देते हैं। अपने फ़ोन नंबर से अपना ऑर्डर देखें।'
        );
        expect(hi['checkout.updatesNotice']).toBe('ऑर्डर की जानकारी हम WhatsApp और ईमेल पर भेजते हैं।');
        expect(en['order.linkOpening']).toBe('Opening your order…');
        expect(en['order.linkExpired.title']).toBe('This link has expired');
        expect(en['order.linkExpired.body']).toBe(
            'For your safety, order links stop working after a while. Find your order with your phone number instead.'
        );
        expect(en['checkout.updatesNotice']).toBe('We send order updates on WhatsApp and email.');
    });
});

describe('translate', () => {
    it('fills placeholders and leaves unknown ones visible', () => {
        expect(interpolate('Only {count} left', { count: 2 })).toBe('Only 2 left');
        expect(interpolate('{a} and {b}', { a: 'x' })).toBe('x and {b}');
        expect(interpolate('plain')).toBe('plain');
    });

    it('speaks Hindi and English', () => {
        expect(createTranslate('hi')('product.addToCart')).toBe('कार्ट में डालें');
        expect(createTranslate('en')('product.addToCart')).toBe('Add to cart');
        expect(createTranslate('hi')('badge.ONLY_N_LEFT', { count: 2 })).toBe('केवल 2 बचे');
    });

    it('uses the singular for exactly one', () => {
        expect(createTranslate('en')('search.count', { count: 1 })).toBe('1 product');
        expect(createTranslate('en')('search.count', { count: 2 })).toBe('2 products');
        expect(createTranslate('en')('nav.cartCount', { count: 1 })).toBe('Cart, 1 item');
        expect(createTranslate('en')('card.colours', { count: 1 })).toBe('1 colour');
        // Hindi keeps its own wording and never borrows the English singular.
        expect(createTranslate('hi')('search.count', { count: 1 })).toBe('1 उत्पाद');
        expect(createTranslate('en')('badge.ONLY_N_LEFT', { count: 1 })).toBe('Only 1 left');
    });

    it('words stock states so they agree with a noun of either gender', () => {
        const t = createTranslate('hi');
        for (const key of ['badge.SOLD_OUT', 'product.stock.out', 'cart.unavailable.OUT_OF_STOCK'] as const) {
            expect(t(key)).toBe('स्टॉक में नहीं');
        }
        expect(t('product.origin', { place: 'महेश्वर' })).toBe('महेश्वर की बुनाई');
    });

    it('reads a regional code as its language and anything unknown as English', () => {
        expect(messagesFor('hi-IN')).toBe(hi);
        expect(messagesFor('fr')).toBe(en);
        expect(createTranslate('ta')('nav.cart')).toBe('Cart');
    });

    it('knows which keys exist (badges come from API codes)', () => {
        expect(hasMessage('badge.NEW')).toBe(true);
        expect(hasMessage('badge.SOMETHING_ELSE')).toBe(false);
        expect(hasMessage('toString')).toBe(false);
    });

    it('labels the language switch with text, never a flag', () => {
        expect(localeLabel('hi')).toBe('हिं');
        expect(localeLabel('en')).toBe('EN');
        expect(localeLabel('fr')).toBe('FR');
    });
});
