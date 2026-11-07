import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Megaphone } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { sanitizeHtml } from '@/lib/utils';
import {
  getAppOverlays,
  markOverlaySeen,
  dismissOverlay,
} from '@/services/announcementApi';
import { getStudentDisplaySettings } from '@/services/student-display-settings';
import type { UserMessage } from '@/types/announcement';

const SESSION_DISMISSED_KEY = 'app-overlay-dismissed-ids';

function readSessionDismissed(): Set<string> {
  try {
    const raw = sessionStorage.getItem(SESSION_DISMISSED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function rememberSessionDismissed(messageId: string) {
  try {
    const ids = readSessionDismissed();
    ids.add(messageId);
    sessionStorage.setItem(SESSION_DISMISSED_KEY, JSON.stringify([...ids]));
  } catch {
    // sessionStorage unavailable — server-side dismiss still prevents re-show on next open
  }
}

// Full HTML documents get a sandboxed iframe; fragments are sanitized and inlined.
function isFullHtmlDocument(html: string): boolean {
  return /^\s*(<!doctype\s+html|<html[\s>])/i.test(html);
}

/**
 * Full-screen APP_OVERLAY announcements ("what's new" / institute notices),
 * shown once per learner on app open until dismissed. Mounted at the root
 * layout so it appears regardless of the route the app opened on.
 *
 * Gating: authenticated users only (caller hides it on public routes),
 * institute Student Display setting notifications.allowAppOverlays,
 * and server-side dismiss-once filtering.
 */
export const AppOverlayHost = () => {
  const { t } = useTranslation('courseComponentsExtra');
  const [queue, setQueue] = useState<UserMessage[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const seenMarkedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const settings = await getStudentDisplaySettings();
        if (settings?.notifications?.allowAppOverlays === false) return;

        const overlays = await getAppOverlays();
        if (cancelled || overlays.length === 0) return;

        const sessionDismissed = readSessionDismissed();
        const pending = overlays.filter(
          (o) =>
            !o.isDismissed &&
            !sessionDismissed.has(o.messageId) &&
            o.content?.content
        );
        if (pending.length > 0) {
          setQueue(pending);
          setTotalCount(pending.length);
        }
      } catch (error) {
        // Never block app usage over an overlay fetch problem
        console.error('Error loading app overlays:', error);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const current = queue[0];

  // Record "seen" once per overlay per session, when it actually shows.
  useEffect(() => {
    if (!current) return;
    if (seenMarkedRef.current.has(current.messageId)) return;
    seenMarkedRef.current.add(current.messageId);
    void markOverlaySeen(current.messageId);
  }, [current]);

  const handleDismiss = useCallback(() => {
    if (!current) return;
    rememberSessionDismissed(current.messageId);
    // Optimistic: advance immediately; the server write is fire-and-forget and
    // the session guard covers a failed write until the next app open.
    setQueue((q) => q.slice(1));
    void dismissOverlay(current.messageId);
  }, [current]);

  if (!current) return null;

  const html = current.content?.content ?? '';
  const fullDocument = isFullHtmlDocument(html);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col bg-white animate-in fade-in duration-300"
      role="dialog"
      aria-modal="true"
      aria-label={current.title || t('appOverlayHost.announcement')}
      style={{
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-neutral-200 px-4 py-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary-500">
          <Megaphone size={20} weight="fill" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-subtitle font-semibold text-neutral-700">
            {current.title || t('appOverlayHost.announcement')}
          </h2>
          {current.createdByName && (
            <p className="truncate text-caption text-neutral-500">
              {t('appOverlayHost.from', { name: current.createdByName })}
            </p>
          )}
        </div>
        {totalCount > 1 && (
          <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-caption text-neutral-500">
            {t('appOverlayHost.progressOfTotal', {
              current: totalCount - queue.length + 1,
              total: totalCount,
            })}
          </span>
        )}
      </header>

      {fullDocument ? (
        <iframe
          title={current.title || t('appOverlayHost.announcement')}
          srcDoc={html}
          sandbox="allow-scripts allow-popups"
          className="min-h-0 w-full flex-1 border-0 bg-white"
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div
            className="mx-auto w-full max-w-2xl px-4 py-5 text-body text-neutral-700 [&_a]:text-primary-500 [&_a]:underline [&_h1]:mb-3 [&_h1]:text-h2 [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:text-h3 [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:text-subtitle [&_h3]:font-semibold [&_img]:my-3 [&_img]:max-w-full [&_img]:rounded-lg [&_li]:mb-1 [&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:ps-5 [&_p]:mb-3 [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:ps-5"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }}
          />
        </div>
      )}

      <footer className="shrink-0 border-t border-neutral-200 px-4 py-3">
        <div className="mx-auto w-full max-w-2xl">
          <MyButton
            buttonType="primary"
            scale="large"
            layoutVariant="default"
            className="w-full"
            onClick={handleDismiss}
          >
            {t('appOverlayHost.gotIt')}
          </MyButton>
        </div>
      </footer>
    </div>,
    document.body
  );
};
