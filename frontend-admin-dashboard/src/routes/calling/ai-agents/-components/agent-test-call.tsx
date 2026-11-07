/**
 * "Call me" from the agent editor: saves the agent, then the agent calls the number
 * typed here, so testing a script does not need a lead in a lead list.
 */
import { useState } from 'react';
import { toast } from 'sonner';
import { Phone, SpinnerGap } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { agentApiError, placeAgentTestCall, type AiAgent } from '../-services/ai-agents';

/** Loose check only; the server normalises to E.164 and has the final say. */
const looksLikePhone = (v: string) => v.replace(/[^0-9]/g, '').length >= 10;

export function AgentTestCall({
    instituteId,
    disabledReason,
    saveForTest,
}: {
    instituteId: string;
    /** Why a call cannot be placed right now, or null. */
    disabledReason: string | null;
    /** Saves the current draft and returns the stored agent (with its id). */
    saveForTest: () => Promise<AiAgent>;
}) {
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [busy, setBusy] = useState(false);
    const [last, setLast] = useState<string | null>(null);

    const call = async () => {
        setBusy(true);
        setLast(null);
        try {
            const saved = await saveForTest();
            if (!saved.id) throw new Error('The agent was not saved.');
            const r = await placeAgentTestCall(saved.id, {
                instituteId,
                phoneNumber: phone.trim(),
                name: name.trim() || undefined,
            });
            const msg = r.dispatched
                ? `Calling ${phone.trim()} now. Pick up to talk to ${saved.name}.`
                : r.status === 'QUEUED'
                  ? `All lines are busy. The call is queued${
                        r.queueEtaMinutes ? ` (about ${r.queueEtaMinutes} min)` : ''
                    } and will ring as soon as a line is free.`
                  : r.providerMessage || 'The call could not be placed.';
            setLast(msg);
            if (r.dispatched || r.status === 'QUEUED') toast.success(msg);
            else toast.error(msg);
        } catch (err) {
            toast.error(agentApiError(err, 'Could not place the test call.'));
        } finally {
            setBusy(false);
        }
    };

    const blocked = disabledReason ?? (!looksLikePhone(phone) ? 'Enter the number to call.' : null);

    return (
        <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                    <Label>Name</Label>
                    <Input
                        value={name}
                        maxLength={120}
                        placeholder="Who picks up, e.g. Rahul"
                        onChange={(e) => setName(e.target.value)}
                    />
                </div>
                <div className="space-y-1.5">
                    <Label>Phone number</Label>
                    <Input
                        type="tel"
                        value={phone}
                        placeholder="+91 98765 43210"
                        onChange={(e) => setPhone(e.target.value)}
                    />
                </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
                <MyButton
                    type="button"
                    buttonType="primary"
                    scale="medium"
                    disable={busy || !!blocked}
                    onClick={() => void call()}
                >
                    {busy ? <SpinnerGap size={16} className="animate-spin" /> : <Phone size={16} />}
                    {busy ? 'Calling…' : 'Save & call'}
                </MyButton>
                <p className="text-caption text-neutral-500">
                    {disabledReason ??
                        'Saves the agent first, so the call uses exactly what you see here. A real call, charged like any other.'}
                </p>
            </div>
            {last && <p className="text-caption text-neutral-700">{last}</p>}
        </div>
    );
}
