import { describe, expect, it } from 'vitest';
import { ownSectionBackground, styleBackgroundUpdate } from './section-background-sync';

/** Style → Background Color must show on blocks that also have their own colour (e.g. a page heading). */
describe('section background: Style picker and the block colour stay one', () => {
    const heading = {
        type: 'sectionHeading',
        props: { title: 'Meet the Founder', backgroundColor: '#FFFFFF' },
        style: { backgroundColor: '#fdf6ee', paddingTop: '0px' },
    };

    it('the picker shows the colour visitors see (the block one)', () => {
        expect(ownSectionBackground(heading)).toBe('#FFFFFF');
        expect(ownSectionBackground({ type: 'sectionHeading', props: {} })).toBeUndefined();
    });

    it('a pick moves the block colour too — even re-picking the old Style value', () => {
        const update = styleBackgroundUpdate(heading, { ...heading.style, backgroundColor: '#fdf6ee' });
        expect(update.style).toEqual({ backgroundColor: '#fdf6ee', paddingTop: '0px' });
        expect(update.props).toEqual({ title: 'Meet the Founder', backgroundColor: '#fdf6ee' });
    });

    it('a block without its own colour only gets the Style colour', () => {
        const update = styleBackgroundUpdate({ type: 'featureGrid', props: { features: [] } }, { backgroundColor: '#eeeeee' });
        expect(update).toEqual({ style: { backgroundColor: '#eeeeee' } });
    });

    it('blocks that paint another colour, or a see-through one, keep the old picker', () => {
        expect(ownSectionBackground({ type: 'statsHighlights', props: { backgroundColor: '#FDF6EE' } })).toBeUndefined();
        expect(ownSectionBackground({ type: 'testimonialSection', props: { backgroundColor: '#FDF6EE' } })).toBeUndefined();
        const layeredHero = { type: 'heroSection', props: { backgroundColor: 'transparent' }, style: { backgroundColor: '#0E1838' } };
        expect(ownSectionBackground(layeredHero)).toBeUndefined();
        expect(styleBackgroundUpdate(layeredHero, { backgroundColor: '#111111' })).toEqual({ style: { backgroundColor: '#111111' } });
    });

    it('a Button block keeps its fill: its own colour is the button, not the band', () => {
        const button = { type: 'buttonBlock', props: { backgroundColor: '#EE9755' }, style: {} };
        expect(ownSectionBackground(button)).toBeUndefined();
        expect(styleBackgroundUpdate(button, { backgroundColor: '#ffffff' })).toEqual({ style: { backgroundColor: '#ffffff' } });
    });
});
