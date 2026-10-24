import React, { useCallback, useState, useMemo } from 'react';
import { BlockManager, BasicType, JsonToMjml } from 'easy-email-core';
import type { IBlockData } from 'easy-email-core';
import { EmailEditor, EmailEditorProvider } from 'easy-email-editor';
import { SimpleLayout } from 'easy-email-extensions';
import { useForm, useFormState } from 'react-final-form';
import mjml2html from 'mjml-browser';
// FormApi type from react-final-form
type FormApi<T, U> = {
    submit: () => void;
    change: (name: keyof T, value: any) => void;
    getState: () => { values: T };
};
import AssetPicker from './AssetPicker';
import { registerTextBorderFrame } from './textBorderFrame';
import { registerTextAttributePanel } from './TextAttributePanel';
import { MessageTemplate, TEMPLATE_VARIABLES } from '@/types/message-template-types';
import { UploadFileInS3, getPublicUrl } from '@/services/upload_file';
import { getUserId } from '@/utils/userDetails';
import { getInstituteId } from '@/constants/helper';
import type { EmailBrandSettings } from '@/services/email-brand-settings';
import { toast } from 'sonner';

import 'easy-email-editor/lib/style.css';
import 'easy-email-extensions/lib/style.css';
import '@arco-themes/react-easy-email-theme/css/arco.css';

// Text-block border / radius: render override + the panel section that edits it.
registerTextBorderFrame();
registerTextAttributePanel();

// Define the email template interface
interface IEmailTemplate {
    subject: string;
    subTitle: string;
    content: IBlockData;
}

// Categories the editor offers. The lowercase ones are marketing metadata stored on the
// template; the uppercase ones double as the DB `type`, because the backend resolves each
// of those templates by type (invoice PDF layout, invoice email, payment-confirmation email).
export type EmailTemplateCategory =
    | 'marketing'
    | 'utility'
    | 'transactional'
    | 'INVOICE'
    | 'INVOICE_EMAIL'
    | 'PAYMENT_CONFIRMATION';

// Categories that are persisted as the template's own DB type rather than as plain EMAIL.
const TYPE_BEARING_CATEGORIES: EmailTemplateCategory[] = [
    'INVOICE',
    'INVOICE_EMAIL',
    'PAYMENT_CONFIRMATION',
];

interface EmailBuilderProps {
    template?: MessageTemplate | null;
    onBack: () => void;
    onSave: (template: MessageTemplate) => Promise<void>;
    isSaving?: boolean;
    // Preselects the category when creating a new template (e.g. opening straight
    // into "Invoice (PDF Layout)" / "Invoice Email" from Invoice Settings).
    initialTemplateType?: Extract<
        EmailTemplateCategory,
        'INVOICE' | 'INVOICE_EMAIL' | 'PAYMENT_CONFIRMATION'
    >;
    // Institute brand kit (Template Settings → Email Brand Kit).
    brand?: EmailBrandSettings | null;
}

// Font list for the rich text toolbar font-family dropdown
const fontList = [
    { value: 'Arial', label: 'Arial' },
    { value: 'Helvetica', label: 'Helvetica' },
    { value: 'Georgia', label: 'Georgia' },
    { value: 'Times New Roman', label: 'Times New Roman' },
    { value: 'Courier New', label: 'Courier New' },
    { value: 'Verdana', label: 'Verdana' },
    { value: 'Tahoma', label: 'Tahoma' },
    { value: 'Trebuchet MS', label: 'Trebuchet MS' },
    { value: 'Lucida Sans Unicode', label: 'Lucida Sans' },
    { value: 'Open Sans', label: 'Open Sans' },
    { value: 'Lato', label: 'Lato' },
    { value: 'Roboto', label: 'Roboto' },
    { value: 'Montserrat', label: 'Montserrat' },
    { value: 'Poppins', label: 'Poppins' },
];

// easy-email's colour pickers show the last 14 entries of this localStorage list as swatches
// (no presets prop in 4.16). Put the brand colours at the end so they are always visible,
// keeping the admin's other recent colours in front of them.
const PRESET_COLORS_STORAGE_KEY = 'CURRENT_COLORS_KEY';
const seedBrandPresetColors = (brandHexes: string[]) => {
    if (brandHexes.length === 0) return;
    try {
        const stored = JSON.parse(localStorage.getItem(PRESET_COLORS_STORAGE_KEY) || '[]');
        const recent = (Array.isArray(stored) ? stored : []).filter(
            (c: unknown) => typeof c === 'string' && !brandHexes.includes(c.toLowerCase())
        );
        localStorage.setItem(
            PRESET_COLORS_STORAGE_KEY,
            JSON.stringify([...recent, ...brandHexes].slice(-20))
        );
    } catch {
        // localStorage unavailable — pickers just show their defaults
    }
};

// Load a non-system brand font into the admin page so the editor canvas renders it.
const ensureFontStylesheet = (href: string) => {
    if (!href || document.querySelector(`link[data-email-brand-font="${href}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset.emailBrandFont = href;
    document.head.appendChild(link);
};

// Register the brand font on the page block so the compiled email carries <mj-font>.
const withBrandFont = (content: IBlockData, brand?: EmailBrandSettings | null): IBlockData => {
    const font = brand?.font;
    if (!font?.name || !font.href || content?.type !== BasicType.PAGE) return content;
    const value = content.data?.value || {};
    const fonts: { name: string; href: string }[] = Array.isArray(value.fonts) ? value.fonts : [];
    if (fonts.some((f) => f?.name === font.name)) return content;
    return {
        ...content,
        data: { ...content.data, value: { ...value, fonts: [...fonts, { name: font.name, href: font.href }] } },
    };
};

// Blank page for a new template: brand font as the default font, logo header when set.
const createBrandedPage = (brand?: EmailBrandSettings | null): IBlockData => {
    const font = brand?.font;
    const payload: Record<string, unknown> = {};
    if (font?.name) {
        payload.data = {
            value: {
                'font-family': `${font.name}, Arial, sans-serif`,
                fonts: font.href ? [{ name: font.name, href: font.href }] : [],
            },
        };
    }
    if (brand?.logoUrl) {
        const image = BlockManager.getBlockByType(BasicType.IMAGE)!.create({
            attributes: { src: brand.logoUrl, width: '160px', align: 'center', alt: 'Logo' },
        });
        const column = BlockManager.getBlockByType(BasicType.COLUMN)!.create({ children: [image] });
        const section = BlockManager.getBlockByType(BasicType.SECTION)!.create({ children: [column] });
        payload.children = [BlockManager.getBlockByType(BasicType.WRAPPER)!.create({ children: [section] })];
    }
    return BlockManager.getBlockByType(BasicType.PAGE)!.create(payload);
};

// Human-readable label for a canonical {{snake_case}} variable, e.g. "{{student_name}}" -> "Student Name"
const toMergeTagLabel = (variable: string): string =>
    variable
        .replace(/[{}]/g, '')
        .split('_')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

// Display names for the TEMPLATE_VARIABLES categories, shown as merge-tag group headers.
const TEMPLATE_VARIABLE_CATEGORY_LABELS: Record<keyof typeof TEMPLATE_VARIABLES, string> = {
    student: 'Student',
    course: 'Course',
    batch: 'Batch',
    institute: 'Institute',
    attendance: 'Attendance',
    'live class': 'Live Class',
    referral: 'Referral',
    custom: 'Custom',
    general: 'Date & General',
};

// Merge tags configuration — every entry here is a variable that a real backend
// resolver (bulkEmailService.ts / UnifiedSendService) actually replaces at send time.
// Sourced from the canonical TEMPLATE_VARIABLES catalog so the picker can never drift
// from what actually gets substituted in the sent email.
const defaultMergeTags: Record<string, Record<string, string>> = Object.fromEntries(
    (Object.keys(TEMPLATE_VARIABLES) as Array<keyof typeof TEMPLATE_VARIABLES>).map((category) => [
        TEMPLATE_VARIABLE_CATEGORY_LABELS[category],
        Object.fromEntries(
            TEMPLATE_VARIABLES[category].map((variable) => [toMergeTagLabel(variable), variable])
        ),
    ])
);

// Invoice-specific merge tags (shown when template type is INVOICE or INVOICE_EMAIL).
// These resolve in InvoiceService.replaceTemplatePlaceholders at generation time.
const invoiceMergeTags = {
    Invoice: {
        'Invoice Number': '{{invoice_number}}',
        'Invoice Date': '{{invoice_date}}',
        'Due Date': '{{due_date}}',
        'User Name': '{{user_name}}',
        'User Email': '{{user_email}}',
        'User Address': '{{user_address}}',
        'Line Items (HTML)': '{{line_items}}',
        Subtotal: '{{subtotal}}',
        'Tax Amount': '{{tax_amount}}',
        'Total Amount': '{{total_amount}}',
        Currency: '{{currency}}',
        'Currency Symbol': '{{currency_symbol}}',
    },
    Institute: {
        'Institute Name': '{{institute_name}}',
        'Institute Address': '{{institute_address}}',
        'Institute Contact': '{{institute_contact}}',
        'Institute Logo': '{{institute_logo}}',
    },
    'Tax & Country': {
        Country: '{{country}}',
        'Country Code': '{{country_code}}',
        'Tax Registration No.': '{{tax_registration_number}}',
        'HSN / SAC Code': '{{hsn_code}}',
        'Tax Components (HTML)': '{{tax_components}}',
        'Tax Label': '{{tax_label}}',
        'Tax Rate': '{{tax_rate}}',
    },
};

// Payment-confirmation merge tags. These resolve in
// PaymentNotificatonService.buildPaymentConfirmationPlaceholders when a PAYMENT_CONFIRMATION
// template replaces the built-in confirmation mail — a different resolver from the invoice
// tags above, so the two lists are deliberately kept separate.
const paymentConfirmationMergeTags = {
    Learner: {
        'Learner Name': '{{learner_name}}',
        Email: '{{email}}',
        'Mobile Number': '{{mobile_number}}',
    },
    Payment: {
        Amount: '{{amount}}',
        Currency: '{{currency}}',
        'Currency Symbol': '{{currency_symbol}}',
        'Payment Date': '{{payment_date}}',
        'Payment Mode': '{{payment_mode}}',
        'Transaction ID': '{{transaction_id}}',
        'Receipt / Invoice No.': '{{invoice_number}}',
        'Receipt URL': '{{receipt_url}}',
        'Invoice PDF Link': '{{invoice_pdf_link}}',
        'Course Name': '{{course_name}}',
    },
    Institute: {
        'Institute Name': '{{institute_name}}',
        'Institute Address': '{{institute_address}}',
        'Institute Contact': '{{institute_contact}}',
        'Institute Email': '{{institute_email}}',
        'Institute Website': '{{institute_website}}',
        'Institute Logo': '{{institute_logo}}',
    },
    'Date & General': {
        'Current Date': '{{current_date}}',
        Year: '{{year}}',
    },
};

// Inner toolbar component to access form context
const EditorToolbar: React.FC<{
    onBack: () => void;
    templateName: string;
    setTemplateName: (name: string) => void;
    onOpenAssets: () => void;
    isSaving: boolean;
    templateType?: EmailTemplateCategory;
    onTemplateTypeChange?: (type: EmailTemplateCategory) => void;
    previewText?: string;
    onPreviewTextChange?: (text: string) => void;
    mergeTags?: Record<string, Record<string, string>>;
}> = ({
    onBack,
    templateName,
    setTemplateName,
    onOpenAssets,
    isSaving,
    templateType = 'utility',
    onTemplateTypeChange,
    previewText = '',
    onPreviewTextChange,
    mergeTags = defaultMergeTags,
}) => {
    const form = useForm();
    const { dirty, values } = useFormState({
        subscription: {
            dirty: true,
            values: true,
        },
    });
    const [isNameEditing, setIsNameEditing] = useState(false);
    const [showMergeTags, setShowMergeTags] = useState(false);
    const [hasSaved, setHasSaved] = useState(false);
    const currentSubject = values?.subject || '';
    // After a successful save, the form is still "dirty" (react-final-form doesn't reset).
    // Track hasSaved so we don't show the unsaved-changes warning after save.
    const hasUnsavedChanges = dirty && !hasSaved;

    // Warn on tab close/refresh
    React.useEffect(() => {
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            if (hasUnsavedChanges) {
                e.preventDefault();
                e.returnValue = '';
            }
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [hasUnsavedChanges]);

    // Reset hasSaved when user makes new edits after saving
    React.useEffect(() => {
        if (dirty && hasSaved) {
            setHasSaved(false);
        }
    }, [values]);

    const handleSave = () => {
        form.submit();
        setHasSaved(true);
    };

    const handleCopyHtml = () => {
        try {
            const values = form.getState().values;
            // 1. Convert to MJML
            const mjml = JsonToMjml({
                data: values.content,
                mode: 'production',
                context: values.content,
            });

            // 2. Convert MJML to HTML
            const { html, errors } = mjml2html(mjml);

            if (errors && errors.length > 0) {
                console.warn('MJML compilation errors:', errors);
            }

            navigator.clipboard.writeText(html);
            toast.success('Copied full HTML to clipboard!');
        } catch (e) {
            console.error('Failed to generate HTML:', e);
            toast.error('Failed to generate HTML. Check console for details.');
        }
    };

    const handleBack = () => {
        if (hasUnsavedChanges) {
            if (window.confirm('You have unsaved changes. Are you sure you want to leave?')) {
                onBack();
            }
        } else {
            onBack();
        }
    };

    const handleMergeTagClick = (value: string) => {
        // Try to insert at cursor position
        if (
            document.activeElement?.getAttribute('contenteditable') === 'true' ||
            document.activeElement?.tagName === 'TEXTAREA' ||
            document.activeElement?.tagName === 'INPUT'
        ) {
            const success = document.execCommand('insertText', false, value);
            if (success) {
                setShowMergeTags(false);
                return;
            }
        }
        navigator.clipboard.writeText(value);
        toast.info(`Copied ${value} to clipboard! (Click inside a text block to insert directly)`);
        setShowMergeTags(false);
    };

    return (
        <div className="email-editor-toolbar" style={styles.toolbar}>
            <div style={styles.toolbarLeft}>
                <button style={styles.backButton} onClick={handleBack}>
                    ← Back
                </button>
                <div style={styles.nameContainer}>
                    {isNameEditing ? (
                        <input
                            type="text"
                            value={templateName}
                            onChange={(e) => setTemplateName(e.target.value)}
                            onBlur={() => setIsNameEditing(false)}
                            onKeyDown={(e) => e.key === 'Enter' && setIsNameEditing(false)}
                            style={styles.nameInput}
                            autoFocus
                        />
                    ) : (
                        <h2 style={styles.templateTitle} onClick={() => setIsNameEditing(true)}>
                            {templateName}
                            {hasUnsavedChanges && (
                                <span style={styles.unsavedIndicator} title="Unsaved changes">
                                    •
                                </span>
                            )}
                            <span style={styles.editIcon}>✏️</span>
                        </h2>
                    )}
                </div>
            </div>
            <div style={styles.toolbarCenter}>
                <div style={styles.subjectContainer}>
                    <label style={styles.subjectLabel}>Subject:</label>
                    <input
                        type="text"
                        value={currentSubject}
                        onChange={(e) => {
                            form.change('subject', e.target.value);
                        }}
                        placeholder="Email subject"
                        style={styles.subjectInput}
                    />
                </div>
                <div style={styles.categoryContainer}>
                    <label style={styles.categoryLabel}>Category:</label>
                    <select
                        value={templateType}
                        onChange={(e) => {
                            const newType = e.target.value as EmailTemplateCategory;
                            if (onTemplateTypeChange) {
                                onTemplateTypeChange(newType);
                            }
                        }}
                        style={styles.categorySelect}
                    >
                        <option value="utility">Utility</option>
                        <option value="marketing">Marketing</option>
                        <option value="transactional">Transactional</option>
                        <option value="INVOICE">Invoice (PDF Layout)</option>
                        <option value="INVOICE_EMAIL">Invoice Email</option>
                        <option value="PAYMENT_CONFIRMATION">Payment Confirmation Email</option>
                    </select>
                </div>
                <div style={styles.subjectContainer}>
                    <label style={styles.subjectLabel}>Preview:</label>
                    <input
                        type="text"
                        value={previewText}
                        onChange={(e) => onPreviewTextChange?.(e.target.value)}
                        placeholder="Inbox preview text..."
                        style={{ ...styles.subjectInput, minWidth: '120px', maxWidth: '180px' }}
                        title="Preview text shown in inbox before the email is opened"
                    />
                </div>
            </div>
            <div style={styles.toolbarRight}>
                <button style={styles.secondaryButton} onClick={handleCopyHtml}>
                    {`</>`} Copy HTML
                </button>
                <div style={{ position: 'relative' }}>
                    <button
                        style={styles.secondaryButton}
                        onClick={() => setShowMergeTags(!showMergeTags)}
                    >
                        {'{ }'} Dynamic Values
                    </button>
                    {showMergeTags && (
                        <div style={styles.dropdownMenu}>
                            {Object.entries(mergeTags).map(([category, tags]) => (
                                <div key={category} style={styles.dropdownCategory}>
                                    <div style={styles.categoryTitle}>{category}</div>
                                    {Object.entries(tags).map(([label, value]) => (
                                        <div
                                            key={label}
                                            style={styles.dropdownItem}
                                            onMouseDown={(e) => e.preventDefault()}
                                            onClick={() => handleMergeTagClick(value)}
                                        >
                                            <span>{label}</span>
                                            <code style={styles.tagCode}>{value}</code>
                                        </div>
                                    ))}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
                <button style={styles.assetButton} onClick={onOpenAssets}>
                    📁 Assets
                </button>
                <button style={styles.saveButton} onClick={handleSave} disabled={isSaving}>
                    {isSaving ? 'Saving...' : '💾 Save Template'}
                </button>
            </div>
        </div>
    );
};

const EmailBuilder: React.FC<EmailBuilderProps> = ({
    template,
    onBack,
    onSave,
    isSaving: externalIsSaving = false,
    initialTemplateType,
    brand,
}) => {
    const [isAssetPickerOpen, setIsAssetPickerOpen] = useState(false);
    const [imageResolve, setImageResolve] = useState<((url: string) => void) | null>(null);
    const [templateName, setTemplateName] = useState(template?.name || 'Untitled Template');
    const [templateType, setTemplateType] = useState<EmailTemplateCategory>(
        template?.templateType || initialTemplateType || 'utility'
    );
    const [isSaving, setIsSaving] = useState(false);
    const [previewText, setPreviewText] = useState(template?.previewText || '');

    // Helper to convert base64 to File
    const base64ToFile = (base64Data: string, mimeType: string, filename: string): File | null => {
        try {
            const base64String = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
            if (!base64String) throw new Error('Invalid base64 data');

            const binaryString = atob(base64String);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            const blob = new Blob([bytes], { type: mimeType });
            return new File([blob], filename, { type: mimeType });
        } catch (error) {
            console.error('Error converting base64 to File:', error);
            return null;
        }
    };

    // Helper to upload image to S3
    const uploadImageToS3 = async (base64Data: string): Promise<string> => {
        try {
            const match = base64Data.match(/data:([^;]+);base64,(.+)/);
            if (!match || !match[1] || !match[2]) {
                throw new Error('Invalid base64 format');
            }

            const mimeType = match[1];
            const extension = mimeType.split('/')[1] || 'png';
            const timestamp = Date.now();
            const randomId = Math.random().toString(36).substring(2, 15);
            const filename = `email-template-image-${timestamp}-${randomId}.${extension}`;

            const file = base64ToFile(match[2], mimeType, filename);
            if (!file) throw new Error('Failed to convert base64 to file');

            const userId = getUserId();
            const instituteId = getInstituteId();

            if (!userId || !instituteId) {
                throw new Error('Missing user credentials');
            }

            // Upload to S3
            const fileId = await UploadFileInS3(
                file,
                () => {},
                userId,
                'EMAIL_TEMPLATES',
                instituteId,
                true // Get public URL
            );

            if (!fileId) {
                throw new Error('Failed to upload to S3');
            }

            const publicUrl = await getPublicUrl(fileId);
            if (!publicUrl) {
                throw new Error('Failed to get public URL');
            }

            return publicUrl;
        } catch (error) {
            console.error('Error uploading image to S3:', error);
            throw error;
        }
    };

    // Process HTML to upload all base64 images to S3
    const processHtmlImages = async (html: string): Promise<string> => {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;

        const images = Array.from(tempDiv.querySelectorAll('img'));
        const base64Images: Array<{ img: HTMLImageElement; src: string }> = [];

        images.forEach((img) => {
            const src = img.getAttribute('src');
            if (src && src.startsWith('data:')) {
                base64Images.push({ img, src });
            }
        });

        if (base64Images.length === 0) {
            return html;
        }

        // Upload all images in parallel
        const uploadPromises = base64Images.map(async ({ img, src }) => {
            try {
                const s3Url = await uploadImageToS3(src);
                img.setAttribute('src', s3Url);
            } catch (error) {
                console.error('Failed to upload image:', error);
                // Keep the base64 image if upload fails
            }
        });

        await Promise.all(uploadPromises);

        return tempDiv.innerHTML;
    };

    // Initial template data
    const initialValues: IEmailTemplate = useMemo(() => {
        const loaded = loadInitialValues();
        return { ...loaded, content: withBrandFont(loaded.content, brand) };
    }, [template, brand]);

    // Brand colours as picker swatches + brand font in the canvas. Runs during render so the
    // pickers' provider reads the seeded list on its first mount.
    useMemo(() => {
        seedBrandPresetColors((brand?.colors || []).map((c) => c.hex.toLowerCase()));
        if (brand?.font?.href) ensureFontStylesheet(brand.font.href);
    }, [brand]);

    // Brand font first in the font-family dropdowns.
    const editorFontList = useMemo(() => {
        const name = brand?.font?.name;
        if (!name) return fontList;
        return [{ value: name, label: `${name} (Brand)` }, ...fontList.filter((f) => f.value !== name)];
    }, [brand]);

    function loadInitialValues(): IEmailTemplate {
        if (template && template.id) {
            // Load MJML JSON from the template.mjml field (stored in settingJson on backend)
            if (template.mjml) {
                try {
                    const contentData = typeof template.mjml === 'string' 
                        ? JSON.parse(template.mjml) 
                        : template.mjml;
                    console.log('Loaded MJML from API settingJson:', { hasContent: !!contentData });
                    return {
                        subject: template.subject || 'Welcome to Easy-email',
                        subTitle: 'Nice to meet you!',
                        content: contentData,
                    };
                } catch (e) {
                    console.warn('Failed to parse MJML JSON from API:', e);
                }
            }

            // Fallback: Try to load from localStorage (for backwards compatibility)
            const mjmlJsonKey = `email_template_mjml_${template.id}`;
            const storedMjml = localStorage.getItem(mjmlJsonKey);

            if (storedMjml) {
                try {
                    const contentData = JSON.parse(storedMjml);
                    console.log('Loaded MJML from localStorage (legacy):', { hasContent: !!contentData });
                    return {
                        subject: template.subject || 'Welcome to Easy-email',
                        subTitle: 'Nice to meet you!',
                        content: contentData,
                    };
                } catch (e) {
                    console.warn('Failed to parse stored MJML JSON from localStorage:', e);
                }
            }

            // If no stored MJML, check if content is JSON
            if (template.content) {
                try {
                    // Try to parse content as JSON (MJML block data)
                    const contentData =
                        typeof template.content === 'string'
                            ? JSON.parse(template.content)
                            : template.content;

                    // Check if it's actually HTML (starts with <)
                    if (
                        typeof template.content === 'string' &&
                        template.content.trim().startsWith('<')
                    ) {
                        // It's HTML, can't load it - show blank template
                        console.warn(
                            'Template content is HTML, cannot load into editor. Please recreate the template.'
                        );
                        toast.warning(
                            'This template was created with a different editor. Please recreate it using the new editor.'
                        );
                        return {
                            subject: template.subject || 'Welcome to Easy-email',
                            subTitle: 'Nice to meet you!',
                            content: createBrandedPage(brand),
                        };
                    }

                    return {
                        subject: template.subject || 'Welcome to Easy-email',
                        subTitle: 'Nice to meet you!',
                        content: contentData,
                    };
                } catch (e) {
                    // If parsing fails, create a new page
                    console.warn('Failed to parse template content, creating new template');
                    return {
                        subject: template.subject || 'Welcome to Easy-email',
                        subTitle: 'Nice to meet you!',
                        content: createBrandedPage(brand),
                    };
                }
            }
        }
        return {
            subject: 'Welcome to Easy-email',
            subTitle: 'Nice to meet you!',
            content: createBrandedPage(brand),
        };
    }

    // Handle form submission (save template)
    const onSubmit = useCallback(
        async (values: IEmailTemplate, _form: any) => {
            setIsSaving(true);
            try {
                // 1. Convert to MJML string
                const mjmlString = JsonToMjml({
                    data: values.content,
                    mode: 'production',
                    context: values.content,
                });

                // 2. Convert MJML to HTML
                const { html, errors } = mjml2html(mjmlString);

                if (errors && errors.length > 0) {
                    console.warn('MJML compilation errors:', errors);
                    toast.warning('Some MJML errors occurred. Please check the template.');
                }

                // 3. Process and upload images to S3
                const processedHtml = await processHtmlImages(html);

                // 4. Serialize MJML JSON for storage in settingJson
                const mjmlJsonString = JSON.stringify(values.content);

                // 5. Create template object with MJML stored in mjml field
                // Type-bearing categories (INVOICE / INVOICE_EMAIL / PAYMENT_CONFIRMATION) are the
                // DB type directly — that's how the backend finds them. Everything else is EMAIL.
                const resolvedType = TYPE_BEARING_CATEGORIES.includes(templateType)
                    ? (templateType as MessageTemplate['type'])
                    : 'EMAIL';

                const savedTemplate: MessageTemplate = {
                    id: template?.id || '',
                    name: templateName,
                    type: resolvedType,
                    subject: values.subject,
                    content: processedHtml, // Save as HTML for sending emails
                    variables: template?.variables || [],
                    isDefault: template?.isDefault || false,
                    templateType: templateType,
                    mjml: mjmlJsonString, // Store MJML JSON in settingJson via API
                    previewText: previewText || undefined,
                    createdAt: template?.createdAt || new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                };

                console.log('Saving template with MJML:', { 
                    hasId: !!savedTemplate.id, 
                    hasMjml: !!savedTemplate.mjml,
                    mjmlLength: savedTemplate.mjml?.length || 0
                });

                // 6. Save via API (mjml will be stored in settingJson on the backend)
                await onSave(savedTemplate);

                // 7. Also store in localStorage as backup for backwards compatibility
                const mjmlJsonKey = template?.id ? `email_template_mjml_${template.id}` : null;
                if (mjmlJsonKey) {
                    localStorage.setItem(mjmlJsonKey, mjmlJsonString);
                }

                // Toast is shown by TemplateEditorEmail.handleSave — no duplicate here
            } catch (error) {
                console.error('Failed to save template:', error);
                toast.error('Failed to save template. Please try again.');
            } finally {
                setIsSaving(false);
            }
        },
        [template, templateName, templateType, previewText, onSave]
    );

    // Handle image upload — upload to S3 and return the public URL.
    // Data URLs (base64) break easy-email's internal style parser which splits
    // on ";" and ":" — destroying data:image/jpeg;base64,... in CSS properties.
    // Using a real https:// URL avoids this parser bug entirely.
    const onUploadImage = useCallback(async (blob: Blob): Promise<string> => {
        try {
            const reader = new FileReader();
            const base64 = await new Promise<string>((resolve, reject) => {
                reader.onload = () => resolve(reader.result as string);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
            const s3Url = await uploadImageToS3(base64);
            return s3Url;
        } catch (error) {
            console.error('S3 upload failed, falling back to base64:', error);
            // Fallback: return base64 (images won't render in preview for
            // background-image CSS, but <img src> will still work)
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result as string);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        }
    }, []);

    // Open asset picker
    const openAssetPicker = useCallback(() => {
        return new Promise<string>((resolve) => {
            setImageResolve(() => resolve);
            setIsAssetPickerOpen(true);
        });
    }, []);

    // Handle asset selection
    const handleAssetSelect = useCallback(
        (imageUrl: string) => {
            if (imageResolve) {
                imageResolve(imageUrl);
                setImageResolve(null);
            }
        },
        [imageResolve]
    );

    // Close asset picker
    const handleAssetPickerClose = useCallback(() => {
        setIsAssetPickerOpen(false);
        if (imageResolve) {
            imageResolve('');
            setImageResolve(null);
        }
    }, [imageResolve]);

    // Merge tags change based on template type
    const mergeTags = useMemo(() => {
        if (templateType === 'INVOICE' || templateType === 'INVOICE_EMAIL') {
            return { ...invoiceMergeTags, ...defaultMergeTags };
        }
        // Payment-confirmation templates get ONLY their own resolver's tags — offering the
        // generic catalog here would advertise variables that render as literal {{...}} text.
        if (templateType === 'PAYMENT_CONFIRMATION') {
            return paymentConfirmationMergeTags;
        }
        return defaultMergeTags;
    }, [templateType]);

    // easy-email's own merge-tag pickers (text toolbar, link/button fields) insert
    // mergeTagGenerate(<path into mergeTags>), e.g. "Student.Student Name". Its default
    // wraps that as {{Student.Student Name}}, which no resolver substitutes. Our catalogs
    // map category → label → canonical tag, so return the tag itself. Split on the first
    // dot only — labels such as "Receipt / Invoice No." contain dots.
    const mergeTagGenerate = useCallback(
        (path: string) => {
            const dot = path.indexOf('.');
            const tags: Record<string, Record<string, string> | undefined> = mergeTags;
            const tag = dot > 0 ? tags[path.slice(0, dot)]?.[path.slice(dot + 1)] : undefined;
            return tag ?? `{{${path}}}`;
        },
        [mergeTags]
    );

    const handleOpenAssets = () => {
        openAssetPicker().then((url) => {
            if (url) {
                navigator.clipboard.writeText(url);
                toast.info('Image URL copied to clipboard! Paste it in an image block.');
            }
        });
    };

    return (
        <>
            <EmailEditorProvider
                data={initialValues}
                height={'calc(100vh - 56px)'}
                autoComplete
                dashed={false}
                mergeTags={mergeTags}
                mergeTagGenerate={mergeTagGenerate}
                fontList={editorFontList}
                onSubmit={onSubmit}
                onUploadImage={onUploadImage}
            >
                {({ values: _values }) => {
                    return (
                        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                            <EditorToolbar
                                onBack={onBack}
                                templateName={templateName}
                                setTemplateName={setTemplateName}
                                onOpenAssets={handleOpenAssets}
                                isSaving={isSaving || externalIsSaving}
                                templateType={templateType}
                                onTemplateTypeChange={setTemplateType}
                                previewText={previewText}
                                onPreviewTextChange={setPreviewText}
                                mergeTags={mergeTags}
                            />
                            <div style={{ flex: 1, overflow: 'hidden' }}>
                                <SimpleLayout showSourceCode={true} mjmlReadOnly={false}>
                                    <EmailEditor />
                                </SimpleLayout>
                            </div>
                        </div>
                    );
                }}
            </EmailEditorProvider>

            {/* Asset Picker Modal */}
            <AssetPicker
                isOpen={isAssetPickerOpen}
                onClose={handleAssetPickerClose}
                onSelect={handleAssetSelect}
            />
        </>
    );
};

const styles: { [key: string]: React.CSSProperties } = {
    toolbar: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '8px 12px',
        backgroundColor: '#1e293b',
        color: '#fff',
        height: '56px',
        minHeight: '56px',
        boxSizing: 'border-box',
        borderBottom: '1px solid #334155',
        position: 'relative',
        zIndex: 1000,
        flexShrink: 0,
        boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
    },
    toolbarLeft: {
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        flexShrink: 0,
    },
    toolbarCenter: {
        display: 'flex',
        alignItems: 'center',
        flex: 1,
        justifyContent: 'center',
        margin: '0 8px',
        minWidth: 0,
        gap: '8px',
    },
    subjectContainer: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        minWidth: 0,
        flexShrink: 1,
    },
    subjectLabel: {
        fontSize: '13px',
        color: '#fff',
        whiteSpace: 'nowrap',
    },
    subjectInput: {
        padding: '5px 10px',
        fontSize: '13px',
        border: '1px solid rgba(255,255,255,0.3)',
        borderRadius: '6px',
        outline: 'none',
        backgroundColor: 'rgba(255,255,255,0.1)',
        color: '#fff',
        minWidth: '160px',
        maxWidth: '280px',
        width: '100%',
        transition: 'border-color 0.2s',
    },
    categoryContainer: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        flexShrink: 0,
    },
    categoryLabel: {
        fontSize: '13px',
        color: '#fff',
        whiteSpace: 'nowrap',
    },
    categorySelect: {
        padding: '5px 10px',
        fontSize: '13px',
        border: '1px solid rgba(255,255,255,0.3)',
        borderRadius: '6px',
        outline: 'none',
        backgroundColor: '#fff',
        color: '#1e293b',
        minWidth: '110px',
        cursor: 'pointer',
        transition: 'border-color 0.2s',
    },
    toolbarRight: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        flexShrink: 0,
    },
    backButton: {
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        padding: '6px 10px',
        backgroundColor: 'transparent',
        color: '#fff',
        border: '1px solid rgba(255,255,255,0.3)',
        borderRadius: '8px',
        fontSize: '13px',
        cursor: 'pointer',
        transition: 'all 0.2s',
        whiteSpace: 'nowrap',
    },
    nameContainer: {
        display: 'flex',
        alignItems: 'center',
    },
    templateTitle: {
        margin: 0,
        fontSize: '16px',
        fontWeight: 500,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
    },
    editIcon: {
        fontSize: '12px',
        opacity: 0.6,
    },
    nameInput: {
        padding: '6px 12px',
        fontSize: '16px',
        fontWeight: 500,
        border: '1px solid #667eea',
        borderRadius: '6px',
        outline: 'none',
        backgroundColor: '#fff',
        color: '#1e293b',
        minWidth: '200px',
    },
    assetButton: {
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        padding: '6px 10px',
        backgroundColor: '#3b82f6',
        color: '#fff',
        border: 'none',
        borderRadius: '8px',
        fontSize: '13px',
        fontWeight: 500,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
    },
    saveButton: {
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        padding: '6px 10px',
        backgroundColor: '#10b981',
        color: '#fff',
        border: 'none',
        borderRadius: '8px',
        fontSize: '13px',
        fontWeight: 500,
        cursor: 'pointer',
        transition: 'background-color 0.2s',
        whiteSpace: 'nowrap',
    },
    secondaryButton: {
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        padding: '6px 10px',
        backgroundColor: '#475569',
        color: '#fff',
        border: 'none',
        borderRadius: '8px',
        fontSize: '13px',
        fontWeight: 500,
        cursor: 'pointer',
        transition: 'background-color 0.2s',
        whiteSpace: 'nowrap',
    },
    dropdownMenu: {
        position: 'absolute',
        top: '100%',
        right: 0,
        marginTop: '8px',
        backgroundColor: '#fff',
        borderRadius: '8px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
        width: '280px',
        maxHeight: '400px',
        overflowY: 'auto',
        zIndex: 2000,
        border: '1px solid #e2e8f0',
        color: '#1e293b',
        padding: '8px 0',
    },
    dropdownCategory: {
        borderBottom: '1px solid #f1f5f9',
    },
    categoryTitle: {
        padding: '8px 16px',
        fontSize: '12px',
        fontWeight: 600,
        color: '#64748b',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        backgroundColor: '#f8fafc',
    },
    dropdownItem: {
        padding: '10px 16px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        cursor: 'pointer',
        fontSize: '14px',
        transition: 'background-color 0.1s',
    },
    tagCode: {
        fontSize: '12px',
        fontFamily: 'monospace',
        backgroundColor: '#f1f5f9',
        padding: '2px 6px',
        borderRadius: '4px',
        color: '#667eea',
    },
    unsavedIndicator: {
        color: '#fbbf24',
        fontSize: '20px',
        marginLeft: '4px',
    },
};

export default EmailBuilder;
