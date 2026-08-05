# Changelog

## [0.2.0] - 2026-08-06

⚠️ marks a breaking change.

### New

**Operators**

- `?.` safe member access. Returns `undefined` instead of throwing when the left operand is nullish, and propagates along the rest of the chain.
- `??` nullish coalescing. Unlike `or`, falsy values such as `0` and `''` pass through.

**Keywords**

- `case` with `when` (strict) and `like` (loose) branches, optional `else`, no fall-through. Returns the matched branch's value.
- ⚠️ `kill` now interrupts the running sentence immediately instead of stopping at the next one, and any in-flight abortable operation runs its abort handler. Killing a `transition` or a `fade` reverts the element to its pre-operation state.
- `finish`, the graceful counterpart to `kill`. The running sentence completes, then execution stops at the next sentence boundary. In-flight abortables are not aborted.
- `wait_until`, pauses until the target dispatches an event, then returns it.
- ⚠️ `debounce`, replacing the `delay` global method.
- ⚠️ `lock`, `unlock` and `is_locked`, moved from global methods to keywords. Keywords take their arguments without the call syntax, so every call site changes: `lock!` becomes `lock`, `lock: click` becomes `lock click`, `lock: scroll false` becomes `lock scroll false`, and `is_locked!` becomes `is_locked`.

**Prefixes**

- ⚠️ `first` and `last`, moved from object methods.

**Methods**

- Element: `clone`, `set_html`, `set_outer_html`. The two HTML setters honour the `sanitize` config; `inner_html:` and `<<` stay direct assignments.

**Events**

- Delegation with `matching`: `on click matching {.item} (...)`, including for `inview` and `offview`, where newly inserted matching elements are observed automatically.
- ⚠️ Event aliases are now written with `#` after the event: `act@click#save_form`. This lets one element carry several handlers for the same event, and gives `kill`, `finish` and `off` a name to target.
- Bracketed event names for names containing `:` or `.`, such as `act@[htmx:before:request]`. Any part may be bracketed, including the alias. An unbracketed name with an unknown `:part` is now reported in the console instead of silently binding to the wrong event.
- Lifecycle events: `actready`, `actbind`, `actstart`, `actend`, `acterror`.

**API**

- `Act.extend(plugin)` with `install` and `ready` hooks, plus `Act.extensions`. Registering after `Act.start()` fires both hooks immediately.
- `Act.abortable({ perform, abort })`, pairing async work with cleanup that runs on `kill`. Used by `transition` and `fade`.
- `Act.hasStarted` and `Act.isStartingUp`.

### Changed

**Syntax**

- ⚠️ The branch terminator is now `~` instead of `else?`.
- ⚠️ Event aliases moved from `act@[alias]event` to `act@event#alias`. Brackets now mean "take this name verbatim" instead of marking an alias, so `act@[save]click` is read as an event literally named `save` followed by a stray `click`, and is reported as an error.

**Methods**

- `trigger` moved from Element to object methods, so it works on any event target including `window` and `document`. Element targets still resolve it, so this is not a breaking change. It throws a clear error on targets that cannot dispatch events.

**Config**

- ⚠️ `debugLexer` and `debugParser` renamed to `lexerDebug` and `parserDebug`. The meta tags become `act-lexer-debug` and `act-parser-debug`.

**htmx**

- `act-htmx.js` rewritten on `htmx.onLoad` and now supports both htmx 2 and htmx 4.

### Removed

**Methods**

- `delay` global method. Use the `debounce` keyword.
- `on_match` (Element). Use the `matching` option on the `on` keyword.
- `collapse` (Element). Moved to `act-ext.js` as an example extension.
- `first` and `last` (object). `$items.first!` no longer resolves; use the `first` prefix.

**htmx**

- `hx-ext="act"` is no longer used. htmx 4 removed the attribute, along with `htmx.defineExtension`, the `onEvent` hook and the `htmx:load` event. Delete `hx-ext="act"` when upgrading; nothing replaces it. act now initialises on every htmx swap, so use htmx's `hx-ignore` to exclude a subtree.

---

Editor support (VSCode, Neovim, Zed, TextMate, Visual Studio, JetBrains) now lives in [oriolmrt/act-editors](https://github.com/oriolmrt/act-editors).

[0.2.0]: https://github.com/oriolmrt/act/releases/tag/v0.2.0
