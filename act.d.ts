/**
 * Act.js - A scripting language for HTML.
 */

declare namespace Act {
  // ============================================================================
  // Configuration
  // ============================================================================

  interface Config {
    /** Convert snake_case to camelCase in property lookups */
    convertToCamelCase: boolean;
    /** Auto-start Act initialization on DOMContentLoaded */
    start: boolean;
    /** Enable global debug mode */
    debug: boolean;
    /** Enable Lexer-specific debug output */
    lexerDebug?: boolean;
    /** Enable Parser-specific debug output */
    parserDebug?: boolean;
    /** Log timing information for Act.start() */
    startTime?: boolean;
    /** Enable HTML sanitization for insertContent operations */
    sanitize?: boolean;
    /** Custom sanitizer function. Required when sanitize is true.
     *  Receives the target element and the raw HTML string.
     *  Return the sanitized HTML string, or `null` if the sanitizer handled
     *  DOM insertion itself (e.g. via `element.setHTML()`), in which case
     *  Act will skip its own `insertAdjacentHTML` call. */
    sanitizer?: ((element: Element, html: string) => string | null) | null;
  }

  const config: Config;

  /**
   * Act.js version string
   */
  const version: string;

  /** True once start() has finished */
  const hasStarted: boolean;

  /** True from the moment start() begins; gates the initial act/load dispatch */
  const isStartingUp: boolean;

  // ============================================================================
  // Core API
  // ============================================================================

  /**
   * Configure Act.js with options from `<meta name="act-{key}" content="{value}">` tags.
   * Keys are kebab-case and converted to camelCase (e.g. `act-start-time` → `startTime`).
   * Values are JSON-parsed where possible, falling back to strings.
   * Also drains all registered `install()` extension hooks.
   */
  function configure(): void;

  /**
   * Start Act.js - scan and bind the document body
   */
  function start(): void;

  /**
   * Initialize Act.js on a specific DOM subtree
   * @param root - Root element to scan
   * @param bindRoot - Whether to bind the root element itself
   * @param force - Force re-initialization even if already bound
   */
  function init(root: Element, bindRoot?: boolean, force?: boolean): Element[] | undefined;

  /**
   * Run Act.js code on a target element
   * @param target - Target element
   * @param code - Act.js code to execute
   * @returns Promise that resolves when execution completes
   */
  function run(target: Element, code: string): Promise<any>;

  /**
   * Get global data (document.body binding data)
   */
  const globals: Record<string, any>;

  // ============================================================================
  // Utility Functions
  // ============================================================================

  /**
   * Check if value is defined and optionally matches any of the given classes
   * @param value - Value to check
   * @param classes - Optional class constructors to check against
   */
  function is<T>(value: any, ...classes: Array<new (...args: any[]) => T>): value is T;

  /**
   * Unwrap a Result to get its underlying value
   * @param value - Value to unwrap (may be a Result or plain value)
   */
  function unwrap<T>(value: T | Result): T;

  /**
   * Unwrap all values in an array
   * @param values - Array of values to unwrap
   */
  function unwrapAll<T>(values: Array<T | Result>): T[];

  /**
   * Get the source solvable that produced a Result
   * @param value - Result to get source from
   */
  function from(value: Result): Solvable | undefined;

  /**
   * Get the ultimate Result (traverse chain of Results)
   * @param value - Result to traverse
   */
  function through(value: Result): Result;

  /**
   * Create an Abortable operation.
   * @param handlers.perform - Receives a `done` callback; call it or return a Promise to signal completion
   * @param handlers.abort - Called when the operation is aborted early
   */
  function abortable(handlers: {
    perform: (done: () => void) => any;
    abort?: () => void;
  }): Abortable;

  // ============================================================================
  // Library (Extensible Act methods)
  // ============================================================================

  interface Library {
    /**
     * Mark a function as an Act method that receives ctx, target, opts
     * @param fn - Function to mark
     */
    method(fn: Function): ActMethod;

    /**
     * Get a library method for a given name and target
     * @param name - Method name
     * @param target - Target object
     */
    get(name: string, target: any): ActMethod | undefined;

    /**
     * Execute a library method
     * @param fn - Method to execute
     * @param args - Arguments to pass
     * @param target - Target object
     * @param context - Execution context
     * @param opts - Options
     */
    exec(fn: ActMethod | Function, args: any[], target: any, context: Context, opts: any): Promise<any>;

    /** Reserved word values (like me, debugger, etc.) */
    words: {
      me: (ctx: Context, target: any) => any;
      source_element: (ctx: Context) => Element;
      original_target: (ctx: Context) => any;
      undefined: () => undefined;
      NaN: () => number;
      debugger: () => void;
      true: () => true;
      false: () => false;
      null: () => null;
      document: () => Document;
      window: () => Window;
      js: () => Window;
      Act: () => typeof Act;
      [key: string]: (ctx: Context, target: any) => any;
    };

    /** Prefix operations (like not, local, scoped, first, last, etc.) */
    prefixes: {
      /** Get the first item of an array/collection */
      first: (ctx: Context, target: any, opts: any, value: any) => Promise<any>;
      /** Get the last item of an array/collection */
      last: (ctx: Context, target: any, opts: any, value: any) => Promise<any>;
      /** Access global variables */
      global: (ctx: Context, target: any, opts: any, value: any) => Result;
      /** Access local binding data */
      local: (ctx: Context, target: any, opts: any, value: any) => Result;
      /** Access scoped variables */
      scoped: (ctx: Context, target: any, opts: any, value: any) => Result;
      /** Logical negation */
      not: (ctx: Context, target: any, opts: any, value: any) => Promise<boolean>;
      /** Numeric negation */
      negative: (ctx: Context, target: any, opts: any, value: any) => Promise<number>;
      /** Get the type name of a value */
      type: (ctx: Context, target: any, opts: any, value: any) => Promise<string>;
      /** Debug logging prefix */
      wat: (ctx: Context, target: any, opts: any, value: any) => Promise<any>;
      [key: string]: (ctx: Context, target: any, opts: any, value: any) => any;
    };

    /** Keyword operations (like if, each, loop, etc.) */
    keywords: {
      /** Case statement - match value against when clauses, with optional default */
      case: (ctx: Context, target: any, opts: any, args: any[]) => Promise<any>;
      /** Run a named block defined with def */
      run: (ctx: Context, target: any, opts: any, args: any[]) => Promise<any>;
      /** Define a named reusable block */
      def: (ctx: Context, target: any, opts: any, args: any[]) => Promise<void>;
      /** Iterate over an iterable */
      each: (ctx: Context, target: any, opts: any, args: any[]) => Promise<any>;
      /** Numeric for loop */
      for: (ctx: Context, target: any, opts: any, args: any[]) => Promise<void>;
      /** Conditional execution */
      if: (ctx: Context, target: any, opts: any, args: any[]) => Promise<any>;
      /** Infinite loop */
      loop: (ctx: Context, target: any, opts: any, args: any[]) => Promise<any>;
      /** Create new instance or element */
      new: (ctx: Context, target: any, opts: any, args: any[]) => Promise<any>;
      /** Attach event listener */
      on: (ctx: Context, target: any, opts: any, args: any[]) => Promise<boolean>;
      /** Remove event listener */
      off: (ctx: Context, target: any, opts: any, args: any[]) => Promise<boolean>;
      /** Halt a running event immediately, aborting in-flight operations */
      kill: (ctx: Context, target: any, opts: any, args: any[]) => Promise<boolean>;
      /** Gracefully stop a running event: the current sentence completes, the rest are skipped */
      finish: (ctx: Context, target: any, opts: any, args: any[]) => Promise<boolean>;
      /** Wait until the target dispatches an event; resolves with the event */
      wait_until: (ctx: Context, target: any, opts: any, args: any[]) => Promise<Event>;
      /** Break out of a loop with optional data */
      break: (ctx: Context, target: any, opts: any, args: any[]) => Promise<never>;
      /** Stop event execution with optional data */
      stop: (ctx: Context, target: any, opts: any, args: any[]) => Promise<never>;
      /** Return from a block with optional data */
      return: (ctx: Context, target: any, opts: any, args: any[]) => Promise<never>;
      /** Repeat the current scope from the beginning */
      repeat: () => never;
      /** Restart the entire event handler */
      restart: () => never;
      /** Continue to the next iteration of a loop */
      continue: () => never;
      /** Halt the current event immediately */
      halt: () => never;
      /** Throw an error */
      throw: (ctx: Context, target: any, opts: any, args: any[]) => Promise<never>;
      /** While loop - execute body while condition is true */
      while: (ctx: Context, target: any, opts: any, args: any[]) => Promise<void>;
      /** Execute body with a different target context */
      with: (ctx: Context, target: any, opts: any, args: any[]) => Promise<any>;
      /** Debounce execution */
      debounce: (ctx: Context, target: any, opts: any, args: any[]) => Promise<any>;
      /** Lock an event handler from running */
      lock: (ctx: Context, target: any, opts: any, args: any[]) => Promise<boolean | null>;
      /** Unlock an event handler */
      unlock: (ctx: Context, target: any, opts: any, args: any[]) => Promise<boolean>;
      /** Check if an event handler is locked */
      is_locked: (ctx: Context, target: any, opts: any, args: any[]) => Promise<boolean | null>;
      [key: string]: (ctx: Context, target: any, opts: any, args: any[]) => any;
    };

    /** Global methods available to all targets */
    globals: {
      /** Check if target listens to an event */
      listens_to(eventName: string): boolean;
      /** Check if an event is currently running */
      is_running(eventName?: string | null): boolean | number | null;
      /** Wait for the next animation frame */
      tick(): Promise<void>;
      /** Wait for a specified time */
      wait(time: number | string): Promise<void>;
      /** Log raw arguments (no unwrapping) */
      log_raw(...args: any[]): void;
      /** Log arguments (unwrapped) */
      log(...args: any[]): void;
      /** Log warning */
      warn(...args: any[]): void;
      /** Log error */
      error(...args: any[]): void;
      /** Convert a time value to milliseconds */
      time_to_ms(time: number | string): number;
      /** Generate a random number between min and max */
      random(min: number, max: number): number;
      [key: string]: (...args: any[]) => any;
    };

    /** Methods available for Element targets */
    Element: {
      /** Check if element matches a selector */
      matches(selector: string): boolean;
      /** Hide an element (display: none) */
      hide(): void;
      /** Show an element (display: '') */
      show(): void;
      /** Animate CSS transitions */
      transition(...args: any[]): Abortable;
      /** Move element to a new position */
      move_to(element: Element | Result | string, position?: string): Element;
      /** Remove all children */
      empty(): void;
      /** Clone the element */
      clone(): Element;
      /** Prepend content to the element */
      prepend(content: any): Element;
      /** Append content to the element */
      append(content: any): Element;
      /** Replace the element's inner HTML (honours config.sanitize) */
      set_html(content: any): Element;
      /** Replace the element itself (honours config.sanitize) */
      set_outer_html(content: any): Element;
      /** Fade element in or out */
      fade(inout: 'in' | 'out', time?: number | string, timing?: string): Promise<void>;
      /** Check if element is in viewport */
      is_in_view(partially?: boolean): boolean | 'partially';
      /** Get next sibling (optionally matching selector) */
      next(selector?: string | Element | NodeList): Element | null;
      /** Get previous sibling (optionally matching selector) */
      previous(selector?: string | Element | NodeList): Element | null;
      /** Get parent node */
      parent(): Node | null;
      /** Take a class or attribute from siblings */
      take(value: any, parent?: Element): Element;
      /** Toggle class, attribute, or visibility */
      toggle(value?: any, force?: boolean): boolean | void;
      /** Add class(es) or attribute(s) */
      add(...args: any[]): Element;
      /** Check if element has class, attribute, or matches selector */
      has(value: any): boolean;
      /** Remove element from DOM, or remove class(es)/attribute(s) */
      remove(...args: any[]): Element | undefined;
      [key: string]: (...args: any[]) => any;
    };

    /** Methods available for Array targets */
    Array: {
      /** Map over array with callback */
      map: ActMethod;
      /** Filter array with callback */
      filter: ActMethod;
      /** Iterate over array with callback */
      for_each: ActMethod;
      /** Find first matching item */
      find: ActMethod;
      /** Find index of first matching item */
      find_index: ActMethod;
      /** Check if some items match */
      some: ActMethod;
      /** Check if all items match */
      every: ActMethod;
      [key: string]: ActMethod | ((...args: any[]) => any);
    };

    /**
     * Methods available for any object target — consulted for Elements, Arrays,
     * collections and plain objects alike, whenever the more specific bucket
     * for the target has no match.
     */
    object: {
      /** Move content to an element */
      move_to(el: Element, pos?: string): any;
      /** Dispatch an event on the target. Throws unless the target is an event target. */
      trigger<T>(e: string, bubbles?: boolean, detail?: any): T;
      [key: string]: (...args: any[]) => any;
    };

    /** Methods available for Function targets */
    function: Record<string, (...args: any[]) => any>;

    /** Methods available for String targets */
    string: {
      /** Get substring after a delimiter */
      after(str: string): string;
      /** Get substring before a delimiter */
      before(str: string): string;
      /** Get substring between two delimiters */
      between(start: string, end: string): string;
      /** Capitalize first letter */
      capitalize(): string;
      [key: string]: (...args: any[]) => any;
    };

    boolean: Record<string, (...args: any[]) => any>;
    number: Record<string, (...args: any[]) => any>;
    bigint: Record<string, (...args: any[]) => any>;
    symbol: Record<string, (...args: any[]) => any>;
    undefined: Record<string, (...args: any[]) => any>;
  }

  const Library: Library;

  // ============================================================================
  // Binder (Element binding utilities)
  // ============================================================================

  interface Binder {
    /** Property name used for storing bindings on elements */
    readonly BINDING_PROPERTY: '__act__';
    /** Attribute names that trigger Act binding */
    readonly ATTRIBUTES: ['act', 'act-block'];
    /** Valid event options */
    readonly EVENT_OPTIONS: ['once', 'prevent', 'stop', 'only', 'target'];
    /** IntersectionObserver event mappings */
    readonly INTERSECT_EVENTS: {
      inview: 'actinview';
      offview: 'actoffview';
      actinview: 'actinview';
      actoffview: 'actoffview';
    };

    /** The sigils that introduce each part of an event attribute name */
    readonly PART_SIGILS: { ':': 'option'; '.': 'key'; '#': 'alias' };

    /**
     * Get the binding attached to an element, if it has one
     * @param element - Element to get the binding for
     */
    from(element: Element): Binding | undefined;

    /**
     * Get the binding attached to an element, creating one if missing
     * @param element - Element to get or create the binding for
     */
    ensure(element: Element): Binding;

    /**
     * Read a name from an event attribute spec: either [verbatim] or bare
     * @param spec - The spec being parsed
     * @param fromIndex - Where in the spec to start reading
     */
    readName(spec: string, fromIndex: number): { value: string; next: number } | null;

    /**
     * Parse one handler spec from an `act@…` attribute name
     * @param spec - A single comma-free spec
     */
    parseEventSpec(spec: string):
      | { event: string; alias: string | null; options: Record<string, any> }
      | { error: string };

    /**
     * Normalize event name (handles intersection events)
     * @param name - Event name to normalize
     */
    eventName(name: string): string;

    /**
     * Bind an element to Act
     * @param element - Element to bind
     */
    bind(element: Element): void;

    /**
     * Scan a DOM subtree for Act elements
     * @param root - Root element to scan
     * @param bindRoot - Whether to bind the root element
     * @param force - Force re-binding
     * @returns Array of newly bound elements
     */
    scan(root: Element, bindRoot?: boolean, force?: boolean): Element[];
  }

  // ============================================================================
  // Internal Classes (exposed for advanced usage)
  // ============================================================================

  class Lexer {
    static Token: new (type: string, value: string, index: number, line: number, column: number) => Token;
    static VALUES: Record<string, string>;
    static EXPRESSIONS: Record<string, string>;
    static OPERATORS: Record<string, string>;
    static SENTENCE_END: Record<string, string>;
    static TOKENS_BY_PRECEDENCE: Array<[string, RegExp]>;

    constructor(input: string);
    hasMoreTokens(): boolean;
    next(): this;
    consume(...types: string[]): this | boolean;
    peek(): Token;
    previous(): Token;
    peekChar(): string | undefined;
    consumeChar(): string | undefined;
    scanRaw(stopChars: string[]): string;
    skipSpaces(): this;
    skipSpacesAndCommas(): this;
    tokenIs(...types: string[]): boolean;
    tokenIsEnd(): boolean;
    tokenIsValue(): boolean;
    tokenIsExpression(): boolean;
    tokenIsOperator(): boolean;
    expect(...types: string[]): this;
    expectValue(): this;
    expectEnd(): this;
    nextIf(...types: string[]): this | false;
    fail(message: string): never;
  }

  class Parser {
    constructor(source: Source);
    parse(): Scope;
    isKeyword(word: any): boolean;
    isPrefix(word: any): boolean;
  }

  // ============================================================================
  // Abortable
  // ============================================================================

  class Abortable {
    /** The underlying promise that resolves when the operation completes */
    value: Promise<any>;
    /** Abort the operation early */
    abort: () => void;
    constructor(value: Promise<any>, abort: () => void);
  }

  // ============================================================================
  // Errors & Signals
  // ============================================================================

  class ActError extends Error { }
  class ActSyntaxError extends ActError {
    token?: Token;
  }
  class ActRuntimeError extends ActError {
    actException?: Error;
    actTrace?: Array<{
      sentence: Sentence;
      sentenceTarget: any;
      target: any;
      context: Context;
    }>;
    expression?: any;
  }

  class Signal extends Error {
    static Break: typeof Signal;
    static Continue: typeof Signal;
    static Stop: typeof Signal;
    static Halt: typeof Signal;
    static Repeat: typeof Signal;
    static Restart: typeof Signal;
    static Return: typeof Signal;
    data?: any;
  }

  // ============================================================================
  // Type Definitions
  // ============================================================================

  interface Token {
    type: string;
    value: string;
    index: number;
    line: number;
    column: number;
    readonly indexEnd: number;
  }

  interface Result {
    readonly value: any;
    readonly from: Solvable | undefined;
    readonly through: Result;
    readonly settable: boolean;
    readonly parent?: any;
    readonly key?: string;
    valueOf(): any;
    toString(...args: any[]): string;
    set(value: any): any;
  }

  interface Solvable {
    readonly scope: Scope;
    readonly source: Source;
    readonly value: any;
    readonly tokenStart: Token;
    readonly tokenEnd: Token;
    readonly code: string;
    solve(ctx: Context, target: any, opts: any): Promise<any>;
  }

  /** Where a piece of act code came from */
  type SourceType = 'directAttribute' | 'inlineScript' | 'externalScript' | 'actrun';

  interface Source {
    readonly code: string;
    readonly element: Element;
    readonly type: SourceType;
    readonly scope: Scope | null;
    readonly attr: Attr | null;
    readonly args: string[];
  }

  /** Static side of Source: the source types, keyed by name */
  const Source: {
    readonly TYPE: {
      readonly ATTRIBUTE: 'directAttribute';
      readonly INLINE_SCRIPT: 'inlineScript';
      readonly EXTERNAL_SCRIPT: 'externalScript';
      readonly ACT_RUN: 'actrun';
    };
  };

  interface Scope extends Solvable {
    readonly value: Sentence[];
    isRoot(): boolean;
    lookup(ctx: Context, key: string, defaultThisScope?: boolean): Result | undefined;
  }

  /** How a sentence runs, decided by its terminator */
  type SentenceMode = 'sync' | 'async' | 'condition' | 'branch' | 'fwd';

  interface Sentence extends Solvable {
    readonly mode: SentenceMode;
    readonly target?: Solvable;
  }

  /** Static side of Sentence: the execution modes, keyed by name */
  const Sentence: {
    readonly MODE: {
      readonly SYNC: 'sync';
      readonly ASYNC: 'async';
      readonly CONDITION: 'condition';
      readonly BRANCH: 'branch';
      readonly FORWARD: 'fwd';
    };
  };

  interface Context {
    readonly binding: Binding;
    readonly target: any;
    readonly event: Event | null;
    readonly eventManager: EventManager;
    readonly source: Source;
    readonly abortSignal: AbortSignal;
    readonly abortController: AbortController;
    /** Set by the `finish` keyword: execution stops at the next sentence boundary */
    finishing: boolean;
    readonly data: WeakMap<Scope, Record<string, any>>;
    solve(value: any, target: any, opts?: any): Promise<any>;
    solveAll(values: any[], target: any, opts?: any): Promise<any[]>;
    asString(value: any, target: any, opts?: any): Promise<string>;
    asValueOf(value: any, target: any, opts?: any): Promise<any>;
    scopeData(scope: Scope): Record<string, any>;
    spawn(): Context;
  }

  /** A block stored inline via the `def` keyword (not a Source) */
  interface DefBlock {
    args: (string | [string])[];
    scope: Solvable;
  }

  interface Binding {
    readonly element: Element;
    readonly data: Record<string, any>;
    readonly events: Record<string, EventManager>;
    readonly blocks: Record<string, Source | DefBlock>;
    parent(): Binding | undefined;
    getBlock(name: string): Source | DefBlock | undefined;
    lookupBlock(name: string): { block: Source | DefBlock; binding: Binding } | undefined;
    lookupData(key: string): Result | undefined;
    addEvent(eventName: string, source: Source, options?: Record<string, any>, eventManager?: EventManager | null, eventAlias?: string | null): void;
  }

  interface EventManager {
    readonly binding: Binding;
    readonly name: string;
    readonly scope: Scope;
    readonly source: Source;
    readonly options: Record<string, any>;
    readonly contexts: Set<Context>;
    readonly listener: (ev: Event) => any;
    lock: boolean;
    observer?: {
      intersectionObserver: IntersectionObserver;
      mutationObserver: MutationObserver | null;
    };
    run(target: any, event?: Event): Promise<any>;
  }

  /** Function marked as an Act method that receives context, target, and opts */
  interface ActMethod {
    (ctx: Context, target: any, opts: any, ...args: any[]): any;
    [Symbol.toStringTag]?: string;
  }

  // ============================================================================
  // Extension System
  // ============================================================================

  /**
   * A plugin object passed to `Act.extend()`.
   * Both hooks are optional — omit whichever you don't need.
   */
  interface Extension {
    /** Optional name for debugging and identification */
    name?: string;
    /**
     * Called before `Act.start()` — use this to add library methods,
     * register keywords/prefixes, or modify config.
     * If `Act.extend()` is called after start, this fires immediately.
     */
    install?(act: typeof Act): void;
    /**
     * Called after `Act.start()` — use this for post-scan integrations.
     * If `Act.extend()` is called after start, this fires immediately.
     */
    ready?(act: typeof Act): void;
  }

  /** All registered extensions, in registration order */
  const extensions: Extension[];

  /** True after `Act.start()` has completed */
  const _started: boolean;

  /**
   * Register a plugin extension.
   * - If called before `DOMContentLoaded`, hooks are queued and drained during init.
   * - If called after `Act.start()`, `install()` and `ready()` fire immediately.
   * @param plugin - Extension object with optional `install` and `ready` hooks,
   *                 or a function (treated as `install`).
   * @returns `Act` for chaining: `Act.extend(a).extend(b)`
   */
  function extend(plugin: Extension | ((act: typeof Act) => void)): typeof Act;
}

// ============================================================================
// Global API
// ============================================================================

interface Window {
  Act: typeof Act;
}

// ============================================================================
// Element Extensions (via Act.js library methods)
// ============================================================================

interface Element {
  /**
   * Act.js binding data (internal property)
   * @internal
   */
  __act__?: Act.Binding;
}

// ============================================================================
// HTML Attributes
// ============================================================================

interface HTMLElement {
  /** Act.js event binding attribute */
  'act'?: string;
  /** Act.js named block definition */
  'act-block'?: string;
}

declare module 'act.js' {
  export = Act;
}
