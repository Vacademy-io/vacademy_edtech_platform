// Tailwind config for the Vacademy Classroom panel bundle (vite.panel.config.ts).
// Same jiti-loaded CommonJS-in-.mjs style as tailwind.config.mjs: it reuses the
// admin theme and narrows `content` to what the panel graph renders, so
// dist-panel CSS stays small.
//
// 10-foot type scale (review finding ux10ft-1): the admin type tokens (text-h1 …
// text-caption, 2xs, *-semibold) are fixed px, so html.panel-root's larger root
// font-size (panel.css) grew boxes but not text. Here every px size / line-height
// of those tokens is re-expressed in rem (px / 16) with the same weights: at the
// default 16px root (Android TV 960x540) text renders exactly as before, and on
// big panels it scales with the boxes. The admin config itself is untouched.
const base = require('./tailwind.config.mjs');

const PX = /^(-?\d+(?:\.\d+)?)px$/;
function toRem(value) {
    if (typeof value !== 'string') return value;
    const match = PX.exec(value.trim());
    if (!match) return value;
    return `${Number(match[1]) / 16}rem`;
}

function remFontSize(entry) {
    if (Array.isArray(entry)) {
        const [size, options] = entry;
        if (options && typeof options === 'object') {
            return [toRem(size), { ...options, lineHeight: toRem(options.lineHeight) }];
        }
        return [toRem(size), options === undefined ? undefined : toRem(options)].filter(
            (part) => part !== undefined
        );
    }
    return toRem(entry);
}

const baseTheme = base.theme || {};
const baseExtend = baseTheme.extend || {};
const baseFontSize = baseExtend.fontSize || {};
const panelFontSize = Object.fromEntries(
    Object.entries(baseFontSize).map(([name, entry]) => [name, remFontSize(entry)])
);

/** @type {import('tailwindcss').Config} */
module.exports = {
    ...base,
    theme: {
        ...baseTheme,
        extend: {
            ...baseExtend,
            fontSize: panelFontSize,
        },
    },
    safelist: [],
    content: [
        './src/panel/**/*.{ts,tsx}',
        './src/components/ui/**/*.{ts,tsx}',
        './src/components/design-system/{button,input,dialog,dropdown,select-field,status-chips,my-label}.tsx',
        './src/components/common/slides/components/{ResponseOverlay,LeaderboardModal,ResponseDistributionModal,WordCloudModal,SessionLeaderboardModal}.tsx',
        './src/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-components/{deck-player,file-video-player}.tsx',
        './src/providers/theme/**/*.tsx',
    ],
};
