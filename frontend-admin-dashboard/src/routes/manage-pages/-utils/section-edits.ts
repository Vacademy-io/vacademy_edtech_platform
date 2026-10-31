/**
 * Pure helpers for whole-section edits in the property panel: the per-section
 * JSON editor and "Try another version". Both replace a section's props in
 * one go, so both must not lose settings the admin did not mean to touch.
 */

type Props = Record<string, unknown>;

const isPlainObject = (v: unknown): v is Props => !!v && typeof v === 'object' && !Array.isArray(v);

export type SectionJsonResult =
    | { ok: true; value: Props }
    | { ok: false; error: string; line?: number; column?: number };

/**
 * Offset of the first character that makes `text` invalid JSON (-1 when it is
 * valid). Browsers word JSON.parse errors differently and Chrome gives no
 * position at all, so the editor finds the spot itself.
 */
const jsonErrorOffset = (text: string): number => {
    let i = 0;
    const fail = (): never => {
        throw i;
    };
    const space = () => {
        while (i < text.length && ' \t\n\r'.includes(text[i]!)) i++;
    };
    const expect = (ch: string) => (text[i] === ch ? i++ : fail());
    const string = () => {
        expect('"');
        while (text[i] !== '"') {
            if (i >= text.length || text[i]! < ' ') fail();
            i += text[i] === '\\' ? 2 : 1;
        }
        i++;
    };
    const value = (): void => {
        space();
        const c = text[i];
        if (c === '{' || c === '[') {
            const close = c === '{' ? '}' : ']';
            i++;
            space();
            if (text[i] === close) return void i++;
            for (;;) {
                if (c === '{') {
                    space();
                    string();
                    space();
                    expect(':');
                }
                value();
                space();
                if (text[i] === ',') i++;
                else return void expect(close);
            }
        }
        if (c === '"') return string();
        const word = /^(true|false|null|-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?)/.exec(text.slice(i));
        if (!word) fail();
        i += word![0].length;
    };
    try {
        value();
        space();
        return i < text.length ? i : -1;
    } catch (at) {
        return typeof at === 'number' ? at : -1;
    }
};

/**
 * Parses the JSON an admin typed for one section's settings. The result must
 * be an object ({ … }); a parse error carries the line and column (1-based)
 * of the first bad character.
 */
export const parseSectionJson = (text: string): SectionJsonResult => {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        const offset = jsonErrorOffset(text);
        if (offset < 0) return { ok: false, error };
        const lines = text.slice(0, offset).split('\n');
        return {
            ok: false,
            error,
            line: lines.length,
            column: lines[lines.length - 1]!.length + 1,
        };
    }
    if (!isPlainObject(value)) return { ok: false, error: 'not-object' };
    return { ok: true, value };
};

/**
 * Lays `next` over `current`, keeping every setting `next` does not mention
 * (except keys `dropUnmentioned` names: those follow `next`, so leaving them
 * out removes them). Nested objects merge the same way; arrays and plain
 * values come from `next`. Returns the merged props and the dotted paths that
 * were kept from `current`.
 */
export const keepUnmentionedProps = (
    current: Props | null | undefined,
    next: Props | null | undefined,
    dropUnmentioned: (key: string) => boolean = () => false
): { props: Props; kept: string[] } => {
    const kept: string[] = [];
    const merge = (a: Props, b: Props, path: string): Props => {
        const out: Props = { ...b };
        for (const [key, value] of Object.entries(a)) {
            const at = path ? `${path}.${key}` : key;
            if (!(key in b)) {
                if (value === undefined || dropUnmentioned(key)) continue;
                out[key] = value;
                kept.push(at);
            } else if (isPlainObject(value) && isPlainObject(b[key])) {
                out[key] = merge(value, b[key] as Props, at);
            }
        }
        return out;
    };
    return { props: merge(current ?? {}, next ?? {}, ''), kept };
};

interface SectionShape<Style> {
    type: string;
    props?: Props;
    style?: Style;
}

/**
 * The look of a section: colours, pictures and backgrounds. A new version
 * that leaves one out means "none" (a light, image-free design), so the old
 * value must not be carried under it.
 */
const isLookProp = (key: string): boolean =>
    /colou?r|image|background|gradient|overlay|^bg[A-Z]|^bg$/i.test(key);

/**
 * "Try another version": the new version replaces what it sets, and the
 * settings it leaves out (a page hero, sidebar, extra rows, card design… that
 * the AI never saw a field for) stay — except its look: a colour, picture or
 * background the version leaves out is removed, so the design applies as the
 * AI made it. A version of a different section type replaces the section
 * outright — the old settings mean nothing to it.
 */
export const mergeSectionVersion = <Style>(
    current: SectionShape<Style>,
    next: SectionShape<Style>
): { patch: { type: string; props: Props; style: Style | undefined }; kept: string[] } => {
    if (next.type !== current.type) {
        return { patch: { type: next.type, props: next.props ?? {}, style: next.style }, kept: [] };
    }
    const { props, kept } = keepUnmentionedProps(current.props, next.props, isLookProp);
    return { patch: { type: next.type, props, style: next.style }, kept };
};

/**
 * Kept-setting paths ("hero", "render.cardStyle") as names a content editor
 * can read: the last part of each path, in words ("card style"), once each.
 */
export const describeKeptSettings = (kept: readonly string[]): string[] => [
    ...new Set(
        kept.map((path) =>
            (path.split('.').pop() ?? path)
                .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
                .replace(/[_-]+/g, ' ')
                .toLowerCase()
        )
    ),
];
