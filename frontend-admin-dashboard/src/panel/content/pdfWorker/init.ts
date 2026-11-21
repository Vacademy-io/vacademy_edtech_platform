/**
 * Polyfills for the pdf.js worker on Chrome 66 (Android 9 AOSP WebView).
 *
 * Workers get NO page polyfills, and pdfjs-dist 3.11's legacy worker only
 * bundles a few core-js modules (ArrayBuffer.transfer, Set methods): it calls
 * Array#at at module evaluation, so on Chrome 66 the worker died with
 * "TypeError: I.at is not a function" and pdf.js fell back to a main-thread
 * "fake worker" (measured on panel_api28). Installed here, before
 * pdf.worker.js, on the NATIVE objects, only when missing:
 *   globalThis (71), Array/String/TypedArray#at (92), String#replaceAll (85),
 *   Array#flat/flatMap (69), Object.fromEntries (73), Promise.allSettled (76),
 *   postMessage(message, null) (Chrome < 70 throws; ./postMessageShim) and a
 *   stable Array#sort (V8 < 7.0 is unstable for > 10 items).
 * These are the APIs the emitted worker chunk uses (verifier worker-api list).
 * No core-js: its promise modules replace window.Promise on V8 66 (owner
 * decision 2), and the worker build cannot resolve core-js (not hoisted).
 *
 * The file is named init.ts on purpose: package.json `sideEffects` keeps
 * "**\/init.*", and the worker build has no panel side-effects override, so a
 * differently named side-effect-only module is dropped (it was).
 */

import { patchNullTransfer } from './postMessageShim';

type Scope = {
    globalThis?: unknown;
    DedicatedWorkerGlobalScope?: { prototype: object };
    __panelPdfWorkerInit?: true;
};
const scope = self as unknown as Scope;
if (typeof scope.globalThis === 'undefined') scope.globalThis = self;
// Marker read by scripts/panel/verify-panel-dist.mjs: proves this module survived the
// worker build (it was once tree-shaken away). The shimmed APIs below MUST stay in sync
// with WORKER_SHIMMED in that verifier.
scope.__panelPdfWorkerInit = true;

// pdf.js answers with self.postMessage(message, null) too (see ./postMessageShim).
patchNullTransfer(
    scope.DedicatedWorkerGlobalScope ? scope.DedicatedWorkerGlobalScope.prototype : self
);

function define(target: object, name: string, value: unknown): void {
    if (Object.prototype.hasOwnProperty.call(target, name)) return;
    Object.defineProperty(target, name, {
        value,
        writable: true,
        configurable: true,
        enumerable: false,
    });
}

function relativeIndex(length: number, index: unknown): number {
    const n = Math.trunc(Number(index)) || 0;
    return n < 0 ? n + length : n;
}

function arrayAt(this: ArrayLike<unknown>, index: unknown): unknown {
    const length = this.length >>> 0;
    const k = relativeIndex(length, index);
    return k < 0 || k >= length ? undefined : this[k];
}

define(Array.prototype, 'at', arrayAt);
define(Object.getPrototypeOf(Int8Array.prototype) as object, 'at', arrayAt);
define(String.prototype, 'at', function stringAt(this: unknown, index: unknown) {
    const text = String(this);
    const k = relativeIndex(text.length, index);
    return k < 0 || k >= text.length ? undefined : text.charAt(k);
});

define(
    String.prototype,
    'replaceAll',
    function replaceAll(this: unknown, search: unknown, replacement: unknown) {
        const text = String(this);
        if (search instanceof RegExp) {
            if (search.flags.indexOf('g') < 0) {
                throw new TypeError('replaceAll must be called with a global RegExp');
            }
            return text.replace(search, replacement as string);
        }
        const escaped = String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return text.replace(new RegExp(escaped, 'g'), replacement as string);
    }
);

function flatInto(target: unknown[], source: ArrayLike<unknown>, depth: number): unknown[] {
    for (let i = 0; i < source.length; i++) {
        if (!(i in (source as object))) continue;
        const item = source[i];
        if (depth > 0 && Array.isArray(item)) flatInto(target, item, depth - 1);
        else target.push(item);
    }
    return target;
}

define(Array.prototype, 'flat', function flat(this: ArrayLike<unknown>, depth?: unknown) {
    const d = depth === undefined ? 1 : Math.trunc(Number(depth)) || 0;
    return flatInto([], this, d);
});
define(
    Array.prototype,
    'flatMap',
    function flatMap(
        this: ArrayLike<unknown>,
        callback: (value: unknown, index: number, array: unknown) => unknown,
        thisArg?: unknown
    ) {
        const mapped: unknown[] = [];
        for (let i = 0; i < this.length; i++) {
            if (i in (this as object)) mapped.push(callback.call(thisArg, this[i], i, this));
        }
        return flatInto([], mapped, 1);
    }
);

define(
    Object,
    'fromEntries',
    function fromEntries(entries: Iterable<readonly [PropertyKey, unknown]>) {
        const result: Record<PropertyKey, unknown> = {};
        for (const [key, value] of Array.from(entries)) result[key] = value;
        return result;
    }
);

define(Promise, 'allSettled', function allSettled(values: Iterable<unknown>) {
    return Promise.all(
        Array.from(values).map((value) =>
            Promise.resolve(value).then(
                (result) => ({ status: 'fulfilled', value: result }),
                (reason: unknown) => ({ status: 'rejected', reason })
            )
        )
    );
});

// Array#sort is only stable from V8 7.0 (Chrome 70); V8 6.6 quick-sorts arrays
// longer than 10. pdf.js font/cmap code relies on ES2019 stable sort: on
// panel_api28 whole letters ("a", "D", "-") vanished from rendered pages.
function sortIsStable(): boolean {
    const items: { key: number; order: number }[] = [];
    for (let i = 0; i < 40; i++) items.push({ key: i % 3, order: i });
    items.sort((a, b) => a.key - b.key);
    for (let i = 1; i < items.length; i++) {
        const previous = items[i - 1];
        const current = items[i];
        if (previous && current && previous.key === current.key && previous.order > current.order) {
            return false;
        }
    }
    return true;
}

function defaultCompare(a: unknown, b: unknown): number {
    const x = String(a);
    const y = String(b);
    return x < y ? -1 : x > y ? 1 : 0;
}

if (!sortIsStable()) {
    const nativeSort = Array.prototype.sort;
    Object.defineProperty(Array.prototype, 'sort', {
        configurable: true,
        writable: true,
        enumerable: false,
        value: function stableSort(this: unknown[], compare?: (a: unknown, b: unknown) => number) {
            const length = this.length >>> 0;
            if (length < 2) return this;
            const cmp = typeof compare === 'function' ? compare : defaultCompare;
            const decorated: [unknown, number][] = [];
            let undefinedCount = 0;
            for (let i = 0; i < length; i++) {
                const value = this[i];
                if (value === undefined) undefinedCount++;
                else decorated.push([value, i]);
            }
            nativeSort.call(decorated, (a: [unknown, number], b: [unknown, number]) => {
                const result = Number(cmp(a[0], b[0]));
                return result || a[1] - b[1];
            });
            let index = 0;
            for (; index < decorated.length; index++) {
                const entry = decorated[index];
                this[index] = entry ? entry[0] : undefined;
            }
            for (let k = 0; k < undefinedCount; k++) this[index++] = undefined;
            return this;
        },
    });
}

export {};
