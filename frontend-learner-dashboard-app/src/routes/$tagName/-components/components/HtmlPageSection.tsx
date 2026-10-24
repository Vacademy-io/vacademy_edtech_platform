import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RouteMatcher } from "../../-services/route-matcher";
import { useNavigate } from '@tanstack/react-router';
import {
    collectVideoMounts,
    renderHtmlPage,
    type HtmlAction,
    type HtmlVideoMount,
} from '../../-utils/catalogue-html';
import { PLAIN_VIDEO_PLAYER_CSS, PlainVideoPlayer } from './PlainVideoPlayer';
import { getPublicUrlWithoutLogin } from '@/services/upload_file';
import {
    applyCourseTokens,
    buildCourseTokens,
    courseTokenMediaKeys,
    type CourseTokenSource,
} from '../../-utils/course-html-tokens';

/** Fired for data-vacademy="enrol" on a course page; CourseDetailsPage opens its enrolment flow. */
export const OPEN_COURSE_ENROLLMENT_EVENT = 'openCourseEnrollment';

/**
 * A whole page pasted from elsewhere — ChatGPT/Claude, an agency, an old site.
 *
 * Rendered through renderHtmlPage: page-level size caps, SVG allowed, the site
 * stylesheet injected ahead of the page's own, and the action hooks bound.
 * Still a shadow root and still no scripts, so the page stays indexable and
 * keeps the site's header and footer — the reason this is not an iframe.
 *
 * The hooks are what make a pasted page part of the site rather than a
 * screenshot of one: a plain <a href> would escape the router, and `#anchor`
 * cannot work at all because fragment navigation does not see into a shadow
 * root. bindHtmlActions turns both into real navigation, and gives pasted
 * markup a way to reach lead capture and enrolment.
 *
 * Video: `<video>` is stripped by the sanitizer, so a page marks a spot with
 * `<div data-vacademy="video" data-src="…" data-poster="…" data-aspect="9:16">`
 * and the site's own play/pause-only player is portalled into it — the same
 * PlainVideoPlayer the typed videoEmbed block uses, so an HTML page never
 * exposes the browser's download menu either. Its stylesheet is injected
 * with the site CSS because utility classes do not reach into a shadow root.
 *
 * Course pages: when rendered inside CourseDetailsPage (courseData present),
 * `{{course.title}}`, `{{course.price}}`, `{{course.image}}` … are filled in
 * first, so ONE designed html `details` page serves every course. Image tokens
 * are media ids and go through media-service like the typed hero's do.
 */
export const HtmlPageSection = ({
    html,
    css,
    siteCss,
    tagName,
    courseData,
}: {
    html?: string;
    css?: string;
    siteCss?: string;
    tagName: string;
    courseData?: CourseTokenSource | null;
}) => {
    const hostRef = useRef<HTMLDivElement>(null);
    const navigate = useNavigate();
    // Read through a ref so the render effect depends on the page CONTENT only:
    // it now sets state (video mounts), and an unstable `navigate` identity in
    // the dependency list would re-render the page — and re-set state — on every
    // commit, i.e. an infinite loop.
    const navigateRef = useRef(navigate);
    navigateRef.current = navigate;
    const [videoMounts, setVideoMounts] = useState<HtmlVideoMount[]>([]);
    // Course tokens are filled from a snapshot; the effect keys on the course id
    // + html so a course switch re-renders without depending on object identity.
    const courseRef = useRef(courseData);
    courseRef.current = courseData;
    const courseId = courseData?.courseId || '';

    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;
        let cancelled = false;
        let teardown: (() => void) | undefined;
        const onAction = (action: HtmlAction) => {
            switch (action.kind) {
                case 'route': {
                    // Routes are page slugs within THIS site; '' is the home
                    // page. Going through the router keeps it a client-side
                    // navigation and keeps the tag scope. A query string is
                    // allowed ("<courseId>?enrollInviteId=…") — course pages read
                    // their pricing/enrolment context from search params.
                    const [path, query] = action.route.split('?');
                    const search = query ? Object.fromEntries(new URLSearchParams(query)) : undefined;
                    navigateRef.current({
                        to: RouteMatcher.pagePath(tagName, path),
                        ...(search ? { search } : {}),
                    } as never);
                    break;
                }
                case 'lead-form':
                    window.dispatchEvent(
                        new CustomEvent('openAudienceForm', {
                            detail: { audienceId: action.audienceId },
                        })
                    );
                    break;
                case 'enrol': {
                    // On the course's own page open the enrolment flow; anywhere
                    // else go to that course's page (/{tag}/{courseId}).
                    const current = courseRef.current?.courseId;
                    if (current && (!action.courseId || action.courseId === current)) {
                        window.dispatchEvent(new CustomEvent(OPEN_COURSE_ENROLLMENT_EVENT, { detail: { courseId: current } }));
                    } else if (action.courseId) {
                        navigateRef.current({ to: RouteMatcher.pagePath(tagName, action.courseId) });
                    }
                    break;
                }
                case 'link':
                    window.open(action.href, '_blank', 'noopener,noreferrer');
                    break;
                default:
                    break; // 'scroll' is handled inside the shadow root
            }
        };
        const render = (markup: string) => {
            if (cancelled) return;
            // Returns a teardown that removes the delegated listener — without it,
            // every re-render would stack another one on the same root.
            teardown = renderHtmlPage(host, markup, css || '', {
                siteCss: `${PLAIN_VIDEO_PLAYER_CSS}\n${siteCss || ''}`,
                onAction,
            });
            // Placeholders keep whatever the author put inside (a poster <img> is
            // the editor preview); the real player replaces it here.
            const mounts = host.shadowRoot ? collectVideoMounts(host.shadowRoot) : [];
            mounts.forEach((m) => m.el.replaceChildren());
            setVideoMounts(mounts);
        };
        const course = courseRef.current;
        const source = html || '';
        if (!course) {
            render(source);
        } else {
            const tokens = buildCourseTokens(course);
            const mediaKeys = courseTokenMediaKeys(source);
            if (mediaKeys.length === 0) {
                render(applyCourseTokens(source, tokens));
            } else {
                // Media ids → public URLs (direct URLs pass through unchanged).
                Promise.all(mediaKeys.map((k) => getPublicUrlWithoutLogin(tokens[k]).catch(() => '')))
                    .then((urls) => {
                        mediaKeys.forEach((k, i) => { tokens[k] = urls[i] || ''; });
                        render(applyCourseTokens(source, tokens));
                    });
            }
        }
        return () => {
            cancelled = true;
            teardown?.();
            setVideoMounts([]);
        };
    }, [html, css, siteCss, tagName, courseId]);

    return (
        <>
            <div ref={hostRef} className="catalogue-html-section" />
            {videoMounts.map((m, i) =>
                createPortal(
                    <PlainVideoPlayer src={m.src} poster={m.poster} title={m.title} paddingBottom={m.paddingBottom} />,
                    m.el,
                    `${i}-${m.src}`,
                ),
            )}
        </>
    );
};

export default HtmlPageSection;
