/**
 * What the panel does when a teacher starts a class, by provider and WebView version.
 *
 *   WebView             BBB                      Zoom    Meet    Zoho or external link
 *   66, 74, 83          device                   device  device  external, else device
 *   91                  device until flag <= 91  device  device  same
 *   98+, flag lowered   here                     device  device  same
 *
 * BBB refuses browsers below its own gate, so no flag value can turn "here" on for those.
 * The major version is read at click time; 0 means it could not be told, and goes to device.
 */
import type { HostProvider } from '@/classroom-shared/hostActions';

export type ClassCapability =
    /** The native meeting screen on this panel. */
    | 'here'
    /** A QR for the teacher's own phone or laptop. */
    | 'device'
    /** Another app on the panel, falling back to the device QR. */
    | 'external'
    /** Neither a host flow nor a link exists. */
    | 'none';

/** MEASURED at 66: BBB's own client gate at Chrome 87 shows "Browser not supported". */
export const BBB_BROWSER_GATE = 87;

export function classCapability(
    provider: HostProvider | 'external' | null,
    webViewMajor: number,
    bbbInAppMinWebview: number
): ClassCapability {
    switch (provider) {
        case 'bbb':
            return webViewMajor >= BBB_BROWSER_GATE && webViewMajor >= bbbInAppMinWebview
                ? 'here'
                : 'device';
        case 'zoom':
        case 'meet':
            return 'device';
        case 'zoho':
        case 'external':
            return 'external';
        default:
            return 'none';
    }
}
