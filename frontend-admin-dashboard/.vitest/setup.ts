import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Unmount anything a test rendered. Vitest isolates each test FILE in its own
// environment, so without this the leak is invisible — but within a file (and in
// any shared-process pool mode) a previous test's DOM stays mounted and makes
// queries like getByText ambiguous. Standard RTL + Vitest wiring.
afterEach(() => {
    cleanup();
});

// jsdom implements no layout, so the APIs Radix and cmdk call while opening a
// popover simply do not exist on Element. Without these, any test that opens a
// SearchableSelect / MyDropdown dies inside a layout effect ("scrollIntoView is
// not a function"), and React then reports the unrelated-looking cascade
// "Should not already be working". No-ops are correct here: they only drive
// scrolling and pointer capture, neither of which a headless assertion reads.
if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function scrollIntoView() {};
}
if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = function hasPointerCapture() {
        return false;
    };
}
if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = function setPointerCapture() {};
}
if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = function releasePointerCapture() {};
}
