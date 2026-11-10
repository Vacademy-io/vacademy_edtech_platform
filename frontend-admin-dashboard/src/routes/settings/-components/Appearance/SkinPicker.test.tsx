// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import type { StudentUiType } from '@/types/theme-role-settings';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, vars?: Record<string, string>) =>
            vars ? `${key}(${Object.values(vars).join(',')})` : key,
        i18n: { language: 'en' },
    }),
}));

const { SkinPicker } = await import('./SkinPicker');
const { SKIN_MODELS, SKIN_ORDER, brandPalette } = await import('./skin-previews');

const ALL_SKINS: StudentUiType[] = [
    'default',
    'vibrant',
    'play',
    'cleanerPlay',
    'corporate',
    'fun',
];
const BRAND = '#2563eb'; // design-lint-ignore: test data

const copy = {
    greeting: 'g',
    greetingName: 'g, n',
    name: 'n',
    continueLabel: 'c',
    nextLabel: 'x',
    passed: 'p',
};

function Harness({ initial = 'default' as StudentUiType, onChange = vi.fn() }) {
    const [value, setValue] = useState<StudentUiType>(initial);
    return (
        <SkinPicker
            value={value}
            brandHex={BRAND}
            onChange={(next) => {
                onChange(next);
                setValue(next);
            }}
        />
    );
}

const radio = (skin: string) => screen.getByRole('radio', { name: `learnerUi.skin.${skin}` });
const panel = () => screen.getByRole('tabpanel');

describe('skin models', () => {
    afterEach(cleanup);

    it('has a model for every learner skin, listed once each', () => {
        expect(Object.keys(SKIN_MODELS).sort()).toEqual([...ALL_SKINS].sort());
        expect([...SKIN_ORDER].sort()).toEqual([...ALL_SKINS].sort());
    });

    it('draws every screen of every model', () => {
        const brand = brandPalette(BRAND);
        for (const skin of ALL_SKINS) {
            const Model = SKIN_MODELS[skin];
            for (const s of ['home', 'lesson', 'result'] as const) {
                const { container, unmount } = render(
                    <Model screen={s} brand={brand} copy={copy} />
                );
                expect(container.firstChild).toBeTruthy();
                unmount();
            }
        }
    });

    it('keeps Fun brand text readable on its tint, even for a light brand', () => {
        const light = brandPalette('#facc15'); // design-lint-ignore: test data
        expect(light.funSolid).not.toBe(light.solid);
        expect(brandPalette(BRAND).solid.toLowerCase()).toBe(BRAND);
    });
});

describe('SkinPicker', () => {
    afterEach(cleanup);

    it('lists every skin as a radio named by its label, in one named group', () => {
        render(<Harness />);
        const group = screen.getByRole('radiogroup', { name: 'learnerUi.skin.label' });
        expect(within(group).getAllByRole('radio')).toHaveLength(ALL_SKINS.length);
        for (const skin of ALL_SKINS) expect(radio(skin)).toBeTruthy();
        expect(radio('default').getAttribute('aria-checked')).toBe('true');
    });

    it('calls onChange with the clicked skin and marks it chosen', () => {
        const onChange = vi.fn();
        render(<Harness onChange={onChange} />);
        fireEvent.click(radio('fun'));
        expect(onChange).toHaveBeenCalledWith('fun');
        expect(radio('fun').getAttribute('aria-checked')).toBe('true');
        expect(radio('default').getAttribute('aria-checked')).toBe('false');
    });

    it('keeps only the chosen radio in the Tab order and moves with arrow keys', () => {
        const onChange = vi.fn();
        render(<Harness initial="play" onChange={onChange} />);
        expect(radio('play').tabIndex).toBe(0);
        expect(radio('default').tabIndex).toBe(-1);
        fireEvent.keyDown(radio('play'), { key: 'ArrowRight' });
        expect(onChange).toHaveBeenLastCalledWith('cleanerPlay');
        expect(document.activeElement).toBe(radio('cleanerPlay'));
        fireEvent.keyDown(radio('cleanerPlay'), { key: 'ArrowUp' });
        expect(onChange).toHaveBeenLastCalledWith('play');
        fireEvent.keyDown(radio('play'), { key: 'End' });
        expect(onChange).toHaveBeenLastCalledWith('fun');
        fireEvent.keyDown(radio('fun'), { key: 'ArrowDown' });
        expect(onChange).toHaveBeenLastCalledWith('default');
    });

    it('shows the chosen skin in the big preview, with its description', () => {
        render(<Harness initial="corporate" />);
        expect(
            screen.getByRole('heading', {
                name: 'learnerUi.skin.previewTitle(learnerUi.skin.corporate)',
            })
        ).toBeTruthy();
        expect(screen.getByText('learnerUi.skin.blurb.corporate')).toBeTruthy();
        expect(screen.queryByText('learnerUi.skin.funFallback')).toBeNull();
        fireEvent.click(radio('fun'));
        expect(
            screen.getByRole('heading', { name: 'learnerUi.skin.previewTitle(learnerUi.skin.fun)' })
        ).toBeTruthy();
        expect(screen.getByText('learnerUi.skin.blurb.fun')).toBeTruthy();
        // Fun says what older learner apps show instead.
        expect(screen.getByText('learnerUi.skin.funFallback')).toBeTruthy();
    });

    it('switches the big preview between Home, Lesson and Quiz result', () => {
        render(<Harness initial="fun" />);
        const tab = (s: string) => screen.getByRole('tab', { name: `learnerUi.skin.screens.${s}` });
        expect(tab('home').getAttribute('aria-selected')).toBe('true');
        expect(panel().getAttribute('aria-labelledby')).toBe(tab('home').id);
        const homePreview = panel().innerHTML;

        fireEvent.click(tab('result'));
        expect(tab('result').getAttribute('aria-selected')).toBe('true');
        expect(tab('home').getAttribute('aria-selected')).toBe('false');
        expect(panel().getAttribute('aria-labelledby')).toBe(tab('result').id);
        expect(panel().innerHTML).not.toBe(homePreview);

        fireEvent.keyDown(tab('result'), { key: 'ArrowLeft' });
        expect(tab('lesson').getAttribute('aria-selected')).toBe('true');
        expect(document.activeElement).toBe(tab('lesson'));
    });

    it('keeps the scale models out of the accessibility tree', () => {
        render(<Harness />);
        // The only radios' names are the labels: model text does not leak into them.
        expect(radio('play').textContent).toContain('learnerUi.skin.play');
        for (const frame of document.querySelectorAll('[aria-hidden="true"]')) {
            expect(frame.closest('[role="radio"], [role="tabpanel"]')).toBeTruthy();
        }
    });
});
