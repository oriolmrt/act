(function () {
    if (typeof htmx === 'undefined' || typeof Act === 'undefined') {
        console.error('act-htmx.js: htmx or Act not found');
        return;
    }
    
    htmx.defineExtension('act', {
        onEvent: (name, evt) => {
            if (name !== 'htmx:load') return;
            Act.init(evt.detail.elt);
        }
    });
})();
