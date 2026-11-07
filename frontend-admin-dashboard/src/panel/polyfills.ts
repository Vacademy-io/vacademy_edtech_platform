// Panel runtime polyfills for Chrome 66 (Android 9 AOSP WebView).
//
// Explicit core-js@3.44.0 side-effect imports, emitted as the `panel-polyfills`
// chunk and imported FIRST by main.tsx.
//
// NO core-js promise module may be imported here (owner decision 2): at exactly
// V8 66 core-js (internals/promise-constructor-detection.js) force-replaces
// window.Promise, after which native async-function results are no longer
// `instanceof Promise`. Promise.prototype.finally / allSettled / any /
// withResolvers are shimmed on the NATIVE Promise by the ES5 pre-flight in
// panel.html instead. Every module below was checked not to pull
// internals/promise-* (scratchpad cjdeps.cjs); verify-panel-dist.mjs fails the
// build if the module manifest ever contains one.
import 'core-js/actual/aggregate-error';
import 'core-js/actual/global-this';
import 'core-js/actual/queue-microtask';
import 'core-js/actual/structured-clone';
import 'core-js/actual/object/from-entries';
import 'core-js/actual/object/has-own';
import 'core-js/actual/object/group-by';
import 'core-js/actual/map/group-by';
import 'core-js/actual/array/at';
import 'core-js/actual/array/flat';
import 'core-js/actual/array/flat-map';
import 'core-js/actual/array/find-last';
import 'core-js/actual/array/find-last-index';
import 'core-js/actual/array/to-sorted';
import 'core-js/actual/array/to-reversed';
import 'core-js/actual/array/to-spliced';
import 'core-js/actual/array/with';
import 'core-js/actual/typed-array/at';
import 'core-js/actual/string/at';
import 'core-js/actual/string/replace-all';
import 'core-js/actual/string/match-all';
import 'core-js/actual/symbol/description';
