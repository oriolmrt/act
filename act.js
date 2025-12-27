(function (global) {
    document.addEventListener('DOMContentLoaded', () => {
        Act.configure();
        if (Act.config.start) Act.start();
    });

    // CORE UTILITIES

    const is = (value, ...classes) => {
        if (value === undefined || value === null) return false;
        for (const c of classes) {
            if (value instanceof c || value?.constructor === c) return true;
        }
        return false;
    };

    const unwrap = (value) => is(value, Result) ? value.value : value;
    const unwrapAll = (values) => values.map(unwrap);
    const from = (value) => is(value, Result) ? value.from : undefined;
    const through = (value) => is(value, Result) ? value.through : value;
    const snakeToCamel = (str) => {
        if (is(str, Solvable)) str = str.value;
        if (typeof str !== 'string') return str;
        const camel = str.toLowerCase().replace(/[-_][a-z]/g, (group) => group[1].toUpperCase());
        if (camel.toLowerCase() === 'innerhtml') return 'innerHTML';
        if (camel.toLowerCase() === 'outerhtml') return 'outerHTML';
        return camel;
    };

    const lookup = (key, object) => {
        if (object === null || object === undefined) return key;
        if (Act.config.convertToCamelCase && object[snakeToCamel(key)] !== undefined) return snakeToCamel(key);
        return key;
    };

    const regexEscape = (str) => { return str.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'); };

    // LIBRARY (Built-in functions)

    const Library = {
        ActMethod: class ActMethod {
            constructor(method) {
                this.method = method;
            }
        },

        method(fn) {
            return new Library.ActMethod(fn);
        },

        get(name, target) {
            if (is(target, Element) && Object.hasOwn(this.Element, name)) {
                return this.Element[name];
            } else if (Array.isArray(target) && Object.hasOwn(this.Array, name)) {
                return this.Array[name];
            } else if (Object.hasOwn(this[typeof target], name)) {
                return this[typeof target][name];
            } else if (Object.hasOwn(this.globals, name)) {
                return this.globals[name];
            }
        },

        async exec(fn, args, target, context, opts) {
            if (is(fn, Result)) return await this.exec(fn.value, args, fn.parent, fn.context || context, opts);
            if (is(fn, Library.ActMethod)) return await fn.method(context, target, opts, ...args);
            if (is(fn, Function)) return await fn.call(target, ...await context.solveAll(args, target));
        },
    };

    Library.words = {
        me: (ctx, target) => target,
        source_element: (ctx) => ctx.binding.element,
        original_target: (ctx) => ctx.target,
        undefined: () => undefined,
        NaN: () => NaN,
        debugger: () => { debugger; },
        true: () => true,
        false: () => false,
        null: () => null,
        document: () => document,
        window: () => window,
        js: () => window,
        Act: () => Act,
    };

    Library.prefixes = {
        global(ctx, target, opts, value) {
            return new Result(Act.globals[value.value], this, { parent: Act.globals, key: value.value });
        },

        local(ctx, target, opts, value) {
            const parent = Binder.from(target, true).data;
            return new Result(parent[value.value], this, { parent, key: value.value });
        },

        scoped(ctx, target, opts, value) {
            const parent = ctx.scopeData(this.scope);
            return new Result(parent[value.value], this, { parent, key: value.value });
        },

        async not(ctx, target, opts, value) {
            return !(await ctx.asValueOf(value, target));
        },

        async negative(ctx, target, opts, value) {
            return -(await ctx.asValueOf(value, target));
        },

        async type(ctx, target, opts, value) {
            const val = await ctx.solve(value, target, opts);
            return from(val)?.constructor.name || typeof unwrap(val);
        },

        async wat(ctx, target, opts, value) {
            const result = await ctx.solve(value, target, opts);
            console.log(
                '🤷 Act WAT?\n',
                'Value:', value, '\n',
                'Result:', result, '\n',
                'Target:', target, '\n',
                'Scope:', this.scope, '\n',
                'Context:', ctx, '\n',
                'Code:', value.code, '\n'
            );

            return result;
        },
    };

    const throwSignal = async (Signal, ctx, target, opts, data) => {
        const signal = new Signal;
        if (data !== undefined) signal.data = await ctx.solve(data, target, opts);
        throw signal;
    };

    Library.keywords = {
        async run(ctx, target, opts, [name, ...args]) {
            name = await ctx.asString(name, target);
            const block = ctx.binding.getBlock(name);
            if (!block) throw new ActError(`Block '${name}' not found.`);

            const data = ctx.scopeData(block.scope);
            data.__fromScope__ = this.scope;

            for (let i = 0; i < block.args.length; i++) {
                const arg = block.args[i];

                if (Array.isArray(arg)) {
                    data[arg[0]] = await Promise.all(
                        args.slice(i).map(a => ctx.solve(a, target, opts))
                    );
                    break;
                }

                data[arg] = await ctx.solve(args[i], target, opts);
            }

            return await ctx.solve(block.scope, target, opts);
        },

        def(ctx, target, opts, args) {
            const name = args[0].value, body = args[args.length - 1];
            const vars = args.slice(1, -1).map(arg => is(arg, List) ? [arg.value[0].value] : arg.value);
            Binder.from(target, true).blocks[name] = { args: vars, scope: body };
        },

        async each(ctx, target, opts, args) {
            let iterable = target, solvable = args[0], name;

            if (is(args[1], Word) && args[1].value === 'in') {
                name = args[0].value;
                iterable = await ctx.asValueOf(args[2], target);
                solvable = args[3];
            } else if (is(args[2], Word) && args[2].value === 'in') {
                iterable = await ctx.asValueOf(args[3], target);
                solvable = args[4];

                for (const [key, value] of Object.entries(iterable)) {
                    ctx.scopeData(solvable)[args[0].value] = key;
                    ctx.scopeData(solvable)[args[1].value] = value;
                    try { await ctx.solve(solvable, iterable, opts); }
                    catch (e) {
                        if (is(e, Signal.Break)) return e.data;
                        if (is(e, Signal.Continue)) continue;
                        throw e;
                    }
                }
                return iterable;
            }

            for (let i of iterable) {
                try {
                    if (name) ctx.scopeData(solvable)[name] = new Result(i, this);
                    await ctx.solve(solvable, (name ? target : i), opts);
                } catch (e) {
                    if (is(e, Signal.Break)) return e.data;
                    if (is(e, Signal.Continue)) continue;
                    throw e;
                }
            }
        },

        async for(ctx, target, opts, args) {
            const name = args[0].value;
            let idx = 1, start = 0;

            if (args[idx].value === 'from') { start = await ctx.asValueOf(args[2], target); idx += 2; }
            if (args[idx].value !== 'to') throw new ActError('Invalid for loop syntax: missing "to" word.');

            const end = await ctx.asValueOf(args[idx + 1], target);
            idx += 2;

            let step = 1, stepDefined = false;
            if (args[idx].value == 'step') {
                step = await ctx.asValueOf(args[idx + 1], target);
                stepDefined = true;
            }

            const scope = args.at(-1), asc = (start <= end);
            if (!stepDefined) step = asc ? 1 : -1;

            for (let i = start; asc ? i <= end : i >= end; i += step) {
                try {
                    ctx.scopeData(scope)[name] = i;
                    await ctx.solve(scope, target);
                } catch (e) {
                    if (is(e, Signal.Break)) return e.data;
                    if (is(e, Signal.Continue)) continue;
                    throw e;
                }
            }
        },

        async if(ctx, target, opts, [condition, trueBranch, elseKw, elseBranch]) {
            if (await ctx.asValueOf(condition, target)) return await ctx.solve(trueBranch, target, opts);
            if (await ctx.asString(elseKw, target) === 'else') return await ctx.solve(elseBranch, target, opts);
        },

        async loop(ctx, target, opts, [solvable]) {
            for (;;) {
                try { await ctx.solve(solvable, target, opts); }
                catch (e) {
                    if (is(e, Signal.Break)) return e.data;
                    if (is(e, Signal.Continue)) continue;
                    throw e;
                }
            }
        },

        async new(ctx, target, opts, [constructor, ...args]) {
            if (is(constructor, Tag)) return document.createElement(constructor.value);
            let value = await ctx.asValueOf(constructor, target);
            args = await ctx.solveAll(args, target, opts);
            try { return new value(...args); }
            catch (e) { return new window[value.toString()](...args); }
        },

        async on(ctx, target, opts, [eventName, ...args]) {
            target = await ctx.asValueOf(target);
            eventName = Binder.eventName(await ctx.asString(eventName, target));
            let options = {};
            if (is(args[0], ActObject)) options = await ctx.asValueOf(args[0], target);

            const binding = Binder.from(target, true), eventScope = args.at(-1);
            const eventManager = new EventManager(binding, eventName, options, eventScope.source, eventScope);
            binding.addEvent(eventName, eventScope.source, options, eventManager);
            return true;
        },

        async off(ctx, target, opts, [eventName]) {
            target = await ctx.asValueOf(target);
            const binding = Binder.from(target);
            if (!binding) return false;

            eventName = Binder.eventName(await ctx.asString(eventName, target));
            binding.element.removeEventListener(eventName, binding.events[eventName].listener);
            delete binding.events[eventName];
            return true;
        },

        async kill(ctx, target, opts, [eventName]) {
            target = await ctx.asValueOf(target);
            if (!is(target, Element)) return false;

            const binding = Binder.from(target);
            if (!binding) return false;

            eventName = Binder.eventName(await ctx.solve(eventName, target, opts));
            const eventManager = binding.events[eventName];
            if (!eventManager) return false;

            if (eventManager.contexts.size > 0) return eventManager.halt = true;
            return false;
        },

        break(ctx, target, opts, [data]) {
            return throwSignal(Signal.Break, ctx, target, opts, data);
        },

        stop(ctx, target, opts, [data]) {
            return throwSignal(Signal.Stop, ctx, target, opts, data);
        },

        return(ctx, target, opts, [data]) {
            return throwSignal(Signal.Return, ctx, target, opts, data);
        },

        repeat() {
            throw new Signal.Repeat;
        },

        restart() {
            throw new Signal.Restart;
        },

        continue() {
            throw new Signal.Continue;
        },

        halt() {
            throw new Signal.Halt;
        },

        async throw(ctx, target, opts, [error]) {
            if (is(error, Error)) throw error;
            throw new ActError(await ctx.asValueOf(error, target));
        },

        async while(ctx, target, opts, [condition, body]) {
            while (await ctx.asValueOf(condition, target)) {
                try {
                    await ctx.solve(body, target, opts);
                } catch (e) {
                    if (is(e, Signal.Break)) return e.data;
                    if (is(e, Signal.Continue)) continue;
                    throw e;
                }
            }
        },

        async with(ctx, target, opts, [object, body]) {
            const withTarget = await ctx.solve(object, target, opts);
            await ctx.solve(body, unwrap(withTarget), opts);
            return withTarget;
        },
    };

    Library.globals = {
        listens_to(eventName) {
            const binding = Binder.from(this);
            return binding && Object.hasOwn(binding.events, eventName?.toString() ?? '');
        },

        is_running(eventName = null) {
            const binding = Binder.from(this);
            if (!binding) return null;

            if (eventName === null) {
                for (const em of Object.values(binding.events)) if (em.contexts.size > 0) return true;
                return false;
            }

            const em = binding.events[Binder.eventName(eventName.toString())];
            return em ? em.contexts.size : false;
        },

        async tick() {
            await new Promise(r => requestAnimationFrame(r));
        },

        wait(time) { return new Promise(r => setTimeout(r, Library.globals.time_to_ms(time))); },

        log_raw: (...args) => console.log(...args),
        log: (...args) => console.log(...unwrapAll(args)),
        warn: (...args) => console.warn(...unwrapAll(args)),
        error: (...args) => console.error(...unwrapAll(args)),

        time_to_ms(t) {
            if (typeof t === 'number') return t;
            t = t.toString();
            const u = t.match(/[a-z]+$/)?.[0], v = parseFloat(t);
            return !u ? (isNaN(v) ? 0 : v) : v * ({ ms: 1, s: 1000, m: 60000, h: 3600000 }[u] || 1);
        },

        random(min, max) {
            const rand = Math.random() * (max - min + 1) + min;
            return (min % 1 + max % 1 == 0) ? Math.floor(rand) : rand;
        },

        delay: Library.method(async function (ctx, target, opts, time, scope) {
            clearTimeout(scope.__delayTimeout__ || 0);
            const ms = Library.globals.time_to_ms(await ctx.solve(time, target, opts));

            return new Promise(resolve => {
                scope.__delayTimeout__ = setTimeout(async () => {
                    resolve(await ctx.solve(scope, target, opts));
                    delete scope.__delayTimeout__;
                }, ms);
            });
        }),

        lock: Library.method(async function (ctx, target, opts, ...args) {
            if (args.length === 0) return ctx.eventManager.lock = true;
            const arg0 = await ctx.asValueOf(args[0], target);
            if (typeof arg0 === 'boolean') return ctx.eventManager.lock = arg0;

            const binding = Binder.from(target);
            if (!binding) return null;
            const em = binding.events[Binder.eventName(await ctx.asString(args[0], target))];
            if (!em) return null;

            em.lock = args[1] === undefined ? true : !!(await ctx.asValueOf(args[1], target));
            return true;
        }),

        unlock: Library.method(async function (ctx, target, opts, ...args) {
            if (args.length === 0) return !(ctx.eventManager.lock = false);
            const binding = Binder.from(target);
            if (!binding) return null;
            const em = binding.events[Binder.eventName(await ctx.asString(args[0], target))];
            if (em) em.lock = false;
            return true;
        }),

        is_locked: Library.method(async function (ctx, target, opts, ...args) {
            if (args.length === 0) return ctx.eventManager.lock;
            const binding = Binder.from(target);
            if (!binding) return null;
            return binding.events[Binder.eventName(await ctx.asString(args[0], target))]?.lock;
        }),
    };

    Library.Array = (function () {
        const wrap = (op) => Library.method(async (ctx, target, opts, fn) => {
            fn = await ctx.solve(fn, target, opts);
            const exec = (i) => is(fn, Library.ActMethod)
                ? fn.method(ctx, target[i], opts, target[i], i, target)
                : fn(target[i], i, target);

            if (op === 'map') return Promise.all(target.map((_, i) => exec(i)));
            if (op === 'filter') {
                const res = await Promise.all(target.map((_, i) => exec(i)));
                return target.filter((_, i) => res[i]);
            }
            for (let i = 0; i < target.length; i++) {
                const res = await exec(i);
                if (op === 'find' && res) return target[i];
                if (op === 'find_index' && res) return i;
                if (op === 'some' && res) return true;
                if (op === 'every' && !res) return false;
            }
            if (op === 'find_index') return -1;
            if (op === 'some') return false;
            if (op === 'every') return true;
        });

        return {
            map: wrap('map'),
            filter: wrap('filter'),
            for_each: wrap('for_each'),
            find: wrap('find'),
            find_index: wrap('find_index'),
            some: wrap('some'),
            every: wrap('every'),
        };
    })();

    const extractActValue = (source) => {
        const val = from(through(source)), isClass = is(val, ActClass), isAttribute = is(val, Attribute);
        return { isClass, isAttribute, name: (isClass || isAttribute) ? val.value : (unwrap(source) ?? '').toString() };
    };

    const sanitizeHTML = (html) => {
        if (!Act.config.sanitize) return html;
        if (typeof Act.config.sanitizer === 'function') return Act.config.sanitizer(html);
        throw new ActError('Act: sanitize is enabled but no sanitizer function provided. Set Act.config.sanitizer to a function (e.g., DOMPurify.sanitize).');
    };

    const insertContent = (element, content, position) => {
        const val = unwrap(content);
        if (is(val, Element)) position === 'afterbegin' ? element.insertBefore(val, element.firstChild) : element.appendChild(val);
        else element.insertAdjacentHTML(position, sanitizeHTML(val.toString()));
        return element;
    };

    const moveContent = (nodes, target, pos = 'beforeend') => {
        target = unwrap(target);
        if (typeof target === 'string') target = document.querySelector(target);
        if (!target) return nodes;

        const isList = is(nodes, DocumentFragment, HTMLCollection, NodeList) || Array.isArray(nodes);
        const list = isList ? (nodes.childNodes ? Array.from(nodes.childNodes) : Array.from(nodes)) : [nodes];
        const key = pos.toString().toLowerCase();

        const alias = { before: 'beforebegin', prepend: 'afterbegin', append: 'beforeend', after: 'afterend', inside: 'innerhtml', replace: 'outerhtml' };
        const mode = alias[key] || key;

        if (mode === 'innerhtml') target.innerHTML = '';

        const parent = target.parentNode;
        const ops = {
            beforebegin: n => parent.insertBefore(n, target),
            afterbegin: n => target.insertBefore(n, target.firstChild),
            beforeend: n => target.appendChild(n),
            afterend: n => parent.insertBefore(n, target.nextSibling),
            innerhtml: n => target.appendChild(n),
            outerhtml: n => parent.insertBefore(n, target)
        };

        const op = ops[mode] || ops.beforeend;
        if (mode === 'afterbegin') list.reverse();
        list.forEach(n => op(n));
        if (mode === 'outerhtml') target.remove();

        return nodes;
    };

    const findSibling = (element, selector, forward) => {
        if (!selector) return forward ? element.nextElementSibling : element.previousElementSibling;
        let all;
        if (typeof selector === 'string') all = document.querySelectorAll(selector);
        else if (is(selector, Element)) all = [selector];
        else if (is(selector, NodeList) || Array.isArray(selector)) all = selector;
        else all = document.querySelectorAll(selector.toString());

        const mask = forward ? 4 : 2;
        if (forward) { for (const n of all) if (element.compareDocumentPosition(n) & mask) return n; }
        else { for (let i = all.length - 1; i >= 0; i--) if (element.compareDocumentPosition(all[i]) & mask) return all[i]; }
        return null;
    };

    Library.Element = {
        matches(selector) {
            return this.matches(selector.toString());
        },

        hide() {
            this.style.display = 'none';
        },

        show() {
            this.style.display = '';
        },

        transition(...args) {
            let css = '', wait = 0, style = {}, og = this.style.transition;
            while (args.length) {
                let dur = 0, time = '', del = 0, prop = args.shift().toString();
                const next = () => args.shift().toString();
                const handlers = {
                    from: () => this.style[prop] = next(), to: () => style[prop] = next(),
                    in: () => dur = Library.globals.time_to_ms(next()), using: () => time = next(),
                    after: () => del = Library.globals.time_to_ms(next())
                };
                while (args.length && handlers[args[0]]) handlers[args.shift()]();

                wait = Math.max(wait, del + dur);
                css += `${css ? ', ' : ''}${prop} ${dur}ms${time ? ' ' + time : ''}${del ? ' ' + del + 'ms' : ''}`;
            }
            this.style.transition = css;
            Object.assign(this.style, style);
            return new Promise(r => setTimeout(() => { this.style.transition = og; r(); }, wait));
        },

        trigger(e, bubbles = true, detail = {}) {
            this.dispatchEvent(new CustomEvent(Binder.eventName(e), { bubbles, detail: unwrap(detail) }));
            return this;
        },

        move_to(element, position = 'beforeend') {
            return moveContent(this, element, position);
        },

        empty() {
            this.replaceChildren();
        },

        prepend(c) {
            return insertContent(this, c, 'afterbegin');
        },

        append(c) {
            return insertContent(this, c, 'beforeend');
        },

        fade(inout, time = 250, timing = 'linear') {
            return this.animate(
                [{ opacity: inout === 'in' ? 0 : 1 }, { opacity: inout === 'in' ? 1 : 0 }],
                { duration: Library.globals.time_to_ms(time), easing: timing, fill: 'forwards' }
            ).finished.then(() => {
                this.style.opacity = inout === 'in' ? '1' : '0';
            });
        },

        remove: Library.method(async function (ctx, target, opts, ...args) {
            for (const value of args) {
                if (value === undefined) return target.parentNode?.removeChild(target);
                if (is(value, ActClass)) target.classList.remove(value.value.slice(1));
                else if (is(value, Attribute)) target.removeAttribute(value.value);
            }

            return target;
        }),

        collapse(time = 250, timing = 'linear') {
            const style = window.getComputedStyle(this), h = this.offsetHeight;
            const props = ['marginTop', 'marginBottom', 'paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth'];
            const kf = [{ height: h + 'px' }, { height: '0px' }];
            props.forEach(p => { kf[0][p] = style[p]; kf[1][p] = '0px'; kf[0].overflow = kf[1].overflow = 'hidden'; });
            return this.animate(kf, { duration: Library.globals.time_to_ms(time), easing: timing }).finished.then(() => this.remove());
        },

        is_in_view(partially = false) {
            const { top, left, bottom, right } = this.getBoundingClientRect();
            const { innerHeight: h, innerWidth: w } = window;
            const full = top >= 0 && left >= 0 && bottom <= h && right <= w;
            return (full || !partially) ? full : ((top < h && bottom > 0 && left < w && right > 0) ? 'partially' : false);
        },

        next(s) {
            return findSibling(this, s, true);
        },

        previous(s) {
            return findSibling(this, s, false);
        },

        parent() {
            return this.parentNode;
        },

        on_match: Library.method(async function (ctx, target, opts, eventName, selector, scope) {
            eventName = Binder.eventName(await ctx.asString(eventName, target));
            selector = await ctx.asString(selector, target);
            const binding = Binder.from(target, true);
            const em = new EventManager(binding, eventName, {}, scope.source, scope);

            em.listener = (e) => {
                let el = e.target;
                while (el && el !== target) {
                    if (el.matches(selector)) return em.run(el, e);
                    el = el.parentElement;
                }
                if (target.matches(selector) && el === target) return em.run(target, e);
            };

            binding.addEvent(eventName, scope.source, {}, em);
            return true;
        }),

        take(attrOrCls, sel) {
            const els = sel ? (is(unwrap(sel), NodeList) ? unwrap(sel) : [unwrap(sel)]) : [...(this.parentNode?.children || [])].filter(c => c !== this);
            const { isClass, isAttribute, name } = extractActValue(attrOrCls);
            els.forEach(el => {
                if (isAttribute && el.hasAttribute(name)) { this.setAttribute(name, el.getAttribute(name)); el.removeAttribute(name); }
                if (isClass && el.classList.contains(name.slice(1))) { this.classList.add(name.slice(1)); el.classList.remove(name.slice(1)); }
            });
            return this;
        },

        toggle: Library.method(async function (ctx, target, opts, ...args) {
            if (args.length === 0) return (target.style.display === 'none') ? Library.Element.show.call(target) : Library.Element.hide.call(target);
            const [value, force] = args;
            const solved = await ctx.solve(value, target);
            const { isClass, isAttribute, name } = extractActValue(solved);
            let solvedForce = force ? unwrap(await ctx.solve(force, target)) : undefined;

            if (isClass) return target.classList.toggle(name.slice(1), solvedForce);
            if (isAttribute) return target.toggleAttribute(name, solvedForce);
            if (solvedForce !== undefined) return solvedForce ? Library.Element.show.call(target) : Library.Element.hide.call(target);
            return (target.style.display === 'none') ? Library.Element.show.call(target) : Library.Element.hide.call(target);
        }),

        add: Library.method(async function (ctx, target, opts, ...args) {
            for (const value of args) {
                if (is(value, ActClass)) target.classList.add(value.value.slice(1));
                else if (is(value, Attribute)) target.setAttribute(value.value, '');
            }

            return target;
        }),

        has: Library.method(async function (ctx, target, opts, value) {
            const { isClass, isAttribute, name } = extractActValue(await ctx.solve(value, target));
            if (isClass) return target.classList.contains(name.slice(1));
            if (isAttribute) return target.hasAttribute(name);
            return target.matches(name);
        }),
    };

    Library.function = {};

    Library.object = {
        first() {
            if ((Array.isArray(this) || is(this, HTMLCollection, NodeList)) && this.length > 0) return this[0];
        },

        last() {
            if ((Array.isArray(this) || is(this, HTMLCollection, NodeList)) && this.length > 0) return this[this.length - 1];
        },

        move_to(el, pos) {
            return moveContent(this, el, pos);
        },
    };

    Library.boolean = {};
    Library.number = {};
    Library.bigint = {};

    Library.string = {
        after(str) {
            const [self, s] = [this.toString(), str.toString()];
            const i = self.indexOf(s);
            return i === -1 ? self : self.substring(i + s.length);
        },
        before(str) {
            const [self, s] = [this.toString(), str.toString()];
            const i = self.indexOf(s);
            return i === -1 ? self : self.substring(0, i);
        },
        between(start, end) {
            const [self, s, e] = [this.toString(), start.toString(), end.toString()];
            const i = self.indexOf(s);
            return i === -1 ? self : self.substring(i + s.length, self.indexOf(e));
        },
        capitalize() { return this.toString().charAt(0).toUpperCase() + this.toString().slice(1); },
    };

    Library.symbol = {};
    Library.undefined = {};

    // RESULTS

    class Result {
        from;
        _value;
        parent;
        key;

        constructor(value, from = null, props = {}) {
            this._value = value;
            this.from = from;
            for (const [k, v] of Object.entries(props)) this[k] = v;
        }

        get settable() { 
            return this.parent && this.key !== undefined; 
        }

        set(value) {
            if (!is(value, ComplexResult)) value = unwrap(value);
            this.parent[this.key] = value;
        }

        get value() {
            if (is(this._value, Result)) return this._value.value;
            if (this.parent && this.key) return this.parent[this.key];
            return this._value;
        }

        get through() {
            if (is(this._value, Result)) return this._value.through;
            return this;
        }

        valueOf() {
            return this.value?.valueOf();
        }

        toString(...args) {
            if (is(this._value, Result)) return this.through.toString(...args);
            return this._value?.toString(...args);
        }
    }

    class AttributeResult extends Result {
        set(value) {
            const str = is(value, Result) ? value.toString() : String(value);
            this.parent.setAttribute(this.key, str);
        }

        get value() { return this.parent.getAttribute(this.key); }
    }

    class ComplexResult extends Result { };

    class DimensionResult extends ComplexResult {
        valueOf() {
            return this.value.number.valueOf();
        }

        toString() {
            return Object.values(this.value).join('');
        }
    }

    class IdResult extends ComplexResult {
        get value() {
            return document.getElementById(this._value.slice(1));
        }
    }

    class SelectorResult extends ComplexResult {
        get value() {
            if (this.mode === 'closest') return this.parent.closest(this._value);
            return this.parent.querySelectorAll(this._value);
        }

        toString() {
            return this._value;
        }

        valueOf() {
            return this.value;
        }
    }

    // ERRORS & SIGNALS

    class BaseError extends Error { }
    class ActError extends BaseError { }
    class ActSyntaxError extends ActError { }
    class ActRuntimeError extends ActError { }
    class Signal extends BaseError {
        static Break = class extends this { };
        static Continue = class extends this { };
        static Stop = class extends this { };
        static Halt = class extends this { };
        static Repeat = class extends this { };
        static Restart = class extends this { };
        static Return = class extends this { };
    }

    // BASE CLASSES

    class Solvable {
        scope;
        source;
        tokenStart;
        tokenEnd;
        value;

        constructor(scope, source, props = {}) {
            this.scope = scope;
            this.source = source;
            for (const [key, value] of Object.entries(props)) if (value !== undefined) this[key] = value;
            if (Act.config.debug) console.log(
                `Act debug. ${this.constructor.name} created.\n`, this, '\n',
            );
        }

        get code() { return this.source.code.substring(this.tokenStart.index, this.tokenEnd.indexEnd); }

        solve() { return this.value; }

        solveDebug(ctx, target, result) {
            console.log(
                `Act: solve() debug. ${this.constructor.name} solved.\n`,
                `${this.constructor.name}:`, this, '\n',
                `Code:`, this.code, '\n',
                'Result value:', result, '\n',
                'Target:', target, '\n',
                'Context:', ctx, '\n',
            );
        }
    }

    class List {
        constructor(value = []) {
            this.value = Array.isArray(value) ? value : [value];
        }

        expand() {
            const result = [];

            for (let value of this.value) {
                if (is(value, this.constructor)) {
                    result.push(...value.expand());
                } else {
                    result.push(value);
                }
            }

            return result;
        }

        async solve(ctx, target, opts) {
            const result = [];

            for (let value of this.expand()) {
                if (is(value, Solvable)) {
                    result.push(await ctx.solve(value, target, opts));
                } else {
                    result.push(value);
                }
            }

            return result;
        }

        push(value) {
            this.value.push(value);
        }
    }

    class Spread extends Solvable {
        async solve(ctx, target, opts) {
            const solved = await ctx.solve(this.value, target, opts);
            return Array.isArray(unwrap(solved)) ? unwrap(solved) : [solved];
        }
    }

    class Template extends Solvable {
        static interpolation(index) {
            return `\uE000_act_itpl_:${index}\uE000`;
        }

        async solve(ctx, target, opts) {
            if (!this.value.scope) return this.value.template;
            let result, skipStack = [], template = this.value.template;

            for (let i = 0; i < this.value.scope.value.length; i++) {
                result = '';
                if (skipStack.shift()) {
                    template = template.replace(Template.interpolation(i), '');
                    continue;
                }

                const sentence = this.value.scope.value[i];

                try {
                    if (sentence.mode == 'async') {
                        result = sentence.solve(ctx, target, opts);
                    } else {
                        result = await sentence.solve(ctx, target, opts);
                    }

                    if (sentence.mode == 'condition') {
                        skipStack = [
                            !unwrap(result),
                            (this.value[i + 1]?.mode == 'branch') && !!unwrap(result),
                        ];
                    } else if (sentence.mode == 'fwd') {
                        target = unwrap(result);
                    }
                } catch (e) {
                    if (is(e, Signal.Stop)) { return e.data; } else if (is(e, Signal.Repeat)) {
                        i = -1;
                    } else {
                        throw e;
                    }
                } finally {
                    template = template.replace(Template.interpolation(i), result.toString());
                }
            }

            return template;
        }
    }

    class Literal extends Solvable {
        solve() {
            return this.value;
        }
    }

    class ActString extends Literal { }
    class ActNumber extends Literal { }
    class ActURL extends Literal { }
    class Dimension extends Solvable {
        static REGEX = /^(-)?\d+(\.\d+)?[a-z%]+$/;

        constructor(scope, source, props = {}) {
            super(scope, source, props);
            this.unit = this.value.match(/[a-z%]+/)[0];
            this.number = parseFloat(this.value.match(/(-)?\d+(\.\d+)?/)[0]);
        }

        solve() {
            return new DimensionResult({ number: this.number, unit: this.unit }, this);
        }
    }

    class Word extends Literal {
        isReservedWord() {
            return Object.hasOwn(Library.words, this.value);
        }

        async solve(ctx, target, opts) {
            if (this.isReservedWord()) return await ctx.solve(
                await Library.words[this.value].call(target, ctx, target), target, opts
            );

            return this.value;
        }
    }

    // SELECTORS & PROPERTIES

    class Property extends Solvable {
        solve(ctx, target) {
            if (target === null || target === undefined) {
                return new Result(undefined, this, { parent: target, key: this.value });
            }

            if (Act.config.convertToCamelCase) {
                const camelKey = snakeToCamel(this.value);
                if (target[camelKey] !== undefined) this.value = camelKey;
            }

            return new Result(target[this.value], this, { parent: target, key: this.value });
        }
    }

    class Variable extends Solvable {
        isGlobal() {
            return (this.value[0] === this.value[0].toUpperCase() && this.value[0] !== this.value[0].toLowerCase());
        }

        solve(ctx, target) {
            if (this.isGlobal()) {
                return new Result(
                    Binder.from(document.body).data[this.value],
                    this,
                    { parent: Binder.from(document.body).data, key: this.value },
                );
            }

            let result = this.scope.lookup(ctx, this.value);
            if (!result) result = ctx.binding.lookupData(this.value);
            if (!result) result = new Result(
                ctx.scopeData(this.scope)[this.value],
                this,
                { parent: ctx.scopeData(this.scope), key: this.value }
            );

            result.from = this;
            return result;
        }
    }

    class Attribute extends Solvable {
        solve(ctx, target) {
            return new AttributeResult(target.attributes[this.value]?.value, this, { parent: target, key: this.value });
        }
    }

    class CSSProperty extends Solvable {
        solve(ctx, target, opts) {
            const value = getComputedStyle(target)[this.value];
            const dimension = value.match(Dimension.REGEX);

            if (dimension && dimension.length && dimension[0] !== undefined) {
                const dimensionResult = new Dimension(
                    this.scope,
                    this.source,
                    { value: dimension[0], tokenStart: this.tokenStart, tokenEnd: this.tokenEnd }
                );
                return new Result(
                    dimensionResult.solve(ctx, target, opts),
                    this,
                    { parent: target.style, key: this.value }
                );
            }

            return new Result(value, this, { parent: target.style, key: this.value });
        }
    }

    class Selector extends Solvable {
        solve(ctx, target, opts) {
            return new SelectorResult(this.value, this, { parent: document });
        }
    }

    class SelectorTemplate extends Solvable {
        async solve(ctx, target, opts) {
            let selector = await ctx.asString(this.value), selectorTarget = (opts?.selectorTarget || document);

            if (selector.startsWith('> ')) {
                selectorTarget = target;
                selector = selector.slice(2);
            } else if (selector.startsWith('< ')) {
                selectorTarget = is(target, Element) ? target : ctx.target;
                return new SelectorResult(selector.slice(2), this, { parent: selectorTarget, mode: 'closest' });
            }

            return new SelectorResult(selector, this, { parent: selectorTarget });
        }
    }

    class Id extends Selector {
        async solve(ctx, target, opts) {
            return new IdResult(this.value, this);
        }
    }

    class Tag extends Selector { }

    class ActClass extends Selector {
        async solve(ctx, target, opts) {
            return new SelectorResult(this.value, this, { parent: document });
        }
    }

    class Sentence extends Solvable {
        mode = 'sync';
        target;

        async solve(ctx, target, opts) {
            let result, sentenceTarget = target;

            try {
                if (this.target !== undefined) {
                    sentenceTarget = await ctx.asValueOf(this.target, target);
                } else if (target === undefined) {
                    sentenceTarget = ctx.target;
                }

                result = await this.value.solve(ctx, unwrap(sentenceTarget), opts);
            } catch (e) {
                if (is(e, Signal)) throw e;

                if (!is(e, ActRuntimeError)) {
                    const wrapped = new ActRuntimeError(e.message);
                    wrapped.actException = e;
                    wrapped.actTrace = [];
                    e = wrapped;
                }

                e.actTrace = e.actTrace || [];
                e.actTrace.push({
                    sentence: this,
                    sentenceTarget,
                    target,
                    context: ctx,
                });

                throw e;
            }

            if (Act.config.debug) this.solveDebug(ctx, target, result);
            return result;
        }
    }

    class Scope extends Solvable {
        value = [];

        isRoot() { return this.scope === undefined; }

        async solve(ctx, target, opts) {
            let result, skipStack = [];

            for (let i = 0; i < this.value.length; i++) {
                if (skipStack.shift()) continue;
                const sentence = this.value[i];

                try {
                    if (sentence.mode == 'async') {
                        result = sentence.solve(ctx, target, opts);
                    } else {
                        result = await sentence.solve(ctx, target, opts);
                    }

                    if (sentence.mode == 'condition') {
                        skipStack = [
                            !unwrap(result),
                            (this.value[i + 1]?.mode == 'branch') && !!unwrap(result),
                        ];
                    } else if (sentence.mode == 'fwd') {
                        target = result;
                    }
                } catch (e) {
                    if (is(e, Signal.Stop)) { return e.data; } else if (is(e, Signal.Repeat) || (this.isRoot() && is(e, Signal.Restart))) {
                        i = -1;
                    } else {
                        throw e;
                    }
                }
            }

            if (this.constructor.debug) this.solveDebug(ctx, target, result);
            return result;
        }

        lookup(ctx, key, defaultThisScope = false) {
            let scope = this;
            while (scope) {
                const scopeData = ctx.scopeData(scope);
                if (scopeData[key] !== undefined) { return new Result(scopeData[key], scope, { parent: scopeData, key }); }

                if (is(scopeData.__fromScope__, this.constructor)) {
                    scope = scopeData.__fromScope__;
                } else {
                    scope = scope.scope;
                }
            }

            if (defaultThisScope) return ctx.scopeData(scope);
        }
    }

    class ActArray extends Solvable {
        async solve(ctx, target, opts) {
            const result = [];

            for (const i of this.value) {
                if (is(i, Spread)) {
                    result.push(...await ctx.solve(i, target, opts));
                } else {
                    result.push(await ctx.solve(i, target, opts));
                }
            }

            return result;
        }
    }

    class ActObject extends Solvable {
        async solve(ctx, target, opts) {
            const object = {};

            for (const [key, value] of this.value) {
                const strKey = await ctx.asString(key, target);
                object[strKey] = await ctx.solve(value, target, { ...opts, parent: object, key: strKey });
            }

            return object;
        }
    }

    class ActFunction extends Solvable {
        async solve(c, t, opts) {
            const scope = this.value.scope, args = this.value.args;

            return Library.method(async function (ctx, target, optsCall, ...callArgs) {
                const fctx = ctx.spawn(), scopeData = fctx.scopeData(scope);
                scopeData.event = fctx.event;
                scopeData.this = opts?.parent;

                const expandedArgs = await ctx.solveAll(callArgs, target, opts);
                for (let i = 0; i < args.length; i++) {
                    if (Array.isArray(args[i])) {
                        scopeData[args[i][0]] = unwrapAll(expandedArgs.slice(i));
                        break;
                    }

                    scopeData[args[i]] = expandedArgs[i];
                }

                try {
                    return await fctx.solve(scope, target, opts);
                } catch (e) {
                    if (is(e, Signal.Return)) return e.data;
                    throw e;
                }
            });
        }
    }

    // EXPRESSIONS

    class Expression extends Solvable {
        async prepare(ctx, target, opts) {
            const l = await ctx.solve(this.l, target, opts);
            const r = await ctx.solve(this.r, target, opts);
            return { l, r };
        }

        async performWith(ctx, target, opts, fn) {
            const { l, r } = await this.prepare(ctx, target, opts);
            return fn(l, r);
        }

        async solve(ctx, target, opts) {
            let result;

            try {
                result = await this.perform(ctx, target, opts);
            } catch (e) {
                if (is(e, Signal)) throw e;
                if (is(e, ActRuntimeError)) throw e;

                const error = new ActRuntimeError;
                error.expression = this;
                error.actException = e;
                error.actTrace = [];
                throw error;
            }

            if (Act.config.debug) this.solveDebug(ctx, target, result);
            return result;
        }
    }

    class KeywordExpression extends Expression {
        async perform(ctx, target, opts) {
            const keyword = this.l.value.toString(), args = this.r.expand();
            return await ctx.solve(
                await Library.keywords[keyword].call(this, ctx, target, opts, args),
                target,
            );
        }
    }

    class PrefixExpression extends Expression {
        async perform(ctx, target, opts) {
            const prefix = this.l.toString();
            return await ctx.solve(
                await Library.prefixes[prefix].call(this, ctx, target, opts, this.r),
                target,
            );
        }
    }

    async function resolveAndCallFunction(ctx, target, opts, l, r, key) {
        if (is(unwrap(l), Library.ActMethod)) {
            return { solved: true, result: await unwrap(l).method(ctx, l.parent ?? target, opts, ...r) };
        } else if (is(unwrap(l), Function)) {
            const solvedR = await ctx.solveAll(r, target, opts);
            const args = solvedR.map(arg => is(unwrap(arg), Library.ActMethod)
                ? (...a) => unwrap(arg).method(ctx, target, opts, ...a)
                : unwrap(arg)
            );
            return { solved: true, result: await unwrap(l).call(l.parent ?? target, ...args) };
        } else if (typeof unwrap(l) === 'string') {
            const fn = Library.get(key, target);
            if (fn !== undefined) return { solved: true, result: await Library.exec(fn, r, target, ctx, opts) };

            const solvedR = await ctx.solveAll(r, target, opts);
            if (is(target[key], Function)) return { solved: true, result: await target[key](...unwrapAll(solvedR)) };
            if (is(unwrap(target)[key], Function)) return { solved: true, result: await unwrap(target)[key](...unwrapAll(solvedR)) };
            if (is(window[key], Function)) return { solved: true, result: await window[key](...unwrapAll(solvedR)) };
        }

        return { solved: false, result: null };
    }

    class ActExpression extends Expression {
        async perform(ctx, target, opts) {
            const l = await ctx.solve(this.l, target, opts), r = this.r.expand();
            const key = lookup(unwrap(l), target);

            const { solved, result } = await resolveAndCallFunction(ctx, target, opts, l, r, key);
            if (solved) return result;

            const solvedR = await ctx.solveAll(this.r, target, opts);
            if (l?.settable) {
                if (is(l.through.from, CSSProperty)) return l.set(solvedR.join(' '));
                return l.set(solvedR[0]);
            } else {
                return target[key] = unwrap(solvedR[0]);
            }
        }
    }

    class CallExpression extends Expression {
        async perform(ctx, target, opts) {
            const l = await ctx.solve(this.l, target, opts), r = this.r.expand();
            const key = lookup(unwrap(l), target);
            const { solved, result } = await resolveAndCallFunction(ctx, target, opts, l, r, key);
            if (solved) return result;

            throw new ActError(`Cannot call '${l.toString()}': not a function or callable object.`);
        }
    }

    class SetExpression extends Expression {
        async perform(ctx, target, opts) {
            const { l, r } = await this.prepare(ctx, target, opts);

            if (l?.settable) {
                if (is(from(l), CSSProperty)) return l.set(r.join(' '));
                return l.set(r);
            } else {
                let key = l.toString();
                if (Act.config.convertToCamelCase) key = snakeToCamel(key);
                target[key] = unwrap(r);
                return unwrap(r);
            }
        }
    }

    class AtExpression extends Expression {
        async perform(ctx, target, opts) {
            let l;

            if (is(this.l, Word) && !this.l.isReservedWord() && lookup(this.l.value, target) !== undefined) {
                l = target[lookup(this.l.value, target)];
            } else {
                l = await ctx.solve(this.l, target, opts);
            }

            let r = await ctx.solveAll(this.r, unwrap(l), opts);

            for (let key of r) {
                key = await ctx.solve(key, target, opts);
                if (is(unwrap(l), Element)) {
                    if (is(from(key), Attribute, CSSProperty)) {
                        l = await from(key).solve(ctx, unwrap(l), opts);
                        continue;
                    } else if (is(from(key), Variable)) {
                        l = new Result(
                            Binder.from(unwrap(l)).data[from(key).value],
                            this,
                            { parent: Binder.from(unwrap(l)).data, key: from(key).value },
                        );
                        continue;
                    }
                }

                l = unwrap(l);
                const keyValue = unwrap(key);
                if (l === null || l === undefined) throw new ActError(`Cannot resolve member '${keyValue}' of ${l}.`);
                const libFn = Library.get(keyValue, l);
                if (libFn !== undefined) {
                    l = new Result(libFn, this, { parent: l });
                } else {
                    const resolvedKey = l[keyValue] !== undefined ? keyValue : lookup(keyValue, l);
                    l = new Result(l[resolvedKey], this, { parent: l, key: resolvedKey });
                }
            }

            return l;
        }
    }

    class SubscriptExpression extends Expression {
        async perform(ctx, target, opts) {
            let { l, r } = await this.prepare(ctx, target, opts);
            l = unwrap(l);

            for (let index of r) {
                index = await ctx.asString(index, target);
                l = new Result(l[index], this, { parent: l, key: index });
            }

            return l;
        }
    }

    class InsertExpression extends Expression {
        async perform(ctx, target, opts) {
            let { l, r } = await this.prepare(ctx, target, opts);
            l = l ?? target ?? ctx.target;
            if (is(unwrap(r), Element)) r = unwrap(r).innerHTML;

            if (is(unwrap(l), Element)) {
                return unwrap(l).innerHTML = r?.toString() ?? '';
            } else if (is(unwrap(l), NodeList)) {
                return unwrap(l)[0].innerHTML = r?.toString() ?? '';
            } else if (Array.isArray(unwrap(l))) {
                return unwrap(l).append(unwrap(r));
            }

            throw new ActError(`Cannot insert into target of type '${typeof unwrap(l)}'. Expected Element, NodeList, or Array.`);
        }
    }

    class IsTypeOperation extends Expression {
        async perform(ctx, target, opts) {
            let { l, r } = await this.prepare(ctx, target, opts);
            const type = r.toString();

            if (is(unwrap(l), Element)) {
                if (is(from(r), Tag)) return unwrap(l).tagName.toLowerCase() === from(r).value.toLowerCase();
                return unwrap(l).tagName.toLowerCase() === type.toLowerCase();
            }

            if (type === 'float') {
                return typeof unwrap(l) === 'number' && !Number.isNaN(unwrap(l));
            } else if (type === 'integer' || type === 'int') {
                return typeof unwrap(l) === 'number' && Number.isInteger(unwrap(l));
            }

            let className = snakeToCamel(type);
            className = className.charAt(0).toUpperCase() + className.slice(1);
            const resultFrom = from(through(l));
            if (resultFrom && resultFrom.constructor?.name === className) return true;
            const unwrapped = unwrap(l);
            if (unwrapped != null && unwrapped.constructor?.name === className) return true;
            return is(unwrap(l), r.value);
        }
    }

    class CastOperation extends Expression {
        static unwrapDimension(val) { 
            return is(from(through(val)), Dimension) ? from(through(val)).number : val; 
        }

        static prefix(val, pre) { 
            return val.toString().startsWith(pre) ? val.toString() : pre + val.toString(); 
        }

        static cast(ValueType, value, expression, prefix = '') {
            return new ValueType(expression.scope, expression.source, {
                tokenStart: expression.tokenStart,
                tokenEnd: expression.tokenEnd,
                value: CastOperation.prefix(value, prefix)
            });
        }

        static STRATEGIES = {
            number: (l) => Number(unwrap(CastOperation.unwrapDimension(l))) || 0,
            float: (l) => parseFloat(CastOperation.unwrapDimension(l).toString()),
            int: (l) => parseInt(CastOperation.unwrapDimension(l).toString()),
            integer: (l) => parseInt(CastOperation.unwrapDimension(l).toString()),
            string: (l) => l.toString(),
            boolean: (l) => (l.toString() === 'false' || unwrap(l) == 0) ? false : !!unwrap(l),
            id: (l, c, t, o, expr) => CastOperation.cast(Id, l, expr, '#').solve(c, t, o),
            class: (l, c, t, o, expr) => CastOperation.cast(ActClass, l, expr, '.').solve(c, t, o),
            json: (l) => JSON.stringify(unwrap(l)),
            fragment: (l) => { 
                const t = document.createElement('template'); 
                t.innerHTML = l.toString(); 
                return t.content; 
            },
            selector: (l, c, t, o, expr) => CastOperation.cast(SelectorTemplate, l, expr).solve(c, t, o),
            attribute: (l, c, t, o, expr) => CastOperation.cast(Attribute, l, expr).solve(c, t, o),
            css_property: (l, c, t, o, expr) => CastOperation.cast(CSSProperty, l, expr).solve(c, t, o),
            dimension: (l, c, t, o, expr) => CastOperation.cast(Dimension, l, expr).solve(c, t, o),
            variable: (l, c, t, o, expr) => CastOperation.cast(Variable, l, expr).solve(c, t, o),
        };

        async perform(ctx, target, opts) {
            let { l, r } = await this.prepare(ctx, target, opts);
            const strategy = CastOperation.STRATEGIES[r.toString()];
            if (strategy) return await strategy(l, ctx, target, opts, this);
        }
    }

    class OrOperation extends Expression {
        async perform(ctx, target, opts) {
            const l = await ctx.solve(this.l, target, opts);
            if (unwrap(l)) return l;
            return unwrap(l) || await ctx.asValueOf(this.r, target);
        }
    }

    class AndOperation extends Expression {
        async perform(ctx, target, opts) {
            const l = await ctx.solve(this.l, target, opts);
            if (!unwrap(l)) return unwrap(l);
            return unwrap(l) && await ctx.asValueOf(this.r, target);
        }
    }

    class ThenOperation extends Expression {
        async perform(ctx, target, opts) { return await ctx.solve(this.r, await ctx.asValueOf(this.l, target), opts); }
    }

    class RescueOperation extends Expression {
        async perform(ctx, target, opts) {
            try { 
                return await ctx.solve(this.l, target, opts); 
            } catch (e) {
                if (is(e, Signal)) throw e;
                if (is(this.r, Scope)) {
                    const scopeData = ctx.scopeData(this.r);
                    scopeData.exception = e;
                    scopeData.exception.message = e.actException.message;
                }

                return await ctx.solve(this.r, target, opts);
            }
        }
    }

    class IsInOperation extends Expression {
        static is_in(l, r) {
            if (Array.isArray(unwrap(r))) {
                return r.includes(unwrap(l));
            } else if (is(unwrap(r), Object)) {
                return Object.keys(unwrap(r)).includes(l.toString());
            } else if (typeof unwrap(r) === 'string') {
                return unwrap(r).includes(l.toString());
            }

            return false;
        }

        async perform(ctx, target, opts) {
            return this.performWith(ctx, target, opts, IsInOperation.is_in);
        }
    }

    const Operators = {
        CastOperation,
        InsertExpression,
        IsTypeOperation,
        OrOperation,
        RescueOperation,
        SetExpression,
        ThenOperation,
        AndOperation,
        IsInOperation,
    };

    [
        ['Mod', (l, r) => l % r],
        ['Sub', (l, r) => l - r],
        ['Add', (l, r) => l + r],
        ['Div', (l, r) => l / r],
        ['Mul', (l, r) => l * r],
        ['Like', (l, r) => l == r],
        ['NotLike', (l, r) => l != r],
        ['Equal', (l, r) => l === r],
        ['NotEqual', (l, r) => l !== r],
        ['Gt', (l, r) => l > r],
        ['Gte', (l, r) => l >= r],
        ['Lt', (l, r) => l < r],
        ['Lte', (l, r) => l <= r],
        ['IsNotIn', (l, r) => !IsInOperation.is_in(l, r)],
        ['SubSet', (l, r) => l.set(l - r), true],
        ['AddSet', (l, r) => l.set(l + r), true],
    ].forEach(([name, op, isSet]) => {
        const C = class extends Expression {
            async perform(ctx, target, opts) {
                if (isSet) return this.performWith(ctx, target, opts, op);
                const { l, r } = await this.prepare(ctx, target, opts);
                if (is(from(through(l)), Dimension) && is(from(through(r)), Dimension) && l.unit === r.unit)
                    return new DimensionResult({ number: op(unwrap(l), unwrap(r)), unit: l.unit }, this);

                return op(unwrap(l), unwrap(r));
            }
        };
        Object.defineProperty(C, 'name', { value: name + 'Operation' });
        Operators[name + 'Operation'] = C;
    });

    class Lexer {
        static debug = false;
        static Token = class {
            constructor(type, value, index, line, column) {
                this.type = type;
                this.value = value;
                this.index = index;
                this.line = line;
                this.column = column;
            }

            get indexEnd() { return this.index + this.value.length; }
        };

        static VALUES = {
            arrow: 'parseFunction',
            string: 'parseString',
            url: 'parseUrl',
            path: 'parsePath',
            list: 'parseList',
            prefix: 'parsePrefixedValue',
            dot: 'parseClass',
            lcurly: 'parseSelectorTemplate',
            backtick: 'parseTemplateValue',
            word: 'parseSimple',
            number: 'parseSimple',
            cssProp: 'parseSimple',
            dimension: 'parseSimple',
            attribute: 'parseSimple',
            variable: 'parseSimple',
            id: 'parseSimple',
            property: 'parseSimple',
            tag: 'parseSimple',
            lparen: 'parseScope',
            do: 'parseScope',
            lbrace: 'parseCollection'
        };

        static PREFIXES = Object.keys(Library.prefixes);

        static EXPRESSIONS = {
            bang: 'parseCallExpressionEmpty',
            call: 'parseCallExpression',
            colon: 'parseActExpression',
            dot: 'parseAtExpression',
            insert: 'parseInsertExpression',
            lbrace: 'parseSubscriptExpression',
            lparen: 'parseCallExpressionParens',
        };

        static OPERATORS = {
            '+': 'AddOperation',
            '-': 'SubOperation',
            '*': 'MulOperation',
            '/': 'DivOperation',
            '%': 'ModOperation',
            'and': 'AndOperation',
            'or': 'OrOperation',
            'is': 'EqualOperation',
            'is_not': 'NotEqualOperation',
            '<': 'LtOperation',
            '<=': 'LteOperation',
            '>': 'GtOperation',
            '>=': 'GteOperation',
            '==': 'LikeOperation',
            '!=': 'NotLikeOperation',
            '=': 'SetExpression',
            '+=': 'AddSetOperation',
            '-=': 'SubSetOperation',
            'as': 'CastOperation',
            'rescue': 'RescueOperation',
            'is_a': 'IsTypeOperation',
            'is_an': 'IsTypeOperation',
            'then': 'ThenOperation',
            '|': 'ThenOperation',
            '<<': 'InsertExpression',
            'is_in': 'IsInOperation',
            'is_not_in': 'IsNotInOperation',
        };

        static SENTENCE_END = {
            ';': 'sync',
            '&': 'async',
            '?': 'condition',
            'else?': 'branch',
            '>>': 'fwd',
        };

        static TOKENS = [
            ['sentence_end', RegExp(Object.keys(this.SENTENCE_END).map(r => regexEscape(r)).join('|'))],
            ['string', /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/],
            ['url', /https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{2,256}\.[a-z]{2,63}\b[-a-zA-Z0-9@:%_+.~#?&\/=]*/],
            ['comment', /\/\*[\s\S]*?\*\/|\/\/.*/],
            ['insert', /(?:^|\s+)<<\s+/],
            ['operator', RegExp(Object.keys(this.OPERATORS).map(r => '\\s+' + regexEscape(r) + '\\s+').join('|'))],
            ['space', /\s+/],
            ['lparen', /\(/],
            ['rparen', /\)/],
            ['do', /\bdo\b/],
            ['end', /\bend\b/],
            ['list', /\.\.\./],
            ['dot', /\./],
            ['call', /!:/],
            ['bang', /!/],
            ['variable', /\$[a-zA-Z0-9_\-]+/],
            ['cssProp', /\*[a-zA-Z0-9_\-]+/],
            ['attribute', /@[a-zA-Z0-9_\-]+/],
            ['dimension', /-?\d+(?:\.\d+)?[a-z%]+/],
            ['number', /-?\d+(?:\.\d+)?/],
            ['id', /#[a-zA-Z0-9_\-]+/],
            ['tag', /<[a-zA-Z0-9_\-]+>/],
            ['path', /\/\b[-a-zA-Z0-9@:%_+.~#?&\/=]*/],
            ['property', /:[a-zA-Z0-9_\-]+/],
            ['arrow', /->/],
            ['prefix', RegExp(`\\b(?:${this.PREFIXES.join('|')})\\b`)],
            ['word', /[a-zA-Z0-9_\-]+/],
            ['colon', /:/],
            ['comma', /,/],
            ['lcurly', /\{/],
            ['rcurly', /}/],
            ['lbrace', /\[/],
            ['rbrace', /]/],
            ['backtick', /`/],
            ['backslash', /\\/],
            ['unclosedComment', /\/\*/],
            ['unclosedString', /["']/],
            ['unknown', /./],
        ];

        static TPL_TOKENS = [
            ['lcurly', /\{/],
            ['rcurly', /}/],
            ['backtick', /`/],
            ['backslash', /\\/],
            ['content', /[^{}`\\]+/],
        ];

        static TPL_TOKENS_START = ['lcurly', 'backtick'];
        static TPL_TOKENS_END = ['rcurly', 'backtick'];

        static LANG_REGEX = new RegExp(this.TOKENS.map(t => `(${t[1].source})`).join('|'), 'gy');
        static TPL_REGEX = new RegExp(this.TPL_TOKENS.map(t => `(${t[1].source})`).join('|'), 'gy');

        constructor(input) {
            this.input = input + '\n;';
            this.wasBackslash = false;
            this.langRegex = new RegExp(Lexer.LANG_REGEX.source, 'gy');
            this.tplRegex = new RegExp(Lexer.TPL_REGEX.source, 'gy');
            this.regex = this.langRegex;
            this.tplMode = false;
            this.tokens = [new Lexer.Token(null, '', 0, 0, 0), new Lexer.Token(null, '', 0, 0, 0)];
            this.index = 0;
            this.line = 1;
            this.column = 0;
        }

        hasMoreTokens() { return this.input.length > this.index; }

        setTplMode(tplMode) {
            if (Lexer.debug) console.warn(`Lexer setTplMode: Lexer set to ${tplMode ? 'template' : 'language'} mode.`);
            this.tplMode = tplMode;
            this.regex = tplMode ? this.tplRegex : this.langRegex;
            this.regex.lastIndex = this.index;
        }

        next() {
            while (this.hasMoreTokens()) {
                this.regex.lastIndex = this.index;
                const match = this.regex.exec(this.input);

                if (!match || match[0].length === 0) {
                    this.index++;
                    continue;
                }

                const groupIndex = match.findIndex((m, i) => i > 0 && m !== undefined);
                const type = (this.tplMode ? Lexer.TPL_TOKENS : Lexer.TOKENS)[groupIndex - 1][0];
                const value = match[0];

                this.index = this.regex.lastIndex;

                if (!this.wasBackslash) {
                    if (!this.tplMode && Lexer.TPL_TOKENS_START.includes(type)) this.setTplMode(true);
                    else if (this.tplMode && (type == 'lcurly')) this.setTplMode(false);
                    else if (!this.tplMode && (type == 'rcurly')) this.setTplMode(true);
                    else if (this.tplMode && Lexer.TPL_TOKENS_END.includes(type)) this.setTplMode(false);
                }

                this.wasBackslash = (type == 'backslash' && !this.wasBackslash);

                if (value.includes('\n')) {
                    const lines = (value.match(/\n/g) || []).length;
                    this.line += lines;
                    this.column = value.length - lines;
                } else {
                    this.column += value.length;
                }

                this.tokens.shift();
                this.tokens.push(
                    new Lexer.Token(type, value, match.index, this.line, this.column)
                );

                if (Act.config.lexerDebug) this.debugNext();
                if (type == 'comment') continue;

                return this;
            }

            return this;
        }

        debugNext() {
            console.log(this.input.substring(0, this.index) + '⬅️' + this.input.substring(this.index));
            console.trace(`Lexer next() (${this.tplMode ? 'template' : 'lang'} mode)`, this.peek());
        }

        peek() {
            return this.tokens[1];
        }

        prev() {
            return this.tokens[0];
        }

        tokenIs(...types) {
            return types.includes(this.peek().type);
        }

        tokenIsEnd() {
            return this.tokenIs('sentence_end', 'rparen', 'end', 'rcurly');
        }

        tokenIsValue() {
            return this.tokenIs(...Object.keys(Lexer.VALUES));
        }

        tokenIsExpression() {
            return this.tokenIs(...Object.keys(Lexer.EXPRESSIONS));
        }

        tokenIsOperator() {
            return Lexer.OPERATORS[this.peek().value.trim()];
        }

        fail(message) {
            const e = new ActSyntaxError(`at line ${this.line}, column ${this.column}: ${message}`);
            e.token = this.peek();
            throw e;
        }

        expect(...types) {
            if (this.tokenIs(...types)) return this;
            this.fail(`Unexpected ${this.peek().type} "${this.peek().value}", expected a token of type ${types.join(', ')}.`);
        }

        expectValue() {
            if (this.tokenIsValue()) return this;
            this.fail(`Unexpected ${this.peek().type} "${this.peek().value}", expected a value token.`);
        }

        expectEnd() {
            return this.expect('sentence_end', 'rparen', 'end');
        }

        nextIf(...types) {
            return this.tokenIs(...types) ? this.next() : false;
        }

        consume(...types) {
            return (types.length === 0 || this.tokenIs(...types)) ? this.next().fwd() : false;
        }

        fwd() {
            while (this.nextIf('space'));
            return this;
        }

        fwdWithComma() {
            while (this.nextIf('space', 'comma'));
            return this;
        }
    }
    
    class Parser {
        static debug = false;

        static VALUES = {
            word: [Word],
            number: [ActNumber, v => parseFloat(v)],
            cssProp: [CSSProperty, v => v.slice(1)],
            dimension: [Dimension],
            attribute: [Attribute, v => v.slice(1)],
            variable: [Variable, v => v.slice(1)],
            id: [Id],
            property: [Property, v => v.slice(1)],
            tag: [Tag, v => v.slice(1, -1)],
        };

        static ESCAPE_CHARS = {
            "'": "'",
            '"': '"',
            '`': '`',
            '\\': '\\',
            'n': '\n',
            'r': '\r',
            't': '\t',
            'b': '\b',
            'f': '\f',
            '{': '{',
            '}': '}',
        }

        constructor(source) {
            this.source = source;
            this.lexer = new Lexer(this.source.code);
            this.lexer.next();
        }

        isKeyword(word) {
            return is(word, Word) && Object.hasOwn(Library.keywords, word.value);
        }

        parse() {
            const root = new Scope(null, this.source);
            root.tokenStart = this.lexer.peek();

            while (this.lexer.hasMoreTokens()) {
                const sentence = this.parseSentence(root);
                if (sentence) root.value.push(sentence);
                this.lexer.expect('sentence_end', 'rparen', 'end', 'space').next();
            }

            root.tokenEnd = this.lexer.peek();
            if (Parser.debug) console.warn('Parser.parse() finished\n', root, this.source);
            return root;
        }

        parseSentence(scope) {
            this.lexer.fwd();
            if (this.lexer.tokenIsEnd()) return;

            const sentence = new Sentence(scope, this.source);
            sentence.tokenStart = this.lexer.peek();
            let target, value = this.parseExpression(scope);

            if (this.lexer.nextIf('space') && this.lexer.fwd().tokenIsValue()) {
                target = value;
                value = this.parseExpression(scope);
            }

            sentence.target = target;
            sentence.value = value;
            sentence.mode = Lexer.SENTENCE_END[this.lexer.fwd().peek().value] || 'sync';
            sentence.tokenEnd = this.lexer.peek();

            return sentence;
        }

        parseExpression(scope, skip = []) {
            let l;

            if (this.lexer.tokenIsValue()) {
                l = this.parseValue(scope);
            } else if (!this.lexer.tokenIs('insert')) {
                this.lexer.fail(`Unexpected token ${this.lexer.peek().type} "${this.lexer.peek().value}" while parsing an expression. A value token or an insert token were expected.`);
            }
            if (this.lexer.tokenIs(...skip)) return l;

            if (this.isKeyword(l)) l = this.parseKeywordExpression(scope, l);
            if (this.lexer.tokenIsEnd() && !this.lexer.tokenIs('rparen', 'end')) return l;

            while (!this.lexer.tokenIsEnd() && this.lexer.hasMoreTokens()) {
                if (this.lexer.tokenIsExpression()) {
                    l = this[
                        Lexer.EXPRESSIONS[this.lexer.peek().type]
                    ](scope, l, [...skip, 'insert']);
                } else if (this.lexer.tokenIsOperator()) {
                    l = this.parseOperator(scope, l, [...skip, 'insert']);
                } else {
                    break;
                }
            }

            return l;
        }

        parseOperator(scope, l, skip = []) {
            const operation = new Operators[
                Lexer.OPERATORS[this.lexer.peek().value.trim()]
            ](scope, this.source, { tokenStart: l.tokenStart });

            operation.l = l;
            this.lexer.consume();
            operation.r = this.parseExpression(scope, ['operator', ...skip]);
            operation.tokenEnd = this.lexer.prev();
            return operation;
        }

        parseKeywordExpression(scope, l) {
            const keywordExpression = new KeywordExpression(scope, this.source, { tokenStart: l.tokenStart });
            keywordExpression.l = l;
            keywordExpression.r = new List;
            this.lexer.fwd();

            while (!this.lexer.nextIf('comma') && this.lexer.hasMoreTokens() && !this.lexer.tokenIsEnd() && !this.lexer.tokenIsOperator()) {
                keywordExpression.r.push(this.parseExpression(scope));
                this.lexer.fwd();
            }

            keywordExpression.tokenEnd = this.lexer.peek();
            return keywordExpression;
        }

        parseAtExpression(scope, l) {
            this.lexer.expect('dot');
            const atExpression = new AtExpression(scope, this.source, { tokenStart: l.tokenStart });
            atExpression.l = l;
            atExpression.r = new List;

            while (this.lexer.nextIf('dot') && this.lexer.hasMoreTokens()) {
                this.lexer.expect('word', 'attribute', 'cssProp', 'variable', 'lparen');
                atExpression.r.push(this.parseValue(scope));
            }

            atExpression.tokenEnd = this.lexer.prev();
            return atExpression;
        }

        parseSubscriptExpression(scope, l) {
            this.lexer.expect('lbrace');
            const subscriptExpression = new SubscriptExpression(scope, this.source, { tokenStart: l.tokenStart });
            subscriptExpression.l = l;
            subscriptExpression.r = new List;

            while (this.lexer.nextIf('lbrace') && this.lexer.hasMoreTokens()) {
                this.lexer.fwd().expectValue();
                subscriptExpression.r.push(this.parseExpression(scope, ['rbrace']));
                this.lexer.fwd().nextIf('rbrace');
            }

            subscriptExpression.tokenEnd = this.lexer.peek();
            return subscriptExpression;
        }

        parseCallExpressionEmpty(scope, l) {
            this.lexer.expect('bang').next();
            const callExpression = new CallExpression(scope, this.source, { tokenStart: l.tokenStart });
            callExpression.l = l;
            callExpression.r = new List;
            callExpression.tokenEnd = this.lexer.peek();
            return callExpression;
        }

        parseInsertExpression(scope, l, skip = []) {
            this.lexer.expect('insert').next().fwd();
            const insertExpression = new InsertExpression(scope, this.source);

            if (l === undefined) {
                insertExpression.tokenStart = this.lexer.prev();
            } else {
                insertExpression.tokenStart = l.tokenStart;
                insertExpression.l = l;
            }

            insertExpression.r = this.parseExpression(scope, skip);
            insertExpression.tokenEnd = this.lexer.peek();
            return insertExpression;
        }

        parseCallExpression(scope, l, skip = []) {
            this.lexer.expect('call').consume();
            const callExpression = new CallExpression(scope, this.source, { tokenStart: l.tokenStart });
            callExpression.l = l;
            callExpression.r = new List;

            while (!this.lexer.tokenIs('comma') && !this.lexer.tokenIsEnd() && this.lexer.hasMoreTokens()) {
                if (this.lexer.tokenIs(...skip)) break;
                callExpression.r.push(this.parseExpression(scope, skip));
                this.lexer.fwd();
            }

            callExpression.tokenEnd = this.lexer.peek();
            return callExpression;
        }

        parseCallExpressionParens(scope, l, skip = []) {
            this.lexer.expect('lparen').consume();
            const callExpression = new CallExpression(scope, this.source, { tokenStart: l.tokenStart });
            callExpression.l = l;
            callExpression.r = new List;

            while (!this.lexer.nextIf('rparen') && this.lexer.hasMoreTokens()) {
                if (this.lexer.tokenIs(...skip)) break;
                callExpression.r.push(this.parseExpression(scope, skip));
                this.lexer.fwdWithComma();
            }

            callExpression.tokenEnd = this.lexer.prev();
            return callExpression;
        }

        parseActExpression(scope, l, skip = []) {
            this.lexer.expect('colon').consume();
            const actExpression = new ActExpression(scope, this.source, { tokenStart: l.tokenStart });
            actExpression.l = l;
            actExpression.r = new List;

            while (!this.lexer.nextIf('comma') && !this.lexer.tokenIsEnd() && this.lexer.hasMoreTokens()) {
                if (this.lexer.tokenIs(...skip)) break;
                actExpression.r.push(this.parseExpression(scope, skip));
                this.lexer.fwd();
            }

            actExpression.tokenEnd = this.lexer.peek();
            return actExpression;
        }

        parseValue(scope) {
            this.lexer.expectValue();
            const tokenStart = this.lexer.peek();
            const value = this[Lexer.VALUES[this.lexer.peek().type]](scope);
            value.tokenStart = tokenStart;
            value.tokenEnd = this.lexer.peek();
            if (!is(value, List, Spread, PrefixExpression)) this.lexer.next();
            return value;
        }

        parseScope(parentScope) {
            const scope = new Scope(parentScope, this.source);
            scope.tokenStart = this.lexer.peek();
            const endToken = this.lexer.expect('lparen', 'do').tokenIs('do') ? 'end' : 'rparen';
            this.lexer.next();

            while (!this.lexer.tokenIs(endToken) && this.lexer.hasMoreTokens()) {
                const sentence = this.parseSentence(scope);
                if (sentence) scope.value.push(sentence);
                if (this.lexer.tokenIsEnd() && !this.lexer.tokenIs(endToken)) this.lexer.next().fwd();
            }

            scope.tokenEnd = this.lexer.peek();
            return scope;
        }

        parseCollection(scope) {
            this.lexer.expect('lbrace').consume();

            if (this.lexer.nextIf('colon') && this.lexer.fwd().tokenIs('rbrace')) { 
                return new ActObject(scope, this.source, { value: new Map }); 
            } else if (this.lexer.fwd().nextIf('rbrace')) { 
                return new ActArray(scope, this.source, { value: [] }); 
            }

            const initial = this.parseExpression(scope, ['colon']);
            this.lexer.fwd();

            if (this.lexer.nextIf('comma') || this.lexer.tokenIsValue() || this.lexer.tokenIs('rbrace')) {
                this.lexer.fwd();
                return new ActArray(scope, this.source, { value: this.parseArray(scope, initial) });
            } else if (this.lexer.nextIf('colon')) {
                this.lexer.fwd();
                const objectScope = new Scope(scope, this.source);
                return new ActObject(objectScope, this.source, { value: this.parseObject(objectScope, initial) });
            }

            this.lexer.fail(`Unexpected token ${this.lexer.peek().type} "${this.lexer.peek().value}" while parsing a collection. Only colon, comma, rbrace and value tokens where expected.`);
        }

        parseArray(scope, value) {
            const array = [];
            array.push(value);
            this.lexer.fwd();

            while (!this.lexer.tokenIs('rbrace') && this.lexer.hasMoreTokens()) {
                array.push(this.parseExpression(scope, ['colon']));
                this.lexer.fwdWithComma();
            }

            this.lexer.expect('rbrace');
            return array;
        }

        parseObject(scope, key) {
            const map = new Map;
            map.set(key, this.parseExpression(scope, ['colon']));
            this.lexer.fwdWithComma();

            while (!this.lexer.tokenIs('rbrace') && this.lexer.hasMoreTokens()) {
                key = this.parseExpression(scope, ['colon']);
                this.lexer.fwd().expect('colon').consume();
                map.set(key, this.parseExpression(scope, ['colon']));
                this.lexer.fwdWithComma();
            }

            this.lexer.expect('rbrace');
            return map;
        }

        parseString(scope) {
            this.lexer.expect('string');
            return new ActString(
                scope,
                this.source,
                { value: this.lexer.peek().value.slice(1, -1).replace(/\\(.)/g, (_, char) => Parser.ESCAPE_CHARS[char] || char) }
            );
        }

        parseFunction(scope) {
            this.lexer.expect('arrow').next().fwd().expect('variable', 'list', 'lparen', 'do');
            const fn = { args: [] };

            while (this.lexer.tokenIs('variable') && this.lexer.hasMoreTokens()) {
                fn.args.push(this.lexer.peek().value.slice(1));
                this.lexer.next().fwd();
            }

            if (this.lexer.nextIf('list')) {
                this.lexer.expect('variable');
                fn.args.push([this.lexer.peek().value.slice(1)]);
                this.lexer.next().fwd();
            }

            fn.scope = this.parseScope(scope);
            return new ActFunction(scope, this.source, { value: fn });
        }

        parseTemplate(scope, startToken, endToken) {
            let template = '';
            const subscope = new Scope(scope, this.source);

            this.lexer.expect(startToken).next();

            while (!this.lexer.tokenIs(endToken) && this.lexer.hasMoreTokens()) {
                if (this.lexer.nextIf('lcurly')) {
                    while (!this.lexer.tplMode && this.lexer.hasMoreTokens()) {
                        const sentence = this.parseSentence(subscope);
                        if (sentence) {
                            subscope.value.push(sentence);
                            template += Template.interpolation(subscope.value.length - 1);
                        } else {
                            this.lexer.next();
                        }
                    }

                    this.lexer.next();
                }

                if (this.lexer.tokenIs(endToken, 'lcurly')) {
                    continue;
                } else if (this.lexer.nextIf('backslash')) {
                    const escaped = Parser.ESCAPE_CHARS[this.lexer.peek().value[0]];
                    if (escaped) template += escaped;
                    template += this.lexer.peek().value.slice(1);
                } else {
                    template += this.lexer.peek().value;
                }

                this.lexer.next();
            }

            this.lexer.expect(endToken);
            return { template, scope: (subscope.value.length > 0 ? subscope : null) };
        }

        parseTemplateValue(scope, startToken = 'backtick', endToken = 'backtick') {
            return new Template(scope, this.source, { value: this.parseTemplate(scope, startToken, endToken) });
        }

        parseSelectorTemplate(scope) {
            return new SelectorTemplate(scope, this.source, { value: this.parseTemplateValue(scope, 'lcurly', 'rcurly') });
        }

        parseSimple(scope) {
            const type = this.lexer.peek().type;
            const [Class, transform = v => v] = Parser.VALUES[type];
            this.lexer.expect(type);
            return new Class(scope, this.source, { value: transform(this.lexer.peek().value) });
        }

        parseClass(scope) {
            this.lexer.expect('dot').next().expect('word');
            return new ActClass(scope, this.source, { value: '.' + this.lexer.peek().value });
        }

        parsePath(scope) {
            this.lexer.expect('path');
            const urlString = window.location.origin + this.lexer.peek().value;
            if (urlString.length > 2048) this.lexer.fail(`URL exceeds maximum length of 2048 characters.`);
            const url = URL.parse(urlString);
            if (url === null) this.lexer.fail(`Invalid URL "${urlString}"`);
            if (!['http:', 'https:'].includes(url.protocol)) {
                this.lexer.fail(`Invalid protocol "${url.protocol}" in URL "${urlString}". Only http: and https: are allowed.`);
            }
            return new ActURL(scope, this.source, { value: url });
        }

        parseUrl(scope) {
            this.lexer.expect('url');
            const urlString = this.lexer.peek().value;
            if (urlString.length > 2048) this.lexer.fail(`URL exceeds maximum length of 2048 characters.`);
            const url = URL.parse(urlString);
            if (url === null) this.lexer.fail(`Invalid URL "${urlString}"`);
            if (!['http:', 'https:', 'ws:', 'wss:', 'file:'].includes(url.protocol)) {
                this.lexer.fail(`Invalid protocol "${url.protocol}" in URL "${urlString}". Only http:, https:, ws:, wss:, and file: are allowed.`);
            }
            return new ActURL(scope, this.source, { value: url });
        }

        parseList(scope) {
            this.lexer.expect('list').next();
            return new Spread(scope, this.source, { value: this.parseExpression(scope) });
        }

        parsePrefixedValue(scope) {
            this.lexer.expect('prefix');
            const prefix = this.lexer.peek().value;
            this.lexer.next().fwd().expectValue();
            return new PrefixExpression(scope, this.source, { l: prefix, r: this.parseValue(scope) });
        }
    }

    class Source {
        args = [];
        attr;
        #code;
        scope;
        type;

        get code() {
            if (this.#code !== null) return this.#code;
            if (this.type == 'directAttribute') return this.attr.value;
            if (this.type == 'inlineScript') return this.attr.ownerElement.innerHTML;
        }

        get element() {
            if (this.type == 'actrun') return document.body;
            if (this.type == 'directAttribute') return this.attr.ownerElement;
            return this.attr.ownerElement.parentNode;
        }

        constructor(attr, type, code = null, scope = null) {
            this.attr = attr;
            this.type = type;
            this.#code = code;
            if (is(scope, Scope)) {
                this.scope = scope;
            } else try {
                const parser = new Parser(this);
                this.scope = parser.parse();
            } catch (e) {
                const codeLines = this.code.split('\n'), line = codeLines[Math.max(0, e.token.line - 1)];
                const logArgs = [
                    '%c💣 act Syntax Error', 'font-weight: bold; font-size: 1.1em;', '\n',
                    'while parsing Source', this, '\n',
                    'for element', this.element, '\n',
                ];

                if (this.attr) logArgs.push(`in attribute "${this.attr.name}" of element`, this.attr.ownerElement, '\n');
                logArgs.push(e.message, '\n\n');

                if ((e.token.line - 1) > 1) logArgs.push(codeLines[e.token.line - 2], '\n');
                logArgs.push(
                    line.substring(0, e.token.column - e.token.value.length) +
                    '⚠️➡️' + line.substring(e.token.column - e.token.value.length, e.token.column) +
                    '⬅️⚠️' + line.substring(e.token.column) +
                    '\n'
                );
                if (codeLines.length - (e.token.line) > 1) logArgs.push(codeLines[e.token.line], '\n');

                console.error(...logArgs);
                throw e;
            }
        }
    }

    const Binder = {
        PROP: '__act__',
        ATTRIBUTES: ['act', 'act-block'],
        EVENT_OPTIONS: [
            'once',
            'prevent',
            'stop',
            'only',
            'target',
        ],

        INTERSECT_EVENTS: {
            inview: 'actinview',
            offview: 'actoffview',
        },

        from(element, create = false) {
            const binding = element[Binder.PROP];
            if (!binding && create) return new Binding(element);
            return binding;
        },

        eventName(name) {
            if (Object.keys(Binder.INTERSECT_EVENTS).includes(name)) { return Binder.INTERSECT_EVENTS[name]; }

            return name;
        },

        bind(element) {
            if (is(element, HTMLScriptElement) && element.attributes.type?.value == 'text/act') { return this.bindScript(element); }

            const binding = this.from(element, true);
            this.bindAttributes(element, binding);
        },

        bindScript(element) {
            const target = element.parentNode;
            const binding = this.from(target, true);

            if (element.hasAttribute('src')) {
                return (async () => {
                    const code = await fetch(
                        element.src, { method: 'GET', headers: { 'Content-Type': 'text/plain' } }
                    ).then(response => response.text());
                    const source = new Source(element.attributes.src, 'externalScript', code);
                    if (Act.config.start) target.dispatchEvent(new Event('actscriptloaded', { detail: { element } }));
                    binding.addEvent('act', source);
                })();
            }

            if (
                !element.hasAttribute('act-block') &&
                !Array.from(element.attributes).some(attr => attr.name == 'act' || attr.name.startsWith('act@'))
            ) {
                element.setAttribute('act', '');
            }

            this.bindAttributes(element, binding, 'inlineScript');
        },

        bindAttributes(element, binding, type = 'directAttribute') {
            for (const attr of element.attributes) {
                if (!this.ATTRIBUTES.includes(attr.name) && !attr.name.startsWith('act@')) continue;
                this.bindSource(binding, new Source(attr, type));
            }
        },

        bindSource(binding, source) {
            if (source.attr.name == 'act-block') return this.bindBlock(binding, source);
            this.bindEvents(binding, source);
        },

        bindBlock(binding, source) {
            const [blockName, ...args] = source.attr.value.replaceAll('$', '').split(' ');
            source.args = args;
            binding.blocks[blockName] = source;
        },

        bindEvents(binding, source) {
            source.attr.name.replace('act@', '').split(',').forEach(evt => {
                const opts = {};
                this.EVENT_OPTIONS.forEach(o => { if (evt.includes(':' + o)) { opts[o] = true; evt = evt.replace(':' + o, ''); } });

                let match, alias = null;
                if (match = evt.match(/\[(.*?)\](.*)/)) { alias = match[1]; evt = match[2]; }

                const [name, ...mods] = evt.split('.');
                if (mods.length) opts.modifiers = mods;

                binding.addEvent(name, source, opts, null, alias);
            });
        },

        scan(root, bindRoot = true, force = false) {
            if (this.from(root) && !force) return;
            if (bindRoot) this.bind(root);

            const xpath = new XPathEvaluator().createExpression(
                './/script[@type = "text/act"] | .//*[@act] | .//*[@*[starts-with(name(), "act@")]]',
            ).evaluate(root, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);

            for (let i = 0; i < xpath.snapshotLength; i++) {
                const node = xpath.snapshotItem(i);
                if (!this.from(node) || force) this.bind(node);
            }
        }
    };

    class Binding {
        data;
        element;
        events = {};
        blocks = {};

        constructor(element) {
            this.element = element;
            this.data = {};
            Object.defineProperty(element, Binder.PROP, { value: this, writable: true, configurable: true });
        }

        #addIntersectObserver(eventName, options) {
            const observerOptions = {}, element = this.element;

            if (options.threshold) observerOptions.threshold = options.threshold;
            if (is(options.root, Element)) observerOptions.root = options.root;
            if (options.rootMargin !== undefined) observerOptions.rootMargin = options.rootMargin.toString();

            const observer = new IntersectionObserver(function (entries) {
                for (const entry of entries) {
                    if (entry.isIntersecting === (eventName == Binder.INTERSECT_EVENTS.inview)) {
                        if (options.once) this.unobserve(element);
                        element.dispatchEvent(new Event(eventName, { detail: { entry } }));
                        break;
                    }
                }
            }, observerOptions);

            observer.observe(element);
        }

        addEvent(eventName, source, options = {}, eventManager = null, eventAlias = null) {
            if (eventAlias === null) eventAlias = eventName;
            if (Object.keys(Binder.INTERSECT_EVENTS).includes(eventName)) {
                eventName = Binder.INTERSECT_EVENTS[eventName];
                this.#addIntersectObserver(eventName, options);
            }

            if (!eventManager) eventManager = new EventManager(this, eventName, options, source, source.scope);
            this.events[eventAlias] = eventManager;
            this.element.addEventListener(eventName, eventManager.listener, options);
            if (eventName === 'act' && Act.config.start) this.element.dispatchEvent(new Event('act', { bubbles: false }));
        }

        parent() {
            let parent = this.element;
            while (parent = parent.parentNode) {
                if (Binder.from(parent)) return Binder.from(parent);
            }
        }

        getBlock(name) {
            return this.lookupBlock(name)?.block;
        }

        lookupBlock(name) {
            let binding = this;

            while (binding) {
                if (Object.hasOwn(binding.blocks, name)) return { block: binding.blocks[name], binding };
                binding = binding.parent();
            }
        }

        lookupData(key) {
            let binding = this;
            while (binding) {
                if (Object.hasOwn(binding.data, key)) { return new Result(binding.data[key], binding, { parent: binding.data, key }); }
                binding = binding.parent();
            }
        }
    }

    class EventManager {
        binding;
        name;
        options;
        source;
        scope;

        lock = false;
        halt = false;

        constructor(binding, name, options, source, scope) {
            this.binding = binding;
            this.name = name;
            this.options = options;
            this.scope = scope;
            this.source = source;
            this.contexts = new Set;

            this.listener = (ev) => {
                const mods = this.options.modifiers?.map(m => m.toLowerCase());
                if (mods) {
                    if (['shift', 'ctrl', 'alt', 'meta'].some(k => (mods.includes(k) || (k === 'ctrl' && mods.includes('control'))) && !ev[k + 'Key'])) return;
                    const keys = mods.filter(m => !['shift', 'ctrl', 'control', 'alt', 'meta'].includes(m));
                    if (keys.length && (!ev.key || !keys.includes(ev.key.toLowerCase()))) return;
                }
                if (this.options.prevent) ev.preventDefault();
                if (this.options.stop) ev.stopPropagation();
                if (this.options.only) ev.stopImmediatePropagation();
                return this.run(this.options.target ? ev.target : this.binding.element, ev);
            };
        }

        async run(target, event = null) {
            if (this.lock) return;
            const context = new Context(target, this.binding, event, this, this.source);

            try {
                this.attach(context);
                context.scopeData(this.scope).event = event;
                return await context.solve(this.scope, target, {});
            } catch (e) {
                if (is(e, Signal.Halt, Signal.Stop)) return e.data;
                if (is(e, ActRuntimeError) && e.actTrace?.length) {
                    const expr = e.expression;
                    const originalError = e.actException ?? e;
                    const initialTrace = e.actTrace[0];

                    console.error('%c💣 act Runtime Error', 'font-weight: bold; font-size: 1.2em;');
                    console.group(`%c${originalError.constructor.name}%c${originalError.message ? ': ' + originalError.message : ''}`,
                        'background: rgba(255, 0, 0, 0.1); font-weight: bold; padding: 2px 4px;',
                        'background: rgba(255, 0, 0, 0.1); padding: 2px 4px;'
                    );

                    console.log(
                        'At line', expr.tokenStart.line, 'Column', expr.tokenStart.column,
                        `\nOn event: '${initialTrace.context.event?.type ?? 'unknown'}'`, initialTrace.context.event,
                        '\nFrom event manager:', initialTrace.context.eventManager,
                        `\nSource: ${initialTrace.sentence.source.type}`, initialTrace.sentence.source,
                        '\nElement binding:', initialTrace.context.binding.element,
                    );

                    console.groupCollapsed('Stack trace');
                    for (const entry of e.actTrace) {
                        const s = entry.sentence, codeLines = s.code.split('\n'), firstLine = codeLines[0], hasMoreLines = codeLines.length > 1;
                        const beforeError = firstLine.substring(0, expr.tokenStart.index - s.tokenStart.index);
                        const errorPart = firstLine.substring(expr.tokenStart.index - s.tokenStart.index, expr.tokenEnd.indexEnd - s.tokenStart.index);
                        const afterError = firstLine.substring(expr.tokenEnd.indexEnd - s.tokenStart.index);

                        if (expr && errorPart) {
                            console.groupCollapsed(
                                `%cLine ${s.tokenStart.line}:\n%c ${beforeError}%c${errorPart}%c${afterError}${hasMoreLines ? '%c ...' : ''}`,
                                'color: gray;', '', 'background: rgba(255, 0, 0, 0.2); font-weight: bold; padding: 1px 4px; border-radius: 4px; border: 1px solid rgba(255, 0, 0, 0.3);', '',
                                ...(hasMoreLines ? ['color: gray; font-style: italic;'] : []),
                            );
                        } else {
                            console.groupCollapsed(
                                `%cLine ${s.tokenStart.line}:\n%c ${firstLine.trim()}${hasMoreLines ? '%c ...' : ''}`,
                                'color: gray;', '',
                                ...(hasMoreLines ? ['color: gray; font-style: italic;'] : []),
                            );
                        }

                        console.log(
                            'Sentence details:\n',
                            '\nTarget:\n', s.target,
                            '\nComputed sentence target:\n', entry.sentenceTarget,
                            '\nSource:\n', s.source,
                            '\nSentence object:\n', s,
                            '\nFull code:\n\n' + s.code,
                        );
                        console.groupEnd();
                    }
                    console.groupEnd();

                    console.groupCollapsed('Full trace data');
                    console.log(e.actTrace);
                    console.groupEnd();

                    console.groupCollapsed('JavaScript Exception');
                    console.error(e.actException);
                    console.groupEnd();
                    
                    console.groupEnd();
                }
            } finally {
                this.detach(context);
            }
        }

        attach(context) {
            this.contexts.add(context);
        }

        detach(context) {
            this.contexts.delete(context);
            if (this.contexts.size === 0) this.halt = false;
        }
    }

    class Context {
        binding;
        data;
        event;
        eventManager;
        source;

        constructor(defaultTarget, binding, event, eventManager, source) {
            this.target = defaultTarget;
            this.binding = binding;
            this.event = event;
            this.eventManager = eventManager;
            this.source = source;
            this.data = new WeakMap;
        }

        async solve(value, target, opts) {
            if (this.eventManager.halt) throw new Signal.Halt;
            if (!is(value, Solvable, List)) return value;
            return await value.solve(this, target, opts);
        }

        async solveAll(values, target, opts) {
            if (is(values, List)) return await values.solve(this, target, opts);
            
            const result = [];
            for (const value of values) {
                if (is(value, Spread)) {
                    result.push(...await this.solve(value, target, opts));
                } else {
                    result.push(await this.solve(value, target, opts));
                }
            }
            return result;
        }

        async asString(value, target, opts) {
            const result = await this.solve(value, target, opts);
            return result === undefined ? '' : result.toString();
        }

        async asValueOf(value, target, opts) {
            return unwrap(await this.solve(value, target, opts));
        }

        scopeData(scope) {
            if (!this.data.has(scope)) this.data.set(scope, {});
            return this.data.get(scope);
        }

        spawn() {
            return new Context(this.target, this.binding, this.event, this.eventManager, this.source);
        }
    }

    const Act = global.Act = {
        get version() { return '0.1.0'; },

        config: {
            convertToCamelCase: true,
            start: true,
            debug: false,
            debugLexer: false,
            debugParser: false,
            startTime: true,
            sanitize: false,
            sanitizer: null,
        },

        configure() {
            const meta = document.querySelectorAll('meta[name="act-config"]');
            const conf = {};
            for (const m of meta) { const [k, v] = m.content.split(':'); conf[k.trim()] = JSON.parse(v.trim()); }
            Object.assign(this.config, conf, window.__actConfig || {});
            if (this.config.debugLexer) Lexer.debug = true;
            if (this.config.debugParser) Parser.debug = true;
        },

        start() {
            if (this.config.startTime) console.time('act start');
            new Binding(window);
            this.init(document.body, true);
            if (this.config.startTime) console.timeEnd('act start');
        },

        init(root, bindRoot, force) {
            Binder.scan(root, bindRoot, force);
        },

        run(target, code) {
            const binding = Binder.from(target, true), source = new Source(null, 'actrun', code);
            return new EventManager(binding, 'actrun', {}, source, source.scope).run(target);
        },

        get globals() {
            return Binder.from(document.body).data;
        },

        is, unwrap, unwrapAll, from, through, Library,
    };
})(this);
