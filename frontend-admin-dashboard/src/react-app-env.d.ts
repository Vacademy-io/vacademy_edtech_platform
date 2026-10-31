/// <reference types="react" />
/// <reference types="react-dom" />

/** Injected by Vite's `define` (see vite.config.ts). */
declare const __VERSION__: string;

declare namespace JSX {
    interface IntrinsicElements {
        [elemName: string]: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    }
}
