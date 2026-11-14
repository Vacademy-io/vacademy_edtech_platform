import React, { useEffect, useState } from 'react';
import { Button, Collapse, Grid, Input, Popover, Radio, Select, Space } from '@arco-design/web-react';
import { AdvancedType, BasicType } from 'easy-email-core';
import { IconFont, useBlock, useEditorProps, useFocusIdx } from 'easy-email-editor';
import {
    Align,
    AttributesPanelWrapper,
    BackgroundColor,
    BlockAttributeConfigurationManager,
    BlockMarketManager,
    BlockMaskWrapper,
    Border,
    ClassName,
    Color,
    ContainerBackgroundColor,
    FontFamily,
    FontSize,
    FontStyle,
    FontWeight,
    LetterSpacing,
    LineHeight,
    MergeTags,
    Padding,
    TextDecoration,
    TextField,
    Width,
} from 'easy-email-extensions';
import { useField } from 'react-final-form';

/**
 * Click-to-email (mailto:) and click-to-call (tel:) support.
 *
 * - Button panel: the free-text "Href" is replaced by a Link field with Website / Email /
 *   Phone modes, so admins fill an address or number and the href is built for them.
 * - "+" block panel: a Contact category with ready-made Email / Call buttons and a text
 *   block with both links.
 *
 * Merge tags ({{institute_email}} …) are kept verbatim inside the href, never URL-encoded,
 * so the backend's string replacement still finds them.
 */

type LinkKind = 'web' | 'email' | 'phone';

interface EmailLink {
    address: string;
    subject: string;
    body: string;
}

const MERGE_TAG = /(\{\{[^}]+\}\})/;

// encodeURIComponent, except merge tags pass through untouched.
function encodeKeepingTags(text: string): string {
    return text
        .split(MERGE_TAG)
        .map((part, i) => (i % 2 === 1 ? part : encodeURIComponent(part)))
        .join('');
}

function safeDecode(text: string): string {
    try {
        return decodeURIComponent(text);
    } catch {
        return text;
    }
}

export function linkKindOf(href?: string): LinkKind {
    const lower = (href ?? '').trim().toLowerCase();
    if (lower.startsWith('mailto:')) return 'email';
    if (lower.startsWith('tel:')) return 'phone';
    return 'web';
}

export function parseMailto(href?: string): EmailLink {
    const raw = (href ?? '').trim().replace(/^mailto:/i, '');
    const [address = '', query = ''] = raw.split('?');
    const params = new Map<string, string>();
    query
        .split('&')
        .filter(Boolean)
        .forEach((pair) => {
            const eq = pair.indexOf('=');
            const key = (eq === -1 ? pair : pair.slice(0, eq)).toLowerCase();
            params.set(key, safeDecode(eq === -1 ? '' : pair.slice(eq + 1)));
        });
    return {
        address: safeDecode(address),
        subject: params.get('subject') ?? '',
        body: params.get('body') ?? '',
    };
}

export function buildMailto({ address, subject, body }: EmailLink): string {
    const query = [
        subject.trim() && `subject=${encodeKeepingTags(subject.trim())}`,
        body.trim() && `body=${encodeKeepingTags(body.trim())}`,
    ]
        .filter(Boolean)
        .join('&');
    return `mailto:${address.trim()}${query ? `?${query}` : ''}`;
}

export function parseTel(href?: string): string {
    return safeDecode((href ?? '').trim().replace(/^tel:/i, ''));
}

// Dialers want digits and a leading +; spaces, dashes and brackets are for humans only.
export function buildTel(number: string): string {
    const trimmed = number.trim();
    if (MERGE_TAG.test(trimmed)) return `tel:${trimmed.replace(/\s+/g, '')}`;
    const digits = trimmed.replace(/[^\d+]/g, '');
    return `tel:${digits.startsWith('+') ? '+' + digits.slice(1).replace(/\+/g, '') : digits.replace(/\+/g, '')}`;
}

function MergeTagButton({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    const { mergeTags } = useEditorProps();
    if (!mergeTags) return null;
    return (
        <Popover trigger="click" content={<MergeTags value={value} onChange={onChange} />}>
            <Button type="text" size="mini" icon={<IconFont iconName="icon-merge-tags" />} />
        </Popover>
    );
}

function LabelledInput({
    label,
    value,
    placeholder,
    onChange,
    textarea,
}: {
    label: string;
    value: string;
    placeholder?: string;
    onChange: (v: string) => void;
    textarea?: boolean;
}) {
    return (
        <div className="vac-link-field__item">
            <div className="vac-link-field__label">
                <span>{label}</span>
                <MergeTagButton value={value} onChange={onChange} />
            </div>
            {textarea ? (
                <Input.TextArea
                    value={value}
                    placeholder={placeholder}
                    autoSize={{ minRows: 2, maxRows: 5 }}
                    onChange={onChange}
                />
            ) : (
                <Input value={value} placeholder={placeholder} onChange={onChange} />
            )}
        </div>
    );
}

/** Website / Email / Phone link editor bound to the focused block's `href` and `target`. */
export function LinkField() {
    const { focusIdx } = useFocusIdx();
    const { focusBlock, change } = useBlock();
    const href: string = focusBlock?.attributes?.href ?? '';
    const target: string = focusBlock?.attributes?.target ?? '';

    const [kind, setKind] = useState<LinkKind>(() => linkKindOf(href));
    const [web, setWeb] = useState(() => (linkKindOf(href) === 'web' ? href : ''));
    const [email, setEmail] = useState<EmailLink>(() => parseMailto(href));
    const [phone, setPhone] = useState(() => (linkKindOf(href) === 'phone' ? parseTel(href) : ''));

    // Reload when another block is selected or the href changes outside this field (undo, source).
    useEffect(() => {
        const nextKind = linkKindOf(href);
        setKind(nextKind);
        if (nextKind === 'web') setWeb((prev) => (prev === href ? prev : href));
        if (nextKind === 'email') setEmail((prev) => (buildMailto(prev) === href ? prev : parseMailto(href)));
        if (nextKind === 'phone') setPhone((prev) => (buildTel(prev) === href ? prev : parseTel(href)));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [focusIdx, href]);

    const setHref = (value: string) => change(`${focusIdx}.attributes.href`, value);

    const switchKind = (next: LinkKind) => {
        setKind(next);
        if (next === 'web') {
            setHref(web || '#');
            return;
        }
        // mailto:/tel: in a new tab leaves an empty tab behind in most clients.
        if (target) change(`${focusIdx}.attributes.target`, '');
        setHref(next === 'email' ? buildMailto(email) : buildTel(phone));
    };

    const updateEmail = (patch: Partial<EmailLink>) => {
        const next = { ...email, ...patch };
        setEmail(next);
        setHref(buildMailto(next));
    };

    return (
        <Space direction="vertical" style={{ width: '100%' }} className="vac-link-field">
            <div className="vac-link-field__label">Link to</div>
            <Radio.Group type="button" size="small" value={kind} onChange={switchKind} className="vac-link-field__kind">
                <Radio value="web">Website</Radio>
                <Radio value="email">Email</Radio>
                <Radio value="phone">Phone</Radio>
            </Radio.Group>

            {kind === 'web' && (
                <Grid.Row>
                    <Grid.Col span={15}>
                        <LabelledInput
                            label="URL"
                            value={web}
                            placeholder="https://"
                            onChange={(value) => {
                                setWeb(value);
                                setHref(value);
                            }}
                        />
                    </Grid.Col>
                    <Grid.Col offset={1} span={8}>
                        <div className="vac-link-field__item">
                            <div className="vac-link-field__label">Open in</div>
                            <Select
                                value={target}
                                onChange={(value: string) => change(`${focusIdx}.attributes.target`, value)}
                                options={[
                                    { label: 'Same tab', value: '' },
                                    { label: 'New tab', value: '_blank' },
                                ]}
                            />
                        </div>
                    </Grid.Col>
                </Grid.Row>
            )}

            {kind === 'email' && (
                <>
                    <LabelledInput
                        label="Email address"
                        value={email.address}
                        placeholder="hello@yourinstitute.com"
                        onChange={(address) => updateEmail({ address })}
                    />
                    <LabelledInput
                        label="Subject (optional)"
                        value={email.subject}
                        placeholder="Enquiry"
                        onChange={(subject) => updateEmail({ subject })}
                    />
                    <LabelledInput
                        label="Message (optional)"
                        value={email.body}
                        placeholder="Pre-filled message"
                        onChange={(body) => updateEmail({ body })}
                        textarea
                    />
                </>
            )}

            {kind === 'phone' && (
                <LabelledInput
                    label="Phone number"
                    value={phone}
                    placeholder="+91 98765 43210"
                    onChange={(value) => {
                        setPhone(value);
                        setHref(buildTel(value));
                    }}
                />
            )}
        </Space>
    );
}

// Rebuild of the library's Button panel with LinkField in place of its Href/Target row.
function ButtonAttributePanel() {
    const { focusIdx } = useFocusIdx();
    const { input: content } = useField(`${focusIdx}.data.value.content`, { parse: (v) => v });
    return (
        <AttributesPanelWrapper>
            <Collapse
                defaultActiveKey={['setting', 'dimension', 'color', 'typography', 'border']}
                style={{ marginBottom: 72 }}
            >
                <Collapse.Item name="setting" header="Setting">
                    <Space direction="vertical" style={{ width: '100%' }}>
                        <TextField
                            label={
                                <span className="vac-link-field__label">
                                    <span>Button text</span>
                                    <MergeTagButton value={content.value} onChange={content.onChange} />
                                </span>
                            }
                            name={`${focusIdx}.data.value.content`}
                        />
                        <LinkField />
                    </Space>
                </Collapse.Item>
                <Collapse.Item name="dimension" header="Dimension">
                    <Space direction="vertical" style={{ width: '100%' }}>
                        <Grid.Row>
                            <Grid.Col span={11}>
                                <Width />
                            </Grid.Col>
                            <Grid.Col offset={1} span={11}>
                                <FontWeight />
                            </Grid.Col>
                        </Grid.Row>
                        <Padding title="Padding" attributeName="padding" showResetAll />
                        <Padding title="Inner padding" attributeName="inner-padding" />
                    </Space>
                </Collapse.Item>
                <Collapse.Item name="color" header="Color">
                    <Grid.Row>
                        <Grid.Col span={11}>
                            <Color title="Text color" />
                        </Grid.Col>
                        <Grid.Col offset={1} span={11}>
                            <BackgroundColor title="Button color" />
                        </Grid.Col>
                        <Grid.Col span={11}>
                            <ContainerBackgroundColor title="Background color" />
                        </Grid.Col>
                    </Grid.Row>
                </Collapse.Item>
                <Collapse.Item name="typography" header="Typography">
                    <Space direction="vertical" style={{ width: '100%' }}>
                        <Grid.Row>
                            <Grid.Col span={11}>
                                <FontFamily />
                            </Grid.Col>
                            <Grid.Col offset={1} span={11}>
                                <FontSize />
                            </Grid.Col>
                        </Grid.Row>
                        <Grid.Row>
                            <Grid.Col span={11}>
                                <LineHeight />
                            </Grid.Col>
                            <Grid.Col offset={1} span={11}>
                                <LetterSpacing />
                            </Grid.Col>
                        </Grid.Row>
                        <TextDecoration />
                        <Align />
                        <FontStyle />
                    </Space>
                </Collapse.Item>
                <Collapse.Item name="border" header="Border">
                    <Border />
                </Collapse.Item>
                <Collapse.Item name="extra" header="Extra">
                    <Grid.Col span={24}>
                        <ClassName />
                    </Grid.Col>
                </Collapse.Item>
            </Collapse>
        </AttributesPanelWrapper>
    );
}

// ---------------------------------------------------------------------------------------
// "+" panel → Contact category
// ---------------------------------------------------------------------------------------

const EXAMPLE_EMAIL = 'hello@yourinstitute.com';
const EXAMPLE_PHONE = '+91 98765 43210';

const BUTTON_BASE = {
    align: 'center',
    color: '#ffffff',
    'font-size': '14px',
    'font-weight': '600',
    'border-radius': '6px',
    padding: '10px 25px 10px 25px',
    'inner-padding': '12px 24px 12px 24px',
    'line-height': '120%',
    target: '',
    'vertical-align': 'middle',
    border: 'none',
    'text-align': 'center',
};

interface ButtonPreset {
    preview: string;
    background: string;
    outline?: string;
    payload: { attributes: Record<string, string>; data: { value: { content: string } } };
}

const CONTACT_BUTTONS: ButtonPreset[] = [
    {
        preview: '✉  Email us',
        background: '#2563eb',
        payload: {
            attributes: { ...BUTTON_BASE, 'background-color': '#2563eb', href: buildMailto({ address: EXAMPLE_EMAIL, subject: '', body: '' }) },
            data: { value: { content: '✉ Email us' } },
        },
    },
    {
        preview: '✉  Email us',
        background: 'transparent',
        outline: '#2563eb',
        payload: {
            attributes: {
                ...BUTTON_BASE,
                color: '#2563eb',
                'background-color': 'transparent',
                border: '2px solid #2563eb',
                href: buildMailto({ address: EXAMPLE_EMAIL, subject: '', body: '' }),
            },
            data: { value: { content: '✉ Email us' } },
        },
    },
];

const CALL_BUTTONS: ButtonPreset[] = [
    {
        preview: '📞  Call us',
        background: '#16a34a',
        payload: {
            attributes: { ...BUTTON_BASE, 'background-color': '#16a34a', href: buildTel(EXAMPLE_PHONE) },
            data: { value: { content: '📞 Call us' } },
        },
    },
    {
        preview: '📞  Call us',
        background: 'transparent',
        outline: '#16a34a',
        payload: {
            attributes: {
                ...BUTTON_BASE,
                color: '#16a34a',
                'background-color': 'transparent',
                border: '2px solid #16a34a',
                href: buildTel(EXAMPLE_PHONE),
            },
            data: { value: { content: '📞 Call us' } },
        },
    },
];

function ButtonPresets({ presets }: { presets: ButtonPreset[] }) {
    return (
        <div className="vac-contact-presets">
            {presets.map((preset, index) => (
                <BlockMaskWrapper key={index} type={AdvancedType.BUTTON} payload={preset.payload}>
                    <div className="vac-contact-presets__item">
                        <span
                            className="vac-contact-presets__button"
                            style={{
                                background: preset.background,
                                color: preset.outline ?? '#ffffff',
                                border: preset.outline ? `2px solid ${preset.outline}` : 'none',
                            }}
                        >
                            {preset.preview}
                        </span>
                    </div>
                </BlockMaskWrapper>
            ))}
        </div>
    );
}

const CONTACT_TEXT_HTML =
    `Email: <a href="${buildMailto({ address: EXAMPLE_EMAIL, subject: '', body: '' })}" style="color:#2563eb">${EXAMPLE_EMAIL}</a>` +
    `<br>Phone: <a href="${buildTel(EXAMPLE_PHONE)}" style="color:#2563eb">${EXAMPLE_PHONE}</a>`;

function ContactTextPreset() {
    return (
        <div className="vac-contact-presets">
            <BlockMaskWrapper
                type={AdvancedType.TEXT}
                payload={{
                    attributes: { padding: '10px 25px 10px 25px', 'font-size': '14px', 'line-height': '1.6' },
                    data: { value: { content: CONTACT_TEXT_HTML } },
                }}
            >
                <div
                    className="vac-contact-presets__item vac-contact-presets__text"
                    dangerouslySetInnerHTML={{ __html: CONTACT_TEXT_HTML }}
                />
            </BlockMaskWrapper>
        </div>
    );
}

let registered = false;

/** Button panel with Website/Email/Phone links + the Contact category. Idempotent. */
export function registerContactLinks(): void {
    if (registered) return;
    registered = true;

    BlockAttributeConfigurationManager.add({
        [BasicType.BUTTON]: ButtonAttributePanel,
        [AdvancedType.BUTTON]: ButtonAttributePanel,
    });

    BlockMarketManager.addCategory('CONTACT', 'Contact', [
        {
            type: AdvancedType.BUTTON,
            title: 'Email button',
            description: 'Opens the reader’s mail app with your address filled in',
            component: () => <ButtonPresets presets={CONTACT_BUTTONS} />,
        },
        {
            type: AdvancedType.BUTTON,
            title: 'Call button',
            description: 'Starts a phone call on mobile',
            component: () => <ButtonPresets presets={CALL_BUTTONS} />,
        },
        {
            type: AdvancedType.TEXT,
            title: 'Email & phone links',
            description: 'Text with a clickable email address and phone number',
            component: () => <ContactTextPreset />,
        },
    ]);
}
