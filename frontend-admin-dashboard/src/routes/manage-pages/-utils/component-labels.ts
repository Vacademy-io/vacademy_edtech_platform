/**
 * Human names for component types — the SINGLE source for every admin surface
 * that shows one: the insert palette, the Layers panel, and the canvas
 * selection badge.
 *
 * These three each used to derive their own label. The palette and the canvas
 * fell back to the raw camelCase type, so the same section appeared as
 * "Program Blocks" in Layers, "detail Blocks" in the palette and "detailBlocks"
 * on the canvas — leaving an admin unable to tell what kind of section they had
 * selected.
 *
 * Only types whose type name is not already the product name need an entry; the
 * fallback splits camelCase and capitalises.
 */
export const COMPONENT_LABELS: Record<string, string> = {
    header: 'Header',
    footer: 'Footer',
    heroSection: 'Hero Section',
    detailBlocks: 'Program Blocks',
    featureGrid: 'Feature Grid',
    courseCatalog: 'Course Catalog',
    bookCatalogue: 'Book Catalogue',
    productPageOffer: 'Product Page Offer',
    folderBrowser: 'Folder Browser',
    accessPassGrid: 'Access Passes',
    learningPath: 'Learning Path',
    productCourseGrid: 'Course Grid (full catalogue)',
    mediaShowcase: 'Media Showcase',
    courseShowcase: 'Course showcase',
    statsHighlights: 'Stats',
    testimonialSection: 'Testimonials',
    cartComponent: 'Cart',
    buyRentSection: 'Buy / Rent',
    policyRenderer: 'Policy',
    courseDetails: 'Course Details',
    bookDetails: 'Book Details',
    faqSection: 'FAQ',
    videoEmbed: 'Video Embed',
    documentViewer: 'Document Viewer',
    ctaBanner: 'CTA Banner',
    pricingTable: 'Pricing Table',
    contactForm: 'Contact Form',
    leadForm: 'Lead Form',
    teamSection: 'Team',
    announcementFeed: 'Announcements',
    blog: 'Blog',
    jobOpenings: 'Job Openings',
    imageGallery: 'Image Gallery',
    columnLayout: 'Column Layout',
    htmlBlock: 'Custom HTML',
    newsletterSignup: 'Newsletter Signup',
    stepsProcess: 'Steps / Process',
    logoCloud: 'Logo Cloud',
    tabsAccordion: 'Tabs / Accordion',
    mapEmbed: 'Map Embed',
    countdownTimer: 'Countdown Timer',
    promoPopup: 'Promo Popup',
    textBlock: 'Text Block',
    imageBlock: 'Image Block',
    buttonBlock: 'Button',
    sectionHeading: 'Section Heading',
};

/**
 * One line saying what each block DOES, for the insert palette.
 *
 * The palette used to print "Click or drag" under every entry, so choosing
 * between "Course Catalog", "Course Grid (full catalogue)" and "Product Page
 * Offer" meant adding all three and looking. A name alone cannot separate
 * blocks that differ by where their data comes from — that is what these say.
 *
 * Keep them to one short sentence: the palette row is two lines tall.
 */
export const COMPONENT_DESCRIPTIONS: Record<string, string> = {
    header: 'Site logo, navigation and login buttons',
    footer: 'Link columns, socials and the copyright line',
    heroSection: 'Opening banner — headline, image and the main call to action',
    sectionHeading: 'A heading and lead-in for the blocks below it',
    spacer: 'Blank vertical gap between two blocks',

    // ── Courses & selling ────────────────────────────────────────────────────
    courseCatalog: 'Every course in this institute, with filters and search',
    productCourseGrid: 'Every course in this institute — same data, plain grid',
    productPageOffer: 'Courses from ONE product page; can collect several into a basket',
    folderBrowser: 'Folders students open (Class → Subject…) to reach a product page’s courses',
    accessPassGrid: 'Access passes for sale — one purchase unlocks several courses',
    learningPath: 'A product page’s courses as numbered steps — or a list of such paths from a folder library',
    bookCatalogue: 'Books for sale, with buy/rent options',
    courseDetails: 'The selected course’s full details (details pages only)',
    bookDetails: 'The selected book’s full details (book pages only)',
    cartComponent: 'The visitor’s basket and its checkout button',
    buyRentSection: 'Buy-or-rent chooser for a single book',
    pricingTable: 'Hand-written plan columns — prices you type, not live courses',

    // ── Persuasion ───────────────────────────────────────────────────────────
    featureGrid: 'Short “why us” points as icon cards',
    detailBlocks: 'One long block per programme — what it covers and who it is for',
    courseShowcase: 'A few chosen courses — newest, on sale, by tag, or hand-picked',
    statsHighlights: 'A row of big numbers (learners, pass rate, years)',
    testimonialSection: 'Quotes from learners or parents',
    logoCloud: 'A row of partner or school logos',
    trustChip: 'A single line of reassurance — certifications, counts, guarantees',
    teamSection: 'Faculty or staff photos with roles',
    mediaShowcase: 'A carousel or grid of images and videos',
    imageGallery: 'A grid of images',
    videoEmbed: 'One embedded YouTube or uploaded video',
    documentViewer: 'A PDF — catalogue, brochure, prospectus — read on the page or in a full-screen viewer',
    stepsProcess: 'Numbered steps — how enrolling or learning works',
    countdownTimer: 'Counts down to a deadline',
    promoPopup: 'A sale or offer popup that opens by itself — on load, on scroll or on exit',
    marquee: 'A scrolling ticker of announcements',

    // ── Asking for something back ────────────────────────────────────────────
    leadForm: 'An enquiry form wired to an Audience campaign',
    contactForm: 'A plain contact form, emailed to you',
    newsletterSignup: 'Email capture for a mailing list',
    ctaBanner: 'A full-width band with one big call to action',
    announcementFeed: 'Your latest announcements, pulled in live',
    blog: 'Your blog posts, read live — the list here, each article on its own URL under this page',
    jobOpenings: 'Careers: a card per job, each job on its own URL under this page with an Apply link',

    // ── Reference ────────────────────────────────────────────────────────────
    faqSection: 'Questions that open and close',
    tabsAccordion: 'Your own content split across tabs or accordions',
    policyRenderer: 'Terms, refund and privacy policy text',
    mapEmbed: 'A map pin for your campus',

    // ── Raw content ──────────────────────────────────────────────────────────
    textBlock: 'A block of formatted text',
    imageBlock: 'A single image',
    buttonBlock: 'A standalone button',
    htmlBlock: 'Your own HTML and CSS, sandboxed into one band',
    htmlPage: 'A whole page pasted in as HTML',
};

/** One-line description of a component type for the insert palette. */
export const componentDescription = (type: string): string =>
    COMPONENT_DESCRIPTIONS[type] ?? 'Click or drag to add';

/** Friendly name for a component type, with a camelCase fallback. */
export const componentLabel = (type: string): string =>
    COMPONENT_LABELS[type] ??
    String(type || '')
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, (c) => c.toUpperCase())
        .trim();
