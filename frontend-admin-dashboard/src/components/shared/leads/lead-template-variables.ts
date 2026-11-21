/**
 * Mapping a WhatsApp template's placeholders onto a lead, for workflows that
 * message leads (an audience's lead-submission confirmation, or a follow-up
 * over its fetch_audience_responses_filtered rows).
 *
 * Meta rejects a template message outright when any declared placeholder gets
 * no value, while the workflow still reports the send as a success — so every
 * placeholder has to be mapped before the workflow runs. A placeholder is
 * filled from a lead detail, one of the lead list's form fields, or fixed text,
 * and is stored on the SEND_WHATSAPP node as `templateVars[key]`: the value the
 * send handler resolves (an item field, a context field, a customFields name,
 * or else the text itself).
 */
import type { TemplateItem } from '@/services/workflow-service';

/**
 * What a SEND_WHATSAPP node iterates when it messages leads:
 *   - 'confirmation': the lead's UserDTO (`{#ctx['user']}`, snake_case), with
 *     the lead-submission context behind it;
 *   - 'followup': a fetch_audience_responses_filtered row (`#ctx['leads']`).
 */
export type LeadWorkflowKind = 'confirmation' | 'followup';

export type LeadVariableId =
    | 'leadName'
    | 'email'
    | 'phone'
    | 'listName'
    | 'submittedOn'
    | 'instituteName';

/** Where one template placeholder takes its value from. */
export type LeadVarChoice =
    | { source: 'lead'; value: LeadVariableId }
    | { source: 'form'; value: string }
    | { source: 'text'; value: string };

/**
 * Lead details a placeholder can be filled from, and the key the send handler
 * resolves each one with. The two kinds iterate different items, so the same
 * detail can sit under a different key in each, or be missing from one
 * altogether (undefined: not offered for that kind).
 */
export const LEAD_VARIABLES: Array<{
    id: LeadVariableId;
    resolve: (kind: LeadWorkflowKind, audienceName: string) => string | undefined;
}> = [
    { id: 'leadName', resolve: (kind) => (kind === 'confirmation' ? 'full_name' : 'parentName') },
    { id: 'email', resolve: () => 'email' },
    { id: 'phone', resolve: () => 'mobileNumber' },
    // A follow-up row carries no campaign name, but a follow-up workflow belongs
    // to a single lead list, so its name is already known (when it is).
    {
        id: 'listName',
        resolve: (kind, audienceName) =>
            kind === 'confirmation' ? 'campaignName' : audienceName || undefined,
    },
    // Only the lead-submission context carries a formatted submission time.
    {
        id: 'submittedOn',
        resolve: (kind) => (kind === 'confirmation' ? 'submissionTime' : undefined),
    },
    { id: 'instituteName', resolve: () => 'instituteName' },
];

/** Template variable names ({{name}}, or a {{1}} labelled "Name") that mean a lead detail. */
const LEAD_VARIABLE_ALIASES: Record<string, LeadVariableId> = {
    name: 'leadName',
    fullname: 'leadName',
    leadname: 'leadName',
    studentname: 'leadName',
    parentname: 'leadName',
    email: 'email',
    emailid: 'email',
    emailaddress: 'email',
    phone: 'phone',
    phonenumber: 'phone',
    mobile: 'phone',
    mobilenumber: 'phone',
    whatsapp: 'phone',
    whatsappnumber: 'phone',
    contactnumber: 'phone',
    campaign: 'listName',
    campaignname: 'listName',
    leadlist: 'listName',
    listname: 'listName',
    institute: 'instituteName',
    institutename: 'instituteName',
};

const normalizeVarName = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

export const leadVariableKey = (id: LeadVariableId, kind: LeadWorkflowKind, audienceName = '') =>
    LEAD_VARIABLES.find((variable) => variable.id === id)?.resolve(kind, audienceName);

export const leadVariablesFor = (kind: LeadWorkflowKind, audienceName = '') =>
    LEAD_VARIABLES.filter((variable) => variable.resolve(kind, audienceName) !== undefined);

export function isLeadVarComplete(
    choice: LeadVarChoice | undefined,
    kind: LeadWorkflowKind,
    audienceName = ''
): boolean {
    if (!choice) return false;
    if (choice.source === 'lead') {
        return leadVariableKey(choice.value, kind, audienceName) !== undefined;
    }
    return choice.value.trim() !== '';
}

/**
 * The template's body placeholders with their human labels (e.g. {"1": "Name"}),
 * as recorded in its dynamic_parameters. Stored on the node as `_templateParams`,
 * which is what makes the builder show a variable picker per placeholder.
 */
export function whatsappTemplateParamSpec(
    template: TemplateItem | undefined
): Record<string, string> {
    if (!template?.dynamic_parameters) return {};
    try {
        const parsed: unknown = JSON.parse(template.dynamic_parameters);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Record<string, string>)
            : {};
    } catch {
        return {};
    }
}

/**
 * Starting picks for a freshly chosen template, from each placeholder's name or
 * label: a form field with that name first (what the lead actually typed), then
 * a lead detail it clearly means ({{name}}, a {{1}} labelled "Name"). Anything
 * else — a bare {{2}} — stays unpicked: a wrong guess would put wrong text in
 * front of a real person. Every pick is visible and editable before it is used.
 */
export function defaultLeadVarChoices(
    paramSpec: Record<string, string>,
    formFieldNames: string[],
    kind: LeadWorkflowKind
): Record<string, LeadVarChoice> {
    const choices: Record<string, LeadVarChoice> = {};
    for (const [key, label] of Object.entries(paramSpec)) {
        const names = [label ?? '', key].map(normalizeVarName).filter(Boolean);
        const formField = formFieldNames.find((field) => names.includes(normalizeVarName(field)));
        const leadVariable = names
            .map((name) => LEAD_VARIABLE_ALIASES[name])
            .find((id): id is LeadVariableId => !!id && leadVariableKey(id, kind) !== undefined);
        if (formField) {
            choices[key] = { source: 'form', value: formField };
        } else if (leadVariable) {
            choices[key] = { source: 'lead', value: leadVariable };
        }
    }
    return choices;
}

/** The value stored in `templateVars` for one mapped placeholder. */
export function leadVarStoredValue(
    choice: LeadVarChoice,
    kind: LeadWorkflowKind,
    audienceName = ''
): string {
    if (choice.source === 'lead') return leadVariableKey(choice.value, kind, audienceName) ?? '';
    return choice.value.trim();
}

/**
 * Read a stored `templateVars` value back into a choice, for a node saved
 * earlier. A lead detail's key, then a form field's name, else fixed text —
 * which also covers expressions and fields typed by hand in older nodes.
 */
export function decodeStoredLeadVar(
    stored: string | undefined,
    kind: LeadWorkflowKind,
    formFieldNames: string[],
    audienceName = ''
): LeadVarChoice | undefined {
    const value = stored?.trim();
    if (!value) return undefined;
    const leadVariable = LEAD_VARIABLES.find(
        (variable) => variable.resolve(kind, audienceName) === value
    );
    // The follow-up's list name is the list's own name, which is also just text:
    // only read it back as the lead detail when it cannot be a hand-typed value.
    if (leadVariable && !(leadVariable.id === 'listName' && kind === 'followup')) {
        return { source: 'lead', value: leadVariable.id };
    }
    if (formFieldNames.includes(value)) return { source: 'form', value };
    return { source: 'text', value };
}

/** A template body split around its {{placeholders}}, for a live preview. */
export function splitTemplateBody(body: string): Array<{ text: string; key?: string }> {
    const parts: Array<{ text: string; key?: string }> = [];
    let last = 0;
    for (const match of body.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)) {
        const index = match.index ?? 0;
        if (index > last) parts.push({ text: body.slice(last, index) });
        parts.push({ text: match[0], key: match[1] });
        last = index + match[0].length;
    }
    if (last < body.length) parts.push({ text: body.slice(last) });
    return parts;
}
