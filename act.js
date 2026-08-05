(function (global) {
    document.addEventListener('DOMContentLoaded', () => {
        Act.configure();
        if (Act.config.start) Act.start();
    });

    const is = (value, ...types) => {
        if (value === undefined || value === null) return false;

        for (const type of types) {
            if (typeof type === 'string') {
                if (typeof value === type) return true;
            } else if (value instanceof type || value?.constructor === type) {
                return true;
            }
        }

        return false;
    };

    const ACT_FUNCTION = Symbol('actFunction');
    const isActFunction = (value) => is(value, Function) && value[ACT_FUNCTION];

    const unwrap = (value) => is(value, Result) ? value.value : value;
    const unwrapAll = (values) => values.map(unwrap);
    const from = (value) => is(value, Result) ? value.from : undefined;
    const through = (value) => is(value, Result) ? value.through : value;

    const snakeToCamel = (text) => {
        if (is(text, Solvable)) text = text.value;
        if (typeof text !== 'string') return text;

        const camel = text.toLowerCase().replace(/[-_][a-z]/g, (group) => group[1].toUpperCase());
        if (camel.toLowerCase() === 'innerhtml') return 'innerHTML';
        if (camel.toLowerCase() === 'outerhtml') return 'outerHTML';
        return camel;
    };

    const lookup = (key, object) => {
        if (object === null || object === undefined) return key;
        if (Act.config.convertToCamelCase && object[snakeToCamel(key)] !== undefined) return snakeToCamel(key);
        return key;
    };

    const isNullish = (value) => value === null || value === undefined;

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

    class Result {
        from;
        _value;
        parent;
        key;

        constructor(value, from = null, props = {}) {
            this._value = value;
            this.from = from;
            for (const [key, value] of Object.entries(props)) this[key] = value;
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
            const text = is(value, Result) ? value.toString() : String(value);
            this.parent.setAttribute(this.key, text);
        }

        get value() {
            return this.parent.getAttribute(this.key);
        }
    }

    class ComplexResult extends Result { }

    class DimensionResult extends ComplexResult {
        get number() { return this.value.number; }
        get unit() { return this.value.unit; }

        valueOf() {
            return this.number.valueOf();
        }

        toString() {
            return `${this.number}${this.unit}`;
        }
    }

    class SelectorResult extends ComplexResult {
        get value() {
            if (this.mode === 'closest') return this.parent.closest(this._value) || [];
            return this.parent.querySelectorAll(this._value);
        }

        toString() {
            return this._value;
        }

        valueOf() {
            return this.value;
        }
    }

    class IdResult extends SelectorResult {
        get value() {
            return document.getElementById(this._value.slice(1));
        }
    }

    class Abortable {
        constructor(value, abort) {
            this.value = value;
            this.abort = abort ?? (() => {});
        }
    }

    const abortable = ({ perform, abort }) => {
        let done;
        const promise = new Promise(resolve => { done = resolve; });
        const returned = perform(done);
        if (!isNullish(returned) && typeof returned.then === 'function') returned.then(done);

        return new Abortable(promise, abort ?? (() => {}));
    };

    const resolveAbortable = async (ctx, returned) => {
        if (is(returned, Abortable)) {
            ctx.abortSignal.addEventListener('abort', returned.abort, { once: true });
            return await returned.value;
        }

        return await returned;
    };

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

        get code() {
            return this.source.code.substring(this.tokenStart.index, this.tokenEnd.indexEnd);
        }

        solve() {
            return this.value;
        }

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

            for (const item of this.value) {
                if (is(item, this.constructor)) {
                    result.push(...item.expand());
                } else {
                    result.push(item);
                }
            }

            return result;
        }

        async solve(ctx, target, opts) {
            const result = [];

            for (const item of this.expand()) {
                if (is(item, Solvable)) {
                    result.push(await ctx.solve(item, target, opts));
                } else {
                    result.push(item);
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
        async solve(ctx, target, opts) {
            const { literals, scope } = this.value;
            if (!scope) return literals[0];

            const rendered = [];
            await scope.solve(ctx, target, opts, (index, value) => rendered[index] = value?.toString() ?? '');

            let text = literals[0];
            for (let index = 0; index < scope.value.length; index++) {
                text += (rendered[index] ?? '') + literals[index + 1];
            }

            return text;
        }
    }

    class Literal extends Solvable {
        solve() {
            return this.value;
        }

        toString() {
            return this.value.toString();
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

    class Property extends Solvable {
        solve(ctx, target) {
            let key = this.value;

            if (target === null || target === undefined) {
                return new Result(undefined, this, { parent: target, key });
            }

            if (Act.config.convertToCamelCase) {
                const camelKey = snakeToCamel(key);
                if (target[camelKey] !== undefined) key = camelKey;
            }

            return new Result(target[key], this, { parent: target, key });
        }
    }

    class Variable extends Solvable {
        isGlobal() {
            return /^[A-Z]/.test(this.value);
        }

        solve(ctx, target) {
            if (this.isGlobal()) {
                const globals = Binder.from(document.body).data;
                return new Result(globals[this.value], this, { parent: globals, key: this.value });
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
        solve(ctx, target) {
            const value = getComputedStyle(target)[this.value];
            const asDimension = value?.match?.(Dimension.REGEX) &&
                new DimensionResult({ number: parseFloat(value), unit: value.match(/[a-z%]+$/)[0] }, this);

            return new Result(asDimension || value, this, { parent: target.style, key: this.value });
        }
    }

    class Selector extends Solvable {
        solve(ctx, target, opts) {
            return new SelectorResult(this.value, this, { parent: document });
        }
    }

    class SelectorTemplate extends Solvable {
        async solve(ctx, target, opts) {
            let selector = await ctx.asString(this.value);
            let searchRoot = opts?.selectorTarget || document;

            if (selector.startsWith('> ')) {
                searchRoot = target;
                selector = selector.slice(2);
            } else if (selector.startsWith('< ')) {
                searchRoot = is(target, Element) ? target : ctx.target;
                return new SelectorResult(selector.slice(2), this, { parent: searchRoot, mode: 'closest' });
            }

            return new SelectorResult(selector, this, { parent: searchRoot });
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
        static MODE = {
            SYNC: 'sync',
            ASYNC: 'async',
            CONDITION: 'condition',
            BRANCH: 'branch',
            FORWARD: 'fwd',
        };

        mode = Sentence.MODE.SYNC;
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
            } catch (error) {
                if (is(error, Signal)) throw error;

                if (!is(error, ActRuntimeError)) {
                    const wrapped = new ActRuntimeError(error.message);
                    wrapped.actException = error;
                    wrapped.actTrace = [];
                    error = wrapped;
                }

                error.actTrace = error.actTrace || [];
                error.actTrace.push({
                    sentence: this,
                    sentenceTarget,
                    target,
                    context: ctx,
                });

                throw error;
            }

            if (Act.config.debug) this.solveDebug(ctx, target, result);
            return result;
        }
    }

    const withoutAwaiting = (pendingResult) => pendingResult;

    class Scope extends Solvable {
        value = [];

        isRoot() {
            return !is(this.scope, Scope);
        }

        async solve(ctx, target, opts, onResult = null) {
            let result, skipStack = [];

            for (let i = 0; i < this.value.length; i++) {
                if (ctx.finishing) throw new Signal.Halt;

                if (skipStack.shift()) {
                    onResult?.(i, '');
                    continue;
                }

                const sentence = this.value[i];

                try {
                    if (sentence.mode === Sentence.MODE.ASYNC) {
                        result = withoutAwaiting(sentence.solve(ctx, target, opts));
                    } else {
                        result = await sentence.solve(ctx, target, opts);
                    }

                    if (sentence.mode === Sentence.MODE.CONDITION) {
                        const conditionHolds = !!unwrap(result);
                        const nextSentenceIsElseBranch = this.value[i + 1]?.mode === Sentence.MODE.BRANCH;
                        skipStack = [!conditionHolds, nextSentenceIsElseBranch && conditionHolds];
                        onResult?.(i, '');
                    } else if (sentence.mode === Sentence.MODE.FORWARD) {
                        target = result;
                        onResult?.(i, result);
                    } else {
                        onResult?.(i, result);
                    }
                } catch (error) {
                    if (is(error, Signal.Stop)) {
                        onResult?.(i, error.data);
                        return error.data;
                    } else if (is(error, Signal.Repeat) || (this.isRoot() && is(error, Signal.Restart))) {
                        i = -1;
                    } else {
                        throw error;
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
                if (scopeData[key] !== undefined) {
                    return new Result(scopeData[key], scope, { parent: scopeData, key });
                }

                if (is(scopeData.__callerScope__, this.constructor)) {
                    scope = scopeData.__callerScope__;
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

            for (const item of this.value) {
                if (is(item, Spread)) {
                    result.push(...await ctx.solve(item, target, opts));
                } else {
                    result.push(await ctx.solve(item, target, opts));
                }
            }

            return result;
        }
    }

    class ActObject extends Solvable {
        async solve(ctx, target, opts) {
            const object = {};

            for (const [key, value] of this.value) {
                const stringKey = await ctx.asString(key, target);
                object[stringKey] = await ctx.solve(value, target, { ...opts, parent: object, key: stringKey });
            }

            return object;
        }
    }

    class ActFunction extends Solvable {
        async solve(outerCtx, outerTarget, opts) {
            const scope = this.value.scope;
            const parameterNames = this.value.args;

            return Library.method(async function (ctx, target, callOpts, ...callArgs) {
                const fnContext = ctx.spawn(), scopeData = fnContext.scopeData(scope);
                scopeData.event = fnContext.event;
                scopeData.this = opts?.parent;

                const solvedArgs = await ctx.solveAll(callArgs, target, opts);
                for (let i = 0; i < parameterNames.length; i++) {
                    if (Array.isArray(parameterNames[i])) {
                        scopeData[parameterNames[i][0]] = unwrapAll(solvedArgs.slice(i));
                        break;
                    }

                    scopeData[parameterNames[i]] = solvedArgs[i];
                }

                try {
                    return await fnContext.solve(scope, target, opts);
                } catch (error) {
                    if (is(error, Signal.Return)) return error.data;
                    throw error;
                }
            });
        }
    }

    const looselyEquals = (value, other) => value == other;

    class Expression extends Solvable {
        async prepare(ctx, target, opts) {
            return {
                left: await ctx.solve(this.left, target, opts),
                right: await ctx.solve(this.right, target, opts)
            };
        }

        async invokeLeft(ctx, target, opts) {
            const left = await ctx.solve(this.left, target, opts);
            const key = lookup(unwrap(left), target);
            const invoked = await tryInvoke(ctx, target, opts, left, this.right.expand(), key);
            return { left, key, invoked };
        }

        async performWith(ctx, target, opts, fn) {
            const { left, right } = await this.prepare(ctx, target, opts);
            return fn(left, right);
        }

        async solve(ctx, target, opts) {
            let result;

            try {
                result = await this.perform(ctx, target, opts);
            } catch (error) {
                if (is(error, Signal)) throw error;
                if (is(error, ActRuntimeError)) throw error;

                const wrapped = new ActRuntimeError;
                wrapped.expression = this;
                wrapped.actException = error;
                wrapped.actTrace = [];
                throw wrapped;
            }

            if (Act.config.debug) this.solveDebug(ctx, target, result);
            return result;
        }
    }

    class KeywordExpression extends Expression {
        async perform(ctx, target, opts) {
            const keyword = this.left.value.toString();
            const args = this.right.expand();

            return await ctx.solve(
                await Library.keywords[keyword].call(this, ctx, target, opts, args),
                target,
            );
        }
    }

    class PrefixExpression extends Expression {
        async perform(ctx, target, opts) {
            const prefix = this.left.toString();

            return await ctx.solve(
                await Library.prefixes[prefix].call(this, ctx, target, opts, this.right),
                target,
            );
        }
    }

    const NOT_INVOCABLE = Symbol('notInvocable');

    async function tryInvoke(ctx, target, opts, left, rawArgs, key) {
        const value = unwrap(left);
        const receiver = left?.parent ?? target;

        const isActLambda = isActFunction(value);
        const isJavaScriptFunction = is(value, Function);
        const isMethodName = is(value, 'string');
        const isCallableDomReference = is(left, SelectorResult) && value.length > 0;

        if (isActLambda) {
            const heldInAVariable = is(from(left), Variable);
            return await value(ctx, heldInAVariable ? target : receiver, opts, ...rawArgs);
        }

        if (isJavaScriptFunction) {
            const asJavaScriptCallback = (actLambda) =>
                (...callArgs) => unwrap(actLambda)(ctx, target, opts, ...callArgs);

            const solved = await ctx.solveAll(rawArgs, target, opts);
            const args = solved.map(arg => isActFunction(unwrap(arg)) ? asJavaScriptCallback(arg) : unwrap(arg));

            return await resolveAbortable(ctx, value.call(receiver, ...args));
        }

        if (isMethodName) {
            const libraryMethod = Library.get(key, target);
            if (libraryMethod !== undefined) return await Library.exec(libraryMethod, rawArgs, target, ctx, opts);

            const hostsSearchedInOrder = [target, unwrap(target), window];
            const host = hostsSearchedInOrder.find(object => is(object?.[key], Function));

            if (host !== undefined) {
                const args = await ctx.solveAll(rawArgs, target, opts);
                return await host[key](...unwrapAll(args));
            }
        }

        if (isCallableDomReference) return value[0];

        return NOT_INVOCABLE;
    }

    class ActExpression extends Expression {
        async perform(ctx, target, opts) {
            const { left, key, invoked } = await this.invokeLeft(ctx, target, opts);
            if (invoked !== NOT_INVOCABLE) return invoked;

            const solvedRight = await ctx.solveAll(this.right, target, opts);

            if (left?.settable) {
                if (is(left.through.from, CSSProperty)) return left.set(solvedRight.join(' '));
                return left.set(solvedRight[0]);
            } else {
                return target[key] = unwrap(solvedRight[0]);
            }
        }
    }

    class CallExpression extends Expression {
        async perform(ctx, target, opts) {
            const { left, invoked } = await this.invokeLeft(ctx, target, opts);
            if (invoked !== NOT_INVOCABLE) return invoked;

            throw new ActError(`Cannot call '${left.toString()}': not a function or callable object.`);
        }
    }

    class SetExpression extends Expression {
        async perform(ctx, target, opts) {
            const { left, right } = await this.prepare(ctx, target, opts);

            if (left?.settable) {
                if (is(from(left), CSSProperty)) return left.set(right.join(' '));
                return left.set(right);
            } else {
                let key = left.toString();
                if (Act.config.convertToCamelCase) key = snakeToCamel(key);
                target[key] = unwrap(right);
                return unwrap(right);
            }
        }
    }

    class AtExpression extends Expression {
        async perform(ctx, target, opts) {
            let current;

            if (is(this.left, Word) && !this.left.isReservedWord()) {
                const host = [target, window].find(candidate => !isNullish(candidate) && candidate[lookup(this.left.value, candidate)] !== undefined);
                current = host ? host[lookup(this.left.value, host)] : await ctx.solve(this.left, target, opts);
            } else {
                current = await ctx.solve(this.left, target, opts);
            }

            const keys = await ctx.solveAll(this.right, unwrap(current), opts);

            for (let key of keys) {
                key = await ctx.solve(key, target, opts);

                const element = is(unwrap(current), SelectorResult) ? unwrap(current).value : unwrap(current);
                if (is(element, Element)) {
                    if (is(from(key), Attribute, CSSProperty)) {
                        current = await from(key).solve(ctx, element, opts);
                        continue;
                    } else if (is(from(key), Variable)) {
                        const data = Binder.from(element).data;
                        current = new Result(data[from(key).value], this, { parent: data, key: from(key).value });
                        continue;
                    }
                }

                current = unwrap(current);
                if (is(current, SelectorResult)) current = current.value;

                const keyValue = unwrap(key);
                if (current === null || current === undefined) {
                    if (this.safe) return new Result(undefined, this, {});
                    throw new ActError(`Cannot resolve member '${keyValue}' of ${current}.`);
                }

                const libraryMethod = Library.get(keyValue, current);
                if (libraryMethod !== undefined) {
                    current = new Result(libraryMethod, this, { parent: current });
                } else {
                    const resolvedKey = current[keyValue] !== undefined ? keyValue : lookup(keyValue, current);
                    current = new Result(current[resolvedKey], this, { parent: current, key: resolvedKey });
                }
            }

            return current;
        }
    }

    class SubscriptExpression extends Expression {
        async perform(ctx, target, opts) {
            let { left, right } = await this.prepare(ctx, target, opts);
            let current = unwrap(left);

            for (let index of right) {
                index = await ctx.asString(index, target);
                current = new Result(current[index], this, { parent: current, key: index });
            }

            return current;
        }
    }

    class InsertExpression extends Expression {
        async perform(ctx, target, opts) {
            let { left, right } = await this.prepare(ctx, target, opts);
            left = left ?? target ?? ctx.target;

            if (is(unwrap(left), Element)) {
                if (is(unwrap(right), Element)) right = unwrap(right).innerHTML;
                return unwrap(left).innerHTML = right?.toString() ?? '';
            } else if (Array.isArray(unwrap(left))) {
                return unwrap(left).push(unwrap(right));
            }

            const type = unwrap(left)?.constructor?.name ?? typeof unwrap(left);
            throw new ActError(`Cannot insert into target of type '${type}'. Expected a single Element or an Array — select one element from a collection with '!' or 'first'.`);
        }
    }

    class IsTypeOperation extends Expression {
        static CHECKS = {
            float: (value) => typeof value === 'number' && !Number.isNaN(value),
            int: (value) => typeof value === 'number' && Number.isInteger(value),
            integer: (value) => typeof value === 'number' && Number.isInteger(value),
            string: (value) => typeof value === 'string',
            boolean: (value) => typeof value === 'boolean',
            object: (value) => typeof value === 'object',
            array: (value) => Array.isArray(value),
        };

        async perform(ctx, target, opts) {
            const { left, right } = await this.prepare(ctx, target, opts);
            const value = unwrap(left), type = right.toString();

            if (value === null || value === undefined) return false;

            if (is(value, Element)) {
                if (type.toLowerCase() === 'element') return true;
                const tag = is(from(right), Tag) ? from(right).value : type;
                return value.tagName.toLowerCase() === tag.toLowerCase();
            }

            if (type === 'dimension') return is(through(left), DimensionResult);
            if (Object.hasOwn(IsTypeOperation.CHECKS, type)) return IsTypeOperation.CHECKS[type](value);

            if (value.constructor?.name === type) return true;
            const className = snakeToCamel(type).replace(/^./, c => c.toUpperCase());
            return from(through(left))?.constructor?.name === className || value.constructor?.name === className;
        }
    }

    class CastOperation extends Expression {
        static unwrapDimension(value) {
            return is(through(value), DimensionResult) ? through(value).number : value;
        }

        static prefix(value, sigil) {
            return value.toString().startsWith(sigil) ? value.toString() : sigil + value.toString();
        }

        static cast(ValueType, value, expression, sigil = '') {
            return new ValueType(expression.scope, expression.source, {
                tokenStart: expression.tokenStart,
                tokenEnd: expression.tokenEnd,
                value: CastOperation.prefix(value, sigil)
            });
        }

        static STRATEGIES = {
            number: (left) => Number(unwrap(CastOperation.unwrapDimension(left))) || 0,
            float: (left) => parseFloat(CastOperation.unwrapDimension(left).toString()),
            int: (left) => parseInt(CastOperation.unwrapDimension(left).toString()),
            integer: (left) => parseInt(CastOperation.unwrapDimension(left).toString()),
            string: (left) => left.toString(),
            boolean: (left) => (left.toString() === 'false' || looselyEquals(unwrap(left), 0)) ? false : !!unwrap(left),
            json: (left) => JSON.stringify(unwrap(left)),
            fragment: (left) => {
                const template = document.createElement('template');
                template.innerHTML = left.toString();
                return template.content;
            },
            id: (left, ctx, target, opts, expr) => CastOperation.cast(Id, left, expr, '#').solve(ctx, target, opts),
            class: (left, ctx, target, opts, expr) => CastOperation.cast(ActClass, left, expr, '.').solve(ctx, target, opts),
            selector: (left, ctx, target, opts, expr) => CastOperation.cast(SelectorTemplate, left, expr).solve(ctx, target, opts),
            attribute: (left, ctx, target, opts, expr) => CastOperation.cast(Attribute, left, expr).solve(ctx, target, opts),
            css_property: (left, ctx, target, opts, expr) => CastOperation.cast(CSSProperty, left, expr).solve(ctx, target, opts),
            dimension: (left, ctx, target, opts, expr) => CastOperation.cast(Dimension, left, expr).solve(ctx, target, opts),
            variable: (left, ctx, target, opts, expr) => CastOperation.cast(Variable, left, expr).solve(ctx, target, opts),
        };

        async perform(ctx, target, opts) {
            const { left, right } = await this.prepare(ctx, target, opts);
            const strategy = CastOperation.STRATEGIES[right.toString()];
            if (strategy) return await strategy(left, ctx, target, opts, this);
        }
    }

    class NullishOperation extends Expression {
        async perform(ctx, target, opts) {
            const left = await ctx.solve(this.left, target, opts);
            if (unwrap(left) !== null && unwrap(left) !== undefined) return left;
            return ctx.solve(this.right, target, opts);
        }
    }

    class OrOperation extends Expression {
        async perform(ctx, target, opts) {
            const left = await ctx.solve(this.left, target, opts);
            return unwrap(left) ? left : await ctx.asValueOf(this.right, target);
        }
    }

    class AndOperation extends Expression {
        async perform(ctx, target, opts) {
            const left = await ctx.solve(this.left, target, opts);
            return unwrap(left) ? await ctx.asValueOf(this.right, target) : unwrap(left);
        }
    }

    class ThenOperation extends Expression {
        async perform(ctx, target, opts) {
            return await ctx.solve(this.right, await ctx.asValueOf(this.left, target), opts);
        }
    }

    class RescueOperation extends Expression {
        async perform(ctx, target, opts) {
            try {
                return await ctx.solve(this.left, target, opts);
            } catch (error) {
                if (is(error, Signal)) throw error;

                if (is(this.right, Scope)) {
                    const scopeData = ctx.scopeData(this.right);
                    scopeData.exception = error;
                    scopeData.exception.message = (error.actException ?? error).message;
                }

                return await ctx.solve(this.right, target, opts);
            }
        }
    }

    class IsInOperation extends Expression {
        static is_in(left, right) {
            if (Array.isArray(unwrap(right))) {
                return right.includes(unwrap(left));
            } else if (is(unwrap(right), Object)) {
                return Object.keys(unwrap(right)).includes(left.toString());
            } else if (typeof unwrap(right) === 'string') {
                return unwrap(right).includes(left.toString());
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
        NullishOperation,
        OrOperation,
        RescueOperation,
        SetExpression,
        ThenOperation,
        AndOperation,
        IsInOperation,
    };

    [
        ['Mod', (left, right) => left % right],
        ['Sub', (left, right) => left - right],
        ['Add', (left, right) => left + right],
        ['Div', (left, right) => left / right],
        ['Mul', (left, right) => left * right],
        ['Like', (left, right) => looselyEquals(left, right)],
        ['NotLike', (left, right) => !looselyEquals(left, right)],
        ['Equal', (left, right) => left === right],
        ['NotEqual', (left, right) => left !== right],
        ['Gt', (left, right) => left > right],
        ['Gte', (left, right) => left >= right],
        ['Lt', (left, right) => left < right],
        ['Lte', (left, right) => left <= right],
        ['IsNotIn', (left, right) => !IsInOperation.is_in(left, right)],
        ['SubSet', (left, right) => left.set(left - right), true],
        ['AddSet', (left, right) => left.set(left + right), true],
    ].forEach(([name, operation, isAssignment]) => {
        const OperationClass = class extends Expression {
            async perform(ctx, target, opts) {
                if (isAssignment) return this.performWith(ctx, target, opts, operation);

                const { left, right } = await this.prepare(ctx, target, opts);
                const leftDimension = through(left), rightDimension = through(right);

                if (is(leftDimension, DimensionResult) && is(rightDimension, DimensionResult)) {
                    if (leftDimension.unit !== rightDimension.unit) return null;
                    const result = operation(leftDimension.number, rightDimension.number);
                    return typeof result === 'number'
                        ? new DimensionResult({ number: result, unit: leftDimension.unit }, this)
                        : result;
                }

                const numericValue = (value, dimension) => is(dimension, DimensionResult) ? dimension.number : unwrap(value);
                return operation(numericValue(left, leftDimension), numericValue(right, rightDimension));
            }
        };

        Object.defineProperty(OperationClass, 'name', { value: name + 'Operation' });
        Operators[name + 'Operation'] = OperationClass;
    });

    class Lexer {
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
            dot: 'parseClass',
            lcurly: 'parseSelectorTemplate',
            backtick: 'parseTemplateValue',
            word: 'parseSimpleValue',
            number: 'parseSimpleValue',
            cssProp: 'parseSimpleValue',
            dimension: 'parseSimpleValue',
            attribute: 'parseSimpleValue',
            variable: 'parseSimpleValue',
            id: 'parseSimpleValue',
            property: 'parseSimpleValue',
            tag: 'parseSimpleValue',
            lparen: 'parseScope',
            do: 'parseScope',
            lbrace: 'parseCollection',
            negative: 'parseNegativePrefix',
        };

        static EXPRESSIONS = {
            bang: 'parseCallExpressionEmpty',
            call: 'parseCallExpression',
            colon: 'parseActExpression',
            dot: 'parseAtExpression',
            safedot: 'parseAtExpression',
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
            '??': 'NullishOperation',
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
            ';': Sentence.MODE.SYNC,
            '&': Sentence.MODE.ASYNC,
            '?': Sentence.MODE.CONDITION,
            '~': Sentence.MODE.BRANCH,
            '>>': Sentence.MODE.FORWARD,
        };

        static regexEscape(text) {
            return text.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        }

        static IMPLICIT_FINAL_TERMINATOR = '\n;';

        static TOKENS_BY_PRECEDENCE = [
            ['safedot', /\?\./],
            ['sentence_end', RegExp(Object.keys(this.SENTENCE_END).map(this.regexEscape).join('|'))],
            ['string', /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/],
            ['url', /https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{2,256}\.[a-z]{2,63}\b[-a-zA-Z0-9@:%_+.~#?&\/=]*/],
            ['comment', /\/\*[\s\S]*?\*\/|\/\/.*/],
            ['insert', /(?:^|\s+)?<<\s*/],
            ['operator', RegExp('\\s+(?:' + Object.keys(this.OPERATORS).sort((a, b) => b.length - a.length).map(this.regexEscape).join('|') + ')\\s+')],
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
            ['negative', /-/],
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

        static LANG_REGEX = new RegExp(this.TOKENS_BY_PRECEDENCE.map(t => `(${t[1].source})`).join('|'), 'gy');

        constructor(input) {
            this.input = input + Lexer.IMPLICIT_FINAL_TERMINATOR;
            this.regex = new RegExp(Lexer.LANG_REGEX.source, 'gy');
            this.previousToken = new Lexer.Token(null, '', 0, 0, 0);
            this.currentToken = new Lexer.Token(null, '', 0, 0, 0);
            this.index = 0;
            this.line = 1;
            this.column = 0;
        }

        hasMoreTokens() {
            return this.input.length > this.index;
        }

        next() {
            while (this.hasMoreTokens()) {
                this.regex.lastIndex = this.index;
                const match = this.regex.exec(this.input);

                if (!match || match[0].length === 0) {
                    this.index++;
                    continue;
                }

                const groupIndex = match.findIndex((group, i) => i > 0 && group !== undefined);
                const type = Lexer.TOKENS_BY_PRECEDENCE[groupIndex - 1][0];
                const value = match[0];

                this.index = this.regex.lastIndex;

                if (value.includes('\n')) {
                    const newlines = (value.match(/\n/g) || []).length;
                    this.line += newlines;
                    this.column = value.length - newlines;
                } else {
                    this.column += value.length;
                }

                this.previousToken = this.currentToken;
                this.currentToken = new Lexer.Token(type, value, match.index, this.line, this.column);

                if (Act.config.lexerDebug) this.debugNext();
                if (type === 'comment') continue;

                return this;
            }

            return this;
        }

        debugNext() {
            console.log(this.input.substring(0, this.index) + '⬅️' + this.input.substring(this.index));
            console.trace('Lexer next()', this.peek());
        }

        peekChar() {
            return this.input[this.index];
        }

        consumeChar() {
            return this.input[this.index++];
        }

        scanRaw(stopChars) {
            let content = '';
            while (this.index < this.input.length) {
                const character = this.input[this.index];
                if (stopChars.includes(character)) break;
                content += character;
                this.index++;
            }
            return content;
        }

        peek() {
            return this.currentToken;
        }

        previous() {
            return this.previousToken;
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
            return this.currentToken.type === 'operator';
        }

        fail(message) {
            const error = new ActSyntaxError(`at line ${this.line}, column ${this.column}: ${message}`);
            error.token = this.peek();
            throw error;
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
            return (types.length === 0 || this.tokenIs(...types)) ? this.next().skipSpaces() : false;
        }

        skipSpaces() {
            while (this.nextIf('space'));
            return this;
        }

        skipSpacesAndCommas() {
            while (this.nextIf('space', 'comma'));
            return this;
        }
    }

    const MAX_URL_LENGTH = 2048;

    const buildURLValue = (lexer, scope, source, urlString, allowedProtocols) => {
        if (urlString.length > MAX_URL_LENGTH) lexer.fail(`URL exceeds maximum length of ${MAX_URL_LENGTH} characters.`);

        const url = URL.parse(urlString);
        if (url === null) lexer.fail(`Invalid URL "${urlString}"`);
        if (!allowedProtocols.includes(url.protocol))
            lexer.fail(`Invalid protocol "${url.protocol}" in URL "${urlString}". Only ${allowedProtocols.join(', ')} are allowed.`);

        return new ActURL(scope, source, { value: url });
    };

    class Parser {
        static VALUES = {
            word: [Word],
            number: [ActNumber, text => parseFloat(text)],
            cssProp: [CSSProperty, text => text.slice(1)],
            dimension: [Dimension],
            attribute: [Attribute, text => text.slice(1)],
            variable: [Variable, text => text.slice(1)],
            id: [Id],
            property: [Property, text => text.slice(1)],
            tag: [Tag, text => text.slice(1, -1)],
        };

        static ESCAPE_CHARS = {
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

        isPrefix(word) {
            return is(word, Word) && Object.hasOwn(Library.prefixes, word.value);
        }

        parse() {
            const root = new Scope(null, this.source, { tokenStart: this.lexer.peek() });

            while (this.lexer.hasMoreTokens()) {
                const sentence = this.parseSentence(root);
                if (sentence) root.value.push(sentence);
                this.lexer.expect('sentence_end', 'rparen', 'end', 'space').next();
            }

            root.tokenEnd = this.lexer.peek();
            if (Act.config.parserDebug) console.warn('Parser.parse() finished\n', root, this.source);
            return root;
        }

        parseSentence(scope) {
            this.lexer.skipSpaces();
            if (this.lexer.tokenIsEnd()) return;

            const sentence = new Sentence(scope, this.source);
            sentence.tokenStart = this.lexer.peek();

            let target, value = this.parseExpression(scope);

            const anotherValueFollows = this.lexer.nextIf('space') && this.lexer.skipSpaces().tokenIsValue();
            if (anotherValueFollows) {
                target = value;
                value = this.parseExpression(scope);
            }

            sentence.target = target;
            sentence.value = value;
            this.lexer.skipSpaces();

            if (target !== undefined && !this.lexer.tokenIsEnd()) {
                this.lexer.fail(`Unexpected ${this.lexer.peek().type} '${this.lexer.peek().value}'. Expected a sentence end token (${Object.keys(Lexer.SENTENCE_END).join(', ')}), or did you mean '${target.tokenStart.value}: ...'?`);
            }

            sentence.mode = Lexer.SENTENCE_END[this.lexer.peek().value] || Sentence.MODE.SYNC;
            sentence.tokenEnd = this.lexer.peek();

            return sentence;
        }

        parseExpression(scope, skip = []) {
            let left;
            this.lexer.skipSpaces();

            if (this.lexer.tokenIsValue()) {
                left = this.parseValue(scope);
            } else if (!this.lexer.tokenIs('insert')) {
                this.lexer.fail(`Unexpected token ${this.lexer.peek().type} "${this.lexer.peek().value}" while parsing an expression. A value token or an insert token were expected.`);
            }

            if (this.lexer.tokenIs(...skip)) return left;

            if (this.isPrefix(left)) left = this.parsePrefixedValue(scope, left);
            else if (this.isKeyword(left)) left = this.parseKeywordExpression(scope, left);
            if (this.lexer.tokenIsEnd() && !this.lexer.tokenIs('rparen', 'end')) return left;

            while (!this.lexer.tokenIsEnd() && this.lexer.hasMoreTokens()) {
                if (this.lexer.tokenIsExpression()) {
                    left = this[Lexer.EXPRESSIONS[this.lexer.peek().type]](scope, left, [...skip, 'insert']);
                } else if (this.lexer.tokenIsOperator()) {
                    left = this.parseOperator(scope, left, [...skip, 'insert']);
                } else {
                    break;
                }
            }

            return left;
        }

        parseOperator(scope, left, skip = []) {
            const operation = new Operators[
                Lexer.OPERATORS[this.lexer.peek().value.trim()]
            ](scope, this.source, { tokenStart: left.tokenStart });

            operation.left = left;
            this.lexer.consume();
            operation.right = this.parseExpression(scope, ['operator', ...skip]);
            operation.tokenEnd = this.lexer.previous();
            return operation;
        }

        #newExpressionWithList(ExpressionClass, scope, left) {
            const expression = new ExpressionClass(scope, this.source, { tokenStart: left.tokenStart });
            expression.left = left;
            expression.right = new List;
            return expression;
        }

        #parseArguments(ExpressionClass, scope, left, skip, { done, separator = 'skipSpaces', stopOnOperator = false, endAtPrevious = false }) {
            const expression = this.#newExpressionWithList(ExpressionClass, scope, left);

            while (!done() && this.lexer.hasMoreTokens()) {
                if (this.lexer.tokenIs(...skip)) break;
                if (stopOnOperator && this.lexer.tokenIsOperator()) break;
                expression.right.push(this.parseExpression(scope, skip));
                this.lexer[separator]();
            }

            expression.tokenEnd = endAtPrevious ? this.lexer.previous() : this.lexer.peek();
            return expression;
        }

        parseKeywordExpression(scope, left) {
            this.lexer.skipSpaces();
            return this.#parseArguments(KeywordExpression, scope, left, [], {
                done: () => this.lexer.nextIf('comma') || this.lexer.tokenIsEnd(),
                stopOnOperator: true,
            });
        }

        parseAtExpression(scope, left) {
            this.lexer.expect('dot', 'safedot');
            const expression = this.#newExpressionWithList(AtExpression, scope, left);
            expression.safe = this.lexer.tokenIs('safedot');

            while (this.lexer.nextIf('dot', ...(expression.safe ? ['safedot'] : [])) && this.lexer.hasMoreTokens()) {
                this.lexer.expect('word', 'attribute', 'cssProp', 'variable', 'lparen');
                expression.right.push(this.parseValue(scope));
            }

            expression.tokenEnd = this.lexer.previous();
            return expression;
        }

        parseSubscriptExpression(scope, left) {
            this.lexer.expect('lbrace');
            const expression = this.#newExpressionWithList(SubscriptExpression, scope, left);

            while (this.lexer.nextIf('lbrace') && this.lexer.hasMoreTokens()) {
                this.lexer.skipSpaces().expectValue();
                expression.right.push(this.parseExpression(scope, ['rbrace']));
                this.lexer.skipSpaces().nextIf('rbrace');
            }

            expression.tokenEnd = this.lexer.peek();
            return expression;
        }

        parseCallExpressionEmpty(scope, left) {
            this.lexer.expect('bang').next();
            const expression = this.#newExpressionWithList(CallExpression, scope, left);
            expression.tokenEnd = this.lexer.peek();
            return expression;
        }

        parseInsertExpression(scope, left, skip = []) {
            this.lexer.expect('insert').next().skipSpaces();
            const expression = new InsertExpression(scope, this.source);

            if (left === undefined) {
                expression.tokenStart = this.lexer.previous();
            } else {
                expression.tokenStart = left.tokenStart;
                expression.left = left;
            }

            expression.right = this.parseExpression(scope, skip);
            expression.tokenEnd = this.lexer.peek();
            return expression;
        }

        parseCallExpression(scope, left, skip = []) {
            this.lexer.expect('call').consume();
            return this.#parseArguments(CallExpression, scope, left, skip, {
                done: () => this.lexer.tokenIs('comma') || this.lexer.tokenIsEnd(),
            });
        }

        parseCallExpressionParens(scope, left, skip = []) {
            this.lexer.expect('lparen').consume();
            return this.#parseArguments(CallExpression, scope, left, skip, {
                done: () => this.lexer.nextIf('rparen'),
                separator: 'skipSpacesAndCommas',
                endAtPrevious: true,
            });
        }

        parseActExpression(scope, left, skip = []) {
            this.lexer.expect('colon').consume();
            return this.#parseArguments(ActExpression, scope, left, skip, {
                done: () => this.lexer.nextIf('comma') || this.lexer.tokenIsEnd(),
            });
        }

        parseValue(scope) {
            this.lexer.expectValue();
            const tokenStart = this.lexer.peek();

            const value = this[Lexer.VALUES[this.lexer.peek().type]](scope);
            value.tokenStart = tokenStart;
            value.tokenEnd = this.lexer.peek();
            if (!is(value, List, Spread)) this.lexer.next();

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
                if (this.lexer.tokenIsEnd() && !this.lexer.tokenIs(endToken)) this.lexer.next().skipSpaces();
            }

            scope.tokenEnd = this.lexer.peek();
            return scope;
        }

        parseCollection(scope) {
            this.lexer.expect('lbrace').consume();

            if (this.lexer.tokenIs('rbrace')) {
                return new ActArray(scope, this.source, { value: [] });
            }

            if (this.lexer.tokenIs('colon')) {
                this.lexer.next().skipSpaces().expect('rbrace');
                return new ActObject(scope, this.source, { value: new Map });
            }

            const first = this.parseExpression(scope, ['colon']);
            this.lexer.skipSpaces();

            if (this.lexer.nextIf('comma') || this.lexer.tokenIsValue() || this.lexer.tokenIs('rbrace')) {
                this.lexer.skipSpaces();
                return new ActArray(scope, this.source, { value: this.parseArray(scope, first) });
            } else if (this.lexer.nextIf('colon')) {
                this.lexer.skipSpaces();
                const objectScope = new Scope(scope, this.source);
                return new ActObject(objectScope, this.source, { value: this.parseObject(objectScope, first) });
            }

            this.lexer.fail(`Unexpected token ${this.lexer.peek().type} "${this.lexer.peek().value}" while parsing a collection. Only colon, comma, rbrace and value tokens where expected.`);
        }

        parseArray(scope, firstValue) {
            const array = [firstValue];
            this.lexer.skipSpaces();

            while (!this.lexer.tokenIs('rbrace') && this.lexer.hasMoreTokens()) {
                array.push(this.parseExpression(scope, ['colon']));
                this.lexer.skipSpacesAndCommas();
            }

            this.lexer.expect('rbrace');
            return array;
        }

        parseObject(scope, firstKey) {
            const map = new Map;
            map.set(firstKey, this.parseExpression(scope, ['colon']));
            this.lexer.skipSpacesAndCommas();

            while (!this.lexer.tokenIs('rbrace') && this.lexer.hasMoreTokens()) {
                const key = this.parseExpression(scope, ['colon']);
                this.lexer.skipSpaces().expect('colon').consume();
                map.set(key, this.parseExpression(scope, ['colon']));
                this.lexer.skipSpacesAndCommas();
            }

            this.lexer.expect('rbrace');
            return map;
        }

        parseString(scope) {
            this.lexer.expect('string');
            const raw = this.lexer.peek().value.slice(1, -1);
            return new ActString(scope, this.source, {
                value: raw.replace(/\\(.)/g, (_, character) => Parser.ESCAPE_CHARS[character] || character),
            });
        }

        parseFunction(scope) {
            this.lexer.expect('arrow').next().skipSpaces().expect('variable', 'list', 'lparen', 'do');
            const fn = { args: [] };

            while (this.lexer.tokenIs('variable') && this.lexer.hasMoreTokens()) {
                fn.args.push(this.lexer.peek().value.slice(1));
                this.lexer.next().skipSpaces();
            }

            if (this.lexer.nextIf('list')) {
                this.lexer.expect('variable');
                fn.args.push([this.lexer.peek().value.slice(1)]);
                this.lexer.next().skipSpaces();
            }

            fn.scope = this.parseScope(scope);
            return new ActFunction(scope, this.source, { value: fn });
        }

        #appendText(literals, text) {
            literals[literals.length - 1] += text;
        }

        parseTemplate(scope, endChar) {
            const literals = [''];
            const subscope = new Scope(scope, this.source);

            for (;;) {
                this.#appendText(literals, this.lexer.scanRaw(['{', '\\', endChar]));

                const character = this.lexer.peekChar();
                if (character === undefined) {
                    this.lexer.fail(`Unclosed template, expected '${endChar}'.`);
                } else if (character === endChar) {
                    this.lexer.next();
                    break;
                } else if (character === '\\') {
                    this.lexer.consumeChar();
                    const escaped = this.lexer.consumeChar() ?? '';
                    this.#appendText(literals, Parser.ESCAPE_CHARS[escaped] || escaped);
                } else {
                    this.lexer.consumeChar();
                    this.lexer.next();
                    while (!this.lexer.tokenIs('rcurly') && this.lexer.hasMoreTokens()) {
                        const sentence = this.parseSentence(subscope);
                        if (sentence) {
                            subscope.value.push(sentence);
                            literals.push('');
                        }
                        if (this.lexer.tokenIsEnd() && !this.lexer.tokenIs('rcurly')) this.lexer.next().skipSpaces();
                    }
                }
            }

            return { literals, scope: (subscope.value.length > 0 ? subscope : null) };
        }

        parseTemplateValue(scope, endChar = '`') {
            return new Template(scope, this.source, { value: this.parseTemplate(scope, endChar) });
        }

        parseSelectorTemplate(scope) {
            return new SelectorTemplate(scope, this.source, { value: this.parseTemplateValue(scope, '}') });
        }

        parseSimpleValue(scope) {
            const type = this.lexer.peek().type;
            const [ValueClass, transform = text => text] = Parser.VALUES[type];
            this.lexer.expect(type);
            return new ValueClass(scope, this.source, { value: transform(this.lexer.peek().value) });
        }

        parseClass(scope) {
            this.lexer.expect('dot').next().expect('word');
            return new ActClass(scope, this.source, { value: '.' + this.lexer.peek().value });
        }

        parsePath(scope) {
            this.lexer.expect('path');
            return buildURLValue(this.lexer, scope, this.source, window.location.origin + this.lexer.peek().value, ['http:', 'https:']);
        }

        parseUrl(scope) {
            this.lexer.expect('url');
            return buildURLValue(this.lexer, scope, this.source, this.lexer.peek().value, ['http:', 'https:', 'ws:', 'wss:', 'file:']);
        }

        parseList(scope) {
            this.lexer.expect('list').next();
            return new Spread(scope, this.source, { value: this.parseExpression(scope) });
        }

        parsePrefixedValue(scope, left) {
            this.lexer.skipSpaces().expectValue();
            return new PrefixExpression(scope, this.source, { left: left.value, right: this.parseValue(scope) });
        }

        parseNegativePrefix(scope) {
            this.lexer.next().skipSpaces().expectValue();
            return new PrefixExpression(scope, this.source, { left: 'negative', right: this[Lexer.VALUES[this.lexer.peek().type]](scope) });
        }
    }

    class Source {
        static TYPE = {
            ATTRIBUTE: 'directAttribute',
            INLINE_SCRIPT: 'inlineScript',
            EXTERNAL_SCRIPT: 'externalScript',
            ACT_RUN: 'actrun',
        };

        args = [];
        attr;
        #code;
        scope;
        type;

        get code() {
            if (this.#code !== null) return this.#code;
            if (this.type === Source.TYPE.ATTRIBUTE) return this.attr.value;
            if (this.type === Source.TYPE.INLINE_SCRIPT) return this.attr.ownerElement.innerHTML;
        }

        get element() {
            if (this.type === Source.TYPE.ACT_RUN) return document.body;
            if (this.type === Source.TYPE.ATTRIBUTE) return this.attr.ownerElement;
            return this.attr.ownerElement.parentNode;
        }

        constructor(attr, type, code = null, scope = null) {
            this.attr = attr;
            this.type = type;
            this.#code = code;

            if (is(scope, Scope)) {
                this.scope = scope;
                return;
            }

            try {
                this.scope = new Parser(this).parse();
            } catch (error) {
                this.scope = null;

                if (!is(error, ActSyntaxError) || !error.token) {
                    console.error('💣 act: unexpected error while parsing', this, 'for element', this.element, '\n', error);
                    return;
                }

                this.#reportSyntaxError(error);
            }
        }

        #reportSyntaxError(error) {
            const codeLines = this.code.split('\n');
            const line = codeLines[Math.max(0, error.token.line - 1)];

            const logArgs = [
                '%c💣 act Syntax Error', 'font-weight: bold; font-size: 1.1em;', '\n',
                'while parsing Source', this, '\n',
                'for element', this.element, '\n',
            ];

            if (this.attr) logArgs.push(`in attribute "${this.attr.name}" of element`, this.attr.ownerElement, '\n');
            logArgs.push(error.message, '\n\n');

            if ((error.token.line - 1) > 1) logArgs.push(codeLines[error.token.line - 2], '\n');
            logArgs.push(
                line.substring(0, error.token.column - error.token.value.length) +
                '⚠️➡️' + line.substring(error.token.column - error.token.value.length, error.token.column) +
                '⬅️⚠️' + line.substring(error.token.column) +
                '\n'
            );
            if (codeLines.length - (error.token.line) > 1) logArgs.push(codeLines[error.token.line], '\n');

            console.error(...logArgs);
        }
    }

    const Binder = {
        BINDING_PROPERTY: '__act__',
        ATTRIBUTES: ['act', 'act-block'],

        EVENT_OPTIONS: [
            'once',
            'prevent',
            'stop',
            'only',
            'target',
        ],

        PART_SIGILS: {
            ':': 'option',
            '.': 'key',
            '#': 'alias',
        },

        INTERSECT_EVENTS: {
            inview: 'actinview',
            offview: 'actoffview',
            actinview: 'actinview',
            actoffview: 'actoffview',
        },

        from(element) {
            return element[Binder.BINDING_PROPERTY];
        },

        ensure(element) {
            return Binder.from(element) ?? new Binding(element);
        },

        eventName(name) {
            return Object.hasOwn(Binder.INTERSECT_EVENTS, name) ? Binder.INTERSECT_EVENTS[name] : name;
        },

        bind(element) {
            if (is(element, HTMLScriptElement) && element.attributes.type?.value === 'text/act') {
                return this.bindScript(element);
            }

            const binding = this.ensure(element);
            this.bindAttributes(element, binding);
            element.dispatchEvent(new CustomEvent('actbind', { bubbles: true, detail: { element, binding } }));
        },

        bindScript(element) {
            const target = element.parentNode;
            const binding = this.ensure(target);

            if (element.hasAttribute('src')) {
                return (async () => {
                    const code = await fetch(
                        element.src, { method: 'GET', headers: { 'Content-Type': 'text/plain' } }
                    ).then(response => response.text());

                    const source = new Source(element.attributes.src, Source.TYPE.EXTERNAL_SCRIPT, code);
                    if (Act.isStartingUp) target.dispatchEvent(new CustomEvent('actscriptloaded', { bubbles: true, detail: { element, target, binding } }));
                    binding.addEvent('act', source);
                })();
            }

            const hasEventAttribute = Array.from(element.attributes)
                .some(attr => attr.name === 'act' || attr.name.startsWith('act@'));
            if (!element.hasAttribute('act-block') && !hasEventAttribute) {
                element.setAttribute('act', '');
            }

            this.bindAttributes(element, binding, Source.TYPE.INLINE_SCRIPT);
        },

        bindAttributes(element, binding, type = Source.TYPE.ATTRIBUTE) {
            for (const attr of element.attributes) {
                if (!this.ATTRIBUTES.includes(attr.name) && !attr.name.startsWith('act@')) continue;
                this.bindSource(binding, new Source(attr, type));
            }
        },

        bindSource(binding, source) {
            if (source.attr.name === 'act-block') return this.bindBlock(binding, source);
            this.bindEvents(binding, source);
        },

        bindBlock(binding, source) {
            const [blockName, ...args] = source.attr.value.replaceAll('$', '').split(' ');
            source.args = args;
            binding.blocks[blockName] = source;
        },

        readName(spec, fromIndex) {
            if (spec[fromIndex] !== '[') {
                let to = fromIndex;
                while (to < spec.length && !Object.hasOwn(this.PART_SIGILS, spec[to]) && spec[to] !== '[') to++;
                return { value: spec.slice(fromIndex, to), next: to };
            }

            const close = spec.indexOf(']', fromIndex);
            return close === -1 ? null : { value: spec.slice(fromIndex + 1, close), next: close + 1 };
        },

        parseEventSpec(spec) {
            const options = {}, keyModifiers = [];
            let alias = null;
            const event = this.readName(spec, 0);

            if (!event) return { error: `Unclosed "[" in "act@${spec}".` };
            if (!event.value) return { error: `Missing event name in "act@${spec}".` };

            let at = event.next;
            while (at < spec.length) {
                const part = this.PART_SIGILS[spec[at]];
                if (!part) return { error: `Unexpected "${spec[at]}" in "act@${spec}". Expected ":", "." or "#".` };

                const name = this.readName(spec, at + 1);
                if (!name) return { error: `Unclosed "[" in "act@${spec}".` };
                if (!name.value) return { error: `Empty ${part} after "${spec[at]}" in "act@${spec}".` };

                if (part === 'key') {
                    keyModifiers.push(name.value.toLowerCase());
                } else if (part === 'alias') {
                    alias = name.value;
                } else if (this.EVENT_OPTIONS.includes(name.value)) {
                    options[name.value] = true;
                } else {
                    return { error: `Unknown event option ":${name.value}" in "act@${spec}". If it is part of a name, wrap the name in brackets: act@[${event.value}:${name.value}]` };
                }

                at = name.next;
            }

            if (keyModifiers.length) options.modifiers = keyModifiers;
            return { event: event.value, alias, options };
        },

        bindEvents(binding, source) {
            for (const spec of source.attr.name.replace('act@', '').split(',')) {
                const { event, alias, options, error } = this.parseEventSpec(spec);

                if (error) {
                    console.error(
                        `💣 act: ${error}\nin attribute "${source.attr.name}" of element`,
                        source.attr.ownerElement,
                    );
                    continue;
                }

                binding.addEvent(event, source, options, null, alias);
            }
        },

        scan(root, bindRoot = true, force = false) {
            if (this.from(root) && !force) return;
            if (bindRoot) this.bind(root);

            const xpath = new XPathEvaluator().createExpression(
                './/script[@type = "text/act"] | .//*[@act] | .//*[@*[starts-with(name(), "act@")]]',
            ).evaluate(root, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);

            const boundNodes = [];

            for (let i = 0; i < xpath.snapshotLength; i++) {
                const node = xpath.snapshotItem(i);
                if (!this.from(node) || force) {
                    this.bind(node);
                    boundNodes.push(node);
                }
            }

            return boundNodes;
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
            Object.defineProperty(element, Binder.BINDING_PROPERTY, { value: this, writable: true, configurable: true });
        }

        #observeIntersections(eventName, options, eventManager = null) {
            const observerOptions = {}, element = this.element, matchingSelector = options.matchingSelector;

            if (options.threshold) observerOptions.threshold = options.threshold;
            if (is(options.root, Element)) observerOptions.root = options.root;
            observerOptions.rootMargin = (options?.rootMargin?.toString() || options?.root_margin?.toString());

            const observed = matchingSelector ? Array.from(element.querySelectorAll(matchingSelector)) : [element];
            const intersectionObserver = new IntersectionObserver(function (entries) {
                for (const entry of entries) if (entry.isIntersecting === (eventName === Binder.INTERSECT_EVENTS.inview)) {
                    if (options.once) this.disconnect();

                    const event = new CustomEvent(eventName, { detail: { entry, matchedElement: entry.target } });
                    element.dispatchEvent(event);
                    if (matchingSelector && eventManager) eventManager.run(entry.target, event);

                    if (options.once) break;
                }
            }, observerOptions);

            for (const el of observed) intersectionObserver.observe(el);

            let mutationObserver = null;
            if (matchingSelector) {
                mutationObserver = new MutationObserver((mutations) => {
                    for (const mutation of mutations) {
                        for (const node of mutation.addedNodes) {
                            if (node.nodeType !== Node.ELEMENT_NODE) continue;
                            if (node.matches(matchingSelector)) intersectionObserver.observe(node);
                            if (node.querySelectorAll) for (const el of node.querySelectorAll(matchingSelector)) intersectionObserver.observe(el);
                        }
                    }
                });
                mutationObserver.observe(element, { childList: true, subtree: true });
            }

            return { intersectionObserver, mutationObserver };
        }

        addEvent(eventName, source, options = {}, eventManager = null, eventAlias = null) {
            if (eventAlias === null) eventAlias = eventName;
            const isIntersectionEvent = Object.hasOwn(Binder.INTERSECT_EVENTS, eventName);

            if (isIntersectionEvent) {
                eventName = Binder.INTERSECT_EVENTS[eventName];
                if (!eventManager) eventManager = new EventManager(this, eventName, options, source, source.scope);
                eventManager.observer = this.#observeIntersections(eventName, options, eventManager);

                const dispatchedByTheObserverItself = Boolean(options.matchingSelector);
                if (dispatchedByTheObserverItself) {
                    this.events[eventAlias] = eventManager;
                    return;
                }
            }

            if (!eventManager) eventManager = new EventManager(this, eventName, options, source, source.scope);
            this.events[eventAlias] = eventManager;
            this.element.addEventListener(eventName, eventManager.listener, options);

            if ((eventName === 'act' || eventName === 'load') && Act.isStartingUp) {
                this.element.dispatchEvent(new Event(eventName, { bubbles: false }));
            }
        }

        parent() {
            let node = this.element;
            while (node = node.parentNode) {
                const binding = Binder.from(node);
                if (binding) return binding;
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
                if (Object.hasOwn(binding.data, key)) return new Result(binding.data[key], binding, { parent: binding.data, key });
                binding = binding.parent();
            }
        }
    }

    class Context {
        binding;
        data;
        event;
        eventManager;
        source;
        abortSignal;
        abortPromise;
        abortController;
        finishing = false;

        #ignoreUnhandledRejection(promise) {
            promise.catch(() => { });
            return promise;
        }

        constructor(defaultTarget, binding, event, eventManager, source, abortSignal) {
            this.target = defaultTarget;
            this.binding = binding;
            this.event = event;
            this.eventManager = eventManager;
            this.source = source;
            this.data = new WeakMap;
            this.abortSignal = abortSignal;

            this.abortPromise = new Promise((_, reject) =>
                abortSignal.addEventListener('abort', () => reject(new Signal.Halt))
            );
            this.#ignoreUnhandledRejection(this.abortPromise);
        }

        async solve(value, target, opts) {
            if (this.abortSignal.aborted) throw new Signal.Halt;
            if (!is(value, Solvable, List)) return value;
            return await this.#raceAgainstKill(value.solve(this, target, opts));
        }

        #raceAgainstKill(work) {
            return Promise.race([work, this.abortPromise]);
        }

        async solveAll(values, target, opts) {
            if (is(values, List)) return await values.solve(this, target, opts);

            const results = [];
            for (const value of values) {
                if (is(value, Spread)) {
                    results.push(...await this.solve(value, target, opts));
                } else {
                    results.push(await this.solve(value, target, opts));
                }
            }
            return results;
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
            return new Context(this.target, this.binding, this.event, this.eventManager, this.source, this.abortSignal);
        }
    }

    class EventManager {
        static LIFECYCLE_EVENTS = ['actstart', 'actend', 'acterror'];
        static META_MODIFIER_KEYS = ['shift', 'ctrl', 'alt', 'meta'];

        binding;
        name;
        options;
        source;
        scope;

        lock = false;
        contexts = new Set;

        constructor(binding, name, options, source, scope) {
            this.binding = binding;
            this.name = name;
            this.options = options;
            this.scope = scope;
            this.source = source;

            this.listener = (event) => {
                if (this.options.modifiers && !this.#modifiersMatch(event, this.options.modifiers)) return;
                if (this.options.prevent) event.preventDefault();
                if (this.options.stop) event.stopPropagation();
                if (this.options.only) event.stopImmediatePropagation();
                return this.run(this.options.target ? event.target : this.binding.element, event);
            };
        }

        #modifiersMatch(event, modifiers) {
            const isMetaKeyRequired = (metaKey) => modifiers.includes(metaKey) || (metaKey === 'ctrl' && modifiers.includes('control'));
            const isMetaKeyHeld = (metaKey) => event[metaKey + 'Key'];
            const everyRequiredMetaKeyHeld = EventManager.META_MODIFIER_KEYS.every(
                metaKey => !isMetaKeyRequired(metaKey) || isMetaKeyHeld(metaKey)
            );

            if (!everyRequiredMetaKeyHeld) return false;

            const pressedKey = event.key?.toLowerCase();
            const requiredLiteralKeys = modifiers.filter(
                modifier => !EventManager.META_MODIFIER_KEYS.includes(modifier) && modifier !== 'control'
            );

            return requiredLiteralKeys.length === 0 || requiredLiteralKeys.includes(pressedKey);
        }

        #dispatchLifecycle(target, name, event, detail = {}) {
            if (EventManager.LIFECYCLE_EVENTS.includes(this.name)) return;
            target.dispatchEvent(new CustomEvent(name, {
                bubbles: true,
                detail: { event, source: this.source, eventManager: this, ...detail },
            }));
        }

        async run(target, event = null) {
            if (this.lock) return;

            const abortController = new AbortController();
            const context = new Context(target, this.binding, event, this, this.source, abortController.signal);
            context.abortController = abortController;
            this.contexts.add(context);

            this.#dispatchLifecycle(target, 'actstart', event);

            try {
                context.scopeData(this.scope).event = event;
                return await context.solve(this.scope, target, {});
            } catch (error) {
                if (is(error, Signal.Halt, Signal.Stop)) return error.data;
                if (is(error, ActRuntimeError) && error.actTrace?.length) this.#reportRuntimeError(error);
                this.#dispatchLifecycle(target, 'acterror', event, { error });
            } finally {
                this.contexts.delete(context);
                this.#dispatchLifecycle(target, 'actend', event);
            }
        }

        #reportRuntimeError(error) {
            const expression = error.expression;
            const originalError = error.actException ?? error;
            const initialTrace = error.actTrace[0];

            console.error('%c💣 act Runtime Error', 'font-weight: bold; font-size: 1.2em;');
            console.group(`%c${originalError.constructor.name}%c${originalError.message ? ': ' + originalError.message : ''}`,
                'background: rgba(255, 0, 0, 0.1); font-weight: bold; padding: 2px 4px;',
                'background: rgba(255, 0, 0, 0.1); padding: 2px 4px;'
            );

            console.log(
                'At line', expression.tokenStart.line, 'Column', expression.tokenStart.column,
                `\nOn event: '${initialTrace.context.event?.type ?? 'unknown'}'`, initialTrace.context.event,
                '\nFrom event manager:', initialTrace.context.eventManager,
                `\nSource: ${initialTrace.sentence.source.type}`, initialTrace.sentence.source,
                '\nElement binding:', initialTrace.context.binding.element,
            );

            console.group('Stack trace');
            for (const entry of error.actTrace) {
                const sentence = entry.sentence;
                const codeLines = sentence.code.split('\n'), firstLine = codeLines[0], hasMoreLines = codeLines.length > 1;

                const beforeError = firstLine.substring(0, expression.tokenStart.index - sentence.tokenStart.index);
                const errorPart = firstLine.substring(expression.tokenStart.index - sentence.tokenStart.index, expression.tokenEnd.indexEnd - sentence.tokenStart.index);
                const afterError = firstLine.substring(expression.tokenEnd.indexEnd - sentence.tokenStart.index);

                if (expression && errorPart) {
                    console.groupCollapsed(
                        `%cLine ${sentence.tokenStart.line}:\n%c ${beforeError}%c${errorPart}%c${afterError}${hasMoreLines ? '%c ...' : ''}`,
                        'color: gray;', '', 'background: rgba(255, 0, 0, 0.2); font-weight: bold; padding: 1px 4px; border-radius: 4px; border: 1px solid rgba(255, 0, 0, 0.3);', '',
                        ...(hasMoreLines ? ['color: gray; font-style: italic;'] : []),
                    );
                } else {
                    console.groupCollapsed(
                        `%cLine ${sentence.tokenStart.line}:\n%c ${firstLine.trim()}${hasMoreLines ? '%c ...' : ''}`,
                        'color: gray;', '',
                        ...(hasMoreLines ? ['color: gray; font-style: italic;'] : []),
                    );
                }

                console.log(
                    'Sentence details:\n',
                    '\nTarget:\n', sentence.target,
                    '\nComputed sentence target:\n', entry.sentenceTarget,
                    '\nSource:\n', sentence.source,
                    '\nSentence object:\n', sentence,
                    '\nFull code:\n\n' + sentence.code,
                );
                console.groupEnd();
            }
            console.groupEnd();

            console.groupCollapsed('Full trace data');
            console.log(error.actTrace);
            console.groupEnd();

            console.groupCollapsed('JavaScript Exception');
            console.error(error.actException);
            console.groupEnd();

            console.groupEnd();
        }
    }

    const Library = {
        method(fn) {
            fn[ACT_FUNCTION] = true;
            return fn;
        },

        get(name, target) {
            const primitiveTypeMethods = this[typeof target];

            if (is(target, Element) && Object.hasOwn(this.Element, name)) return this.Element[name];
            if (Array.isArray(target) && Object.hasOwn(this.Array, name)) return this.Array[name];
            if (Object.hasOwn(primitiveTypeMethods, name)) return primitiveTypeMethods[name];
            if (Object.hasOwn(this.globals, name)) return this.globals[name];
        },

        async exec(fn, args, target, context, opts) {
            if (is(fn, Result)) return await this.exec(fn.value, args, fn.parent, fn.context || context, opts);
            if (isActFunction(fn)) return await fn(context, target, opts, ...args);
            if (is(fn, Function)) return await resolveAbortable(context, fn.call(target, ...await context.solveAll(args, target)));
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
        async first(ctx, target, opts, value) {
            return (await ctx.asValueOf(value, target, opts))[0];
        },

        async last(ctx, target, opts, value) {
            const collection = await ctx.asValueOf(value, target, opts);
            return collection[collection.length - 1];
        },

        global(ctx, target, opts, value) {
            return new Result(Act.globals[value.value], this, { parent: Act.globals, key: value.value });
        },

        local(ctx, target, opts, value) {
            const data = Binder.ensure(target).data;
            return new Result(data[value.value], this, { parent: data, key: value.value });
        },

        scoped(ctx, target, opts, value) {
            const data = ctx.scopeData(this.scope);
            return new Result(data[value.value], this, { parent: data, key: value.value });
        },

        async not(ctx, target, opts, value) {
            return !(await ctx.asValueOf(value, target));
        },

        async negative(ctx, target, opts, value) {
            return -(await ctx.asValueOf(value, target));
        },

        async type(ctx, target, opts, value) {
            const solved = await ctx.solve(value, target, opts);
            return from(solved)?.constructor.name || typeof unwrap(solved);
        },

        async wat(ctx, target, opts, value) {
            const result = await ctx.solve(value, target, opts);
            console.log(
                '🤷 Act WAT?\n',
                'Value:', value, '\n',
                'Result:', result, '\n',
                'Unwrapped Result:', unwrap(result), '\n',
                'Target:', target, '\n',
                'Scope:', this.scope, '\n',
                'Context:', ctx, '\n',
                'Code:', value.code, '\n'
            );

            return result;
        },
    };

    const findEventManager = async (ctx, target, name) => {
        const binding = Binder.from(target);
        return binding ? binding.events[Binder.eventName(await ctx.asString(name, target))] : null;
    };

    Library.keywords = {
        async case(ctx, target, opts, [value, ...args]) {
            const testValue = await ctx.asValueOf(value, target, opts);

            for (let i = 0; i < args.length; i++) {
                const clause = args[i];
                if (!is(clause, Word)) return;

                if (clause.value === 'when') {
                    const matchValue = await ctx.asValueOf(args[++i], target, opts);
                    const branch = args[++i];
                    if (testValue === matchValue) return await ctx.solve(branch, target, opts);
                } else if (clause.value === 'like') {
                    const matchValue = await ctx.asValueOf(args[++i], target, opts);
                    const branch = args[++i];
                    if (looselyEquals(testValue, matchValue)) return await ctx.solve(branch, target, opts);
                } else if (clause.value === 'else') {
                    return await ctx.solve(args[++i], target, opts);
                }
            }
        },

        async run(ctx, target, opts, [name, ...args]) {
            name = await ctx.asString(name, target);

            let fromElement = null;
            if (args[0]?.toString() === 'from') {
                fromElement = unwrap(await ctx.solve(args[1], target, opts));
                if (!is(fromElement, Element) && is(fromElement?.[0], Element)) fromElement = fromElement[0];
                if (!is(fromElement, Element)) throw new ActError(`'from' element for block '${name}' not found.`);
                args = args.slice(2);
            }

            const block = fromElement
                ? Binder.ensure(fromElement).getBlock(name)
                : ctx.binding.getBlock(name) ?? (is(target, Element) ? Binder.ensure(target).getBlock(name) : undefined);
            if (!block) throw new ActError(`Block '${name}' not found.`);

            const data = ctx.scopeData(block.scope);
            data.__callerScope__ = this.scope;

            const solvedArgs = await ctx.solveAll(args, target, opts);
            for (let i = 0; i < block.args.length; i++) {
                const parameter = block.args[i];
                if (Array.isArray(parameter)) {
                    data[parameter[0]] = solvedArgs.slice(i);
                    break;
                }

                data[parameter] = solvedArgs[i];
            }

            return await ctx.solve(block.scope, target, opts);
        },

        async def(ctx, target, opts, args) {
            const name = await ctx.asString(args[0], target, opts);
            const body = args[args.length - 1];
            const parameters = args.slice(1, -1).map(arg => is(arg, List) ? [arg.value[0].value] : arg.value);

            Binder.ensure(target).blocks[name] = { args: parameters, scope: body };
        },

        async each(ctx, target, opts, args) {
            let iterable = target, body = args[0], valueName, keyName;

            if (is(args[1], Word) && args[1].value === 'in') {
                valueName = args[0].value;
                iterable = await ctx.asValueOf(args[2], target);
                body = args[3];
            } else if (is(args[2], Word) && args[2].value === 'in') {
                keyName = args[0].value;
                valueName = args[1].value;
                iterable = await ctx.asValueOf(args[3], target);
                body = args[4];
            }

            const entries = keyName ? Object.entries(iterable) : iterable;

            for (const entry of entries) {
                if (keyName) {
                    ctx.scopeData(body)[keyName] = entry[0];
                    ctx.scopeData(body)[valueName] = entry[1];
                } else if (valueName) {
                    ctx.scopeData(body)[valueName] = new Result(entry, this);
                }

                try {
                    await ctx.solve(body, keyName ? iterable : (valueName ? target : entry), opts);
                } catch (error) {
                    if (is(error, Signal.Break)) return error.data;
                    if (is(error, Signal.Continue)) continue;
                    throw error;
                }
            }
        },

        async for(ctx, target, opts, args) {
            const name = args[0].value;
            let position = 1, start = 0;

            if (args[position]?.value === 'from') {
                start = await ctx.asValueOf(args[2], target);
                position += 2;
            }

            if (args[position].value !== 'to') throw new ActError('Invalid for loop syntax: missing "to" word.');

            const end = await ctx.asValueOf(args[position + 1], target);
            position += 2;

            let step = 1, stepDefined = false;
            if (args[position]?.value === 'step') {
                step = await ctx.asValueOf(args[position + 1], target);
                stepDefined = true;
            }

            const body = args.at(-1), ascending = (start <= end);
            if (!stepDefined) step = ascending ? 1 : -1;

            for (let i = start; ascending ? i <= end : i >= end; i += step) {
                try {
                    ctx.scopeData(body)[name] = i;
                    await ctx.solve(body, target);
                } catch (error) {
                    if (is(error, Signal.Break)) return error.data;
                    if (is(error, Signal.Continue)) continue;
                    throw error;
                }
            }
        },

        async if(ctx, target, opts, [condition, thenBranch, elseWord, elseBranch]) {
            if (await ctx.asValueOf(condition, target)) return await ctx.solve(thenBranch, target, opts);
            if (await ctx.asString(elseWord, target) === 'else') return await ctx.solve(elseBranch, target, opts);
        },

        async loop(ctx, target, opts, [body]) {
            for (;;) {
                try {
                    await ctx.solve(body, target, opts);
                } catch (error) {
                    if (is(error, Signal.Break)) return error.data;
                    if (is(error, Signal.Continue)) continue;
                    throw error;
                }
            }
        },

        async new(ctx, target, opts, [constructor, ...args]) {
            if (is(constructor, Tag)) return document.createElement(constructor.value);

            const Constructor = await ctx.asValueOf(constructor, target);
            args = await ctx.solveAll(args, target, opts);

            try {
                return new Constructor(...args);
            } catch (error) {
                return new window[Constructor.toString()](...args);
            }
        },

        async on(ctx, target, opts, [eventNameOrAlias, ...args]) {
            target = await ctx.asValueOf(target);
            let eventName, alias;

            if (is(eventNameOrAlias, ActObject)) {
                const aliasObject = await ctx.asValueOf(eventNameOrAlias, target);
                alias = Object.keys(aliasObject)[0];
                eventName = Binder.eventName(aliasObject[alias].toString());
            } else {
                eventName = Binder.eventName(await ctx.asString(eventNameOrAlias, target));
            }

            let options = {}, matchingSelector = null;
            const body = args.at(-1);

            for (let i = 0; i < args.length - 1; i++) {
                const arg = args[i];
                if (is(arg, ActObject)) {
                    Object.assign(options, await ctx.asValueOf(arg, target));
                } else if (arg.toString() === 'matching') {
                    matchingSelector = await ctx.asString(args[++i], target);
                } else if (Binder.EVENT_OPTIONS.includes(arg.toString())) {
                    options[arg.toString()] = true;
                }
            }

            const binding = Binder.ensure(target);
            const eventManager = new EventManager(binding, eventName, options, body.source, body);
            const isIntersectEvent = Object.hasOwn(Binder.INTERSECT_EVENTS, eventName);

            if (matchingSelector) {
                if (isIntersectEvent) {
                    options.matchingSelector = matchingSelector;
                } else {
                    eventManager.listener = (event) => {
                        let element = event.target;
                        while (element && element !== target) {
                            if (element.matches(matchingSelector)) return eventManager.run(element, event);
                            element = element.parentElement;
                        }
                        if (target.matches(matchingSelector) && element === target) return eventManager.run(target, event);
                    };
                }
            }

            binding.addEvent(eventName, body.source, options, eventManager, alias);
            return true;
        },

        async off(ctx, target, opts, [eventName]) {
            target = await ctx.asValueOf(target);
            const binding = Binder.from(target);
            if (!binding) return false;

            eventName = Binder.eventName(await ctx.asString(eventName, target));
            const eventManager = binding.events[eventName];
            if (!eventManager) return false;

            eventManager.observer?.intersectionObserver?.disconnect();
            eventManager.observer?.mutationObserver?.disconnect();
            binding.element.removeEventListener(eventManager.name, eventManager.listener);
            delete binding.events[eventName];
            return true;
        },

        async kill(ctx, target, opts, [eventName]) {
            target = await ctx.asValueOf(target);
            if (!is(target, Element)) return false;

            const eventManager = await findEventManager(ctx, target, eventName);
            if (!eventManager || eventManager.contexts.size === 0) return false;

            for (const context of eventManager.contexts) context.abortController.abort();
            return true;
        },

        async finish(ctx, target, opts, [eventName]) {
            target = await ctx.asValueOf(target);
            if (!is(target, Element)) return false;

            const eventManager = await findEventManager(ctx, target, eventName);
            if (!eventManager || eventManager.contexts.size === 0) return false;

            for (const context of eventManager.contexts) context.finishing = true;
            return true;
        },

        async wait_until(ctx, target, opts, [eventName]) {
            const name = await ctx.asString(eventName, target);
            const element = unwrap(target);

            let listener;
            const promise = new Promise(resolve => {
                listener = event => resolve(event);
                element.addEventListener(name, listener, { once: true });
            });

            ctx.abortSignal.addEventListener('abort', () => element.removeEventListener(name, listener), { once: true });
            return promise;
        },

        async break(ctx, target, opts, [data]) {
            const signal = new Signal.Break;
            if (data !== undefined) signal.data = await ctx.solve(data, target, opts);
            throw signal;
        },

        async stop(ctx, target, opts, [data]) {
            const signal = new Signal.Stop;
            if (data !== undefined) signal.data = await ctx.solve(data, target, opts);
            throw signal;
        },

        async return(ctx, target, opts, [data]) {
            const signal = new Signal.Return;
            if (data !== undefined) signal.data = await ctx.solve(data, target, opts);
            throw signal;
        },

        repeat() { throw new Signal.Repeat; },
        restart() { throw new Signal.Restart; },
        continue() { throw new Signal.Continue; },
        halt() { throw new Signal.Halt; },

        async throw(ctx, target, opts, [error]) {
            if (is(error, Error)) throw error;
            throw new ActError(await ctx.asValueOf(error, target));
        },

        async while(ctx, target, opts, [condition, body]) {
            while (await ctx.asValueOf(condition, target)) {
                try {
                    await ctx.solve(body, target, opts);
                } catch (error) {
                    if (is(error, Signal.Break)) return error.data;
                    if (is(error, Signal.Continue)) continue;
                    throw error;
                }
            }
        },

        async with(ctx, target, opts, [object, body]) {
            const withTarget = await ctx.solve(object, target, opts);
            return await ctx.solve(body, unwrap(withTarget), opts);
        },

        async debounce(ctx, target, opts, [time, body]) {
            clearTimeout(body.__debounceTimeout__ || 0);
            body.__haltSupersededRun__?.();

            const ms = Library.globals.time_to_ms(await ctx.solve(time, target, opts));

            return new Promise((resolve, reject) => {
                body.__haltSupersededRun__ = () => reject(new Signal.Halt);
                body.__debounceTimeout__ = setTimeout(() => {
                    delete body.__haltSupersededRun__;
                    delete body.__debounceTimeout__;
                    ctx.solve(body, target, opts).then(resolve, reject);
                }, ms);
            });
        },

        async lock(ctx, target, opts, args) {
            if (args.length === 0) return ctx.eventManager.lock = true;

            const first = await ctx.asValueOf(args[0], target);
            if (typeof first === 'boolean') return ctx.eventManager.lock = first;

            const eventManager = await findEventManager(ctx, target, args[0]);
            if (!eventManager) return null;
            eventManager.lock = args[1] === undefined ? true : !!(await ctx.asValueOf(args[1], target));
            return true;
        },

        async unlock(ctx, target, opts, args) {
            if (args.length === 0) return !(ctx.eventManager.lock = false);

            const eventManager = await findEventManager(ctx, target, args[0]);
            if (eventManager === null) return null;
            if (eventManager) eventManager.lock = false;
            return true;
        },

        async is_locked(ctx, target, opts, args) {
            if (args.length === 0) return ctx.eventManager.lock;
            const eventManager = await findEventManager(ctx, target, args[0]);
            return eventManager === null ? null : eventManager?.lock;
        },
    };

    Library.globals = {
        listens_to(eventName) {
            const binding = Binder.from(this);
            return binding && Object.hasOwn(binding.events, Binder.eventName(eventName?.toString() ?? ''));
        },

        is_running(eventName = null) {
            const binding = Binder.from(this);
            if (!binding) return null;

            if (eventName === null) {
                for (const eventManager of Object.values(binding.events)) {
                    if (eventManager.contexts.size > 0) return true;
                }
                return false;
            }

            const eventManager = binding.events[Binder.eventName(eventName.toString())];
            return eventManager ? eventManager.contexts.size : false;
        },

        async tick() {
            await new Promise(resolve => requestAnimationFrame(resolve));
        },

        wait(time) {
            return new Promise(resolve => setTimeout(resolve, Library.globals.time_to_ms(time)));
        },

        log_raw: (...args) => console.log(...args),
        log: (...args) => console.log(...unwrapAll(args)),
        warn: (...args) => console.warn(...unwrapAll(args)),
        error: (...args) => console.error(...unwrapAll(args)),

        time_to_ms(time) {
            if (typeof time === 'number') return time;

            time = time.toString();
            const unit = time.match(/[a-z]+$/)?.[0];
            const value = parseFloat(time);

            if (!unit) return isNaN(value) ? 0 : value;
            return value * ({ ms: 1, s: 1000, m: 60000, h: 3600000 }[unit] || 1);
        },

        random(min, max) {
            min = Number(min) || 0;
            max = Number(max) || 0;
            if (Number.isInteger(min) && Number.isInteger(max)) return Math.floor(Math.random() * (max - min + 1)) + min;
            return Math.random() * (max - min) + min;
        },
    };

    Library.Array = (() => {
        const arrayMethod = (body) => Library.method(async (ctx, target, opts, fn) => {
            fn = await ctx.solve(fn, target, opts);
            const call = (index) => isActFunction(fn)
                ? fn(ctx, target[index], opts, target[index], index, target)
                : fn(target[index], index, target);
            return body(target, call);
        });

        return {
            map: arrayMethod((array, call) => Promise.all(array.map((_, i) => call(i)))),

            filter: arrayMethod(async (array, call) => {
                const keep = await Promise.all(array.map((_, i) => call(i)));
                return array.filter((_, i) => keep[i]);
            }),

            for_each: arrayMethod(async (array, call) => {
                for (let i = 0; i < array.length; i++) await call(i);
            }),

            find: arrayMethod(async (array, call) => {
                for (let i = 0; i < array.length; i++) if (await call(i)) return array[i];
            }),

            find_index: arrayMethod(async (array, call) => {
                for (let i = 0; i < array.length; i++) if (await call(i)) return i;
                return -1;
            }),

            some: arrayMethod(async (array, call) => {
                for (let i = 0; i < array.length; i++) if (await call(i)) return true;
                return false;
            }),

            every: arrayMethod(async (array, call) => {
                for (let i = 0; i < array.length; i++) if (!(await call(i))) return false;
                return true;
            }),
        };
    })();

    const classifyClassOrAttribute = (source) => {
        const origin = from(through(source));
        const isClass = is(origin, ActClass);
        const isAttribute = is(origin, Attribute);
        return { isClass, isAttribute, name: isClass ? origin.value.slice(1) : origin.value };
    };

    const sanitizeHTML = (element, html) => {
        if (!Act.config.sanitize) return html;
        if (typeof Act.config.sanitizer === 'function') return Act.config.sanitizer(element, html);
        throw new ActError('Act: sanitize is enabled but no sanitizer function provided. Set Act.config.sanitizer to a function that returns a sanitized string, or null if it handled insertion itself.');
    };

    const setHTML = (element, content, outer) => {
        const value = unwrap(content);

        if (is(value, Element, DocumentFragment)) {
            outer ? element.replaceWith(value) : element.replaceChildren(value);
        } else {
            const sanitized = sanitizeHTML(element, value?.toString() ?? '');
            if (!isNullish(sanitized)) outer ? element.outerHTML = sanitized : element.innerHTML = sanitized;
        }

        return element;
    };

    const insertContent = (element, content, position) => {
        const value = unwrap(content);

        if (is(value, Element, DocumentFragment)) {
            position === 'afterbegin' ? element.insertBefore(value, element.firstChild) : element.appendChild(value);
        } else {
            const sanitized = sanitizeHTML(element, value);
            if (!isNullish(sanitized)) element.insertAdjacentHTML(position, sanitized);
        }

        return element;
    };

    const moveContent = (nodes, target, position = 'beforeend') => {
        target = unwrap(target);
        if (typeof target === 'string') target = document.querySelector(target);
        if (!target) return nodes;

        const isCollection = is(nodes, DocumentFragment, HTMLCollection, NodeList) || Array.isArray(nodes);
        const list = isCollection ? (nodes.childNodes ? Array.from(nodes.childNodes) : Array.from(nodes)) : [nodes];

        const aliases = { before: 'beforebegin', prepend: 'afterbegin', append: 'beforeend', after: 'afterend', inside: 'innerhtml', replace: 'outerhtml' };
        const key = position.toString().toLowerCase();
        const mode = aliases[key] || key;

        if (mode === 'innerhtml') target.innerHTML = '';

        const parent = target.parentNode;
        const operations = {
            beforebegin: node => parent.insertBefore(node, target),
            afterbegin: node => target.insertBefore(node, target.firstChild),
            beforeend: node => target.appendChild(node),
            afterend: node => parent.insertBefore(node, target.nextSibling),
            innerhtml: node => target.appendChild(node),
            outerhtml: node => parent.insertBefore(node, target),
        };

        const operation = operations[mode] || operations.beforeend;
        const eachNodeLandsBeforeTheLast = mode === 'afterbegin';
        if (eachNodeLandsBeforeTheLast) list.reverse();
        for (const node of list) operation(node);
        const replacesTargetItself = mode === 'outerhtml';
        if (replacesTargetItself) target.remove();

        return nodes;
    };

    const forceReflow = (element) => void element.offsetWidth;

    const findSibling = (element, selector, forward) => {
        if (!selector) return forward ? element.nextElementSibling : element.previousElementSibling;
        if (is(selector, Element)) return selector;

        if (is(selector, NodeList) || Array.isArray(selector)) {
            const positionMask = forward ? Node.DOCUMENT_POSITION_FOLLOWING : Node.DOCUMENT_POSITION_PRECEDING;
            if (forward) {
                for (const node of selector)
                    if (element.compareDocumentPosition(node) & positionMask) return node;
            } else {
                for (let i = selector.length - 1; i >= 0; i--)
                    if (element.compareDocumentPosition(selector[i]) & positionMask) return selector[i];
            }

            return null;
        }

        const cssSelector = typeof selector === 'string' ? selector : selector.toString();
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
        walker.currentNode = element;

        let node;
        while (node = forward ? walker.nextNode() : walker.previousNode()) {
            if (node.matches(cssSelector)) return node;
        }

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
            let css = '', totalWait = 0;
            const targetStyles = {}, originalStyles = {};
            const previousTransition = this.style.transition;

            while (args.length) {
                let duration = 0, timingFunction = '', delay = 0;
                const property = args.shift().toString();

                const next = () => args.shift().toString();
                const capture = () => originalStyles[property] ??= this.style[property];
                const handlers = {
                    from: () => { capture(); this.style[property] = next(); },
                    to: () => { capture(); targetStyles[property] = next(); },
                    in: () => duration = Library.globals.time_to_ms(next()),
                    using: () => timingFunction = next(),
                    after: () => delay = Library.globals.time_to_ms(next()),
                };
                while (args.length && handlers[args[0]]) handlers[args.shift()]();

                totalWait = Math.max(totalWait, delay + duration);
                css += `${css ? ', ' : ''}${property} ${duration}ms${timingFunction ? ' ' + timingFunction : ''}${delay ? ' ' + delay + 'ms' : ''}`;
            }

            this.style.transition = css;
            forceReflow(this);
            Object.assign(this.style, targetStyles);

            let timer;
            return abortable({
                perform: done => {
                    timer = setTimeout(() => { this.style.transition = previousTransition; done(); }, totalWait);
                },
                abort: () => {
                    clearTimeout(timer);
                    this.style.transition = 'none';
                    for (const property of Object.keys(originalStyles)) this.style[property] = originalStyles[property];
                    forceReflow(this);
                    this.style.transition = previousTransition;
                },
            });
        },

        move_to(element, position = 'beforeend') {
            return moveContent(this, element, position);
        },

        empty() {
            this.replaceChildren();
        },

        clone() {
            return this.cloneNode(true);
        },

        prepend(content) {
            return insertContent(this, content, 'afterbegin');
        },

        append(content) {
            return insertContent(this, content, 'beforeend');
        },

        set_html(content) {
            return setHTML(this, content, false);
        },

        set_outer_html(content) {
            return setHTML(this, content, true);
        },

        fade(direction, time = 250, timing = 'linear') {
            const animation = this.animate(
                [{ opacity: direction === 'in' ? 0 : 1 }, { opacity: direction === 'in' ? 1 : 0 }],
                { duration: Library.globals.time_to_ms(time), easing: timing, fill: 'forwards' }
            );

            return abortable({
                perform: async () => {
                    try {
                        await animation.finished;
                        this.style.opacity = direction === 'in' ? '1' : '0';
                        animation.cancel();
                    } catch {  }
                },
                abort: () => animation.cancel(),
            });
        },

        is_in_view(partially = false) {
            const { top, left, bottom, right } = this.getBoundingClientRect();
            const { innerHeight: viewportHeight, innerWidth: viewportWidth } = window;

            const fullyVisible = top >= 0 && left >= 0 && bottom <= viewportHeight && right <= viewportWidth;
            if (fullyVisible || !partially) return fullyVisible;

            const partiallyVisible = top < viewportHeight && bottom > 0 && left < viewportWidth && right > 0;
            return partiallyVisible ? 'partially' : false;
        },

        next(selector) {
            return findSibling(this, selector, true);
        },

        previous(selector) {
            return findSibling(this, selector, false);
        },

        parent() {
            return this.parentNode;
        },

        take(value, parent = this.parentNode) {
            const { isClass, isAttribute, name } = classifyClassOrAttribute(value);

            if (isClass) {
                for (const element of unwrap(parent).querySelectorAll('.' + name)) {
                    element.classList.remove(name);
                }
                this.classList.add(name);
            } else if (isAttribute) {
                let attributeValue = '';
                for (const element of unwrap(parent).querySelectorAll(`[${name}]`)) {
                    attributeValue = element.getAttribute(name);
                    element.removeAttribute(name);
                }
                this.setAttribute(name, attributeValue);
            } else {
                throw new ActError('Invalid value');
            }

            return this;
        },

        toggle(value, force) {
            const forcedState = force !== undefined ? unwrap(force) : undefined;

            if (value !== undefined) {
                const { isClass, isAttribute, name } = classifyClassOrAttribute(value);
                if (isClass) return this.classList.toggle(name, forcedState);
                if (isAttribute) return this.toggleAttribute(name, forcedState);
            }

            const show = forcedState ?? (this.style.display === 'none');
            return show ? Library.Element.show.call(this) : Library.Element.hide.call(this);
        },

        add(...values) {
            for (const value of values) {
                const { isClass, isAttribute, name } = classifyClassOrAttribute(value);
                if (isClass) this.classList.add(name);
                else if (isAttribute) this.setAttribute(name, '');
            }
            return this;
        },

        has(value) {
            const { isClass, isAttribute, name } = classifyClassOrAttribute(value);
            if (isClass) return this.classList.contains(name);
            if (isAttribute) return this.hasAttribute(name);
            return this.matches(name);
        },

        remove(...values) {
            if (values.length === 0) return this.parentNode?.removeChild(this);

            for (const value of values) {
                const { isClass, isAttribute, name } = classifyClassOrAttribute(value);
                if (isClass) this.classList.remove(name);
                else if (isAttribute) this.removeAttribute(name);
            }
            return this;
        },
    };

    Library.object = {
        move_to(element, position) {
            return moveContent(this, element, position);
        },

        trigger(eventName, bubbles = true, detail = {}) {
            if (typeof this?.dispatchEvent !== 'function') {
                throw new ActError(`Cannot trigger '${eventName}' on a value of type '${this?.constructor?.name ?? typeof this}': not an event target.`);
            }

            this.dispatchEvent(new CustomEvent(Binder.eventName(eventName), { bubbles, detail: unwrap(detail) }));
            return this;
        },
    };

    Library.string = {
        after(text) {
            const [self, search] = [this.toString(), text.toString()];
            const index = self.indexOf(search);
            return index === -1 ? self : self.substring(index + search.length);
        },

        before(text) {
            const [self, search] = [this.toString(), text.toString()];
            const index = self.indexOf(search);
            return index === -1 ? self : self.substring(0, index);
        },

        between(start, end) {
            const [self, startText, endText] = [this.toString(), start.toString(), end.toString()];
            const index = self.indexOf(startText);
            return index === -1 ? self : self.substring(index + startText.length, self.indexOf(endText));
        },

        capitalize() {
            return this.toString().charAt(0).toUpperCase() + this.toString().slice(1);
        },
    };

    for (const type of ['function', 'boolean', 'number', 'bigint', 'symbol', 'undefined']) Library[type] = {};

    const Act = global.Act = {
        get version() { return '0.2.0'; },

        config: {
            convertToCamelCase: true,
            start: true,
            debug: false,
            lexerDebug: false,
            parserDebug: false,
            startTime: true,
            sanitize: false,
            sanitizer: null,
        },

        extensions: [],
        hasStarted: false,
        isStartingUp: false,

        extend(plugin) {
            if (typeof plugin === 'function') plugin = { install: plugin };
            this.extensions.push(plugin);

            if (this.hasStarted) {
                plugin.install?.(this);
                plugin.ready?.(this);
            }

            return this;
        },

        configure() {
            for (const meta of document.querySelectorAll('meta[name^="act-"]')) {
                const key = meta.name.slice(4).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
                try { this.config[key] = JSON.parse(meta.content); }
                catch { this.config[key] = meta.content; }
            }

            for (const extension of this.extensions) extension.install?.(this);
        },

        start() {
            this.isStartingUp = true;
            if (this.config.startTime) console.time('act start');

            new Binding(window);
            const boundNodes = this.init(document.body, true, true);

            if (this.config.startTime) console.timeEnd('act start');
            document.body.dispatchEvent(new CustomEvent('actready', { bubbles: true, detail: { bindedNodes: boundNodes } }));
            for (const extension of this.extensions) extension.ready?.(this);
            this.hasStarted = true;
        },

        init(root, bindRoot, force) {
            return Binder.scan(root, bindRoot, force);
        },

        run(target, code) {
            const binding = Binder.ensure(target);
            const source = new Source(null, Source.TYPE.ACT_RUN, code);
            return new EventManager(binding, Source.TYPE.ACT_RUN, {}, source, source.scope).run(target);
        },

        get globals() {
            return Binder.from(document.body).data;
        },

        is, unwrap, unwrapAll, from, through, Library, abortable,
    };
})(this);
