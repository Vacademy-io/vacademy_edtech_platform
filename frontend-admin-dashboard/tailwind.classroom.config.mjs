// Tailwind config for the Classroom phone page (vite.classroom.config.ts). Same
// jiti-loaded CommonJS-in-.mjs style as tailwind.config.mjs: it reuses the admin
// theme and narrows `content` to what the page renders, so its CSS stays small.
const base = require('./tailwind.config.mjs');

const baseTheme = base.theme || {};
const baseExtend = baseTheme.extend || {};

/** @type {import('tailwindcss').Config} */
module.exports = {
    ...base,
    theme: {
        ...baseTheme,
        extend: {
            ...baseExtend,
            // The page loads no web fonts. Phones already have fonts for Latin and Devanagari.
            fontFamily: {
                sans: [
                    'system-ui',
                    '-apple-system',
                    'Segoe UI',
                    'Roboto',
                    'Noto Sans',
                    'Noto Sans Devanagari',
                    'sans-serif',
                ],
            },
        },
    },
    safelist: [],
    plugins: [],
    content: [
        './src/classroom-phone/**/*.{ts,tsx}',
        './src/components/design-system/{button,input}.tsx',
        './src/components/ui/{button,input,form,label}.tsx',
    ],
};
