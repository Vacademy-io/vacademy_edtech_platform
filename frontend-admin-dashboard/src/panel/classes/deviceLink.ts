/**
 * The address behind the "Start on your device" QR. It names a class and an institute
 * and nothing else: the phone page signs the teacher in itself and asks for its own join
 * link. A join URL or a token must never be passed to this function or shown in that QR.
 */
export function buildDeviceStartUrl(
    approveBaseUrl: string | null | undefined,
    scheduleId: string,
    instituteId: string
): string | null {
    const base = (approveBaseUrl ?? '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\/[^/?#]+$/i.test(base) || !scheduleId || !instituteId) return null;
    return `${base}/classroom#s=${encodeURIComponent(scheduleId)}&i=${encodeURIComponent(instituteId)}`;
}

/** What to print under the QR for someone typing it on a laptop. */
export function deviceStartAddress(approveBaseUrl: string | null | undefined): string {
    const base = (approveBaseUrl ?? '').trim().replace(/\/+$/, '');
    return `${base.replace(/^https?:\/\//i, '')}/classroom`;
}
