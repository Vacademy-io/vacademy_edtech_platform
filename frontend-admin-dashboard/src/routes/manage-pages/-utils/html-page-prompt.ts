/**
 * The prompt an admin pastes into ChatGPT or Claude to get a page that works
 * here on the first try.
 *
 * WHY THIS EXISTS: most people arriving with an AI-built page are not
 * technical, and the failure modes are all silent. A pasted page loses its
 * styling because <style> is not an allowed tag, its buttons do nothing
 * because a raw href escapes the router, and its images 404 because they point
 * at a local folder. None of that produces an error message — the page just
 * looks wrong, and the admin has no way to know why.
 *
 * Teaching those rules to the admin is the wrong fix. Encoding them in a prompt
 * the AI reads is the right one: the constraints get applied by the tool that
 * writes the markup, and the admin only has to paste twice.
 *
 * Keep in sync with the real contract (catalogue-html.ts page mode).
 */
export const HTML_PAGE_AI_PROMPT = `I'm building a web page that will be pasted into a website builder with a few specific rules. Please follow them exactly.

WHAT TO GIVE ME
Two separate code blocks:
1. HTML — the page content only. No <!DOCTYPE>, no <html>, no <head>, no <body> tags. Start directly with the first section.
2. CSS — all styles in one block. Do not put any <style> tags in the HTML.

RULES
- No JavaScript. No <script> tags, no onclick, no interactive widgets that need JS. Accordions, carousels and counters will not work.
- No forms. No <form>, <input>, <textarea> or <select> — they are removed. If the page needs an enquiry form, use the button below instead.
- No external resources. No Google Fonts, no @import, no CDN links, no <link> tags. Use system font stacks like: font-family: system-ui, -apple-system, "Segoe UI", sans-serif.
- Inline SVG icons are fine and encouraged.
- Images: use https:// placeholder URLs and add a comment saying what each one should be. I will replace them with my own uploaded images.
- Make it fully responsive with CSS media queries. Mobile matters most.

BUTTONS AND LINKS — this part is important
Ordinary links to other websites work normally:
  <a href="https://example.com">Visit</a>

But for anything inside my own site, use these instead of a normal link:
  Go to another page:      <a data-vacademy="route" data-route="pricing">See pricing</a>
  Scroll down this page:   <button data-vacademy="scroll" data-target="faq">Jump to FAQ</button>
  Open an enquiry form:    <button data-vacademy="lead-form">Book a call</button>
  Open a course:           <button data-vacademy="enrol">Join the programme</button>
For the scroll one, give the target section a matching id, e.g. <section id="faq">.

LANGUAGE
Write all page copy in the same language I use to describe the page below.

THE PAGE I WANT
[Describe your page here: what it is for, who it is for, the sections you want, your brand colours, and the tone. Paste in your real text if you have it.]`;

/**
 * The prompt itself stays in English even for a translated UI: it is read by
 * ChatGPT or Claude rather than by the admin, these are technical instructions
 * whose meaning a translation could easily break, and the LANGUAGE section
 * above tells the model to write the page copy in whatever language the admin
 * describes it in. The surrounding UI strings ARE translated.
 */
