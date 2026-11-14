/**
 * i18n strings for the 'offline' namespace (registered synchronously by
 * src/panel/i18n/index.ts). Same keys in both languages. Plurals use i18next v4
 * suffixes (_one / _other). Never call addResourceBundle for this namespace.
 */
export const strings: { en: Record<string, unknown>; hi: Record<string, unknown> } = {
    en: {
        chip: 'Offline: showing a saved copy',
        notSaved:
            'This panel has no saved copy of this file. Only lessons opened here while online are saved.',
        lock: {
            title: 'This panel has been offline for too long',
            body: 'Saved lessons are locked. Connect to the internet, then sign in again if the panel asks.',
            diagnostics: 'Check connection',
            signOut: 'Sign out',
        },
    },
    hi: {
        chip: 'ऑफ़लाइन: सहेजी हुई कॉपी दिख रही है',
        notSaved:
            'इस पैनल पर इस फ़ाइल की कोई सहेजी हुई कॉपी नहीं है। यहाँ ऑनलाइन रहते हुए खोले गए पाठ ही सहेजे जाते हैं।',
        lock: {
            title: 'यह पैनल बहुत देर से ऑफ़लाइन है',
            body: 'सहेजे गए पाठ लॉक हैं। इंटरनेट से जोड़ें, फिर पैनल के कहने पर दोबारा साइन इन करें।',
            diagnostics: 'कनेक्शन जाँचें',
            signOut: 'साइन आउट',
        },
    },
};
