import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    DEFAULT_EXAM_INTERFACE_FORM,
    EXAM_INTERFACE_CUSTOM_KEY,
    EXAM_INTERFACE_OPTIONS,
    examInterfaceCustomLabel,
    examInterfaceFormFromWire,
    examInterfaceWireFromForm,
} from '@/types/assessments/exam-interface';

describe('examInterfaceFormFromWire', () => {
    it('treats null, absent and non-objects as the standard screen', () => {
        for (const wire of [null, undefined, 'jee-main', 42, []]) {
            expect(examInterfaceFormFromWire(wire)).toEqual(DEFAULT_EXAM_INTERFACE_FORM);
        }
    });

    it('treats preset "default" or a missing preset as the standard screen', () => {
        expect(examInterfaceFormFromWire({ v: 1, preset: 'default' }).choice).toBe('default');
        expect(examInterfaceFormFromWire({ v: 1, strict: true }).choice).toBe('default');
    });

    it('maps each known preset and layout to its option', () => {
        expect(
            examInterfaceFormFromWire({ v: 1, preset: 'jee-main', layout: 'nta-mock' }).choice
        ).toBe('jee-main-nta');
        expect(
            examInterfaceFormFromWire({ v: 1, preset: 'jee-main', layout: 'tcs-console' }).choice
        ).toBe('jee-main-tcs');
        expect(examInterfaceFormFromWire({ preset: 'jee-advanced' }).choice).toBe('jee-advanced');
        expect(examInterfaceFormFromWire({ preset: 'gate' }).choice).toBe('gate');
        expect(examInterfaceFormFromWire({ preset: 'rrb-je' }).choice).toBe('rrb-je');
    });

    it('reads jee-main with no layout as the NTA mock layout (the contract default)', () => {
        expect(examInterfaceFormFromWire({ preset: 'jee-main' }).choice).toBe('jee-main-nta');
    });

    it('defaults strict to true and honours an explicit false only', () => {
        expect(examInterfaceFormFromWire({ preset: 'gate' }).strict).toBe(true);
        expect(examInterfaceFormFromWire({ preset: 'gate', strict: null }).strict).toBe(true);
        expect(examInterfaceFormFromWire({ preset: 'gate', strict: false }).strict).toBe(false);
    });

    it('keeps a preset this build does not know as a custom choice', () => {
        const form = examInterfaceFormFromWire({ v: 1, preset: 'neet', strict: true });
        expect(form.choice).toBe(EXAM_INTERFACE_CUSTOM_KEY);
        expect(examInterfaceCustomLabel(form)).toBe('neet');
        const layoutForm = examInterfaceFormFromWire({ preset: 'jee-main', layout: 'paper' });
        expect(layoutForm.choice).toBe(EXAM_INTERFACE_CUSTOM_KEY);
        expect(examInterfaceCustomLabel(layoutForm)).toBe('jee-main / paper');
    });
});

describe('examInterfaceWireFromForm', () => {
    it('sends null for the standard screen, so the save clears a stored theme', () => {
        expect(examInterfaceWireFromForm(DEFAULT_EXAM_INTERFACE_FORM)).toBeNull();
        expect(examInterfaceWireFromForm(undefined)).toBeNull();
        expect(
            examInterfaceWireFromForm({
                choice: 'default',
                strict: true,
                stored: { v: 1, preset: 'gate', strict: true },
            })
        ).toBeNull();
    });

    it('writes the exact contract shape for each option', () => {
        const base = { strict: true, stored: null };
        expect(examInterfaceWireFromForm({ ...base, choice: 'jee-main-nta' })).toEqual({
            v: 1,
            preset: 'jee-main',
            layout: 'nta-mock',
            strict: true,
        });
        expect(examInterfaceWireFromForm({ ...base, choice: 'jee-main-tcs' })).toEqual({
            v: 1,
            preset: 'jee-main',
            layout: 'tcs-console',
            strict: true,
        });
        expect(examInterfaceWireFromForm({ choice: 'gate', strict: false, stored: null })).toEqual({
            v: 1,
            preset: 'gate',
            strict: false,
            tools: { calculator: true },
        });
        expect(examInterfaceWireFromForm({ ...base, choice: 'jee-advanced' })).toEqual({
            v: 1,
            preset: 'jee-advanced',
            strict: true,
        });
        expect(examInterfaceWireFromForm({ ...base, choice: 'rrb-je' })).toEqual({
            v: 1,
            preset: 'rrb-je',
            strict: true,
        });
    });

    it('keeps unknown stored keys and drops a layout the new preset does not have', () => {
        const form = examInterfaceFormFromWire({
            v: 1,
            preset: 'jee-main',
            layout: 'tcs-console',
            strict: true,
            options: { early_submit: 'allowed' },
        });
        expect(examInterfaceWireFromForm({ ...form, choice: 'gate', strict: false })).toEqual({
            v: 1,
            preset: 'gate',
            strict: false,
            options: { early_submit: 'allowed' },
            tools: { calculator: true },
        });
    });

    it('saves a custom preset back unchanged apart from the strict switch', () => {
        const form = examInterfaceFormFromWire({
            v: 2,
            preset: 'neet',
            layout: 'omr-like',
            strict: true,
            breaks: [{ minutes: 10 }],
        });
        expect(examInterfaceWireFromForm({ ...form, strict: false })).toEqual({
            v: 2,
            preset: 'neet',
            layout: 'omr-like',
            strict: false,
            breaks: [{ minutes: 10 }],
        });
    });

    it('sends null in OMR sheet mode whatever was picked', () => {
        expect(
            examInterfaceWireFromForm(
                { choice: 'jee-main-nta', strict: true, stored: null },
                { omrMode: true }
            )
        ).toBeNull();
    });

    it('round-trips every known option through the wire shape', () => {
        for (const choice of ['jee-main-nta', 'jee-main-tcs', 'jee-advanced', 'gate', 'rrb-je']) {
            const wire = examInterfaceWireFromForm({ choice, strict: false, stored: null });
            const back = examInterfaceFormFromWire(wire);
            expect(back.choice).toBe(choice);
            expect(back.strict).toBe(false);
        }
    });
});

describe('exam interface picker catalogue', () => {
    it('lists the options in picker order, standard first', () => {
        expect(EXAM_INTERFACE_OPTIONS.map((o) => o.key)).toEqual([
            'default',
            'jee-main-nta',
            'jee-main-tcs',
            'jee-advanced',
            'gate',
            'rrb-je',
        ]);
    });

    it('has every string the card uses in all four locales', () => {
        const dir = path.resolve(process.cwd(), 'public/locales');
        const keys = [
            'title',
            'description',
            'pickerLabel',
            'strict.label',
            'strict.description',
            'disclaimer',
            'omrDisabled',
            'previewHint',
            'options.custom',
            ...EXAM_INTERFACE_OPTIONS.map((o) => `options.${o.labelKey}`),
        ];
        for (const lang of ['en', 'hi', 'ar', 'fr']) {
            const catalog = JSON.parse(
                fs.readFileSync(path.join(dir, lang, 'assessmentStep1BasicInfo.json'), 'utf8')
            );
            for (const key of keys) {
                const value = key
                    .split('.')
                    .reduce<unknown>(
                        (node, part) => (node as Record<string, unknown> | undefined)?.[part],
                        catalog.examInterface
                    );
                expect(typeof value, `${lang} examInterface.${key}`).toBe('string');
            }
        }
    });
});

describe('GATE built-in calculator', () => {
    const gateForm = (calculator: boolean, stored: Record<string, unknown> | null = null) => ({
        choice: 'gate',
        strict: true,
        calculator,
        stored,
    });

    it('saves tools.calculator for GATE, on by default', () => {
        expect(examInterfaceWireFromForm(gateForm(true))).toEqual({
            v: 1,
            preset: 'gate',
            strict: true,
            tools: { calculator: true },
        });
        expect(examInterfaceWireFromForm(gateForm(false))?.tools).toEqual({ calculator: false });
    });

    it('keeps other stored tool keys', () => {
        const wire = examInterfaceWireFromForm(
            gateForm(false, { v: 1, preset: 'gate', tools: { scratch: 1 } })
        );
        expect(wire?.tools).toEqual({ scratch: 1, calculator: false });
    });

    it('does not add tools for presets without a built-in calculator', () => {
        const wire = examInterfaceWireFromForm({
            choice: 'jee-advanced',
            strict: true,
            calculator: true,
            stored: null,
        });
        expect(wire).not.toHaveProperty('tools');
    });

    it('loads calculator as on unless explicitly false', () => {
        expect(examInterfaceFormFromWire({ v: 1, preset: 'gate' }).calculator).toBe(true);
        expect(
            examInterfaceFormFromWire({ v: 1, preset: 'gate', tools: { calculator: false } })
                .calculator
        ).toBe(false);
        expect(examInterfaceFormFromWire(null).calculator).toBe(true);
    });
});
