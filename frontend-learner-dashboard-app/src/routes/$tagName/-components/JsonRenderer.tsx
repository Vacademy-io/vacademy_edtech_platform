import React, { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState } from "react";
import { FitImage } from "@/components/common/fit-image/FitImage";
import { useTranslation } from "react-i18next";
import { useLocation } from "@tanstack/react-router";
import { Page, GlobalSettings, CourseCatalogueData } from "../-types/course-catalogue-types";
import { useCatalogueLocale } from "../-utils/catalogue-locale";
import {
  hasVisibleWhenRules,
  localizeComponentProps,
  sectionVisibility,
} from "../-utils/catalogue-site-language";
import {
  buildComponentStyle,
  buildResponsiveCSS,
  getHoverClass,
  hasSectionShell,
  buildSectionShellStyles,
  type ComponentStyle,
} from "../-utils/style-utils";
import { SectionDecorations, hasDecorations } from "../-utils/catalogue-decorations";
import { blockTypeLabel } from "../-utils/preview-bridge";
import { CatalogueLink } from "./CatalogueLink";
import PhoneInput from "react-phone-input-2";
// Same stylesheet every other phone field in the app imports. Mixing this with
// react-phone-input-2's other skins in one bundle stacks the flag on top of the
// country name, so this must stay `bootstrap.css`.
import "react-phone-input-2/lib/bootstrap.css";
import {
  phoneFieldHasInput,
  usePreferredPhoneCountries,
} from "@/hooks/use-preferred-phone-countries";
import {
  CaretLeft,
  CaretRight,
  GraduationCap,
  Train,
  Bank,
  Newspaper,
  Exam,
  Books,
  FileText,
  SquaresFour,
  Fire,
  Student,
  ChalkboardTeacher,
  Rocket,
  Target,
  UsersThree,
  Code,
  Brain,
  Trophy,
  Lightbulb,
  ShieldCheck,
  ChartLineUp,
  Clock,
  Star,
  BookOpen,
  Certificate,
  ChatsCircle,
  Wrench,
  Sparkle,
  Medal,
  Briefcase,
  Globe,
  Check,
} from "@phosphor-icons/react";
import { HeaderComponent } from "./components/HeaderComponent";
import { headerOffsetClass } from "./header/header-chrome";
import { HtmlPageSection } from './components/HtmlPageSection';
import { HtmlBlockSection } from "./components/HtmlBlockSection";
import { ProductPageOfferComponent } from "./components/ProductPageOfferComponent";
import { FolderBrowserComponent } from "./components/FolderBrowserComponent";
import { AccessPassGridComponent } from "./components/AccessPassGridComponent";
import { DetailBlocksComponent } from "./components/DetailBlocksComponent";
import { BlogComponent } from "./components/BlogComponent";
import { JobOpeningsComponent } from "./components/JobOpeningsComponent";
import { LeadFormComponent } from "./components/LeadFormComponent";
import { submitWebsiteLead, isSpamSubmission } from "../-utils/website-lead";
import { emitLeadCaptured } from "../-utils/catalogue-tracking";
import { useNewsletterSignup } from "./components/newsletter/use-newsletter-signup";
import { CtaBand } from "./components/promo/CtaBand";
import { StepsCards } from "./components/promo/StepsCards";
import { PromoPopup } from "./components/promo/PromoPopup";
import { BannerComponent } from "./components/BannerComponent";
import { CourseCatalogComponent } from "./components/CourseCatalogComponent";
// Removed CourseRecommendationsComponent import as it's not used
// Removed CourseDetailsComponent import as it's not used
import { FooterComponent } from "./components/FooterComponent";
import { HeroSectionComponent } from "./components/HeroSectionComponent";
import { MediaShowcaseComponent } from "./components/MediaShowcaseComponent";
import { PlainVideoPlayer } from "./components/PlainVideoPlayer";
import { isDirectVideoFile } from "../-utils/video-url";
import { normalizeResourceUrl, trackResourceDownload, useResourceUnlocked } from "../-utils/resource-unlock";
import { StatsHighlightsComponent } from "./components/StatsHighlightsComponent";
import { CourseShowcaseComponent } from "./components/CourseShowcaseComponent";
import { TestimonialSectionComponent } from "./components/TestimonialSectionComponent";
import { CartComponent } from "./components/CartComponent";
import { BuyRentSectionComponent } from "./components/BuyRentSectionComponent";
import { BookCatalogueComponent } from "./components/BookCatalogueComponent";
import { BookDetailsComponent } from "./components/BookDetailsComponent";
import { DocumentViewerComponent } from "./components/DocumentViewerComponent";
import { Policy } from "./components/Policy";
import { RAIL_CLONE_PROPS, useAutoScrollRail, useRailArrows } from "../-utils/use-auto-scroll-rail";
import { useCatalogueSearchParams } from "../-utils/catalogue-url-state";

// Opt-in section: loaded only by pages that have a learningPath, so every
// other page (and the logged-in app, which bundles this renderer) skips it.
const LearningPathComponent = lazy(() =>
  import("./components/LearningPathComponent").then((m) => ({ default: m.LearningPathComponent })),
);

interface JsonRendererProps {
  page: Page;
  globalSettings: GlobalSettings;
  instituteId: string;
  tagName: string;
  courseData?: any; // Course data for dynamic content
  catalogueData?: CourseCatalogueData; // Full catalogue data for route matching
  isPreviewMode?: boolean; // When true, shows component selection UI for admin editor
  /** The editor's own marks — hidden-block strips and per-block frames inside
   *  columns and tabs. Defaults to isPreviewMode; the headless AI preview
   *  (not framed) turns them off, as it shoots the page as visitors see it. */
  previewChrome?: boolean;
  /** Preview "Browse" mode: the page is clickable as on the live site and
   *  clicking no longer selects blocks. */
  previewInteractive?: boolean;
  /** Preview only: the real route of the page shown as the root page, for the
   *  header's active nav item. */
  previewPath?: string;
  selectedComponentId?: string | null; // Currently selected component to highlight
  /** Preview click on a block; parentId is set for a block inside a column or tab. */
  onComponentClick?: (componentId: string, pageId: string, parentId?: string) => void;
}

export const JsonRenderer: React.FC<JsonRendererProps> = ({
  page,
  globalSettings,
  instituteId,
  tagName,
  courseData,
  catalogueData,
  isPreviewMode = false,
  previewChrome = isPreviewMode,
  previewInteractive = false,
  previewPath,
  selectedComponentId = null,
  onComponentClick,
}) => {
  // Site language (catalogue-locale): the dictionary for the visitor's
  // language, undefined in the base language or on a single-language site.
  const { dict } = useCatalogueLocale();

  /** A section with visibleWhen rules (e.g. "Start free" only on the
   *  unfiltered Courses view) follows the URL through VisibleWhenGate, around
   *  its whole wrapper so a hidden section leaves no styled band behind.
   *  Sections without rules render exactly as before — no URL subscription. */
  const withVisibleWhen = (
    component: { id?: string; visibleWhen?: unknown },
    element: React.ReactNode,
  ): React.ReactNode =>
    element && hasVisibleWhenRules(component) ? (
      <VisibleWhenGate key={component.id} rules={component.visibleWhen} isPreviewMode={isPreviewMode}>
        {element}
      </VisibleWhenGate>
    ) : (
      element
    );

  /** Builder preview only: a block that can be picked on its own. */
  const previewFrame = (component: { id: string; style?: any }, element: React.ReactNode, parentId?: string) => (
    <PreviewBlockFrame
      key={component.id}
      id={component.id}
      sticky={component.style?.sticky}
      selected={component.id === selectedComponentId}
      interactive={previewInteractive}
      onSelect={() => onComponentClick?.(component.id, page.id, parentId)}
    >
      {element}
    </PreviewBlockFrame>
  );

  /** Slot-child rendering (columnLayout columns, accordion/tab slots): same
   *  ComponentStyle treatment as top-level components — children previously
   *  went through bare renderComponent and silently lost their style.
   *  In the builder preview each child is pickable on its own (parentId = the
   *  column layout or tabs block holding it). */
  const renderChild = (child: any, parentId?: string): React.ReactNode => {
    const rendered = renderComponent(child);
    if (!rendered) {
      return previewChrome && child?.enabled === false
        ? previewFrame(child, <HiddenBlockStrip type={child.type} />, parentId)
        : null;
    }
    const styled = renderStyledChild(child, rendered);
    return withVisibleWhen(child, previewChrome ? previewFrame(child, styled, parentId) : styled);
  };

  const renderStyledChild = (child: any, rendered: React.ReactNode): React.ReactNode => {
    const hasStyle = child.style && Object.keys(child.style).length > 0;
    if (!hasStyle) return <React.Fragment key={child.id}>{rendered}</React.Fragment>;
    return (
      <ComponentStyleWrapper
        key={child.id}
        component={child}
        componentStyle={buildComponentStyle(child.style)}
        responsiveCSS={buildResponsiveCSS(child.id, child.style)}
        hoverClass={getHoverClass(child.style)}
        // Preview iframe: top-level components suppress entrances (preview
        // branch renders statically) — slot children must match, or they
        // hide behind IntersectionObserver gates while editing.
        motionOff={isPreviewMode || (globalSettings as any)?.motion?.personality === 'none'}
      >
        {rendered}
      </ComponentStyleWrapper>
    );
  };

  const renderComponent = (component: any) => {
    const { type, props: baseProps, id, enabled = true, showCondition } = component;

    // Check if component is enabled
    if (!enabled) {
      return null;
    }

    // Check conditional rendering based on showCondition
    if (showCondition) {
      const { field, value } = showCondition;
      // Support nested field paths like "globalSettings.courseCatalogeType.enabled"
      // If field starts with "globalSettings.", remove it since we already have globalSettings
      const fieldPath = field.startsWith('globalSettings.') ? field.substring('globalSettings.'.length) : field;
      const fieldParts = fieldPath.split('.');
      let currentValue: any = globalSettings;

      for (const part of fieldParts) {
        if (currentValue && typeof currentValue === 'object' && part in currentValue) {
          currentValue = currentValue[part];
        } else {
          currentValue = undefined;
          break;
        }
      }

      // Normalize boolean values for comparison (handle both boolean true and string "true")
      const normalizedCurrentValue = typeof currentValue === 'boolean' ? currentValue : currentValue;
      const normalizedExpectedValue = typeof value === 'boolean' ? value : (value === 'true' || value === true);


      // Check if condition matches
      if (normalizedCurrentValue !== normalizedExpectedValue) {
        return null;
      }
    }

    // Authored text in the visitor's language — the very same object as the
    // base props when there is no dictionary. Slot children are localized
    // when renderChild reaches them.
    const localizedProps = localizeComponentProps(baseProps, dict);
    // Style-panel Background Color is painted on the wrapper, but these blocks
    // paint their own opaque section (bg-catalogue-bg) on top of it and only
    // honour props.backgroundColor — so the picked colour never showed. Hand
    // it to the block when it has no colour of its own (mirror of the shell
    // canvas adopting props.backgroundColor in ComponentStyleWrapper).
    const props = withStyleBackground(type, localizedProps, component.style);

    switch (type) {
      case "header":
        return (
          <HeaderComponent
            key={id}
            {...props}
            navigation={props.navigation}
            authLinks={props.authLinks}
            catalogueData={catalogueData}
            tagName={tagName}
            instituteId={instituteId}
            globalSettings={globalSettings}
            // The untranslated props, for logic that keys on authored labels
            // or links (which button opens the lead form, and so on).
            baseProps={baseProps}
            previewPath={previewPath}
          />
        );
      case "banner":
        return <BannerComponent key={id} {...props} />;
      case "courseCatalog":
        return (
          <CourseCatalogComponent
            key={id}
            {...props}
            instituteId={instituteId}
            globalSettings={globalSettings}
            tagName={tagName}
          />
        );
      case "bookCatalogue":
        return (
          <BookCatalogueComponent
            key={id}
            {...props}
            instituteId={instituteId}
            globalSettings={globalSettings}
            tagName={tagName}
          />
        );
      case "courseDetails":
        // Skip course details component - it shows hardcoded data after footer
        return null;
      case "bookDetails":
        return (
          <BookDetailsComponent
            key={id}
            {...props}
            courseData={courseData}
            instituteId={instituteId}
          />
        );
      case "courseRecommendations":
        // Skip course recommendations component - user doesn't want "you may also like" section
        return null;
      case "footer":
        return (
          <FooterComponent
            key={id}
            {...props}
            catalogueData={catalogueData}
            tagName={tagName}
            baseProps={baseProps}
            // The brand footer's newsletter needs it; the original footer ignores it.
            instituteId={instituteId}
            globalSettings={globalSettings}
          />
        );
      case "heroSection":
        return <HeroSectionComponent key={id} {...props} courseData={courseData} />;
      case "mediaShowcase":
      case "MediaShowcaseComponent":
        return <MediaShowcaseComponent key={id} {...props} />;
      case "statsHighlights":
        // baseProps: each stat's icon is picked from its authored label, so
        // the icons stay the same in every language.
        return <StatsHighlightsComponent key={id} {...props} baseProps={baseProps} />;
      case "courseShowcase":
        // Curated strip (new / on sale / one tag / hand-picked). Unlike
        // productCourseGrid this shows a LIMITED, chosen set — no filters.
        return (
          <CourseShowcaseComponent
            key={id}
            {...props}
            instituteId={instituteId}
            tagName={tagName}
            globalSettings={globalSettings}
          />
        );
      case "testimonialSection":
        return <TestimonialSectionComponent key={id} {...props} />;
      case "cartComponent":
        return <CartComponent key={id} {...props} instituteId={instituteId} globalSettings={globalSettings} isPreviewMode={isPreviewMode} />;
      case "buyRentSection":
        return <BuyRentSectionComponent key={id} {...props} tagName={tagName} />;
      case "policyRenderer":
        return <Policy key={id} {...props} />;

      case "faqSection":
        return <FaqSectionRenderer key={id} {...props} />;
      case "videoEmbed":
        return <VideoEmbedRenderer key={id} {...props} />;
      case "documentViewer":
        return <DocumentViewerComponent key={id} {...props} />;
      case "ctaBanner":
        // variant "band" (opt-in): eyebrow, two styled buttons, phone mockup.
        return props?.variant === "band" ? <CtaBand key={id} {...props} /> : <CtaBannerRenderer key={id} {...props} />;
      case "pricingTable":
        return <PricingTableRenderer key={id} {...props} />;
      case "contactForm":
        // baseFields: answers are submitted under the authored field names
        // and labels, whatever language the visitor reads the form in.
        return (
          <ContactFormRenderer
            key={id}
            {...props}
            baseFields={baseProps?.fields}
            instituteId={instituteId}
            tagName={tagName}
            isPreviewMode={isPreviewMode}
          />
        );
      case "teamSection":
        return <TeamSectionRenderer key={id} {...props} />;
      case "announcementFeed":
        return <AnnouncementFeedRenderer key={id} {...props} />;
      case "imageGallery":
        return <ImageGalleryRenderer key={id} {...props} />;

      case "spacer":
        return <SpacerRenderer key={id} {...props} />;
      case "tabsAccordion":
        return (
          <TabsAccordionRenderer
            key={id}
            {...props}
            renderSlot={(comps: any[]) => comps.map((child) => renderChild(child, id))}
          />
        );
      case "trustChip":
        return <TrustChipRenderer key={id} {...props} />;
      case "sectionHeading":
        return <SectionHeadingRenderer key={id} {...props} />;
      case "logoCloud":
        return <LogoCloudRenderer key={id} {...props} />;
      case "mapEmbed":
        return <MapEmbedRenderer key={id} {...props} />;
      case "countdownTimer":
        return <CountdownTimerRenderer key={id} {...props} />;
      case "textBlock":
        return <TextBlockRenderer key={id} {...props} />;
      case "featureGrid":
        return <FeatureGridRenderer key={id} {...props} />;
      case "detailBlocks":
        // Dense per-item spec blocks (programmes/services/plans). isPreviewMode
        // so an unconfigured section guides the admin instead of vanishing;
        // baseProps so anchor ids (deep links) come from the authored titles.
        return (
          <DetailBlocksComponent key={id} {...props} isPreviewMode={isPreviewMode} baseProps={baseProps} />
        );

      case "marquee":
        return <MarqueeRenderer key={id} {...props} />;

      case "promoPopup":
        // Opens over the page (portal into the site's theme wrapper) on its own
        // trigger; in the editor preview a strip marks it and selecting it
        // opens the popup.
        return (
          <PromoPopup
            key={id}
            {...props}
            componentId={id}
            instituteId={instituteId}
            tagName={tagName}
            isPreviewMode={isPreviewMode}
            showPreviewStrip={previewChrome}
            isSelected={id === selectedComponentId}
          />
        );

      case "blog":
        // Live-reads the institute's published posts (Manage Pages → Blog /
        // MCP). Renders the list, or one article when the URL carries a slug
        // after this page's route — see BlogComponent.
        return (
          <BlogComponent
            key={id}
            {...props}
            instituteId={instituteId}
            tagName={tagName}
            // Recommended-course cards under an article use the site's card settings.
            globalSettings={globalSettings}
            pageRoute={page.route || ""}
            isPreviewMode={isPreviewMode}
          />
        );

      case "jobOpenings":
        // Careers: job cards, or one job as its own page when the URL carries
        // its slug after this page's route (same address shape as a blog
        // post). baseProps: slugs come from the authored titles, so a job has
        // one address in every site language.
        return (
          <JobOpeningsComponent
            key={id}
            {...props}
            baseProps={baseProps}
            tagName={tagName}
            pageRoute={page.route || ""}
            isPreviewMode={isPreviewMode}
          />
        );

      case "leadForm":
        // An Audience campaign's form rendered inline — the form definition
        // lives in the CRM (AUDIENCE_FORM custom fields), fetched live.
        return (
          <LeadFormComponent
            key={id}
            {...props}
            instituteId={instituteId}
            isPreviewMode={isPreviewMode}
          />
        );
      case "imageBlock":
        return <ImageBlockRenderer key={id} {...props} />;
      case "buttonBlock":
        return <ButtonBlockRenderer key={id} {...props} />;
      case "newsletterSignup":
        return <NewsletterSignupRenderer key={id} {...props} instituteId={instituteId} tagName={tagName} isPreviewMode={isPreviewMode} />;
      case "stepsProcess":
        // variant "cards" (opt-in): one row of numbered cards.
        return props?.variant === "cards" ? <StepsCards key={id} {...props} /> : <StepsProcessRenderer key={id} {...props} />;

      case "productCourseGrid":
        // In the catalogue context, render as a standard course catalog grid
        return (
          <CourseCatalogComponent
            key={id}
            {...props}
            instituteId={instituteId}
            globalSettings={globalSettings}
            tagName={tagName}
          />
        );

      case "productPageOffer":
        // Live-reads the product page's courses; instituteId/preview come from
        // the renderer, everything else from props.
        return (
          <ProductPageOfferComponent
            key={id}
            {...props}
            instituteId={instituteId}
            tagName={tagName}
            isPreviewMode={isPreviewMode}
            // Joins the site-wide cart when globalSettings.siteCart is on;
            // otherwise the section keeps its own basket, exactly as before.
            globalSettings={globalSettings}
          />
        );

      case "folderBrowser":
        // A shared folder library (Manage Pages → Folders), read live; a
        // product page inside the open folder shows its courses inline.
        return (
          <FolderBrowserComponent
            key={id}
            {...props}
            instituteId={instituteId}
            tagName={tagName}
            isPreviewMode={isPreviewMode}
            globalSettings={globalSettings}
          />
        );

      case "accessPassGrid":
        // Published Access Passes (one purchase -> several courses), read live.
        // Buying goes through the pass invite on the enroll-by-invite page.
        return (
          <AccessPassGridComponent
            key={id}
            {...props}
            instituteId={instituteId}
            tagName={tagName}
            isPreviewMode={isPreviewMode}
            globalSettings={globalSettings}
          />
        );

      case "learningPath":
        // Ordered product pages as numbered steps, or a stream's paths as
        // cards — read live, like productPageOffer. Its own boundary: while
        // the section's code loads, only this section is empty.
        return (
          <Suspense key={id} fallback={null}>
            <LearningPathComponent
              {...props}
              // Opt-in sharedWith: it reads goals / featured path from a section on this page.
              pageSections={props?.sharedWith ? page.components : undefined}
              instituteId={instituteId}
              tagName={tagName}
              globalSettings={globalSettings}
              isPreviewMode={isPreviewMode}
            />
          </Suspense>
        );

      case "htmlPage":
        // A whole pasted page. Always a page's only component (created by the
        // Add Page > HTML page flow), so it takes the site stylesheet and
        // binds the action hooks; htmlBlock below is the SECTION-level hatch.
        return (
          <HtmlPageSection
            key={id}
            html={props.html as string}
            css={props.css as string}
            siteCss={(globalSettings as any)?.customCss as string | undefined}
            tagName={tagName}
            courseData={courseData}
          />
        );

      case "htmlBlock":
        // Sanitized + shadow-scoped custom HTML/CSS (see catalogue-html.ts) —
        // never raw dangerouslySetInnerHTML: htmlBlock content can come from
        // AI generation or admin paste and renders on the learner domain.
        return (
          <HtmlBlockSection
            key={id}
            html={props.html as string}
            css={props.css as string}
          />
        );

      case "columnLayout": {
        const {
          slots = [] as any[][],
          columnWidths = [] as string[],
          columnFr = undefined as string[] | undefined,
          gap = 'md',
          align = 'top',
          stackOnMobile = true,
          reverseOnMobile = false,
        } = props;
        const gapMap: Record<string, string> = { none: '0', sm: '0.5rem', md: '1rem', lg: '2rem', xl: '3rem', '2xl': '4rem' };
        const alignMap: Record<string, string> = { top: 'start', center: 'center', bottom: 'end', stretch: 'stretch' };
        const widthToFr = (w?: string) => {
          const map: Record<string, string> = { '1/2': '1fr', '1/3': '1fr', '2/3': '2fr', '1/4': '1fr', '3/4': '3fr' };
          return map[w ?? ''] || '1fr';
        };
        // columnFr (true per-column track sizes, e.g. ['3fr','2fr']) takes
        // precedence over the legacy lossy columnWidths fractions. Array.isArray
        // matters: a hand-authored STRING whose length equals the slot count
        // would otherwise pass the guard and crash on .every().
        const gridCols = Array.isArray(columnFr) && columnFr.length === slots.length && columnFr.every(Boolean)
          ? columnFr.join(' ')
          : slots.map((_: any, i: number) => widthToFr(columnWidths[i])).join(' ');
        // Use a CSS custom property so the @media rule in index.css can override it
        // on mobile (inline styles can't be overridden by regular rules, but CSS
        // custom properties cascade normally and can be overridden with !important).
        return (
          <div
            key={id}
            className={`${stackOnMobile ? 'grid-layout-responsive' : ''} ${stackOnMobile && reverseOnMobile ? 'grid-layout-reverse' : ''}`}
            style={{
              '--catalogue-grid-cols': gridCols,
              display: 'grid',
              gridTemplateColumns: 'var(--catalogue-grid-cols)',
              gap: gapMap[gap] || '1rem',
              alignItems: alignMap[align] || 'start',
            } as React.CSSProperties}
          >
            {slots.map((slotComponents: any[], slotIndex: number) => (
              <div
                key={slotIndex}
                className="min-w-0"
                // A sticky child needs travel room: stretch just this slot to
                // the row height, overriding the container's alignItems.
                style={{
                  alignSelf: slotComponents.some((c: any) => c?.style?.sticky?.enabled) ? 'stretch' : undefined,
                }}
              >
                {slotComponents.map((child: any) => renderChild(child, id))}
              </div>
            ))}
          </div>
        );
      }

      default:
        console.warn(`Unknown component type: ${type}`);
        return null;
    }
  };

  // Check if page has a header component to add appropriate top padding
  // But don't add padding when the page IS the header itself (id="header")
  const hasHeader = page.id !== 'header' && page.components.some(
    (component) => component.type === 'header' && component.enabled !== false
  );
  // A compact header bar (barSize "compact") is 64px at every width.
  const pageHeaderProps = hasHeader
    ? (page.components.find((component) => component.type === 'header' && component.enabled !== false) as any)?.props
    : undefined;

  /** One top-level section inside its style / preview wrapper. */
  const renderTopLevel = (component: Page["components"][number]) => {
    const rendered = renderComponent(component);
    if (!rendered) {
      // Switched off in the editor: visitors see nothing, the preview a strip.
      return previewChrome && component.enabled === false
        ? previewFrame(component, <HiddenBlockStrip type={component.type} />)
        : null;
    }

    const componentStyle = buildComponentStyle(component.style);
    const responsiveCSS = buildResponsiveCSS(component.id, component.style);
    const hoverClass = getHoverClass(component.style);
    const hasOverlay = component.style?.backgroundImage && component.style?.backgroundOverlay;
    const hasStyle = component.style && Object.keys(component.style).length > 0;

    if (isPreviewMode) {
      const isSelected = component.id === selectedComponentId;
      const shell = hasSectionShell(component.style);
      const shellStyles = shell ? buildSectionShellStyles(component.style!) : null;
      const outerStyle = shellStyles ? shellStyles.canvasStyle : componentStyle;
      const decor = hasDecorations(component.style?.ornaments, component.style?.dividers);
      // Select mode: clicks land on this wrapper (nested blocks opt back in).
      const contentPointerEvents = previewInteractive ? undefined : ('none' as const);
      return (
        <div
          key={component.id}
          id={component.anchorId || undefined}
          data-component-id={component.id}
          data-cid={component.id}
          // Browse mode: the section behaves as on the live site (same
          // markup, so open menus and tabs keep their state across modes).
          onClick={previewInteractive ? undefined : () => onComponentClick?.(component.id, page.id)}
          className={`relative ${component.style?.customClass || ''} ${hoverClass} ${isSelected ? 'outline outline-2 outline-blue-500 outline-offset-[-2px]' : previewInteractive ? '' : 'hover:outline hover:outline-1 hover:outline-blue-300 hover:outline-offset-[-1px]'}`}
          style={{ cursor: previewInteractive ? undefined : 'pointer', ...outerStyle, ...(component.style?.ornaments?.length ? { overflow: 'hidden' } : {}) }}
        >
          {responsiveCSS && <style dangerouslySetInnerHTML={{ __html: responsiveCSS }} />}
          {hasOverlay && (
            <div style={{ position: 'absolute', inset: 0, backgroundColor: component.style!.backgroundOverlay, zIndex: 0, borderRadius: outerStyle.borderRadius }} />
          )}
          {decor && <SectionDecorations ornaments={component.style?.ornaments} dividers={component.style?.dividers} />}
          <div
            style={
              shellStyles
                ? { ...shellStyles.contentStyle, pointerEvents: contentPointerEvents, position: 'relative', zIndex: 1 }
                : { pointerEvents: contentPointerEvents, position: hasOverlay || decor ? 'relative' : undefined, zIndex: hasOverlay || decor ? 1 : undefined }
            }
          >
            {rendered}
          </div>
          {isSelected && !previewInteractive && (
            <div className="absolute top-0 start-0 z-50 bg-primary-500 text-white text-xs px-2 py-0.5 rounded-ee-md font-medium select-none">
              {component.type}
            </div>
          )}
        </div>
      );
    }

    // Normal (non-preview) rendering with style wrapper
    if (hasStyle) {
      return (
        <ComponentStyleWrapper key={component.id} component={component} componentStyle={componentStyle} responsiveCSS={responsiveCSS} hoverClass={hoverClass} motionOff={(globalSettings as any)?.motion?.personality === 'none'}>
          {rendered}
        </ComponentStyleWrapper>
      );
    }

    // Plain rendering — still add anchor ID if present
    if (component.anchorId) {
      return <div key={component.id} id={component.anchorId} className="catalogue-block-anchor">{rendered}</div>;
    }
    return <React.Fragment key={component.id}>{rendered}</React.Fragment>;
  };

  return (
    <div
      className={`page w-full ${hasHeader ? headerOffsetClass(pageHeaderProps) : ''}`}
      data-page-id={page.id}
    >
      {page.components.map((component) => withVisibleWhen(component, renderTopLevel(component)))}
    </div>
  );
};

/**
 * Builder preview only: wraps a block inside a column or tab (or a hidden
 * block) so a click picks that block rather than the section around it. The
 * section's content is click-through in Select mode, so this frame opts back
 * in and keeps its own content inert. Browse mode leaves clicks alone.
 */
const PreviewBlockFrame: React.FC<{
  id: string;
  /** The block's sticky rail: the frame sticks in its place (the block's own
   *  sticky has no room to move inside a frame its own height). */
  sticky?: { enabled?: boolean; top?: number };
  selected: boolean;
  interactive: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}> = ({ id, sticky, selected, interactive, onSelect, children }) => (
  <div
    data-cid={id}
    style={sticky?.enabled ? { position: 'sticky', top: `${sticky.top ?? 88}px` } : undefined}
    onClick={
      interactive
        ? undefined
        : (event) => {
            event.stopPropagation();
            onSelect();
          }
    }
    className={`${interactive ? '' : 'pointer-events-auto cursor-pointer'} ${
      selected
        ? 'outline outline-2 outline-blue-500 outline-offset-[-2px]'
        : interactive
          ? ''
          : 'hover:outline hover:outline-1 hover:outline-blue-300 hover:outline-offset-[-1px]'
    }`}
  >
    <div className={interactive ? undefined : 'pointer-events-none'}>{children}</div>
  </div>
);

/** Builder preview only: a block switched off in the editor, dimmed and
 *  labelled so it can still be found and picked. Visitors never see it. */
const HiddenBlockStrip: React.FC<{ type: string }> = ({ type }) => {
  const { t } = useTranslation("coursePlayerA");
  return (
    <div className="mx-auto my-2 max-w-5xl rounded-catalogue-md border border-dashed border-catalogue-border px-4 py-3 text-center text-sm text-catalogue-text-muted opacity-70">
      {t("jsonRenderer.hiddenBlock", { label: blockTypeLabel(type) })}
    </div>
  );
};

/**
 * Shows its section only when the section's visibleWhen rules hold for the
 * current query string. In the builder preview a section hidden for the URL
 * still renders, marked, so the admin can see and select it.
 */
const VisibleWhenGate: React.FC<{ rules: unknown; isPreviewMode: boolean; children: React.ReactNode }> = ({
  rules,
  isPreviewMode,
  children,
}) => {
  const searchStr = useLocation({ select: (location) => location.searchStr || "" });
  const visibility = sectionVisibility({ visibleWhen: rules }, searchStr, isPreviewMode);
  if (visibility === "hide") return null;
  if (visibility === "hint") return <HiddenForUrlHint>{children}</HiddenForUrlHint>;
  return <>{children}</>;
};

/**
 * Builder preview only: a section whose visibleWhen rules hide it for the
 * current URL (e.g. "Start free" on a filtered Courses view). Visitors never
 * see it; the admin sees it dimmed and labelled so it can still be selected.
 */
const HiddenForUrlHint: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t } = useTranslation("coursePlayerA");
  return (
    <div className="relative rounded-catalogue-md border border-dashed border-catalogue-border">
      <span className="absolute end-2 top-2 z-10 rounded-full bg-catalogue-bg-elevated px-2 py-0.5 text-xs font-medium text-catalogue-text-muted shadow-sm">
        {t("jsonRenderer.hiddenForUrl", "Hidden for this URL")}
      </span>
      <div className="opacity-60">{children}</div>
    </div>
  );
};

/* ─── Inline renderers for new component types ───────────────────────────── */

/** True when a #rrggbb color is dark enough to need light text on top. */
const isHexDark = (hex?: string): boolean => {
  const raw = (hex || '').trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return false;
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  // Rec. 601 relative luminance; < 0.55 reads as "dark".
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.55;
};

/** Blocks whose own section is opaque unless props.backgroundColor is set,
 *  so a style-panel Background Color on the wrapper is never seen. Blocks
 *  outside this list either let the wrapper show through already or give
 *  props.backgroundColor extra meaning (hero drops its image, header and
 *  footer have their own pickers) — they keep their current behaviour. */
const STYLE_BG_TO_PROPS_TYPES = new Set([
  'sectionHeading', 'faqSection', 'contactForm', 'announcementFeed',
  'tabsAccordion', 'featureGrid', 'newsletterSignup', 'stepsProcess',
]);

/** Props with the style-panel Background Color handed to the block, when it
 *  is a plain #rrggbb (what the picker writes, and what sectionText can read
 *  for contrast) and the style paints no image or gradient over it. */
const withStyleBackground = <P,>(type: string, props: P, style?: ComponentStyle): P => {
  const styleBg = style?.backgroundColor;
  if (!STYLE_BG_TO_PROPS_TYPES.has(type)) return props;
  if (typeof styleBg !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(styleBg.trim())) return props;
  if (style?.backgroundImage || style?.gradient || style?.backgroundLayers?.length) return props;
  if ((props as { backgroundColor?: unknown } | undefined)?.backgroundColor) return props;
  return { ...props, backgroundColor: styleBg.trim() };
};

/**
 * Text classes for section copy. Three cases, because an author-colored
 * surface can be anything:
 *   no background  → theme tokens (adapt to presets + dark mode)
 *   DARK author bg → light ink (near-black tokens/greys measured 1.32:1 on the
 *                    deep-green bands the AI composer likes — invisible copy)
 *   LIGHT author bg → fixed dark neutrals (token text goes near-white in dark
 *                     mode and would vanish on an author-picked light color)
 */
const sectionText = (customBg?: string) => {
  if (!customBg) {
    return {
      heading: 'text-catalogue-text-primary',
      body: 'text-catalogue-text-secondary',
      muted: 'text-catalogue-text-muted',
    };
  }
  if (isHexDark(customBg)) {
    return { heading: 'text-white', body: 'text-white/85', muted: 'text-white/70' };
  }
  return {
    heading: 'text-gray-900', // design-lint-ignore: fixed neutrals over author-colored surface
    body: 'text-gray-600', // design-lint-ignore: fixed neutrals over author-colored surface
    muted: 'text-gray-600', // design-lint-ignore: fixed neutrals over author-colored surface
  };
};

/** Inline style for an author-set section background (undefined otherwise,
 *  letting the token fallback class on the element show through). */
const sectionBg = (customBg?: string): React.CSSProperties | undefined =>
  customBg ? { backgroundColor: customBg } : undefined;

/** Curated icon set for featureGrid/steps — 'iconName' values map here;
 *  anything else falls back to the legacy emoji/text `icon` field. */
const FEATURE_ICON_MAP: Record<string, React.ComponentType<any>> = {
  GraduationCap, Rocket, Target, UsersThree, Code, Brain, Trophy, Lightbulb,
  ShieldCheck, ChartLineUp, Clock, Star, BookOpen, Certificate, ChatsCircle,
  Wrench, Sparkle, Medal, Briefcase, Globe,
  Train, Bank, Newspaper, Exam, Books, FileText, SquaresFour, Fire, Student, ChalkboardTeacher,
};

/**
 * Prev/next arrows over a full-bleed card rail (featureGrid 'carousel'), the
 * same affordance the product-page rail has. Hidden until there is somewhere
 * to go; swipe and snap stay the primary way to move on touch screens.
 */
const RailArrows: React.FC<{ canPrev: boolean; canNext: boolean; onMove: (dir: number) => void }> = ({ canPrev, canNext, onMove }) => {
  const { t } = useTranslation("coursePlayerB");
  const cls =
    "catalogue-btn catalogue-btn-secondary absolute top-1/2 hidden size-10 -translate-y-1/2 justify-center rounded-full border-catalogue-border bg-catalogue-bg catalogue-btn-icon shadow-lg md:inline-flex";
  return (
    <>
      {canPrev && (
        <button type="button" onClick={() => onMove(-1)} aria-label={t("common.previousSlide")} className={`${cls} left-3`}>
          <CaretLeft className="size-5" weight="bold" aria-hidden="true" />
        </button>
      )}
      {canNext && (
        <button type="button" onClick={() => onMove(1)} aria-label={t("common.nextSlide")} className={`${cls} right-3`}>
          <CaretRight className="size-5" weight="bold" aria-hidden="true" />
        </button>
      )}
    </>
  );
};

/**
 * featureGrid style 'categoryTiles': a row of icon tiles that filter the page.
 * Each tile writes `?<filterParam>=<value>` (a tile with no value clears it =
 * "All"), and the sections below opt in with visibleWhen rules on that param.
 * The tile matching the current URL is filled, so the visitor always sees
 * which category they are in. No navigation, no scroll jump.
 */
const CategoryTilesRenderer: React.FC<any> = ({ headerText, subheading, features = [], filterParam, backgroundColor }) => {
  const txt = sectionText(backgroundColor);
  const param = String(filterParam || 'cat').trim() || 'cat';
  const { get, update } = useCatalogueSearchParams();
  const current = (get(param) || '').toLowerCase();
  return (
    <section style={sectionBg(backgroundColor)} className="catalogue-section bg-catalogue-bg">
      <div className="catalogue-shell">
        {headerText && <h2 className={`mb-2 text-center catalogue-h2 ${txt.heading}`}>{headerText}</h2>}
        {subheading && <p className={`catalogue-lead catalogue-measure mb-8 text-center ${txt.muted}`}>{subheading}</p>}
        <div
          role="tablist"
          aria-label={headerText || param}
          className="catalogue-no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:flex-wrap sm:justify-center sm:gap-4 sm:overflow-visible sm:px-0"
        >
          {features.map((f: any, i: number) => {
            const value = String(f.value || '').trim();
            const active = value.toLowerCase() === current;
            const IconComp = f.iconName ? FEATURE_ICON_MAP[f.iconName] : undefined;
            return (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => update({ [param]: value || null })}
                className={`flex w-28 shrink-0 snap-start flex-col items-center justify-center gap-3 rounded-catalogue-lg border p-4 text-center transition-all duration-200 sm:w-36 sm:p-5 ${
                  active
                    ? 'border-transparent bg-primary-500 text-primary-foreground shadow-lg'
                    : 'border-catalogue-border bg-catalogue-bg-subtle text-catalogue-text-primary hover:-translate-y-0.5 hover:shadow-md'
                }`}
              >
                {IconComp ? (
                  <IconComp size={40} weight="duotone" aria-hidden="true" className={active ? '' : 'text-catalogue-brand-ink'} />
                ) : f.icon ? (
                  <span className="text-3xl" aria-hidden="true">{f.icon}</span>
                ) : null}
                <span className="text-sm font-semibold leading-tight">{f.title}</span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
};

const FaqSectionRenderer: React.FC<any> = ({ headerText, subheading, faqs = [], backgroundColor }) => {
  const [openIndex, setOpenIndex] = React.useState<number | null>(null);
  const sectionUid = React.useId();
  const txt = sectionText(backgroundColor);
  return (
    <section style={sectionBg(backgroundColor)} className="catalogue-section bg-catalogue-bg-subtle">
      <div className="catalogue-shell-prose">
        {headerText && <h2 className={`mb-2 text-center catalogue-h2 ${txt.heading}`}>{headerText}</h2>}
        {subheading && <p className={`mb-10 text-center ${txt.muted}`}>{subheading}</p>}
        <div className="space-y-3">
          {faqs.map((faq: any, i: number) => (
            <div key={i} data-stagger-item style={{ ['--stagger-i' as any]: i }} className="rounded-lg border border-catalogue-border bg-catalogue-bg overflow-hidden">
              <button
                type="button"
                aria-expanded={openIndex === i}
                aria-controls={`faq-panel-${sectionUid}-${i}`}
                id={`faq-trigger-${sectionUid}-${i}`}
                onClick={() => setOpenIndex(openIndex === i ? null : i)}
                className="flex w-full items-center justify-between px-6 py-4 text-start font-medium text-catalogue-text-primary hover:bg-catalogue-interactive-hover"
              >
                <span>{faq.question}</span>
                <span aria-hidden="true" className="ms-4 text-catalogue-text-muted text-xl">{openIndex === i ? '−' : '+'}</span>
              </button>
              {openIndex === i && (
                <div
                  id={`faq-panel-${sectionUid}-${i}`}
                  role="region"
                  aria-labelledby={`faq-trigger-${sectionUid}-${i}`}
                  className="border-t border-catalogue-border-subtle px-6 py-4 text-catalogue-text-secondary leading-relaxed"
                >
                  {faq.answer}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

const VideoEmbedRenderer: React.FC<any> = ({ url = '', title, caption, aspectRatio = '16:9', autoplay = false, poster = '' }) => {
  const { t } = useTranslation("coursePlayerA");
  // An UPLOADED file (mp4/webm) gets the play/pause-only player rather than an
  // iframe: framing a raw media URL hands the visitor the browser's stock media
  // page, complete with a download menu and no styling hooks. YouTube/Vimeo
  // links keep the iframe below.
  const isFile = isDirectVideoFile(url);
  const getEmbedUrl = (rawUrl: string) => {
    if (!rawUrl) return '';
    const ytMatch = rawUrl.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([A-Za-z0-9_-]{11})/);
    if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}${autoplay ? '?autoplay=1' : ''}`;
    const vimeoMatch = rawUrl.match(/vimeo\.com\/(\d+)/);
    if (vimeoMatch) return `https://player.vimeo.com/video/${vimeoMatch[1]}${autoplay ? '?autoplay=1' : ''}`;
    return rawUrl;
  };
  const padMap: Record<string, string> = { '16:9': '56.25%', '4:3': '75%', '1:1': '100%', '9:16': '177.78%' };
  const embedUrl = getEmbedUrl(url);
  return (
    <section className="catalogue-section-tight">
      <div className="catalogue-shell-narrow">
        {title && <h2 className="mb-6 text-center text-2xl font-bold text-catalogue-text-primary">{title}</h2>}
        {isFile ? (
          <PlainVideoPlayer src={url} poster={poster} title={title || caption} paddingBottom={padMap[aspectRatio] || '56.25%'} />
        ) : embedUrl ? (
          <div className="relative w-full overflow-hidden rounded-xl shadow-lg" style={{ paddingBottom: padMap[aspectRatio] || '56.25%' }}>
            <iframe src={embedUrl} className="absolute inset-0 size-full" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen title={title || t("jsonRenderer.video")} />
          </div>
        ) : (
          <div className="flex items-center justify-center rounded-xl bg-catalogue-bg-muted text-catalogue-text-muted" style={{ aspectRatio: aspectRatio.replace(':', '/') }}>
            {t("jsonRenderer.noVideoUrlConfigured")}
          </div>
        )}
        {caption && <p className="mt-3 text-center text-sm text-catalogue-text-muted">{caption}</p>}
      </div>
    </section>
  );
};

const CtaBannerRenderer: React.FC<any> = ({ heading, subheading, backgroundColor = '#3B82F6', textColor = 'white', layout = 'centered', button }) => { // design-lint-ignore: page-builder default color
  const isSplit = layout === 'split';
  // Intentional white: the button sits on the author-colored banner surface,
  // so it must stay white in every theme/mode (not a token surface).
  const ctaButtonClass = 'mt-4 inline-block rounded-lg bg-white px-8 py-3 font-semibold shadow-md transition hover:opacity-90'; // design-lint-ignore: intentional white over author-colored surface
  // Optional author colours for the button; defaults keep the white button
  // with banner-coloured text.
  const ctaButtonStyle = { color: button?.textColor || backgroundColor, backgroundColor: button?.backgroundColor || undefined }; // design-lint-ignore: page-builder dynamic button color
  return (
    <section style={{ backgroundColor }} className="catalogue-section">
      <div className={`catalogue-shell flex ${isSplit ? 'items-center justify-between gap-8 flex-wrap' : 'flex-col items-center text-center'}`}>
        <div className={isSplit ? 'flex-1' : ''}>
          {heading && <h2 style={{ color: textColor }} className="catalogue-h2">{heading}</h2>}
          {subheading && <p style={{ color: textColor, opacity: 0.85 }} className="mt-2 text-lg">{subheading}</p>}
        </div>
        {button?.enabled &&
          (button.action === 'openForm' && button.audienceId ? (
            <button
              type="button"
              onClick={() => dispatchOpenAudienceForm(button.audienceId, button.formTitle || button.text)}
              className={ctaButtonClass}
              style={ctaButtonStyle}
            >
              {button.text}
            </button>
          ) : (
            <CatalogueLink to={button.target || '#'} className={ctaButtonClass} style={ctaButtonStyle}>
              {button.text}
            </CatalogueLink>
          ))}
      </div>
    </section>
  );
};

const PricingTableRenderer: React.FC<any> = ({ headerText, subheading, plans = [] }) => {
  const { t } = useTranslation("coursePlayerA");
  return (
  <section className="catalogue-section bg-catalogue-bg">
    <div className="catalogue-shell">
      {headerText && <h2 className="mb-2 text-center catalogue-h2 text-catalogue-text-primary">{headerText}</h2>}
      {subheading && <p className="mb-12 text-center text-catalogue-text-muted">{subheading}</p>}
      <div className={`grid gap-6 ${plans.length === 2 ? 'md:grid-cols-2' : 'md:grid-cols-3'}`}>
        {plans.map((plan: any, i: number) => (
          <div key={i} data-stagger-item style={{ ['--stagger-i' as any]: i }} className={`relative flex flex-col rounded-2xl border-2 p-8 ${plan.highlighted ? 'border-primary-500 shadow-xl' : 'border-catalogue-border'}`}>
            {plan.highlighted && <div className="absolute -top-3 start-1/2 -translate-x-1/2 rounded-full px-4 py-1 text-xs font-semibold text-white" style={{ backgroundColor: 'hsl(var(--primary-500, 217 91% 60%))' }}>{t("jsonRenderer.recommended")}</div>}
            <h3 className="text-xl font-bold text-catalogue-text-primary">{plan.name}</h3>
            {plan.description && <p className="mt-1 text-sm text-catalogue-text-muted">{plan.description}</p>}
            <div className="mt-4 flex items-baseline gap-1">
              <span className="text-4xl font-bold text-catalogue-text-primary">{plan.price}</span>
              {plan.period && <span className="text-catalogue-text-muted">{plan.period}</span>}
            </div>
            <ul className="mt-6 flex-1 space-y-3">
              {(plan.features || []).map((f: string, j: number) => (
                <li key={j} className="flex items-center gap-2 text-sm text-catalogue-text-secondary">
                  <span className="text-green-500">✓</span>{f}
                </li>
              ))}
            </ul>
            {plan.buttonText && (
              <CatalogueLink to={plan.buttonTarget || '#'} className={`mt-8 block rounded-lg py-3 text-center font-semibold transition ${plan.highlighted ? 'text-white hover:opacity-90' : 'border border-catalogue-border text-catalogue-text-primary hover:bg-catalogue-interactive-hover'}`} style={plan.highlighted ? { backgroundColor: 'hsl(var(--primary-500, 217 91% 60%))' } : undefined}>
                {plan.buttonText}
              </CatalogueLink>
            )}
          </div>
        ))}
      </div>
    </div>
  </section>
  );
};

/** Pull the visitor's identity out of authored form fields by name heuristics
 *  (the same heuristics the audience submit service uses). */
const extractLeadIdentity = (fields: any[], formData: Record<string, string>) => {
  let email = '', phone = '', fullName = '';
  const rest: Record<string, string> = {};
  for (const f of fields) {
    const value = (formData[f.name] || '').trim();
    if (!value) continue;
    const k = `${f.name} ${f.label || ''}`.toLowerCase();
    if (!email && (f.type === 'email' || k.includes('email') || k.includes('mail'))) email = value;
    else if (!phone && (f.type === 'tel' || k.includes('phone') || k.includes('mobile') || k.includes('whatsapp'))) phone = value;
    else if (!fullName && k.includes('name')) fullName = value;
    else rest[f.label || f.name] = value;
  }
  return { email, phone, fullName, rest };
};

const ContactFormRenderer: React.FC<any> = ({ heading, subheading, fields = [], baseFields, submitLabel, successMessage, backgroundColor, audienceId, instituteId, tagName, isPreviewMode }) => {
  const { t } = useTranslation("coursePlayerA");
  // The authored fields, index-paired with the shown ones (a translation
  // keeps the list's order). Answers are keyed, and the visitor's email /
  // phone / name found, by the authored names and labels, so a हिन्दी visitor's
  // lead lands in the same campaign fields as an English one. The shown
  // (translated) label is for display only.
  const submitFields: any[] =
    Array.isArray(baseFields) && Array.isArray(fields) && baseFields.length === fields.length ? baseFields : fields;
  // HISTORY: this form used to fake success with no network call — every
  // submission on every institute site was silently discarded. It now submits
  // through the hardened catalogue-lead pipeline; audienceId (optional, set in
  // the editor) routes it to a chosen campaign instead of the default list.
  const [submitted, setSubmitted] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState('');
  const [honeypot, setHoneypot] = React.useState('');
  const mountedAt = React.useRef(Date.now());
  const [formData, setFormData] = React.useState<Record<string, string>>({});
  // Dial code currently selected per phone field, so submit can tell "+91 and
  // nothing else" (the visitor never touched an OPTIONAL phone field) apart
  // from a real number. Submitting the bare dial code makes every such lead
  // collide on the same "+91" identity.
  const [phoneDials, setPhoneDials] = React.useState<Record<string, string>>({});

  // Detect the phone field the same way LeadCollectionModal does — some
  // authored configs type it "text" and only the name/label says phone.
  const isPhoneField = (f: any) =>
    f?.type === 'tel' || /phone|mobile|contact|whatsapp/i.test(`${f?.name || ''} ${f?.label || ''}`);
  // Start on the institute's configured country (or the visitor's, on
  // GEO_FIRST), and stop moving once a number has been typed.
  const hasTypedPhone = submitFields.some(
    (f) => isPhoneField(f) && phoneFieldHasInput(formData[f.name]),
  );
  const { defaultCountry, preferredCountries } = usePreferredPhoneCountries({ freeze: hasTypedPhone });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // The editor preview never creates a lead (the page shell says so too).
    if (isPreviewMode) return;
    setError('');
    // Spam verdicts show the success state — never tell a bot it was caught.
    if (isSpamSubmission(honeypot, mountedAt.current)) { setSubmitted(true); return; }
    // Drop dial-code-only values before they become a lead's phone number.
    const submitData = { ...formData };
    for (const f of submitFields) {
      if (!isPhoneField(f)) continue;
      const digits = (submitData[f.name] || '').replace(/\D/g, '');
      if (!digits || digits === (phoneDials[f.name] || '')) submitData[f.name] = '';
    }
    const { email, phone, fullName, rest } = extractLeadIdentity(submitFields, submitData);
    if (!email) { setError(t("jsonRenderer.includeEmailAddress")); return; }
    if (!instituteId) { setError(t("jsonRenderer.formNotConnected")); return; }
    setSubmitting(true);
    try {
      await submitWebsiteLead({
        instituteId,
        audienceId,
        fullName,
        email,
        mobileNumber: phone,
        sourceType: 'WEBSITE_FORM',
        sourceId: `${tagName || 'catalogue'}:contact-form`,
        customFieldValues: rest,
      });
      setSubmitted(true);
    } catch {
      setError(t("jsonRenderer.somethingWentWrongRetry"));
    } finally {
      setSubmitting(false);
    }
  };
  const txt = sectionText(backgroundColor);
  return (
    <section style={sectionBg(backgroundColor)} className="catalogue-section px-4 bg-catalogue-bg">
      <div className="mx-auto max-w-2xl">
        {heading && <h2 className={`mb-2 text-center catalogue-h2 ${txt.heading}`}>{heading}</h2>}
        {subheading && <p className={`mb-10 text-center ${txt.muted}`}>{subheading}</p>}
        {submitted ? (
          <div className="rounded-xl border border-green-200 bg-green-50 p-8 text-center text-green-700 font-medium">
            {successMessage || t("jsonRenderer.contactFormSuccessDefault")}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5 rounded-xl border border-catalogue-border bg-catalogue-bg p-8 shadow-sm">
            {fields.map((shown: any, i: number) => {
              // The authored field keys the value and decides the input
              // (phone or not); only the label shown is the translated one.
              const field = submitFields[i] ?? shown;
              return (
                <div key={field.name}>
                  <label className="mb-1 block text-sm font-medium text-catalogue-text-secondary">{shown?.label}{field.required && <span className="ms-1 text-red-500">*</span>}</label>
                  {field.type === 'textarea' ? (
                    <textarea required={field.required} rows={4} value={formData[field.name] || ''} onChange={(e) => setFormData({ ...formData, [field.name]: e.target.value })} className="w-full rounded-lg border border-catalogue-border bg-catalogue-bg text-catalogue-text-primary px-4 py-2.5 text-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none" />
                  ) : isPhoneField(field) ? (
                    // Country picker + dial code. Stored as +<digits> so the lead
                    // reaches the CRM in E.164 — a bare 10-digit number is what
                    // makes outbound calling drop the connection.
                    <PhoneInput
                      country={defaultCountry}
                      preferredCountries={preferredCountries}
                      enableSearch
                      countryCodeEditable={false}
                      enableAreaCodes={false}
                      value={formData[field.name] || ''}
                      onChange={(value, data: any) => {
                        const digits = (value || '').replace(/\D/g, '');
                        setPhoneDials((prev) => ({ ...prev, [field.name]: data?.dialCode || '' }));
                        setFormData((prev) => ({ ...prev, [field.name]: digits ? `+${digits}` : '' }));
                      }}
                      inputProps={{ required: field.required }}
                      placeholder={t("leadCollectionModal.phonePlaceholder")}
                      containerClass="!w-full"
                      inputClass="!w-full !h-11 !rounded-lg !border-catalogue-border !bg-catalogue-bg !text-catalogue-text-primary !text-sm"
                      // No buttonClass: the flag button is absolutely positioned OVER the
                      // input's left edge, so giving it an opaque background paints out the
                      // input's border and rounded corner — the control then reads as two
                      // detached boxes. The app's own .react-tel-input theming already gives
                      // it the divider and radius.
                    />
                  ) : (
                    <input type={field.type} required={field.required} value={formData[field.name] || ''} onChange={(e) => setFormData({ ...formData, [field.name]: e.target.value })} className="w-full rounded-lg border border-catalogue-border bg-catalogue-bg text-catalogue-text-primary px-4 py-2.5 text-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none" />
                  )}
                </div>
              );
            })}
            {/* Honeypot — hidden from humans, filled by bots. */}
            <div className="sr-only" aria-hidden="true">
              <label>{t("jsonRenderer.companyWebsite")}<input type="text" tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} /></label>
            </div>
            {error && <p className="rounded-lg bg-warning-50 px-4 py-2.5 text-sm text-catalogue-text-secondary" role="alert">{error}</p>}
            <button type="submit" disabled={submitting} className="w-full rounded-lg py-3 font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60" style={{ backgroundColor: 'hsl(var(--primary-500, 217 91% 60%))' }}>
              {submitting ? t("jsonRenderer.sendingEllipsis") : (submitLabel || t("jsonRenderer.sendMessage"))}
            </button>
          </form>
        )}
      </div>
    </section>
  );
};

const TeamSectionRenderer: React.FC<any> = ({ headerText, subheading, members = [], columns = 3 }) => (
  <section className="catalogue-section bg-catalogue-bg">
    <div className="catalogue-shell">
      {headerText && <h2 className="mb-2 text-center catalogue-h2 text-catalogue-text-primary">{headerText}</h2>}
      {subheading && <p className="mb-12 text-center text-catalogue-text-muted">{subheading}</p>}
      <div className={`grid gap-8 ${columns === 2 ? 'sm:grid-cols-2' : columns === 4 ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-2 lg:grid-cols-3'}`}>
        {members.map((m: any, i: number) => (
          <div key={i} data-stagger-item style={{ ['--stagger-i' as any]: i }} className="flex flex-col items-center text-center">
            {m.avatar ? (
              <img src={m.avatar} alt={m.name} className="mb-4 size-24 rounded-full object-cover shadow-md" />
            ) : (
              <div className="mb-4 flex size-16 sm:size-20 items-center justify-center rounded-full bg-primary-100 text-2xl font-bold text-catalogue-brand-ink">
                {m.name?.[0] || '?'}
              </div>
            )}
            <h3 className="text-lg font-semibold text-catalogue-text-primary">{m.name}</h3>
            <p className="text-sm font-medium text-catalogue-brand-ink">{m.role}</p>
            {m.bio && <p className="mt-2 text-sm text-catalogue-text-muted">{m.bio}</p>}
          </div>
        ))}
      </div>
    </div>
  </section>
);

const AnnouncementFeedRenderer: React.FC<any> = ({ headerText, subheading, announcements = [], layout = 'list', showDate = true, showTag = true, backgroundColor }) => (
  <section style={sectionBg(backgroundColor)} className="catalogue-section bg-catalogue-bg">
    <div className="catalogue-shell-narrow">
      {headerText && <h2 className={`mb-2 text-center catalogue-h2 ${sectionText(backgroundColor).heading}`}>{headerText}</h2>}
      {subheading && <p className={`mb-10 text-center ${sectionText(backgroundColor).muted}`}>{subheading}</p>}
      <div className={layout === 'grid' ? 'grid gap-6 sm:grid-cols-2' : 'space-y-4'}>
        {announcements.map((a: any, i: number) => (
          <div key={i} data-stagger-item style={{ ['--stagger-i' as any]: i }} className={`rounded-xl border border-catalogue-border bg-catalogue-bg p-6 shadow-sm ${layout === 'list' ? 'flex items-start gap-4' : ''}`}>
            <div className="flex-1">
              <div className="mb-2 flex flex-wrap items-center gap-3">
                {showTag && a.tag && <span className="rounded-full bg-primary-100 px-3 py-0.5 text-xs font-semibold text-catalogue-brand-ink">{a.tag}</span>}
                {showDate && a.date && <span className="text-xs text-catalogue-text-muted">{new Date(a.date).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' })}</span>}
              </div>
              <h3 className="text-base font-semibold text-catalogue-text-primary">{a.title}</h3>
              {a.summary && <p className="mt-1 text-sm text-catalogue-text-secondary">{a.summary}</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  </section>
);

const ImageGalleryRenderer: React.FC<any> = ({ headerText, images = [], columns = 3, showCaptions = false }) => {
  const { t } = useTranslation("coursePlayerA");
  return (
  <section className="catalogue-section-tight bg-catalogue-bg">
    <div className="catalogue-shell">
      {headerText && <h2 className="mb-8 text-center catalogue-h2 text-catalogue-text-primary">{headerText}</h2>}
      <div className={`grid gap-4 ${columns === 2 ? 'sm:grid-cols-2' : columns === 4 ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-2 lg:grid-cols-3'}`}>
        {images.map((img: any, i: number) => (
          <div key={i} data-stagger-item style={{ ['--stagger-i' as any]: i }} className="group overflow-hidden rounded-xl">
            {img.src ? (
              <FitImage src={img.src} alt={img.alt || ''} className="w-full transition group-hover:scale-105" style={{ aspectRatio: '4/3' }} />
            ) : (
              <div className="flex w-full items-center justify-center rounded-xl bg-catalogue-bg-muted text-catalogue-text-muted" style={{ aspectRatio: '4/3' }}>{t("jsonRenderer.noImage")}</div>
            )}
            {showCaptions && img.caption && <p className="mt-2 text-center text-sm text-catalogue-text-muted">{img.caption}</p>}
          </div>
        ))}
      </div>
    </div>
  </section>
  );
};

/* ─── Spacer / Divider ─────────────────────────────────────────────────── */

const SpacerRenderer: React.FC<any> = ({ height = '48px', showDivider = false, dividerStyle = 'solid', dividerColor = '#E5E7EB', dividerWidth = '1px', maxWidth = '100%' }) => ( // design-lint-ignore: page-builder default color
  <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    {showDivider && (
      <hr style={{ borderTop: `${dividerWidth} ${dividerStyle} ${dividerColor}`, maxWidth, width: '100%', margin: '0 auto' }} />
    )}
  </div>
);

/* ─── Tabs / Accordion ─────────────────────────────────────────────────── */

const TabsAccordionRenderer: React.FC<any> = ({ mode = 'tabs', items = [], defaultOpen = 0, allowMultiple = false, backgroundColor, variant = 'plain', renderSlot }) => {
  const [activeTab, setActiveTab] = React.useState(defaultOpen);
  const [openIndices, setOpenIndices] = React.useState<Set<number>>(new Set([defaultOpen]));
  const tabsUid = React.useId();

  const toggleAccordion = (i: number) => {
    setOpenIndices((prev) => {
      const next = new Set(prev);
      if (next.has(i)) {
        next.delete(i);
      } else {
        if (!allowMultiple) next.clear();
        next.add(i);
      }
      return next;
    });
  };

  // Trigger row: icon/numbered label + title + optional right-aligned meta.
  // Numbered prefix + single-line truncation are split-variant styling only;
  // plain/boxed legacy configs (no icon field) keep the bare wrapping title.
  const triggerContent = (item: any, i: number, open: boolean) => {
    const IconComp = item.icon && FEATURE_ICON_MAP[item.icon];
    const compact = variant === 'split';
    return (
      <>
        <span className="flex min-w-0 items-center gap-3">
          {IconComp ? (
            <IconComp size={18} weight="duotone" className="shrink-0 text-primary-500" aria-hidden="true" />
          ) : item.icon ? (
            <span className="shrink-0" aria-hidden="true">{item.icon}</span>
          ) : compact ? (
            <span className="shrink-0 text-sm font-bold text-primary-400">{String(i + 1).padStart(2, '0')}</span>
          ) : null}
          <span className={compact ? 'truncate' : 'min-w-0'}>{item.title}</span>
        </span>
        <span className="ms-4 flex shrink-0 items-center gap-3">
          {item.meta && <span className="text-xs text-catalogue-text-muted">{item.meta}</span>}
          <span className={`text-catalogue-text-muted transition-transform ${open ? 'rotate-180' : ''}`}>&#9662;</span>
        </span>
      </>
    );
  };

  // Panel body: nested components (slot) when configured, else rich text.
  const panelContent = (item: any) =>
    Array.isArray(item.slot) && item.slot.length && renderSlot ? (
      <div className="space-y-4">{renderSlot(item.slot)}</div>
    ) : (
      <div className="text-sm text-catalogue-text-secondary" dangerouslySetInnerHTML={{ __html: item.content || '' }} />
    );

  if (mode === 'accordion' && variant === 'split') {
    // Accordion-with-artifact: trigger list left, open item's panel in a
    // sticky right pane on desktop; stacked accordion on mobile.
    const activeIndex = [...openIndices][0] ?? 0;
    const active = items[activeIndex];
    return (
      <section style={sectionBg(backgroundColor)} className="catalogue-section-tight bg-catalogue-bg">
        <div className="catalogue-shell lg:grid lg:grid-cols-5 lg:gap-8">
          <div className="space-y-2 lg:col-span-2">
            {items.map((item: any, i: number) => (
              <div key={i} className={`rounded-lg border overflow-hidden ${openIndices.has(i) ? 'border-primary-200 bg-primary-50' : 'border-catalogue-border bg-catalogue-bg'}`}>
                <button onClick={() => setOpenIndices(new Set([i]))} className="flex w-full items-center justify-between px-5 py-4 text-start font-medium text-catalogue-text-primary hover:bg-catalogue-interactive-hover">
                  {triggerContent(item, i, openIndices.has(i))}
                </button>
                {/* Mobile: panel renders inline under the open trigger */}
                {openIndices.has(i) && (
                  <div className="px-5 pb-4 lg:hidden">{panelContent(item)}</div>
                )}
              </div>
            ))}
          </div>
          <div className="hidden lg:block lg:col-span-3">
            <div className="sticky top-24 rounded-xl border border-catalogue-border-subtle bg-catalogue-bg-subtle p-6">
              {active ? panelContent(active) : null}
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (mode === 'accordion') {
    const boxed = variant === 'boxed';
    return (
      <section style={sectionBg(backgroundColor)} className="catalogue-section-tight bg-catalogue-bg">
        <div className={`catalogue-shell-prose ${boxed ? 'divide-y divide-catalogue-border-subtle rounded-xl border border-catalogue-border overflow-hidden' : 'space-y-2'}`}>
          {items.map((item: any, i: number) => (
            <div key={i} className={boxed ? 'bg-catalogue-bg' : 'rounded-lg border border-catalogue-border bg-catalogue-bg overflow-hidden'}>
              <button onClick={() => toggleAccordion(i)} className="flex w-full items-center justify-between px-5 py-4 text-start font-medium text-catalogue-text-primary hover:bg-catalogue-interactive-hover">
                {triggerContent(item, i, openIndices.has(i))}
              </button>
              {openIndices.has(i) && (
                <div className="px-5 pb-4">{panelContent(item)}</div>
              )}
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section style={sectionBg(backgroundColor)} className="catalogue-section-tight bg-catalogue-bg">
      <div className="catalogue-shell-prose">
        <div role="tablist" className="flex border-b border-catalogue-border">
          {items.map((item: any, i: number) => (
            <button key={i} onClick={() => setActiveTab(i)}
              type="button"
              role="tab"
              id={`tab-${tabsUid}-${i}`}
              aria-selected={i === activeTab}
              aria-controls={`tabpanel-${tabsUid}-${i}`}
              tabIndex={i === activeTab ? 0 : -1}
              className={`px-5 py-3 text-sm font-medium transition-colors ${i === activeTab ? 'border-b-2 border-primary-500 text-catalogue-brand-ink' : 'text-catalogue-text-muted hover:text-catalogue-text-secondary'}`}>
              {item.title}
            </button>
          ))}
        </div>
        {items[activeTab] && (
          <div
            role="tabpanel"
            id={`tabpanel-${tabsUid}-${activeTab}`}
            aria-labelledby={`tab-${tabsUid}-${activeTab}`}
            tabIndex={0}
          >
            {Array.isArray(items[activeTab].slot) && items[activeTab].slot.length && renderSlot ? (
              <div className="p-5 space-y-4">{renderSlot(items[activeTab].slot)}</div>
            ) : (
              <div className="p-5 text-catalogue-text-secondary" dangerouslySetInnerHTML={{ __html: items[activeTab].content || '' }} />
            )}
          </div>
        )}
      </div>
    </section>
  );
};

/* ─── Logo Cloud ───────────────────────────────────────────────────────── */

const MARQUEE_SPEED_MAP: Record<string, string> = { slow: '45s', medium: '30s', fast: '18s' };
const MARQUEE_TEXT_SIZE: Record<string, string> = { xs: 'text-xs', sm: 'text-sm', base: 'text-base', lg: 'text-lg', xl: 'text-xl' };

/* ─── Marquee (announcement ticker) ────────────────────────────────────── */

/** Standalone scrolling ticker ("GCC Batch 2026-27 — Now Launching …").
 *
 *  This type previously existed ONLY as an admin canvas preview — the learner
 *  renderer had no case for it, so a published marquee rendered as nothing at
 *  all (the exact ghost-component failure detailBlocks was registered against).
 *  Reuses the logoCloud marquee machinery: the catalogue-marquee keyframes
 *  translate -50%, so rendering the row twice yields a seamless loop, and the
 *  shared class already handles hover-pause and prefers-reduced-motion. */
const MarqueeRenderer: React.FC<any> = ({
  items = [],
  defaultIcon = '',
  speed = 'medium',
  direction = 'left',
  pauseOnHover = true,
  backgroundColor = '#1e1b4b', // design-lint-ignore: page-builder default color
  textColor = '#ffffff', // design-lint-ignore: page-builder default color
  iconColor = '#facc15', // design-lint-ignore: page-builder default color
  fontSize = 'sm',
}) => {
  const { t } = useTranslation("coursePlayerA");
  const list = (Array.isArray(items) ? items : []).filter((it: any) => it && it.text);
  const viewportRef = useRef<HTMLDivElement>(null);
  const unitRef = useRef<HTMLDivElement>(null);
  // Copies of the items in each half of the track. The loop is seamless only
  // when one half is at least as wide as the band: two short items doubled
  // ran out halfway across a desktop screen, and the ticker looked stuck.
  const [copies, setCopies] = useState(1);
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const unit = unitRef.current;
    if (!viewport || !unit || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const width = unit.offsetWidth;
      if (width > 0) setCopies(Math.max(1, Math.ceil(viewport.clientWidth / width)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(unit);
    return () => observer.disconnect();
  }, [list.length]);
  if (list.length === 0) return null;
  // The duration covers one half, so it grows with the copies to keep the speed.
  const seconds = parseFloat(MARQUEE_SPEED_MAP[speed] || "30s") * copies;
  // Each item carries its own trailing space (no flex gap), so a half is
  // exactly N items wide and translate(-50%) lands on the next copy.
  const half = (part: number) =>
    Array.from({ length: copies }, (_, copy) => (
      <div
        key={`${part}-${copy}`}
        ref={part === 0 && copy === 0 ? unitRef : undefined}
        aria-hidden={part > 0 || copy > 0 || undefined}
        className="flex shrink-0 items-center"
      >
        {list.map((item: any, i: number) => {
          const itemClass = `flex shrink-0 items-center gap-2 whitespace-nowrap pe-10 font-medium ${MARQUEE_TEXT_SIZE[fontSize] || 'text-sm'}`;
          const content = (
            <>
              {(item.icon || defaultIcon) && (
                <span style={{ color: iconColor }} aria-hidden="true">{item.icon || defaultIcon}</span>
              )}
              {item.text}
            </>
          );
          // A linked item opens a page, scrolls to a #section or opens an
          // external URL (CatalogueLink). Only the first copy is tabbable — the
          // loop copies are aria-hidden duplicates.
          return item.link ? (
            <CatalogueLink
              key={i}
              to={item.link}
              tabIndex={part > 0 || copy > 0 ? -1 : undefined}
              className={`${itemClass} underline-offset-4 hover:underline focus-visible:underline`}
            >
              {content}
            </CatalogueLink>
          ) : (
            <span key={i} className={itemClass}>{content}</span>
          );
        })}
      </div>
    ));
  return (
    // The band keeps its colour edge to edge; only the moving text fades at
    // the sides (the mask on the band itself faded the colour into a smudge).
    <section style={{ backgroundColor }} aria-label={t("jsonRenderer.announcements")}>
      <div ref={viewportRef} className="catalogue-marquee-viewport overflow-hidden py-3">
        <div
          className={`catalogue-marquee flex items-center ${pauseOnHover === false ? 'catalogue-marquee-nopause' : ''}`}
          style={{
            animationDuration: `${seconds}s`,
            // The keyframes scroll left; 'right' simply plays them backwards.
            animationDirection: direction === 'right' ? 'reverse' : undefined,
            color: textColor,
          }}
        >
          {half(0)}
          {half(1)}
        </div>
      </div>
    </section>
  );
};

// Must match LogoItem's visibility rule — grid cells are pre-filtered so a
// null item never leaves an empty grid track or a dead stagger slot.
const logoWillRender = (logo: any, display: string) =>
  display === 'label-pill' ? !!(logo.label || logo.alt) : !!(logo.image || logo.label);

const LogoCloudRenderer: React.FC<any> = ({ headerText, subheading, logos = [], layout = 'grid', grayscale = true, columns = 5, display = 'logo', tile = 'none', marqueeSpeed = 'medium', logoHeight = 'md' }) => {
  const visible = logos.filter((logo: any) => logoWillRender(logo, display));
  return (
  <section className="catalogue-section-tight">
    {(headerText || subheading) && (
      <div className="catalogue-shell text-center">
        {headerText && <h3 className="mb-2 text-lg font-semibold uppercase tracking-wider text-catalogue-text-muted">{headerText}</h3>}
        {subheading && <p className="mb-8 text-sm text-catalogue-text-muted">{subheading}</p>}
      </div>
    )}
    {layout === 'marquee' ? (
      // A ticker must run EDGE TO EDGE. Keeping the track inside
      // .catalogue-shell clamped it to the 72rem content column, so the band
      // spanned the viewport while its items floated in a centred box with
      // dead space either side. The header still uses the shell; only the
      // scrolling track breaks out.
      <div className="catalogue-marquee-viewport overflow-hidden">
        <div className="catalogue-marquee flex items-center gap-6 sm:gap-12" style={{ animationDuration: MARQUEE_SPEED_MAP[marqueeSpeed] || '30s' }}>
          {[...visible, ...visible].map((logo: any, i: number) => (
            <LogoItem key={i} logo={logo} grayscale={grayscale} display={display} tile={tile} logoHeight={logoHeight} />
          ))}
        </div>
      </div>
    ) : (
      <div className="catalogue-shell text-center">
        <div className={`grid items-center justify-items-center gap-8 grid-cols-2 sm:grid-cols-3 ${columns >= 4 ? 'md:grid-cols-4' : ''} ${columns >= 5 ? 'lg:grid-cols-5' : ''} ${columns >= 6 ? 'xl:grid-cols-6' : ''}`}>
          {visible.map((logo: any, i: number) => (
            <div key={i} data-stagger-item style={{ ['--stagger-i' as any]: i }}>
              <LogoItem logo={logo} grayscale={grayscale} display={display} tile={tile} logoHeight={logoHeight} />
            </div>
          ))}
        </div>
      </div>
    )}
  </section>
  );
};

const LOGO_HEIGHT_MAP: Record<string, string> = { sm: 'h-7', md: 'h-10', lg: 'h-14' };

const LogoItem: React.FC<{
  logo: any;
  grayscale: boolean;
  display?: 'logo' | 'logo+label' | 'label-pill';
  tile?: 'none' | 'card' | 'pill';
  logoHeight?: 'sm' | 'md' | 'lg';
}> = ({ logo, grayscale, display = 'logo', tile = 'none', logoHeight = 'md' }) => {
  const h = LOGO_HEIGHT_MAP[logoHeight] || 'h-10';
  // alt is a pill-label source only in the explicit pill mode — legacy configs
  // carry editor-seeded {image:'', alt:'Logo N'} rows that must stay invisible.
  const explicitPill = display === 'label-pill';
  const label = explicitPill ? logo.label || logo.alt || '' : logo.label || '';

  // Label-only pill (orgs without a logo asset, or a text-first wall)
  if (explicitPill || (!logo.image && label)) {
    if (!label) return null;
    const pill = (
      <span className="inline-flex items-center rounded-full border border-catalogue-border bg-catalogue-bg-subtle px-4 py-1.5 text-sm font-medium text-catalogue-text-secondary">
        {label}
      </span>
    );
    return logo.url ? <a href={logo.url} target="_blank" rel="noopener noreferrer">{pill}</a> : pill;
  }

  const img = logo.image ? (
    <img src={logo.image} alt={logo.alt || label || ''} className={`${h} w-auto object-contain transition ${grayscale ? 'grayscale hover:grayscale-0' : ''}`} />
  ) : null;
  if (!img) return null;

  const inner =
    display === 'logo+label' && label ? (
      <span className="flex flex-col items-center gap-2">
        {img}
        <span className="text-xs font-medium text-catalogue-text-muted">{label}</span>
      </span>
    ) : (
      img
    );

  const tiled =
    tile === 'card' ? (
      <span className="inline-flex items-center justify-center rounded-xl border border-catalogue-border-subtle bg-catalogue-bg p-4 shadow-sm">{inner}</span>
    ) : tile === 'pill' ? (
      <span className="inline-flex items-center justify-center rounded-full border border-catalogue-border-subtle bg-catalogue-bg px-5 py-2.5">{inner}</span>
    ) : (
      inner
    );

  if (logo.url) return <a href={logo.url} target="_blank" rel="noopener noreferrer">{tiled}</a>;
  return tiled;
};

/* ─── Trust Chip ───────────────────────────────────────────────────────── */

const TrustChipRenderer: React.FC<any> = ({ text, rating, avatars = [], alignment = 'center' }) => {
  const clamped = rating ? Math.max(0, Math.min(5, Number(rating))) : 0;
  if (!text && !clamped && !avatars.length) return null;
  const justify = alignment === 'left' ? 'justify-start' : alignment === 'right' ? 'justify-end' : 'justify-center';
  return (
    <section className={`flex px-4 py-6 ${justify}`}>
      <div className="inline-flex items-center gap-3 rounded-full border border-catalogue-border-subtle bg-catalogue-bg-subtle py-2 ps-2.5 pe-5">
        {avatars.length > 0 && (
          <span className="flex -space-x-2">
            {avatars.slice(0, 4).map((src: string, i: number) => (
              <img key={i} src={src} alt="" aria-hidden="true" className="h-8 w-8 rounded-full border-2 border-catalogue-bg object-cover" />
            ))}
          </span>
        )}
        {clamped > 0 && (
          <span className="flex items-center gap-1 text-sm font-semibold text-catalogue-text-primary">
            <Star size={15} weight="fill" className="text-warning-500" aria-hidden="true" />
            {clamped.toFixed(1)}
          </span>
        )}
        {text && <span className="text-sm text-catalogue-text-secondary">{text}</span>}
      </div>
    </section>
  );
};

/* ─── Section Heading (D7 primitive) ───────────────────────────────────── */

/** Standalone premium heading block: eyebrow + title (with optional styled
 *  highlight substring) + lead. Drop it above any section that lacks its own
 *  header — one consistent heading voice across the page. */
const SectionHeadingRenderer: React.FC<any> = ({
  eyebrow, title = '', highlight, lead, align = 'center', size = 'lg', backgroundColor,
}) => {
  const txt = sectionText(backgroundColor);
  const sizeClass = size === 'xl' ? 'catalogue-display' : size === 'md' ? 'catalogue-h3' : 'catalogue-h2';

  // Wrap the first occurrence of highlight.text inside the title.
  let titleNode: React.ReactNode = title;
  if (highlight?.text && typeof title === 'string' && title.includes(highlight.text)) {
    const idx = title.indexOf(highlight.text);
    const before = title.slice(0, idx);
    const after = title.slice(idx + highlight.text.length);
    const hlClass =
      highlight.style === 'underline'
        ? 'underline decoration-primary-400 decoration-4 underline-offset-8'
        : highlight.style === 'mark'
          ? 'rounded-md bg-primary-100 px-2 text-gray-900' // design-lint-ignore: fixed dark text — primary-100 highlighter stays light in both modes
          : 'catalogue-text-gradient';
    titleNode = (
      <>
        {before}
        <span className={hlClass}>{highlight.text}</span>
        {after}
      </>
    );
  }

  return (
    <section style={sectionBg(backgroundColor)} className="px-4 pt-14 pb-4 bg-catalogue-bg">
      <div className={`mx-auto max-w-3xl ${align === 'left' ? 'text-start' : 'text-center'}`}>
        {eyebrow && <span className="catalogue-eyebrow">{eyebrow}</span>}
        <h2 className={`${eyebrow ? 'mt-3' : ''} font-bold ${sizeClass} ${txt.heading}`}>{titleNode}</h2>
        {lead && <p className={`mt-4 catalogue-lead ${txt.muted}`}>{lead}</p>}
      </div>
    </section>
  );
};

/* ─── Map Embed ────────────────────────────────────────────────────────── */

const MapEmbedRenderer: React.FC<any> = ({ embedUrl, height = '400px', borderRadius = '8px', title }) => {
  const { t } = useTranslation("coursePlayerA");
  return (
  <section className="py-8 px-4">
    <div className="mx-auto max-w-5xl">
      {title && <h3 className="mb-4 text-xl font-semibold text-catalogue-text-primary">{title}</h3>}
      {embedUrl ? (
        <iframe
          src={embedUrl}
          width="100%"
          height={height}
          style={{ border: 0, borderRadius }}
          allowFullScreen
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          title={title || t("jsonRenderer.map")}
        />
      ) : (
        <div className="flex items-center justify-center rounded bg-catalogue-bg-muted text-catalogue-text-muted" style={{ height, borderRadius }}>
          {t("jsonRenderer.noMapUrlConfigured")}
        </div>
      )}
    </div>
  </section>
  );
};

/* ─── Countdown Timer ──────────────────────────────────────────────────── */

const CountdownTimerRenderer: React.FC<any> = ({ targetDate, heading, expiredMessage, backgroundColor = '#1E293B', textColor = 'white', style = 'cards' }) => { // design-lint-ignore: page-builder default color
  const { t } = useTranslation("coursePlayerA");
  const [timeLeft, setTimeLeft] = React.useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  const [expired, setExpired] = React.useState(false);

  React.useEffect(() => {
    if (!targetDate || isNaN(new Date(targetDate).getTime())) return;
    const tick = () => {
      const diff = new Date(targetDate).getTime() - Date.now();
      if (diff <= 0) { setExpired(true); return; }
      setTimeLeft({
        days: Math.floor(diff / (1000 * 60 * 60 * 24)),
        hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
        minutes: Math.floor((diff / (1000 * 60)) % 60),
        seconds: Math.floor((diff / 1000) % 60),
      });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [targetDate]);

  if (expired) {
    return (
      <section style={{ backgroundColor }} className="catalogue-section-tight px-4 text-center">
        <p className="text-xl font-semibold" style={{ color: textColor }}>{expiredMessage || t("jsonRenderer.eventStarted")}</p>
      </section>
    );
  }

  const units = [
    { label: t("jsonRenderer.days"), value: timeLeft.days },
    { label: t("jsonRenderer.hours"), value: timeLeft.hours },
    { label: t("jsonRenderer.mins"), value: timeLeft.minutes },
    { label: t("jsonRenderer.secs"), value: timeLeft.seconds },
  ];

  return (
    <section style={{ backgroundColor }} className="catalogue-section-tight px-4 text-center">
      {heading && <h3 className="mb-8 text-xl font-bold" style={{ color: textColor }}>{heading}</h3>}
      <div className="flex justify-center gap-4">
        {units.map(({ label, value }) => (
          <div key={label} className={style === 'cards' ? 'rounded-xl bg-white/10 px-6 py-4' : 'px-4'}>
            <div className="text-4xl font-bold tabular-nums" style={{ color: textColor }}>
              {String(value).padStart(2, '0')}
            </div>
            <div className="mt-1 text-xs uppercase tracking-wider" style={{ color: `${textColor}99` }}>
              {label}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

/* ─── Text Block ───────────────────────────────────────────────────────── */

const TextBlockRenderer: React.FC<any> = ({ content = '', maxWidth = '800px', alignment = 'center' }) => (
  <section className="py-8 px-4 sm:px-6 lg:px-8">
    <div
      className="catalogue-rich-text max-w-none"
      style={{
        maxWidth,
        margin: alignment === 'center' ? '0 auto' : alignment === 'right' ? '0 0 0 auto' : undefined,
      }}
      dangerouslySetInnerHTML={{ __html: content }}
    />
  </section>
);

/* ─── Feature Grid ─────────────────────────────────────────────────────── */

/**
 * One card of the featureGrid `resource` style — a free-resources library
 * card: 16:9 thumbnail (with an optional badge such as "Featured"), chips for
 * age group / duration, title, description and a full-width action button.
 * A link flagged `gated` (or every link, with the grid's `gateAll`) opens the grid's gate list form first (see
 * -utils/resource-unlock.ts); once that list is unlocked it is a plain link.
 */
const ResourceCard: React.FC<{ feature: any; index: number; gateAudienceId: string; gateTitle?: string; gateAll?: boolean }> = ({
  feature: f, index, gateAudienceId, gateTitle, gateAll = false,
}) => {
  const unlocked = useResourceUnlocked(gateAudienceId);
  const chips: string[] = (f.chips || []).filter(Boolean);
  const cta = f.link?.text && f.link?.url ? { ...f.link, url: normalizeResourceUrl(f.link.url) } : null;
  // `gateAll` = the author gated the whole section; `cta.gated` = this card only.
  const gated = !!(cta && (gateAll || cta.gated) && gateAudienceId && !unlocked);
  const badge = (f.badge || '').trim();

  const trackOpen = () => {
    if (cta && !cta.url.startsWith('#')) trackResourceDownload({ url: cta.url, title: f.title, audienceId: gateAudienceId });
  };

  const openGate = () => {
    window.dispatchEvent(new CustomEvent('openAudienceForm', {
      detail: {
        audienceId: gateAudienceId,
        title: gateTitle || f.title,
        unlockUrl: cta.url,
        unlockLabel: cta.text,
        unlockTitle: f.title,
      },
    }));
  };

  return (
    <article
      data-stagger-item
      style={{ ['--stagger-i' as any]: index }}
      className="catalogue-card-elevated group flex flex-col overflow-hidden text-start"
    >
      {f.image && (
        <div className="relative aspect-video w-full overflow-hidden bg-catalogue-bg-subtle">
          <FitImage
            src={f.image}
            alt=""
            loading="lazy"
            className="size-full transition-transform duration-500 ease-out group-hover:scale-105"
          />
          {badge && (
            <span className="absolute start-3 top-3 inline-flex items-center rounded-full bg-catalogue-bg-elevated px-3 py-1 text-xs font-semibold text-primary-500 shadow-sm">
              {badge}
            </span>
          )}
        </div>
      )}
      <div className="flex flex-1 flex-col p-5 sm:p-6">
        {!f.image && badge && (
          <span className="mb-3 inline-flex w-fit items-center rounded-full bg-primary-500 px-3 py-1 text-xs font-semibold text-catalogue-bg-elevated">
            {badge}
          </span>
        )}
        {chips.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {chips.map((c: string, j: number) => (
              <span key={j} className="inline-flex items-center rounded-full bg-primary-50 px-2.5 py-0.5 text-xs font-medium text-primary-500 ring-1 ring-primary-100">{c}</span>
            ))}
          </div>
        )}
        <h3 className="text-lg font-semibold tracking-tight text-catalogue-text-primary">{f.title}</h3>
        {f.description && (
          <p className="mt-1.5 text-sm leading-relaxed text-catalogue-text-muted">{f.description}</p>
        )}
        {cta && (
          <div className="mt-auto pt-5">
            {gated ? (
              <button type="button" onClick={openGate} className="catalogue-btn catalogue-btn-primary w-full justify-center">
                {cta.text}
              </button>
            ) : (
              // Every open counts — after the unlock and on ungated cards too — so
              // the admin sees each lead's full list, not just the first file.
              // Captured on a wrapper, not passed as the link's onClick: that
              // would replace CatalogueLink's own handler for site pages.
              // onAuxClick covers a middle-click into a new tab.
              <div
                onClickCapture={trackOpen}
                onAuxClick={(e) => { if (e.button === 1) trackOpen(); }}
              >
                <CatalogueLink to={cta.url} className="catalogue-btn catalogue-btn-primary w-full justify-center">
                  {cta.text}
                </CatalogueLink>
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  );
};

const FeatureGridRenderer: React.FC<any> = ({
  headerText, subheading, columns = 3, features = [], style = 'cards', iconSize = 'large', backgroundColor, align,
  layout, gateAudienceId = '', gateTitle, gateAll = false, autoScroll = false, autoScrollIntervalMs, autoScrollLoop = false, filterParam,
}) => {
  // 'carousel' rails (photo / resource) can advance on their own, one card at a time.
  const railRef = React.useRef<HTMLDivElement>(null);
  const { looping } = useAutoScrollRail(railRef, {
    enabled: layout === 'carousel' && !!autoScroll,
    intervalMs: autoScrollIntervalMs,
    itemCount: features.length,
    loop: !!autoScrollLoop,
  });
  // Endless ring: a second lap of the same slides (see useAutoScrollRail).
  const loopCopy = (slides: React.ReactNode[]) =>
    looping
      ? slides.map((s, i) => (React.isValidElement(s) ? React.cloneElement(s, { key: `loop-${i}`, ...RAIL_CLONE_PROPS }) : null))
      : null;
  const arrows = useRailArrows(railRef, { enabled: layout === 'carousel', itemCount: features.length });
  const sizeMap: Record<string, string> = { small: 'text-xl', medium: 'text-2xl', large: 'text-3xl' };
  const txt = sectionText(backgroundColor);
  if (style === 'categoryTiles') {
    return (
      <CategoryTilesRenderer
        headerText={headerText}
        subheading={subheading}
        features={features}
        filterParam={filterParam}
        backgroundColor={backgroundColor}
      />
    );
  }
  const cardClass =
    style === 'cards' ? 'catalogue-card-elevated group p-6 sm:p-7' :
    style === 'bordered' ? 'rounded-xl border-2 border-catalogue-border p-6' :
    style === 'glass' ? 'catalogue-card-glass p-6' :
    style === 'gradient-border' ? 'catalogue-card-gradient-border p-6' :
    style === 'tinted' ? 'catalogue-card-tinted p-6' :
    'p-6';
  // Plain/minimal/bordered cards sit directly on the section surface, so
  // their text follows the section pairing; skinned cards (cards/glass/
  // gradient-border/tinted) have their own token surface.
  const cardOnSection = style === 'plain' || style === 'minimal' || style === 'bordered';
  // Short label-style cards (e.g. six engineering-branch tiles) waste a whole
  // row each at 1-col, which is what makes phone pages enormous. Only pair
  // them up when every card is genuinely compact — cards with bullets or real
  // description copy still get the full width.
  const compactCards =
    features.length >= 3 &&
    features.every(
      (f: any) =>
        !(f.bullets?.length) &&
        !(f.chips?.length) &&
        !f.image &&
        String(f.description || '').length <= 60
    );
  // Multi-line copy reads badly centred (the reference designs left-align it).
  // Compact icon tiles still look right centred, so only prose cards flip.
  const hasProse = features.some((f: any) => String(f.description || '').length > 60 || (f.bullets?.length ?? 0) > 0);
  const effectiveAlign = align ?? (hasProse ? 'left' : 'center');
  const isLeft = effectiveAlign === 'left';

  // "panel" — a tinted-header division/comparison card: a colored header band
  // (badge + serif title + description) over a body of brand-bulleted rows.
  // Each feature may set headerColor (hex) or headerVariant 'solid'|'tint'.
  if (style === 'panel') {
    const panelCols = Math.min(Math.max(Number(columns) || 2, 1), 3);
    return (
      <section style={sectionBg(backgroundColor)} className="catalogue-section bg-catalogue-bg">
        <div className="catalogue-shell">
          {headerText && <h2 className={`mb-2 text-center catalogue-h2 ${txt.heading}`}>{headerText}</h2>}
          {subheading && <p className={`catalogue-lead catalogue-measure mb-10 text-center ${txt.muted}`}>{subheading}</p>}
          <div className={`grid gap-6 grid-cols-1 ${panelCols >= 2 ? 'md:grid-cols-2' : ''} ${panelCols >= 3 ? 'lg:grid-cols-3' : ''}`}>
            {features.map((f: any, i: number) => {
              const IconComp = f.iconName ? FEATURE_ICON_MAP[f.iconName] : undefined;
              const bullets: string[] = (f.bullets || []).filter(Boolean);
              const badge: string = f.badge || (f.chips || []).filter(Boolean)[0] || '';
              const solid = f.headerColor ? isHexDark(f.headerColor) : f.headerVariant === 'solid';
              const headerStyle: React.CSSProperties = f.headerColor
                ? { backgroundColor: f.headerColor }
                : solid
                  ? { backgroundColor: 'hsl(var(--primary-500))' }
                  : { backgroundColor: 'hsl(var(--primary-50))' };
              return (
                <div
                  key={i}
                  data-stagger-item
                  style={{ ['--stagger-i' as any]: i }}
                  className="catalogue-card-elevated overflow-hidden !p-0 text-start"
                >
                  <div className="p-6 sm:p-8" style={headerStyle}>
                    {(badge || IconComp) && (
                      <div className="mb-4 flex items-center justify-between gap-3">
                        {badge ? (
                          <span
                            className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider ${
                              solid ? 'bg-white/15 text-white' : 'bg-primary-100 text-catalogue-brand-ink'
                            }`}
                          >
                            {badge}
                          </span>
                        ) : <span />}
                        {IconComp && (
                          <span
                            className={`inline-flex items-center justify-center rounded-xl p-2.5 ${
                              solid ? 'bg-white/15 text-white' : 'bg-primary-100 text-primary-500'
                            }`}
                          >
                            <IconComp size={26} weight="duotone" aria-hidden="true" />
                          </span>
                        )}
                      </div>
                    )}
                    <h3 className={`catalogue-h3 text-2xl font-bold ${solid ? 'text-white' : 'text-catalogue-text-primary'}`}>
                      {f.title}
                    </h3>
                    {f.description && (
                      <p className={`mt-2 text-sm leading-relaxed ${solid ? 'text-white/75' : 'text-catalogue-text-secondary'}`}>
                        {f.description}
                      </p>
                    )}
                  </div>
                  {(bullets.length > 0 || (f.link?.text && f.link?.url)) && (
                    <div className="p-6 sm:p-8">
                      {bullets.length > 0 && (
                        <ul className="space-y-2.5 text-sm text-catalogue-text-secondary">
                          {bullets.map((b: string, j: number) => (
                            <li key={j} className="flex items-start gap-2.5">
                              <Check size={16} weight="bold" className="mt-0.5 shrink-0 text-primary-500" aria-hidden="true" />
                              <span>{b}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {f.link?.text && f.link?.url && (
                        <div className="mt-4">
                          <CatalogueLink to={f.link.url} className="text-sm font-semibold text-primary-500 hover:underline">
                            {f.link.text} →
                          </CatalogueLink>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>
    );
  }

  // "resource" — free-resources library cards (thumbnail + chips + button),
  // with optional email-gated links. Headings stay centred unless the author
  // asked for left: the cards carry prose, the section title does not.
  if (style === 'resource') {
    const headLeft = align === 'left';
    const gateId = String(gateAudienceId || '').trim();
    return (
      <section style={sectionBg(backgroundColor)} className="catalogue-section bg-catalogue-bg">
        <div className="catalogue-shell">
          {headerText && <h2 className={`mb-2 catalogue-h2 ${headLeft ? '' : 'text-center'} ${txt.heading}`}>{headerText}</h2>}
          {subheading && <p className={`catalogue-lead mb-8 ${headLeft ? '' : 'catalogue-measure text-center'} ${txt.muted}`}>{subheading}</p>}
          {layout !== 'carousel' && (
            <div className={`grid gap-6 grid-cols-1 sm:grid-cols-2 ${columns >= 3 ? 'lg:grid-cols-3' : ''} ${columns >= 4 ? 'xl:grid-cols-4' : ''}`}>
              {features.map((f: any, i: number) => (
                <ResourceCard key={i} feature={f} index={i} gateAudienceId={gateId} gateTitle={gateTitle} gateAll={!!gateAll} />
              ))}
            </div>
          )}
        </div>
        {layout === 'carousel' && (
          // Same full-bleed rail as the photo style: `columns` cards per view,
          // the next one peeking in, swipe / snap native.
          <div className="relative">
            <div ref={railRef} className="catalogue-carousel-bleed catalogue-no-scrollbar flex snap-x snap-mandatory gap-5 overflow-x-auto py-2">
              {(() => {
                const slides = features.map((f: any, i: number) => (
                  <div
                    key={i}
                    className="flex min-w-reg-250 shrink-0 snap-start [&>*]:w-full"
                    // Width per card follows the authored column count — a computed value, not a token.
                    style={{ flexBasis: `calc((100% - ${(Math.min(Math.max(Number(columns) || 4, 1), 4) - 1) * 1.25}rem) / ${Math.min(Math.max(Number(columns) || 4, 1), 4)})` }}
                  >
                    <ResourceCard feature={f} index={i} gateAudienceId={gateId} gateTitle={gateTitle} gateAll={!!gateAll} />
                  </div>
                ));
                return (
                  <>
                    {slides}
                    {loopCopy(slides)}
                  </>
                );
              })()}
            </div>
            <RailArrows canPrev={arrows.canPrev} canNext={arrows.canNext} onMove={arrows.scrollByPage} />
          </div>
        )}
      </section>
    );
  }

  // "photo" — the offering-card shape: the image IS the card, with the copy
  // over a scrim and an optional CTA. Cards with no image fall back to a tinted
  // card carrying the same title/description/CTA, because the designs this
  // exists for deliberately alternate photo cards with plain colour cards in
  // one rail. Pair with layout 'carousel' for a swipeable row.
  if (style === 'photo') {
    const rail = layout === 'carousel';
    const cards = features.map((f: any, i: number) => {
      const chips: string[] = (f.chips || []).filter(Boolean);
      const cta = f.link?.text && f.link?.url ? f.link : null;
      return (
        <div
          key={i}
          data-stagger-item
          style={{ ['--stagger-i' as any]: i }}
          className={`relative isolate flex min-h-80 flex-col justify-end overflow-hidden rounded-catalogue-xl text-start ${
            rail ? 'w-72 shrink-0 snap-start sm:w-80' : ''
          } ${f.image ? '' : 'bg-catalogue-bg-subtle p-6'}`}
        >
          {f.image && (
            <>
              <img
                src={f.image}
                alt={f.title || ''}
                loading="lazy"
                className="absolute inset-0 -z-10 size-full object-cover"
              />
              {/* Scrim: overlaid copy has to stay legible over an arbitrary
                  photo, and no theme token can guarantee that. */}
              <div
                className="absolute inset-0 -z-10 bg-gradient-to-t from-black/75 via-black/30 to-transparent" // design-lint-ignore: legibility scrim over user photography
                aria-hidden="true"
              />
            </>
          )}
          <div className={f.image ? 'p-6' : ''}>
            {chips.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {chips.map((c: string, j: number) => (
                  <span
                    key={j}
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      f.image
                        ? 'bg-white/20 text-white' // design-lint-ignore: chip over photography
                        : 'bg-primary-50 text-primary-500 ring-1 ring-primary-100'
                    }`}
                  >
                    {c}
                  </span>
                ))}
              </div>
            )}
            <h4
              className={`text-xl font-semibold tracking-tight ${
                f.image ? 'text-white' : 'text-catalogue-text-primary' // design-lint-ignore: over scrim
              }`}
            >
              {f.title}
            </h4>
            {f.description && (
              <p
                className={`mt-1.5 text-sm leading-relaxed ${
                  f.image ? 'text-white/90' : 'text-catalogue-text-muted' // design-lint-ignore: over scrim
                }`}
              >
                {f.description}
              </p>
            )}
            {cta && (
              <CatalogueLink
                to={cta.url}
                className="catalogue-btn catalogue-btn-primary mt-4 inline-flex w-fit"
              >
                {cta.text}
              </CatalogueLink>
            )}
          </div>
        </div>
      );
    });
    return (
      <section style={sectionBg(backgroundColor)} className="catalogue-section bg-catalogue-bg">
        <div className="catalogue-shell">
          {headerText && <h2 className={`mb-2 catalogue-h2 ${isLeft ? '' : 'text-center'} ${txt.heading}`}>{headerText}</h2>}
          {subheading && <p className={`catalogue-lead mb-8 ${isLeft ? '' : 'catalogue-measure text-center'} ${txt.muted}`}>{subheading}</p>}
        </div>
        {rail ? (
          // Full-bleed rail: the shell would clip the edge-to-edge scroll, and
          // scroll-padding (baked into catalogue-carousel-bleed) is what keeps
          // snap alignment honest against the gutter.
          <div className="relative">
            <div ref={railRef} className="catalogue-carousel-bleed catalogue-no-scrollbar flex snap-x snap-mandatory gap-5 overflow-x-auto pb-2">
              {cards}
              {loopCopy(cards)}
            </div>
            <RailArrows canPrev={arrows.canPrev} canNext={arrows.canNext} onMove={arrows.scrollByPage} />
          </div>
        ) : (
          <div className="catalogue-shell">
            <div
              className={`grid gap-6 grid-cols-1 sm:grid-cols-2 ${columns >= 3 ? 'lg:grid-cols-3' : ''} ${columns >= 4 ? 'xl:grid-cols-4' : ''}`}
            >
              {cards}
            </div>
          </div>
        )}
      </section>
    );
  }

  return (
    <section style={sectionBg(backgroundColor)} className="catalogue-section bg-catalogue-bg">
      <div className="catalogue-shell">
        {headerText && <h2 className={`mb-2 text-center catalogue-h2 ${txt.heading}`}>{headerText}</h2>}
        {subheading && <p className={`catalogue-lead catalogue-measure mb-10 text-center ${txt.muted}`}>{subheading}</p>}
        <div
          className={`grid gap-6 ${compactCards ? 'grid-cols-2' : 'grid-cols-1'} sm:grid-cols-2 ${columns >= 3 ? 'lg:grid-cols-3' : ''} ${columns >= 4 ? 'xl:grid-cols-4' : ''} ${columns >= 5 ? '2xl:grid-cols-5' : ''}`}
        >
          {features.map((f: any, i: number) => {
            const IconComp = f.iconName ? FEATURE_ICON_MAP[f.iconName] : undefined;
            const chips: string[] = (f.chips || []).filter(Boolean);
            const bullets: string[] = (f.bullets || []).filter(Boolean);
            return (
            <div key={i} data-stagger-item style={{ ['--stagger-i' as any]: i }} className={`${isLeft ? 'text-start' : 'text-center'} ${cardClass}`}>
              {(f.image || IconComp || f.icon) && (
              <div className="mb-4">
                {f.image ? (
                  <img src={f.image} alt={f.title || ''} className={`${isLeft ? '' : 'mx-auto'} w-full max-w-40 h-auto rounded-lg object-cover`} style={{ aspectRatio: '1/1' }} />
                ) : IconComp ? (
                  <span className={`inline-flex items-center justify-center rounded-2xl bg-gradient-to-br from-primary-50 to-primary-100 ring-1 ring-primary-100 text-primary-500 transition-transform duration-300 ease-out group-hover:scale-105 ${iconSize === 'small' ? 'size-11 p-2.5' : iconSize === 'medium' ? 'size-12 p-3' : 'size-14 p-3.5'} ${isLeft ? '' : 'mx-auto'}`}>
                    <IconComp size={iconSize === 'small' ? 20 : iconSize === 'medium' ? 26 : 30} weight="duotone" aria-hidden="true" />
                  </span>
                ) : f.icon ? (
                  <span className={sizeMap[iconSize] || 'text-3xl'}>{f.icon}</span>
                ) : null}
              </div>
              )}
              {chips.length > 0 && (
                <div className={`mb-3 flex flex-wrap gap-1.5 ${isLeft ? '' : 'justify-center'}`}>
                  {chips.map((c: string, j: number) => (
                    <span key={j} className="inline-flex items-center rounded-full bg-primary-50 px-3 py-1 text-xs font-medium text-primary-500 ring-1 ring-primary-100">{c}</span>
                  ))}
                </div>
              )}
              <h4 className={`mb-2 text-xl font-semibold tracking-tight ${cardOnSection ? txt.heading : 'text-catalogue-text-primary'}`}>{f.title}</h4>
              <p className={`text-sm leading-relaxed ${cardOnSection ? txt.muted : 'text-catalogue-text-muted'}`}>{f.description}</p>
              {bullets.length > 0 && (
                <ul className={`mt-3 space-y-1.5 text-sm ${cardOnSection ? txt.body : 'text-catalogue-text-secondary'} ${isLeft ? '' : 'inline-block text-start'}`}>
                  {bullets.map((b: string, j: number) => (
                    <li key={j} className="flex items-start gap-2">
                      <Check size={15} weight="bold" className="mt-0.5 shrink-0 text-primary-500" aria-hidden="true" />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              )}
              {f.link?.text && f.link?.url && (
                <div className={`mt-3 ${isLeft ? '' : 'text-center'}`}>
                  <CatalogueLink to={f.link.url} className="text-sm font-semibold text-primary-500 hover:underline">
                    {f.link.text} →
                  </CatalogueLink>
                </div>
              )}
            </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

/* ─── Image Block ──────────────────────────────────────────────────────── */

const ImageBlockRenderer: React.FC<any> = ({ src, alt = '', caption, linkUrl, linkTarget = '_blank', alignment = 'center', maxWidth = '100%', borderRadius = '8px', aspectRatio = 'auto' }) => {
  if (!src) return null;
  const imgStyle: React.CSSProperties = { maxWidth, borderRadius, width: '100%', aspectRatio: aspectRatio !== 'auto' ? aspectRatio : undefined, objectFit: aspectRatio !== 'auto' ? 'cover' : undefined };
  const img = <img src={src} alt={alt} style={imgStyle} className="h-auto" loading="lazy" />;
  const wrapped = linkUrl ? <CatalogueLink to={linkUrl} target={linkTarget}>{img}</CatalogueLink> : img;

  return (
    <section className="py-6 px-4 sm:px-6 lg:px-8" style={{ textAlign: alignment as any }}>
      <div style={{ display: 'inline-block', maxWidth }}>
        {wrapped}
        {caption && <p className="mt-3 text-sm text-catalogue-text-muted">{caption}</p>}
      </div>
    </section>
  );
};

/* ─── Button Block ─────────────────────────────────────────────────────── */

/** Ask the page shell to open an Audience campaign form as a popup. Buttons
 *  anywhere in the JSON tree dispatch this; CourseSubPage/CourseCataloguePage
 *  own the single modal mount — same pattern as `openLeadCollection`. */
const dispatchOpenAudienceForm = (audienceId: string, title?: string) =>
  window.dispatchEvent(new CustomEvent('openAudienceForm', { detail: { audienceId, title } }));

/** Open a WhatsApp chat from any button. Tracked like a form submission so
 *  ad platforms count WhatsApp enquiries as conversions. */
const openWhatsApp = (phone?: string, message?: string) => {
  const digits = (phone || '').replace(/\D/g, '');
  if (!digits) return;
  emitLeadCaptured({ sourceType: 'WHATSAPP_CLICK', sourceId: 'button' });
  window.open(
    `https://wa.me/${digits}${message ? `?text=${encodeURIComponent(message)}` : ''}`,
    '_blank',
    'noopener,noreferrer',
  );
};

const ButtonBlockRenderer: React.FC<any> = ({ text, url = '#', target = '_self', variant = 'filled', size = 'large', alignment = 'center', backgroundColor = '', textColor = '', borderRadius = '8px', fullWidth = false, action = 'link', audienceId = '', formTitle = '', whatsappPhone = '', whatsappMessage = '' }) => {
  const { t } = useTranslation("coursePlayerA");
  const buttonText = text || t("jsonRenderer.button");
  const bg = backgroundColor || 'hsl(var(--primary-500, 217 91% 60%))';
  const fg = textColor || (variant === 'filled' ? 'white' : bg);
  const padding = size === 'small' ? '10px 24px' : size === 'large' ? '16px 40px' : '12px 32px';
  const fontSize = size === 'small' ? '14px' : size === 'large' ? '18px' : '16px';
  const styleProps: React.CSSProperties = {
    padding,
    fontSize,
    backgroundColor: variant === 'filled' ? bg : 'transparent',
    color: fg,
    border: variant === 'outline' ? `2px solid ${bg}` : 'none',
    borderRadius,
    textDecoration: 'none',
  };
  const className = `inline-block font-semibold transition-all duration-200 hover:opacity-90 active:scale-[0.98] ${fullWidth ? 'w-full text-center' : ''}`;

  return (
    <section className="py-8 px-4 sm:px-6 lg:px-8" style={{ textAlign: alignment as any }}>
      {action === 'whatsapp' ? (
        <button type="button" onClick={() => openWhatsApp(whatsappPhone, whatsappMessage)} className={className} style={styleProps}>
          {buttonText}
        </button>
      ) : action === 'openForm' && audienceId ? (
        // Any button can be a registration point: opens the campaign's form as
        // a popup instead of navigating.
        <button type="button" onClick={() => dispatchOpenAudienceForm(audienceId, formTitle || buttonText)} className={className} style={styleProps}>
          {buttonText}
        </button>
      ) : (
        <CatalogueLink to={url || '#'} target={target} className={className} style={styleProps}>
          {buttonText}
        </CatalogueLink>
      )}
    </section>
  );
};

/* ─── Newsletter Signup ────────────────────────────────────────────────── */

const NewsletterSignupRenderer: React.FC<any> = ({ heading, subheading, placeholder, buttonText, layout = 'inline', backgroundColor, successMessage, audienceId, instituteId, tagName, isPreviewMode }) => {
  const { t } = useTranslation("coursePlayerA");
  // HISTORY: previously set the success flag with no network call — every
  // subscription was silently discarded. Now submits through the catalogue-lead
  // pipeline; audienceId (optional) routes to a chosen campaign. The submit
  // logic is shared with the brand footer's newsletter (same sourceId here).
  const { email, setEmail, honeypot, setHoneypot, submitted, submitting, error, handleSubmit } =
    useNewsletterSignup({ instituteId, audienceId, tagName, sourceSuffix: 'newsletter' });
  const txt = sectionText(backgroundColor);

  return (
    <section style={sectionBg(backgroundColor)} className="catalogue-section px-4 sm:px-6 lg:px-8 bg-catalogue-bg-subtle">
      <div className="mx-auto max-w-lg text-center">
        {heading && <h3 className={`mb-2 text-2xl font-bold ${txt.heading}`}>{heading}</h3>}
        {subheading && <p className={`mb-6 ${txt.muted}`}>{subheading}</p>}
        {submitted ? (
          <p className="text-lg font-medium text-green-600">{successMessage || t("jsonRenderer.newsletterSuccessDefault")}</p>
        ) : (
          <form
            // The editor preview never creates a lead.
            onSubmit={isPreviewMode ? (e) => e.preventDefault() : handleSubmit}
            className={`flex ${layout === 'stacked' ? 'flex-col' : ''} gap-3`}
          >
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={placeholder || t("jsonRenderer.enterYourEmail")}
              className="flex-1 rounded-lg border border-catalogue-border bg-catalogue-bg px-4 py-3 text-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
            />
            {/* Honeypot — hidden from humans, filled by bots. */}
            <div className="sr-only" aria-hidden="true">
              <label>{t("jsonRenderer.companyWebsite")}<input type="text" tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} /></label>
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
              style={{ backgroundColor: 'hsl(var(--primary-500, 217 91% 60%))' }}
            >
              {submitting ? '…' : (buttonText || t("jsonRenderer.subscribe"))}
            </button>
          </form>
        )}
        {error && <p className="mt-3 text-sm text-catalogue-text-secondary" role="alert">{error}</p>}
      </div>
    </section>
  );
};

/* ─── Steps / Process ──────────────────────────────────────────────────── */

const StepsProcessRenderer: React.FC<any> = ({ headerText, subheading, layout = 'horizontal', steps = [], connectorStyle = 'line', backgroundColor, accentColor, variant = 'plain', nodeStyle = 'number', connectorGradient = false }) => {
  const accent = accentColor || 'hsl(var(--primary-500, 217 91% 60%))';
  const isHorizontal = layout !== 'vertical';
  const txt = sectionText(backgroundColor);

  // Node bubble per nodeStyle: numbered circle (default), icon, or plain dot.
  const nodeEl = (step: any, i: number, highlight: boolean) => {
    if (nodeStyle === 'dot') {
      return (
        <span
          className="mt-1.5 block h-3.5 w-3.5 shrink-0 rounded-full border-2 border-catalogue-bg shadow-sm"
          style={{ backgroundColor: accent }}
          aria-hidden="true"
        />
      );
    }
    const IconComp = nodeStyle === 'icon' && step.icon ? FEATURE_ICON_MAP[step.icon] : undefined;
    return (
      <span
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base font-bold text-white shadow-md ${highlight ? 'ring-4 ring-primary-200' : ''}`}
        style={{ backgroundColor: accent }}
      >
        {IconComp ? <IconComp size={20} weight="bold" aria-hidden="true" /> : (nodeStyle === 'icon' && step.icon) ? step.icon : step.number || i + 1}
      </span>
    );
  };

  // Step body card used by the timeline variants.
  const stepCard = (step: any, i: number, highlight: boolean) => {
    const chips: string[] = (step.chips || []).filter(Boolean);
    return (
      <div className={`rounded-xl border p-5 shadow-sm ${highlight ? 'border-primary-200 bg-primary-50' : 'border-catalogue-border-subtle bg-catalogue-bg'}`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h4 className="text-lg font-semibold text-catalogue-text-primary">{step.title}</h4>
          {step.meta && <span className="text-xs font-medium uppercase tracking-wide text-catalogue-text-muted">{step.meta}</span>}
        </div>
        {chips.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {chips.map((c: string, j: number) => (
              <span key={j} className="catalogue-badge catalogue-badge-primary rounded-full">{c}</span>
            ))}
          </div>
        )}
        {step.description && <p className="mt-2 text-sm leading-relaxed text-catalogue-text-secondary">{step.description}</p>}
      </div>
    );
  };

  const railStyle: React.CSSProperties = {
    background: connectorGradient
      ? `linear-gradient(to bottom, ${accent}, transparent)`
      : 'hsl(var(--catalogue-border))',
  };

  if (variant === 'timeline-cards' || variant === 'alternating') {
    const isAlt = variant === 'alternating';
    return (
      <section style={sectionBg(backgroundColor)} className="catalogue-section bg-catalogue-bg">
        <div className="catalogue-shell-narrow">
          {headerText && <h2 className={`mb-2 text-center catalogue-h2 ${txt.heading}`}>{headerText}</h2>}
          {subheading && <p className={`catalogue-lead catalogue-measure mb-10 text-center ${txt.muted}`}>{subheading}</p>}
          <div className="relative">
            {/* Rail: left on mobile/timeline, centered on desktop alternating */}
            <div
              className={`absolute bottom-0 top-0 w-0.5 ${isAlt ? 'start-5 md:start-1/2 md:-translate-x-1/2' : 'start-5'}`}
              style={railStyle}
              aria-hidden="true"
            />
            <div className="space-y-8">
              {steps.map((step: any, i: number) => {
                const highlight = step.state === 'highlight';
                const onRight = isAlt && i % 2 === 1;
                return (
                  <div key={i} data-stagger-item style={{ ['--stagger-i' as any]: i }} className="relative">
                    {/* Mobile / timeline-cards: node on the left rail, card beside it */}
                    <div className={`flex items-start gap-4 ${isAlt ? 'md:hidden' : ''}`}>
                      <span className="relative z-10 flex w-10 justify-center">{nodeEl(step, i, highlight)}</span>
                      <div className="min-w-0 flex-1">{stepCard(step, i, highlight)}</div>
                    </div>
                    {/* Desktop alternating: zigzag around the center rail */}
                    {isAlt && (
                      <div className="hidden md:grid md:grid-cols-[1fr_auto_1fr] md:items-start md:gap-4">
                        <div className={onRight ? '' : 'md:order-1'}>{onRight ? null : stepCard(step, i, highlight)}</div>
                        <span className="relative z-10 md:order-2">{nodeEl(step, i, highlight)}</span>
                        <div className={onRight ? 'md:order-3' : ''}>{onRight ? stepCard(step, i, highlight) : null}</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>
    );
  }

  const connectorEl = (i: number) => {
    if (i === steps.length - 1 || connectorStyle === 'none') return null;
    if (isHorizontal) {
      return (
        <div className="hidden sm:flex flex-1 items-center px-2">
          <div className="h-0.5 w-full" style={{
            background: connectorStyle === 'dashed' ? `repeating-linear-gradient(to right, ${accent} 0, ${accent} 6px, transparent 6px, transparent 12px)` :
                         connectorStyle === 'dots' ? `repeating-linear-gradient(to right, ${accent} 0, ${accent} 4px, transparent 4px, transparent 12px)` :
                         accent,
          }} />
        </div>
      );
    }
    return (
      <div className="ms-5 flex justify-center" style={{ height: 24 }}>
        <div className="w-0.5" style={{
          height: '100%',
          background: connectorStyle === 'dashed' ? `repeating-linear-gradient(to bottom, ${accent} 0, ${accent} 6px, transparent 6px, transparent 12px)` : accent,
        }} />
      </div>
    );
  };

  return (
    <section style={sectionBg(backgroundColor)} className="catalogue-section bg-catalogue-bg">
      <div className="catalogue-shell">
        {headerText && <h2 className={`mb-2 text-center catalogue-h2 ${txt.heading}`}>{headerText}</h2>}
        {subheading && <p className={`catalogue-lead catalogue-measure mb-10 text-center ${txt.muted}`}>{subheading}</p>}
        <div className={isHorizontal ? 'flex flex-col sm:flex-row items-start justify-center' : 'flex flex-col'}>
          {steps.map((step: any, i: number) => (
            <React.Fragment key={i}>
              <div data-stagger-item style={{ ['--stagger-i' as any]: i }} className={`flex ${isHorizontal ? 'flex-1 flex-col items-center text-center' : 'items-start gap-4'}`}>
                <div
                  className="mb-3 flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-base font-bold text-white shadow-md"
                  style={{ backgroundColor: accent }}
                >
                  {step.icon || step.number || i + 1}
                </div>
                <div className={isHorizontal ? '' : 'pt-1'}>
                  <h4 className={`text-lg font-semibold ${txt.heading}`}>{step.title}</h4>
                  <p className={`mt-1 text-sm leading-relaxed ${txt.muted}`}>{step.description}</p>
                </div>
              </div>
              {connectorEl(i)}
            </React.Fragment>
          ))}
        </div>
      </div>
    </section>
  );
};

/* ─── Component Style Wrapper with scroll animation ────────────────────── */

/** Live prefers-reduced-motion — configured entrance animations must respect
 *  it (WCAG 2.3.3): content shows immediately with zero motion when set. */
const usePrefersReducedMotion = (): boolean => {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
  );
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
};

/** When the admin authored explicit section padding, zero the rhythm vars so
 *  their value is authoritative instead of stacking on top of the renderer's
 *  .catalogue-section padding. */
/** Authored vertical padding replaces the section's own rhythm, so the two
 *  don't stack into a 168px gap.
 *
 *  EXCEPT when the component paints its own band. `paintsOwnBand` means
 *  props.backgroundColor is set and the wrapper is NOT the painted element —
 *  the colour is on the inner `.catalogue-section`, while the authored padding
 *  lands on this wrapper OUTSIDE it. Zeroing the vars there left the band with
 *  no padding at all, so a 64px-padded coloured section rendered as a strip
 *  hugging its own cards while the 64px sat invisibly outside the colour
 *  (field bug, The 7Cs home page).
 *
 *  Keeping the defaults in that case means the band gets its normal rhythm and
 *  the authored value adds outside it — marginally more total space than the
 *  author asked for, which is the right way to be wrong here. */
const authoredPaddingVars = (
  style?: { paddingTop?: string; paddingBottom?: string },
  paintsOwnBand?: boolean
) =>
  (style?.paddingTop || style?.paddingBottom) && !paintsOwnBand
    ? ({
        ['--catalogue-section-py' as string]: '0px',
        ['--catalogue-section-py-tight' as string]: '0px',
        ['--catalogue-section-py-loose' as string]: '0px',
      } as React.CSSProperties)
    : undefined;

const ComponentStyleWrapper: React.FC<{
  component: any;
  componentStyle: React.CSSProperties;
  responsiveCSS: string;
  hoverClass: string;
  motionOff?: boolean;
  children: React.ReactNode;
}> = ({ component, componentStyle, responsiveCSS, hoverClass, motionOff, children }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const prefersReducedMotion = usePrefersReducedMotion();

  const entrance = component.style?.animation?.entrance;
  // motionOff = global motion personality 'none' — kills entrances, authored
  // delays and stagger ramps entirely (the duration token alone can't: delay
  // ms values live outside it and fill:both hides content during the delay).
  const hasEntrance = !prefersReducedMotion && !motionOff && entrance?.type && entrance.type !== 'none';
  const hasOverlay = component.style?.backgroundImage && component.style?.backgroundOverlay;
  const shell = hasSectionShell(component.style);
  const decor = hasDecorations(component.style?.ornaments, component.style?.dividers);
  // Ornaments can bleed past the box (blobs at negative offsets) — clip them.
  const decorClip = component.style?.ornaments?.length ? { overflow: 'hidden' as const } : {};

  useEffect(() => {
    if (!hasEntrance || !ref.current) {
      setIsVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [hasEntrance]);

  // Stagger: cascade the entrance across child items (data-stagger-item)
  // instead of animating the whole section as one block. If the rendered
  // markup has no marked items (renderer without markers, marquee layout),
  // degrade to a normal whole-section entrance instead of animating nothing.
  const stagger = hasEntrance ? entrance?.stagger : undefined;
  const staggerEnabled = !!(stagger && stagger.interval > 0);
  const [hasStaggerItems, setHasStaggerItems] = useState(true);
  useLayoutEffect(() => {
    if (staggerEnabled) setHasStaggerItems(!!ref.current?.querySelector('[data-stagger-item]'));
  }, [staggerEnabled]);
  const hasStagger = staggerEnabled && hasStaggerItems;

  // duration must be nullish-checked: an explicit 0 means "instant", not "use token"
  const durationCss = entrance?.duration != null ? `${entrance.duration}ms` : 'var(--catalogue-motion-duration-md, 600ms)';

  const animationStyle: React.CSSProperties = hasEntrance && !hasStagger
    ? isVisible
      ? {
          animation: `catalogue-${entrance!.type} ${durationCss} ${entrance!.easing ?? 'var(--catalogue-motion-ease, ease-out)'} ${entrance!.delay ?? 0}ms both`,
        }
      : { opacity: 0 }
    : {};

  const staggerCSS = hasStagger
    ? `
[data-cid="${component.id}"] [data-stagger-item] { opacity: 0; }
[data-cid="${component.id}"].catalogue-stagger-go [data-stagger-item] {
  /* opacity:1 is the failsafe, not a conflict: a RUNNING animation's keyframes
     override normal declarations, but if catalogue-<type> resolves to no
     keyframe (it happened — the fade-up/fadeInUp naming mismatch) the
     animation silently never runs, and without this line the base opacity:0
     above held every staggered section permanently invisible. */
  opacity: 1;
  animation: catalogue-${entrance!.type} ${durationCss} ${entrance!.easing ?? 'var(--catalogue-motion-ease, ease-out)'} both;
  animation-delay: calc(${entrance!.delay ?? 0}ms + min(var(--stagger-i, 0), ${stagger!.maxItems ?? 8}) * ${stagger!.interval}ms);
}
@media (prefers-reduced-motion: reduce) {
  [data-cid="${component.id}"] [data-stagger-item] { opacity: 1 !important; animation: none !important; }
}`
    : '';
  const staggerClass = hasStagger && isVisible ? 'catalogue-stagger-go' : '';

  // Section-shell path: full-width background canvas + contained content
  // column. Opt-in via style.layout; legacy configs never reach this branch.
  if (shell) {
    const { canvasStyle, contentStyle } = buildSectionShellStyles(component.style);
    // Components like heroSection carry their surface color as a PROP
    // (props.backgroundColor). On a section shell the full-bleed canvas must
    // own that color — otherwise the band renders as an inset card with
    // page-color gutters left and right.
    if (!canvasStyle.backgroundColor && !canvasStyle.background && !canvasStyle.backgroundImage) {
      const propBg = (component.props as Record<string, unknown> | undefined)?.backgroundColor;
      if (typeof propBg === 'string' && propBg) canvasStyle.backgroundColor = propBg;
    }
    return (
      <div
        ref={ref}
        id={component.anchorId || undefined}
        data-cid={component.id}
        className={`${component.style?.customClass || ''} ${hoverClass} ${staggerClass}${component.anchorId ? ' catalogue-block-anchor' : ''}`}
        style={{ ...canvasStyle, ...animationStyle, ...decorClip, ...authoredPaddingVars(component.style) }}
      >
        {responsiveCSS && <style dangerouslySetInnerHTML={{ __html: responsiveCSS }} />}
        {staggerCSS && <style dangerouslySetInnerHTML={{ __html: staggerCSS }} />}
        {hasOverlay && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundColor: component.style!.backgroundOverlay,
              zIndex: 0,
              borderRadius: canvasStyle.borderRadius,
            }}
          />
        )}
        {decor && <SectionDecorations ornaments={component.style?.ornaments} dividers={component.style?.dividers} />}
        <div style={{ ...contentStyle, position: 'relative', zIndex: 1 }}>
          {children}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={ref}
      id={component.anchorId || undefined}
      data-cid={component.id}
      className={`${component.style?.customClass || ''} ${hoverClass} ${staggerClass}${component.anchorId ? ' catalogue-block-anchor' : ''}`}
      style={{
        ...componentStyle,
        ...animationStyle,
        // Preserve engine-emitted position (sticky rails); otherwise only go
        // positioned when overlay/decoration children need an anchor.
        position: (componentStyle.position as React.CSSProperties['position']) ?? (hasOverlay || decor ? 'relative' : undefined),
        ...decorClip,
        // This branch has no section shell, so the colour (when the component
        // sets one) is painted by the child, not by this wrapper — see
        // authoredPaddingVars.
        ...authoredPaddingVars(
          component.style,
          typeof component.props?.backgroundColor === 'string' && !!component.props.backgroundColor
        ),
      }}
    >
      {responsiveCSS && <style dangerouslySetInnerHTML={{ __html: responsiveCSS }} />}
      {staggerCSS && <style dangerouslySetInnerHTML={{ __html: staggerCSS }} />}
      {hasOverlay && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: component.style!.backgroundOverlay,
            zIndex: 0,
            borderRadius: componentStyle.borderRadius,
          }}
        />
      )}
      {decor && <SectionDecorations ornaments={component.style?.ornaments} dividers={component.style?.dividers} />}
      <div style={{ position: hasOverlay || decor ? 'relative' : undefined, zIndex: hasOverlay || decor ? 1 : undefined }}>
        {children}
      </div>
    </div>
  );
};
