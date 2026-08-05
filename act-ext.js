Act.extend({
    name: 'act-collapse',
    install(Act) {
        console.log('Act extension installed');
        Act.Library.Element.collapse = function (time = 250, timing = 'linear') {
            const computedStyle = window.getComputedStyle(this);
            const spacingProps = ['marginTop', 'marginBottom', 'paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth'];
            const startKeyframe = { height: this.offsetHeight + 'px', overflow: 'hidden' };
            const endKeyframe = { height: '0px', overflow: 'hidden' };

            for (const prop of spacingProps) {
                startKeyframe[prop] = computedStyle[prop];
                endKeyframe[prop] = '0px';
            }

            const animation = this.animate([startKeyframe, endKeyframe], {
                duration: Act.Library.globals.time_to_ms(time),
                easing: timing,
            });

            return animation.finished.then(() => this.remove());
        };
    },
});
