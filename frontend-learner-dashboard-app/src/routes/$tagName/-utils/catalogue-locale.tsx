import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useRouter } from "@tanstack/react-router";
import { I18nextProvider, useTranslation } from "react-i18next";
import type { i18n as I18nInstance } from "i18next";
import {
  clearSiteTermScope,
  ensureSiteTermsCatalog,
  setSiteTermScope,
  siteTermsCatalogReady,
  type SiteTermScope,
} from "@/components/common/layout-container/sidebar/utils";
import { NAMING_TERMS_CHANGED_EVENT } from "@/i18n/naming-terms";
import {
  LOCALE_PARAM,
  baseLocaleOf,
  dictionaryFor,
  localesOf,
  resolveSiteLocale,
  translateText,
  type CatalogueI18nSettings,
  type CatalogueLocale,
  type TranslationDictionary,
} from "./catalogue-i18n";
import { useCatalogueSearchParams } from "./catalogue-url-state";
import { forwardedEvents, siteI18nInstance } from "./catalogue-i18n-instance";
import { repairRetainedLocaleHref } from "./catalogue-site-language";
import { holdSiteLanguage } from "./catalogue-route-search";

/**
 * The visitor's site language, for every catalogue section (see
 * catalogue-i18n.ts for the model). Mounted once around the page tree; a
 * section reads it with useCatalogueLocale(), and live-data sections (course
 * names, folder names) translate their strings with useSiteT().
 *
 * Without a provider — or on a single-language site — everything resolves to
 * the base language with no dictionary, so sections behave exactly as before.
 */

export interface CatalogueLocaleValue {
  /** Language being rendered. */
  locale: string;
  /** Language the site is authored in. */
  baseLocale: string;
  /** Languages offered by the switcher (base first). Empty when the site is single-language. */
  locales: CatalogueLocale[];
  /** True when a switcher should show. */
  enabled: boolean;
  /** Translations for `locale`; undefined when rendering the base language. */
  dict: TranslationDictionary | undefined;
  /** Switches language: remembered for the visitor and reflected in ?lang=. */
  setLocale: (code: string) => void;
  /** One string through the dictionary (identity in the base language). */
  t: (text: string | null | undefined) => string;
}

const identity = (text: string | null | undefined) => text ?? "";

const FALLBACK: CatalogueLocaleValue = {
  locale: "en",
  baseLocale: "en",
  locales: [],
  enabled: false,
  dict: undefined,
  setLocale: () => {},
  t: identity,
};

const CatalogueLocaleContext = createContext<CatalogueLocaleValue>(FALLBACK);

const storageKey = (scope: string) => `catalogue-locale:${scope}`;

const readStored = (scope: string): string | null => {
  try {
    return localStorage.getItem(storageKey(scope));
  } catch {
    return null;
  }
};

const writeStored = (scope: string, code: string) => {
  try {
    localStorage.setItem(storageKey(scope), code);
  } catch {
    // Private mode: the choice lasts as long as ?lang= stays in the URL.
  }
};

/** Where a provider's term scope stands (see the provider body). */
interface TermScopeState {
  /** Set by this provider's render (lifted by its render once languages go off). */
  held: boolean;
  /** This provider has committed at least once. */
  committed: boolean;
  /** The last commit-phase release lifted the scope (nobody had taken over). */
  released: boolean;
  /** The scope was lifted before this provider ever committed. */
  dropped: boolean;
}

/**
 * A render React throws away (an error boundary above the page, a first mount
 * abandoned mid-way) never commits, so no cleanup lifts the term scope it set
 * — the logged-in app would go on reading the site's words. A scope whose
 * provider has not committed by then is lifted, and the app re-renders its
 * translations. Long enough that only a render that never commits gets there.
 */
const UNCOMMITTED_TERM_SCOPE_MS = 10_000;

const liftUnlessCommitted = (token: object, state: TermScopeState, app: I18nInstance | undefined) => {
  setTimeout(() => {
    if (state.committed || !clearSiteTermScope(token)) return;
    state.dropped = true;
    app?.emit(NAMING_TERMS_CHANGED_EVENT);
  }, UNCOMMITTED_TERM_SCOPE_MS);
};

export const CatalogueLocaleProvider: React.FC<{
  /** globalSettings.i18n of the site being rendered. */
  settings: CatalogueI18nSettings | undefined | null;
  /** Remembers the choice per site (tag name or institute id). */
  scope: string;
  /**
   * Read and remember the visitor's choice in localStorage (default). Off for
   * the builder preview, which shows exactly the language its URL asks for —
   * an admin who once browsed the site in Hindi must not get a Hindi preview
   * while editing English, nor leave their editing language behind as their
   * visitor preference.
   */
  persist?: boolean;
  children: React.ReactNode;
}> = ({ settings, scope, persist = true, children }) => {
  const { get, update } = useCatalogueSearchParams();
  const urlLocale = get(LOCALE_PARAM);
  const [stored, setStored] = useState<string | null>(() => (persist ? readStored(scope) : null));

  useEffect(() => {
    setStored(persist ? readStored(scope) : null);
  }, [scope, persist]);

  const enabled = !!settings?.enabled;
  const baseLocale = baseLocaleOf(settings);
  const locale = resolveSiteLocale({ settings, urlLocale, storedLocale: stored });
  const dict = dictionaryFor(settings, locale);

  // An explicit ?lang= is also the visitor's choice from now on.
  useEffect(() => {
    if (persist && enabled && urlLocale && urlLocale.toLowerCase() === locale && stored !== locale) {
      writeStored(scope, locale);
      setStored(locale);
    }
  }, [persist, enabled, urlLocale, locale, stored, scope]);

  // The catalogue routes carry ?lang= across navigation only while a site
  // with languages is on screen (catalogue-route-search), so a single-language
  // site — even one whose URL has a stray ?lang= — navigates as it always did.
  // A layout effect: it runs before every passive effect, so a section that
  // navigates from its own mount effect (children's effects run first) still
  // carries the language.
  useLayoutEffect(() => (enabled ? holdSiteLanguage() : undefined), [enabled]);

  // A caller that navigates with `to: "/courses?stream=x"` (instead of
  // useSiteNavigate) gets the carried ?lang= after a second "?" — repaired
  // here after that render, whoever navigated. Only on sites with languages,
  // and from the RAW address: the router's own location has already encoded
  // the second "?" as %3F.
  const href = useLocation({ select: (current) => current.href });
  const router = useRouter();
  useEffect(() => {
    if (!enabled) return;
    // Optional chaining: a router without a history location (a stub in
    // another section's render test, say) simply has nothing to repair.
    const raw = router.history?.location?.href;
    const repaired = repairRetainedLocaleHref(raw);
    if (raw && repaired !== null && repaired !== raw) router.history.replace(repaired);
  }, [enabled, href, router]);

  // Screen readers and the browser's own translate prompt read <html lang>:
  // the language the page's text is in, so the base language until this one
  // has translations (the rule the edge middleware applies for crawlers).
  const contentLocale = dict ? locale : baseLocale;
  useEffect(() => {
    if (!enabled || typeof document === "undefined") return;
    const previous = document.documentElement.lang;
    document.documentElement.lang = contentLocale;
    return () => {
      document.documentElement.lang = previous;
    };
  }, [enabled, contentLocale]);

  // setLocale stays the same function for the life of the provider: the URL
  // helper (`update`) changes with every URL change, and if setLocale followed
  // it the context value would too — re-rendering every section on each
  // filter tweak. The latest settings/update are read from a ref instead, so
  // the value changes only when the language (or the settings) do.
  const latest = useRef({ settings, update, persist });
  latest.current = { settings, update, persist };

  const setLocale = useCallback(
    (code: string) => {
      const { settings: current, update: applyToUrl, persist: remember } = latest.current;
      const next = resolveSiteLocale({ settings: current, urlLocale: code });
      if (remember) {
        writeStored(scope, next);
        setStored(next);
      }
      // The base language needs no parameter; any other language is put in the
      // URL so a shared link opens in the language the sharer was reading.
      applyToUrl({ [LOCALE_PARAM]: next === baseLocaleOf(current) ? null : next });
    },
    [scope],
  );

  // Live data is untyped JSON: a non-string value (a number in a label) is
  // shown as it is rather than crashing the dictionary lookup.
  const t = useCallback(
    (text: string | null | undefined) =>
      typeof text === "string" ? translateText(text, dict) : text == null ? "" : String(text),
    [dict],
  );

  const value = useMemo<CatalogueLocaleValue>(
    () => ({
      locale,
      baseLocale,
      locales: enabled ? localesOf(settings) : [],
      enabled,
      dict,
      setLocale,
      t,
    }),
    [locale, baseLocale, enabled, settings, dict, setLocale, t],
  );

  // react-i18next chrome follows the site language through a cloned instance.
  // Single-language sites get the app's own instance — the one every
  // useTranslation() below reads anyway — so nothing changes for them, and
  // the element tree is the same either way (turning languages on in the
  // builder preview does not remount the page).
  const { i18n: contextI18n } = useTranslation();
  const baseI18n =
    contextI18n && typeof (contextI18n as Partial<I18nInstance>).cloneInstance === "function"
      ? contextI18n
      : undefined;
  const chromeI18n = useMemo(
    () => (enabled && baseI18n ? siteI18nInstance(baseI18n, locale) : baseI18n),
    [enabled, baseI18n, locale],
  );

  useEffect(() => {
    if (!baseI18n || !chromeI18n || chromeI18n === baseI18n) return;
    const handlers = forwardedEvents(baseI18n).map((event) => {
      const forward = (...args: unknown[]) => chromeI18n.emit(event, ...args);
      baseI18n.on(event, forward);
      return { event, forward };
    });
    return () => handlers.forEach(({ event, forward }) => baseI18n.off(event, forward));
  }, [baseI18n, chromeI18n]);

  // The institute's terms ("Course", "Level"…) follow the site language too.
  // Sections read them through getTerminology() — dozens of calls, outside
  // React — so this provider scopes that resolution to its language and clone
  // (sidebar/utils): set right here, before the children render, so their
  // first render and the one after a switch already resolve in it; re-asserted
  // on commit; lifted by token on the way out, since the page that replaced
  // this one may already have set its own. A site without languages sets
  // nothing, and its terms resolve exactly as before.
  const termScope = useMemo<SiteTermScope | null>(
    () => (chromeI18n && chromeI18n !== baseI18n ? { locale, i18n: chromeI18n } : null),
    [chromeI18n, baseI18n, locale],
  );
  const [termToken] = useState<object>(() => ({}));
  const termState = useRef<TermScopeState>({ held: false, committed: false, released: false, dropped: false });
  if (termScope) {
    setSiteTermScope(termToken, termScope);
    if (!termState.current.held) {
      termState.current.held = true;
      if (!termState.current.committed) liftUnlessCommitted(termToken, termState.current, baseI18n);
    }
  } else if (termState.current.held) {
    termState.current.held = false;
    clearSiteTermScope(termToken);
  }

  useLayoutEffect(() => {
    if (!termScope) return;
    const state = termState.current;
    state.committed = true;
    state.released = false;
    setSiteTermScope(termToken, termScope);
    return () => {
      state.released = clearSiteTermScope(termToken);
    };
  }, [termToken, termScope]);

  useEffect(() => {
    if (!termScope) return;
    const state = termState.current;
    // Lifted before this provider first committed (a very slow first render):
    // re-render the chrome in the scope now that the children are subscribed
    // (their effects ran before this one).
    if (state.dropped) {
      state.dropped = false;
      termScope.i18n.emit(NAMING_TERMS_CHANGED_EVENT);
    }
    return () => {
      // Whatever replaced this page in the same render — the next route, the
      // product page's success step — rendered while the scope still stood.
      // Once it is lifted for good, re-render the app's translations so their
      // terms follow the app's language again: from a microtask, after the
      // new page's effects have subscribed it.
      if (!state.released) return;
      state.released = false;
      queueMicrotask(() => baseI18n?.emit(NAMING_TERMS_CHANGED_EVENT));
    };
  }, [termScope, baseI18n]);

  // terms:Course in the site language ("कोर्स") comes from the terms catalog,
  // loaded through the clone (which asks for it as it starts); if it was not
  // in for this render, make sure it loads and re-render the chrome when it
  // lands.
  const termsReady = termScope ? siteTermsCatalogReady(termScope) : true;
  useEffect(() => {
    if (!termScope || termsReady) return;
    let live = true;
    void ensureSiteTermsCatalog(termScope).then((loaded) => {
      if (loaded && live) termScope.i18n.emit(NAMING_TERMS_CHANGED_EVENT);
    });
    return () => {
      live = false;
    };
  }, [termScope, termsReady]);

  const tree = <CatalogueLocaleContext.Provider value={value}>{children}</CatalogueLocaleContext.Provider>;
  return chromeI18n ? <I18nextProvider i18n={chromeI18n}>{tree}</I18nextProvider> : tree;
};

export const useCatalogueLocale = (): CatalogueLocaleValue => useContext(CatalogueLocaleContext);

/** Translate live-data strings (course names, folder titles…) in the visitor's language. */
export const useSiteT = () => useContext(CatalogueLocaleContext).t;
