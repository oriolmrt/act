(function () {
    if (typeof htmx === 'undefined' || typeof Act === 'undefined') {
        console.error('act-htmx.js: htmx or Act not found');
        return;
    }

    htmx.onLoad(elt => Act.init(elt));
})();
