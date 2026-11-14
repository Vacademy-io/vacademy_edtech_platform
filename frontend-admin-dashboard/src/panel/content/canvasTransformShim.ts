/**
 * CanvasRenderingContext2D#getTransform for Chrome 66-67 (it shipped in 68).
 *
 * pdf.js 3.11 reads the current matrix with ctx.getTransform() while painting
 * (legacy/build/pdf.js:10128, 10139, 13010). Without it every PDF page stays
 * white on the Android 9 WebView (measured on panel_api28: text layer present,
 * canvases blank, no console error). This tracks the matrix by wrapping the
 * transform setters, as pdf.js' own former addContextCurrentTransform did.
 * Setting canvas.width/height resets the real matrix and save-stack, so the
 * tracked state is reset too (react-pdf-viewer re-renders into the same canvas
 * on every zoom).
 *
 * Installed only when getTransform is missing, from PanelPdfViewer.
 */
type Matrix = [number, number, number, number, number, number];

interface TransformState {
    matrix: Matrix;
    stack: Matrix[];
}

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const states = new WeakMap<object, TransformState>();

function stateOf(context: object): TransformState {
    let state = states.get(context);
    if (!state) {
        state = { matrix: IDENTITY.slice() as Matrix, stack: [] };
        states.set(context, state);
    }
    return state;
}

function multiply(m: Matrix, n: Matrix): Matrix {
    return [
        m[0] * n[0] + m[2] * n[1],
        m[1] * n[0] + m[3] * n[1],
        m[0] * n[2] + m[2] * n[3],
        m[1] * n[2] + m[3] * n[3],
        m[0] * n[4] + m[2] * n[5] + m[4],
        m[1] * n[4] + m[3] * n[5] + m[5],
    ];
}

type Method = (this: object, ...args: unknown[]) => unknown;

function wrap(
    proto: Record<string, unknown>,
    name: string,
    after: (state: TransformState, args: unknown[]) => void
) {
    const original = proto[name];
    if (typeof original !== 'function') return;
    proto[name] = function wrapped(this: object, ...args: unknown[]) {
        const result = (original as Method).apply(this, args);
        after(stateOf(this), args);
        return result;
    };
}

function toMatrix(args: unknown[]): Matrix {
    if (args.length === 1 && args[0] && typeof args[0] === 'object') {
        const init = args[0] as Partial<Record<'a' | 'b' | 'c' | 'd' | 'e' | 'f', number>>;
        return [init.a ?? 1, init.b ?? 0, init.c ?? 0, init.d ?? 1, init.e ?? 0, init.f ?? 0];
    }
    if (args.length === 0) return IDENTITY.slice() as Matrix;
    return args.slice(0, 6).map(Number) as Matrix;
}

let nativeSupport: boolean | null = null;

/** Installs the polyfill when needed. Returns true when the browser has getTransform natively. */
export function installCanvasGetTransform(): boolean {
    if (nativeSupport !== null) return nativeSupport;
    if (typeof window.CanvasRenderingContext2D === 'undefined') {
        nativeSupport = true;
        return nativeSupport;
    }
    const proto = window.CanvasRenderingContext2D.prototype as unknown as Record<string, unknown>;
    nativeSupport = typeof proto.getTransform === 'function';
    if (nativeSupport) return nativeSupport;

    wrap(proto, 'save', (state) => {
        state.stack.push(state.matrix.slice() as Matrix);
    });
    wrap(proto, 'restore', (state) => {
        const previous = state.stack.pop();
        if (previous) state.matrix = previous;
    });
    wrap(proto, 'translate', (state, args) => {
        state.matrix = multiply(state.matrix, [1, 0, 0, 1, Number(args[0]), Number(args[1])]);
    });
    wrap(proto, 'scale', (state, args) => {
        state.matrix = multiply(state.matrix, [Number(args[0]), 0, 0, Number(args[1]), 0, 0]);
    });
    wrap(proto, 'rotate', (state, args) => {
        const angle = Number(args[0]);
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        state.matrix = multiply(state.matrix, [cos, sin, -sin, cos, 0, 0]);
    });
    wrap(proto, 'transform', (state, args) => {
        state.matrix = multiply(state.matrix, toMatrix(args));
    });
    wrap(proto, 'setTransform', (state, args) => {
        state.matrix = toMatrix(args);
    });
    wrap(proto, 'resetTransform', (state) => {
        state.matrix = IDENTITY.slice() as Matrix;
    });

    // A canvas resize resets the context: forget the tracked matrix/stack too.
    const canvasProto = window.HTMLCanvasElement.prototype;
    const contexts = new WeakMap<object, object>();
    const getContext = canvasProto.getContext as unknown as (
        this: HTMLCanvasElement,
        ...args: unknown[]
    ) => object | null;
    (canvasProto as unknown as Record<string, unknown>).getContext = function patchedGetContext(
        this: HTMLCanvasElement,
        ...args: unknown[]
    ) {
        const context = getContext.apply(this, args);
        if (context && args[0] === '2d') contexts.set(this, context);
        return context;
    };
    ['width', 'height'].forEach((name) => {
        const descriptor = Object.getOwnPropertyDescriptor(canvasProto, name);
        if (!descriptor || !descriptor.set || !descriptor.get) return;
        const { get, set } = descriptor;
        Object.defineProperty(canvasProto, name, {
            configurable: true,
            enumerable: descriptor.enumerable,
            get,
            set(this: HTMLCanvasElement, value: unknown) {
                set.call(this, value);
                const context = contexts.get(this);
                if (context) states.delete(context);
            },
        });
    });

    proto.getTransform = function getTransform(this: object) {
        return new DOMMatrix(stateOf(this).matrix);
    };
    return nativeSupport;
}
