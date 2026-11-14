import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SitePaletteCard } from './SitePaletteCard';
import { CourseFormatsCard } from './CourseFormatsCard';
import brahmVarchasSite from '../brahm-varchas-site.fixture.json';

/**
 * Global Settings cards for a site with its own palette, content width and
 * course formats (Brahm Varchas). Every edit changes one key and keeps the
 * rest; nothing is written on render.
 */

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (k: string, o?: Record<string, unknown>) => (o ? `${k} ${JSON.stringify(o)}` : k),
    }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- fixture JSON
type Json = Record<string, any>;
const GS = (brahmVarchasSite as unknown as { globalSettings: Json }).globalSettings;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const NEW_COLOUR = '#123456'; // design-lint-ignore: fixture colour

/** The visible hex input of the ColorPickerField labelled `label`. */
const colourInput = (label: string) =>
    screen.getByText(label).parentElement!.querySelector('input')!;

describe('SitePaletteCard', () => {
    it('shows one plain-labelled colour per palette key and writes nothing on render', () => {
        const onThemeChange = vi.fn();
        render(<SitePaletteCard theme={clone(GS.theme)} onThemeChange={onThemeChange} />);
        expect(screen.getByText('global.palette.keys.text')).toBeInTheDocument();
        expect(screen.getByText('global.palette.keys.outline')).toBeInTheDocument();
        expect(colourInput('global.palette.keys.cream')).toHaveValue(GS.theme.palette.cream);
        expect(screen.getByLabelText('global.palette.contentWidth')).toHaveValue('1152');
        expect(onThemeChange).not.toHaveBeenCalled();
    });

    it('a palette edit keeps the other palette keys and the rest of the theme', () => {
        const theme = clone(GS.theme);
        const onThemeChange = vi.fn();
        render(<SitePaletteCard theme={theme} onThemeChange={onThemeChange} />);
        fireEvent.change(colourInput('global.palette.keys.sand'), {
            target: { value: NEW_COLOUR },
        });
        expect(onThemeChange).toHaveBeenCalledWith({
            ...theme,
            palette: { ...theme.palette, sand: NEW_COLOUR },
        });
    });

    it('the brand colour updates palette.primary and theme.primaryColor together', () => {
        const theme = clone(GS.theme);
        const onThemeChange = vi.fn();
        render(<SitePaletteCard theme={theme} onThemeChange={onThemeChange} />);
        fireEvent.change(colourInput('global.palette.keys.primary'), {
            target: { value: NEW_COLOUR },
        });
        expect(onThemeChange).toHaveBeenCalledWith({
            ...theme,
            primaryColor: NEW_COLOUR,
            palette: { ...theme.palette, primary: NEW_COLOUR },
        });
    });

    it('content width: writes a width in range, ignores one outside 320–2400, clears to the default', () => {
        const theme = clone(GS.theme);
        const onThemeChange = vi.fn();
        render(<SitePaletteCard theme={theme} onThemeChange={onThemeChange} />);
        const width = screen.getByLabelText('global.palette.contentWidth');

        fireEvent.change(width, { target: { value: '5000' } });
        fireEvent.blur(width);
        expect(onThemeChange).not.toHaveBeenCalled();

        fireEvent.change(width, { target: { value: '1280' } });
        fireEvent.blur(width);
        expect(onThemeChange).toHaveBeenLastCalledWith({ ...theme, contentMaxWidth: 1280 });

        fireEvent.change(width, { target: { value: '' } });
        fireEvent.blur(width);
        const withoutWidth = { ...theme };
        delete withoutWidth.contentMaxWidth;
        expect(onThemeChange).toHaveBeenLastCalledWith(withoutWidth);
    });

    it('content width stored as text reads like the learner, and a bad entry is not saved', () => {
        const theme = { ...clone(GS.theme), contentMaxWidth: '1152' };
        const onThemeChange = vi.fn();
        render(<SitePaletteCard theme={theme} onThemeChange={onThemeChange} />);
        const width = screen.getByLabelText('global.palette.contentWidth');
        expect(width).toHaveValue('1152');
        fireEvent.blur(width);
        fireEvent.change(width, { target: { value: '-' } });
        fireEvent.blur(width);
        expect(onThemeChange).not.toHaveBeenCalled();
    });

    it('a width that cannot be saved says so and is marked invalid; "1100px" is saved as 1100', () => {
        const theme = clone(GS.theme);
        const onThemeChange = vi.fn();
        render(<SitePaletteCard theme={theme} onThemeChange={onThemeChange} />);
        const width = screen.getByLabelText('global.palette.contentWidth');

        fireEvent.change(width, { target: { value: '5000' } });
        expect(width).toHaveAttribute('aria-invalid', 'true');
        fireEvent.blur(width);
        expect(screen.getByRole('alert')).toHaveTextContent('global.palette.contentWidthNotSaved');
        expect(onThemeChange).not.toHaveBeenCalled();

        fireEvent.change(width, { target: { value: '1100px' } });
        expect(width).not.toHaveAttribute('aria-invalid');
        fireEvent.blur(width);
        expect(onThemeChange).toHaveBeenLastCalledWith({ ...theme, contentMaxWidth: 1100 });
        expect(width).toHaveValue('1100');
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('a theme with a width but no palette shows only the width', () => {
        const onThemeChange = vi.fn();
        render(
            <SitePaletteCard theme={{ contentMaxWidth: 1152.4 }} onThemeChange={onThemeChange} />
        );
        expect(screen.getByLabelText('global.palette.contentWidth')).toHaveValue('1152');
        expect(screen.queryByText('global.palette.heading')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('global.palette.applyToTokens')).not.toBeInTheDocument();
    });

    it('"Use these colours everywhere" toggles palette.applyToTokens only', () => {
        const theme = clone(GS.theme);
        const onThemeChange = vi.fn();
        render(<SitePaletteCard theme={theme} onThemeChange={onThemeChange} />);
        fireEvent.click(screen.getByLabelText('global.palette.applyToTokens'));
        expect(onThemeChange).toHaveBeenCalledWith({
            ...theme,
            palette: { ...theme.palette, applyToTokens: false },
        });
    });
});

describe('CourseFormatsCard', () => {
    const formats = () => clone(GS.courseFormats) as Json;
    const order = () => clone(GS.courseFormatOrder) as string[];

    it('lists the formats in order with their tag, and writes nothing on render', () => {
        const onChange = vi.fn();
        render(<CourseFormatsCard formats={formats()} order={order()} onChange={onChange} />);
        const labels = screen.getAllByLabelText('global.courseFormats.name').slice(0, -1);
        expect(labels.map((i) => (i as HTMLInputElement).value)).toEqual(
            order().map((id) => GS.courseFormats[id].label)
        );
        expect(screen.getByText('format-ebook')).toBeInTheDocument();
        expect(onChange).not.toHaveBeenCalled();
    });

    it('renaming keeps the levels and every other format, and leaves the order alone', () => {
        const onChange = vi.fn();
        render(<CourseFormatsCard formats={formats()} order={order()} onChange={onChange} />);
        fireEvent.change(screen.getByDisplayValue('E-books'), { target: { value: 'Books' } });
        expect(onChange).toHaveBeenCalledWith({
            courseFormats: { ...formats(), ebook: { label: 'Books', levels: ['eBook'] } },
        });
    });

    it('renaming carries the Hindi translation to the new name when the field is left', () => {
        const i18n = { ...clone(GS.i18n), strings: { hi: { 'E-books': 'ई-पुस्तकें' } } };
        const onChange = vi.fn();
        const { rerender } = render(
            <CourseFormatsCard
                formats={formats()}
                order={order()}
                onChange={onChange}
                i18n={i18n}
            />
        );
        expect(screen.getByText('global.courseFormats.renameHint')).toBeInTheDocument();
        const name = screen.getByDisplayValue('E-books');
        fireEvent.focus(name);
        fireEvent.change(name, { target: { value: 'E-Books' } });
        const renamed = onChange.mock.calls[0][0].courseFormats;
        rerender(
            <CourseFormatsCard formats={renamed} order={order()} onChange={onChange} i18n={i18n} />
        );
        fireEvent.blur(name);
        expect(onChange).toHaveBeenLastCalledWith({
            i18n: {
                ...i18n,
                strings: { hi: { 'E-books': 'ई-पुस्तकें', 'E-Books': 'ई-पुस्तकें' } },
            },
        });
    });

    it('editing in Hindi: names are read-only, nothing can be added, and nothing is written', () => {
        const onChange = vi.fn();
        render(
            <CourseFormatsCard
                formats={formats()}
                order={order()}
                onChange={onChange}
                i18n={GS.i18n}
                readOnlyNames
            />
        );
        expect(screen.getByText('global.courseFormats.namesInTranslations')).toBeInTheDocument();
        const name = screen.getByDisplayValue('E-books');
        expect(name).toHaveAttribute('readonly');
        fireEvent.focus(name);
        fireEvent.change(name, { target: { value: 'ई-पुस्तकें' } });
        fireEvent.blur(name);
        expect(screen.getAllByLabelText('global.courseFormats.name').at(-1)).toBeDisabled();
        expect(screen.getByRole('button', { name: /global.courseFormats.add$/ })).toBeDisabled();
        expect(onChange).not.toHaveBeenCalled();
    });

    it('moving a format writes only the order', () => {
        const onChange = vi.fn();
        render(<CourseFormatsCard formats={formats()} order={order()} onChange={onChange} />);
        fireEvent.click(screen.getAllByLabelText(/^global\.courseFormats\.moveDown /)[0]!);
        const [first, second, ...rest] = order();
        expect(onChange).toHaveBeenCalledWith({ courseFormatOrder: [second, first, ...rest] });
    });

    it('removing a format asks first, naming its tag; cancelling keeps it', () => {
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
        const onChange = vi.fn();
        render(<CourseFormatsCard formats={formats()} order={order()} onChange={onChange} />);
        fireEvent.click(screen.getByLabelText('global.courseFormats.remove {"name":"E-books"}'));
        expect(confirm).toHaveBeenCalledWith(
            'global.courseFormats.confirmRemove {"name":"E-books","tag":"format-ebook"}'
        );
        expect(onChange).not.toHaveBeenCalled();
        confirm.mockRestore();
    });

    it('removing a format drops it from the formats and the order', () => {
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
        const onChange = vi.fn();
        render(<CourseFormatsCard formats={formats()} order={order()} onChange={onChange} />);
        fireEvent.click(screen.getByLabelText('global.courseFormats.remove {"name":"Audio Book"}'));
        confirm.mockRestore();
        const rest = formats();
        delete rest.audiobook;
        expect(onChange).toHaveBeenCalledWith({
            courseFormats: rest,
            courseFormatOrder: order().filter((id) => id !== 'audiobook'),
        });
    });

    it('adding a format appends it and reminds the editor to tag courses format-<id>', () => {
        const onChange = vi.fn();
        const { rerender } = render(
            <CourseFormatsCard formats={formats()} order={order()} onChange={onChange} />
        );
        const add = screen.getByRole('button', { name: /global.courseFormats.add$/ });
        expect(add).toBeDisabled();
        fireEvent.change(screen.getAllByLabelText('global.courseFormats.name').at(-1)!, {
            target: { value: 'Podcast series' },
        });
        expect(screen.getByLabelText('global.courseFormats.id')).toHaveValue('podcast-series');
        fireEvent.click(add);
        const edit = onChange.mock.calls[0][0];
        expect(edit).toEqual({
            courseFormats: { ...formats(), 'podcast-series': { label: 'Podcast series' } },
            courseFormatOrder: [...order(), 'podcast-series'],
        });
        rerender(
            <CourseFormatsCard
                formats={edit.courseFormats}
                order={edit.courseFormatOrder}
                onChange={onChange}
            />
        );
        expect(
            screen.getByText(
                'global.courseFormats.tagHint {"tag":"format-podcast-series","name":"Podcast series"}'
            )
        ).toBeInTheDocument();
    });

    it('a Hindi-only name needs an id typed by hand; a taken id is refused', () => {
        const onChange = vi.fn();
        render(<CourseFormatsCard formats={formats()} order={order()} onChange={onChange} />);
        fireEvent.change(screen.getAllByLabelText('global.courseFormats.name').at(-1)!, {
            target: { value: 'पॉडकास्ट' },
        });
        expect(screen.getByText(/global.courseFormats.issue.noId/)).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('global.courseFormats.id'), {
            target: { value: 'Live' },
        });
        expect(screen.getByText(/global.courseFormats.issue.taken/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /global.courseFormats.add$/ })).toBeDisabled();
    });
});
