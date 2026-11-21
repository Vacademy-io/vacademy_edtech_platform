/**
 * Phase 2 strings of the 'panel' namespace: the refused sign-in views (licence, approval,
 * update required), the update bar, the GRACE chip and the installer line after pairing.
 * Only screens outside the first load show them, so they live here instead of
 * panel.{en,hi}.json and join the namespace when one of those screens first renders.
 * Same keys in both languages.
 */
import i18next from 'i18next';

export const phase2Strings: { en: Record<string, unknown>; hi: Record<string, unknown> } = {
    en: {
        licence: {
            title: 'This classroom needs a licence',
            body: 'Ask your school admin to assign one to {{room}}.',
            bodyNoRoom: 'Ask your school admin to assign one to this room.',
            expiredTitle: "The school's panel licence has ended",
            expiredBody: 'Ask your school admin to renew it. The whiteboard still works.',
            endsOn: 'Licence ends {{date}}',
            checkAgain: 'Check again',
        },
        approval: {
            title: 'Waiting for the school',
            body: "An installer set up this panel. {{school}}'s admin needs to approve it in Settings → Classroom Panels.",
            bodyNoSchool:
                "An installer set up this panel. The school's admin needs to approve it in Settings → Classroom Panels.",
            installedBy: 'Set up by {{installer}}',
        },
        update: {
            ready: 'Update ready',
            readyBody: 'Version {{version}} is downloaded.',
            install: 'Install',
            installing: 'Opening…',
            downloading: 'Downloading an update… {{progress}}%',
            downloadingNoProgress: 'Downloading an update…',
            needsPermission:
                'Allow installs from this app on the screen that opened, then tap Install again.',
            requiredTitle: 'This panel needs an app update',
            requiredBody:
                'Nobody can sign in until the app is updated. The whiteboard still works.',
            requiredNoUpdater:
                'Ask your school admin or installer to update the classroom app on this panel.',
        },
    },
    hi: {
        licence: {
            title: 'इस कक्षा को लाइसेंस चाहिए',
            body: 'अपने स्कूल एडमिन से {{room}} के लिए लाइसेंस देने को कहें।',
            bodyNoRoom: 'अपने स्कूल एडमिन से इस कमरे के लिए लाइसेंस देने को कहें।',
            expiredTitle: 'स्कूल का पैनल लाइसेंस खत्म हो गया है',
            expiredBody:
                'अपने स्कूल एडमिन से इसे फिर से शुरू करवाने को कहें। व्हाइटबोर्ड अब भी चलता है।',
            endsOn: 'लाइसेंस {{date}} को खत्म होगा',
            checkAgain: 'फिर जाँचें',
        },
        approval: {
            title: 'स्कूल की मंज़ूरी का इंतज़ार',
            body: 'इस पैनल को एक इंस्टॉलर ने लगाया है। {{school}} के एडमिन को इसे Settings → Classroom Panels में मंज़ूर करना होगा।',
            bodyNoSchool:
                'इस पैनल को एक इंस्टॉलर ने लगाया है। स्कूल के एडमिन को इसे Settings → Classroom Panels में मंज़ूर करना होगा।',
            installedBy: '{{installer}} ने लगाया',
        },
        update: {
            ready: 'अपडेट तैयार है',
            readyBody: 'वर्शन {{version}} डाउनलोड हो गया है।',
            install: 'इंस्टॉल करें',
            installing: 'खुल रहा है…',
            downloading: 'अपडेट डाउनलोड हो रहा है… {{progress}}%',
            downloadingNoProgress: 'अपडेट डाउनलोड हो रहा है…',
            needsPermission:
                'खुली हुई स्क्रीन पर इस ऐप से इंस्टॉल की अनुमति दें, फिर से इंस्टॉल करें दबाएँ।',
            requiredTitle: 'इस पैनल के ऐप को अपडेट करना ज़रूरी है',
            requiredBody: 'ऐप अपडेट होने तक कोई साइन इन नहीं कर सकता। व्हाइटबोर्ड अब भी चलता है।',
            requiredNoUpdater:
                'अपने स्कूल एडमिन या इंस्टॉलर से इस पैनल पर क्लासरूम ऐप अपडेट करवाएँ।',
        },
    },
};

/** Adds the strings above to 'panel' once per language. Cheap to call on every render. */
export function ensurePhase2Strings(): void {
    if (!i18next.isInitialized) return;
    for (const lng of ['en', 'hi'] as const) {
        if (i18next.getResource(lng, 'panel', 'licence.title') === undefined) {
            i18next.addResourceBundle(lng, 'panel', phase2Strings[lng], true, false);
        }
    }
}
