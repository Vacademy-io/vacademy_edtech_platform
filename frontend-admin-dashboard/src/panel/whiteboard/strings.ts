/**
 * i18n strings for the 'whiteboard' namespace (registered by src/panel/i18n/index.ts).
 * Keep the shape `export const strings = { en: {...}, hi: {...} }` with the same keys.
 * Use with useTranslation('whiteboard').
 */
export const strings = {
    en: {
        title: 'Whiteboard',
        toolbarLabel: 'Whiteboard tools',
        coloursLabel: 'Ink colours',
        tools: {
            pen: 'Pen',
            highlighter: 'Highlighter',
            eraser: 'Eraser',
            pan: 'Move',
            select: 'Select',
        },
        colours: {
            black: 'Black',
            red: 'Red',
            blue: 'Blue',
            green: 'Green',
            orange: 'Orange',
            violet: 'Violet',
            yellow: 'Yellow',
            pink: 'Pink',
        },
        actions: {
            undo: 'Undo',
            redo: 'Redo',
            clear: 'Clear',
            save: 'Save picture',
            fit: 'Show everything',
        },
        emptyHint: {
            title: 'Draw anywhere with one finger',
            body: 'Use two fingers to move and zoom the board.',
        },
        clearDialog: {
            title: 'Clear the whiteboard?',
            body: 'Everything on the board will be removed. You can still bring it back with Undo.',
            confirm: 'Clear board',
        },
        toasts: {
            savedDevice: 'Picture saved to {{path}}',
            savedDownload: 'Picture downloaded as {{name}}',
            saveFailed: 'Could not save the picture. Try again.',
            nothingToSave: 'The board is empty. Draw something first.',
            restoreFailed: 'The last board could not be opened, so a new one was started.',
            tooBigToKeep:
                'This board is too big to keep after closing. Save it as a picture to keep it.',
        },
    },
    hi: {
        title: 'व्हाइटबोर्ड',
        toolbarLabel: 'व्हाइटबोर्ड टूल',
        coloursLabel: 'स्याही के रंग',
        tools: {
            pen: 'पेन',
            highlighter: 'हाइलाइटर',
            eraser: 'इरेज़र',
            pan: 'खिसकाएँ',
            select: 'चुनें',
        },
        colours: {
            black: 'काला',
            red: 'लाल',
            blue: 'नीला',
            green: 'हरा',
            orange: 'नारंगी',
            violet: 'बैंगनी',
            yellow: 'पीला',
            pink: 'गुलाबी',
        },
        actions: {
            undo: 'पूर्ववत करें',
            redo: 'फिर से करें',
            clear: 'साफ़ करें',
            save: 'चित्र सेव करें',
            fit: 'सब कुछ दिखाएँ',
        },
        emptyHint: {
            title: 'एक उँगली से कहीं भी लिखें',
            body: 'बोर्ड को खिसकाने और ज़ूम करने के लिए दो उँगलियों का उपयोग करें।',
        },
        clearDialog: {
            title: 'व्हाइटबोर्ड साफ़ करें?',
            body: 'बोर्ड पर सब कुछ हट जाएगा। आप पूर्ववत करें से इसे वापस ला सकते हैं।',
            confirm: 'बोर्ड साफ़ करें',
        },
        toasts: {
            savedDevice: 'चित्र {{path}} में सेव हो गया',
            savedDownload: 'चित्र {{name}} के रूप में डाउनलोड हो गया',
            saveFailed: 'चित्र सेव नहीं हो सका। फिर से कोशिश करें।',
            nothingToSave: 'बोर्ड खाली है। पहले कुछ लिखें।',
            restoreFailed: 'पिछला बोर्ड नहीं खुल सका, इसलिए नया बोर्ड शुरू किया गया।',
            tooBigToKeep:
                'यह बोर्ड बंद करने के बाद रखने के लिए बहुत बड़ा है। इसे रखने के लिए चित्र के रूप में सेव करें।',
        },
    },
};
