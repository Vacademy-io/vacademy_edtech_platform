/**
 * i18n strings for the 'classes' namespace (registered synchronously by
 * src/panel/i18n/index.ts). Same keys in both languages. Plurals use i18next v4
 * suffixes (_one / _other). Never call addResourceBundle for this namespace.
 */
export const strings: { en: Record<string, unknown>; hi: Record<string, unknown> } = {
    en: {
        today: {
            label: "Today's classes",
            headingMine: 'Your classes today',
            headingAll: 'All classes today',
            scopeMine: 'Mine',
            scopeAll: 'All',
            noneOfYours: 'You have no classes of your own today.',
            emptyAll: 'No live classes scheduled today.',
            emptyMine: 'No classes assigned to you today.',
            showAll: 'Show all classes',
            truncated: 'Showing the first {{count}} classes.',
            asOf: 'As of {{time}}',
            offline: 'No internet.',
            offlineNoList: 'No internet. Whiteboard still works.',
            error: "Couldn't update the list.",
            errorNoList: "Couldn't load today's classes.",
            wrongDate: 'Panel date is wrong.',
            retry: 'Retry',
            wifi: 'Wi-Fi settings',
            dateSettings: 'Date settings',
            settingsUnavailable: 'Settings are not available on this device.',
        },
        status: {
            now: 'Now',
            soon: 'In {{minutes}} min',
            done: 'Done',
        },
        card: {
            untitled: 'Live class',
            moreInstructors: '{{names}} +{{more}}',
        },
        provider: {
            bbb: 'Live class',
            zoom: 'Zoom',
            meet: 'Google Meet',
            zoho: 'Zoho Meeting',
            external: 'External link',
        },
        action: {
            here: 'Start',
            device: 'Start on your device',
            external: 'Open class link',
            none: 'No class link',
            starting: 'Starting…',
        },
        device: {
            title: 'Start on your device',
            whyUnsupported:
                "This class can't run on this panel. Start it on your phone, or on a laptop connected by HDMI.",
            whyNoBrowser:
                'This panel has no browser that can open the class link. Start it on your phone, or on a laptop connected by HDMI.',
            whyNoMeetingScreen:
                "This panel's app can't open the class here. Start it on your phone, or on a laptop connected by HDMI.",
            whyChosen: 'Start it on your phone, or on a laptop connected by HDMI.',
            scan: 'Scan this with your phone, or open this address on a laptop:',
            phoneShows: 'Your phone page already shows this class.',
            noAddress:
                "The panel hasn't reached the server yet. Check the internet connection and try again.",
            close: 'Close',
        },
        ended: {
            title: 'This class has ended',
            body: 'The earlier room for this class is over. Start a new room?',
            confirm: 'Start a new room',
        },
        blocked: {
            title: "A new room can't be started",
            body: 'Learners are still in the current room for this class.',
            close: 'OK',
        },
        failed: {
            title: "Couldn't start the class",
            body: 'Check the internet connection and try again, or start it on your own device.',
            noLink: "The server didn't give a link for this class. Start it on your own device.",
            useDevice: 'Start on your device',
            retry: 'Try again',
            close: 'Close',
        },
        toast: {
            alreadyOpen: 'A class is already open on this panel.',
            externalOpened:
                'Opening the class link. If nothing opens, press the class again to start it on your device.',
            noHostLink:
                'Opening the class link, without host controls. If nothing opens, press the class again to start it on your device.',
            noLink: "This class doesn't have a link.",
        },
    },
    hi: {
        today: {
            label: 'आज की कक्षाएँ',
            headingMine: 'आज की आपकी कक्षाएँ',
            headingAll: 'आज की सभी कक्षाएँ',
            scopeMine: 'मेरी',
            scopeAll: 'सभी',
            noneOfYours: 'आज आपकी अपनी कोई कक्षा नहीं है।',
            emptyAll: 'आज कोई लाइव कक्षा निर्धारित नहीं है।',
            emptyMine: 'आज आपको कोई कक्षा नहीं दी गई है।',
            showAll: 'सभी कक्षाएँ दिखाएँ',
            truncated: 'पहली {{count}} कक्षाएँ दिखाई जा रही हैं।',
            asOf: '{{time}} तक की जानकारी',
            offline: 'इंटरनेट नहीं है।',
            offlineNoList: 'इंटरनेट नहीं है। व्हाइटबोर्ड फिर भी चलेगा।',
            error: 'सूची अपडेट नहीं हो सकी।',
            errorNoList: 'आज की कक्षाएँ लोड नहीं हो सकीं।',
            wrongDate: 'पैनल की तारीख़ ग़लत है।',
            retry: 'फिर से कोशिश करें',
            wifi: 'वाई-फ़ाई सेटिंग',
            dateSettings: 'तारीख़ सेटिंग',
            settingsUnavailable: 'इस डिवाइस पर सेटिंग उपलब्ध नहीं है।',
        },
        status: {
            now: 'अभी',
            soon: '{{minutes}} मिनट में',
            done: 'पूरी हुई',
        },
        card: {
            untitled: 'लाइव कक्षा',
            moreInstructors: '{{names}} +{{more}}',
        },
        provider: {
            bbb: 'लाइव कक्षा',
            zoom: 'Zoom',
            meet: 'Google Meet',
            zoho: 'Zoho Meeting',
            external: 'बाहरी लिंक',
        },
        action: {
            here: 'शुरू करें',
            device: 'अपने डिवाइस पर शुरू करें',
            external: 'कक्षा का लिंक खोलें',
            none: 'कक्षा का लिंक नहीं है',
            starting: 'शुरू हो रही है…',
        },
        device: {
            title: 'अपने डिवाइस पर शुरू करें',
            whyUnsupported:
                'यह कक्षा इस पैनल पर नहीं चल सकती। इसे अपने फ़ोन पर, या HDMI से जुड़े लैपटॉप पर शुरू करें।',
            whyNoBrowser:
                'इस पैनल पर कक्षा का लिंक खोलने के लिए कोई ब्राउज़र नहीं है। इसे अपने फ़ोन पर, या HDMI से जुड़े लैपटॉप पर शुरू करें।',
            whyNoMeetingScreen:
                'इस पैनल का ऐप यहाँ कक्षा नहीं खोल सकता। इसे अपने फ़ोन पर, या HDMI से जुड़े लैपटॉप पर शुरू करें।',
            whyChosen: 'इसे अपने फ़ोन पर, या HDMI से जुड़े लैपटॉप पर शुरू करें।',
            scan: 'इसे अपने फ़ोन से स्कैन करें, या लैपटॉप पर यह पता खोलें:',
            phoneShows: 'आपके फ़ोन के पेज पर यह कक्षा पहले से दिख रही है।',
            noAddress: 'पैनल अभी सर्वर तक नहीं पहुँचा है। इंटरनेट जाँचें और फिर से कोशिश करें।',
            close: 'बंद करें',
        },
        ended: {
            title: 'यह कक्षा समाप्त हो चुकी है',
            body: 'इस कक्षा का पिछला रूम बंद हो गया है। नया रूम शुरू करें?',
            confirm: 'नया रूम शुरू करें',
        },
        blocked: {
            title: 'नया रूम शुरू नहीं हो सकता',
            body: 'इस कक्षा के मौजूदा रूम में अभी विद्यार्थी हैं।',
            close: 'ठीक है',
        },
        failed: {
            title: 'कक्षा शुरू नहीं हो सकी',
            body: 'इंटरनेट जाँचकर फिर से कोशिश करें, या इसे अपने डिवाइस पर शुरू करें।',
            noLink: 'सर्वर ने इस कक्षा का लिंक नहीं दिया। इसे अपने डिवाइस पर शुरू करें।',
            useDevice: 'अपने डिवाइस पर शुरू करें',
            retry: 'फिर से कोशिश करें',
            close: 'बंद करें',
        },
        toast: {
            alreadyOpen: 'इस पैनल पर एक कक्षा पहले से खुली है।',
            externalOpened:
                'कक्षा का लिंक खुल रहा है। अगर कुछ न खुले, तो अपने डिवाइस पर शुरू करने के लिए कक्षा को फिर से दबाएँ।',
            noHostLink:
                'कक्षा का लिंक होस्ट नियंत्रण के बिना खुल रहा है। अगर कुछ न खुले, तो अपने डिवाइस पर शुरू करने के लिए कक्षा को फिर से दबाएँ।',
            noLink: 'इस कक्षा का कोई लिंक नहीं है।',
        },
    },
};
