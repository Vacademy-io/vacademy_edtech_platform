/** K7QF2M9X shows as K7QF-2M9X. */
export function formatCode(code: string): string {
    return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}
