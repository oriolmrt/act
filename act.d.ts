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
    debugLexer?: boolean;
    /** Enable Parser-specific debug output */
    debugParser?: boolean;
    /** Log timing information for Act.start() */
    startTime?: boolean;
    /** Enable HTML sanitization for insertContent operations */
    sanitize?: boolean;
    /** Custom sanitizer function (e.g., DOMPurify.sanitize). Required when sanitize is true. */
    sanitizer?: ((html: string) => string) | null;
  }

  const config: Config;

  /**
   * Act.js version string
   */
  const version: string;

  // ============================================================================
  // Core API
  // ============================================================================

  /**
   * Configure Act.js with options from meta tags or window.__actConfig
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
  function init(root: Element, bindRoot?: boolean, force?: boolean): void;

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
      def: (ctx: Context, target: any, opts: any, args: any[]) => void;
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
      /** Halt a running event */
      kill: (ctx: Context, target: any, opts: any, args: any[]) => Promise<boolean>;
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
      /** Declare or nullify a variable */
      let: (ctx: Context, target: any, opts: any, args: any[]) => Promise<any>;
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
      transition(...args: any[]): Promise<void>;
      /** Trigger a custom event on the element */
      trigger(e: string, bubbles?: boolean, detail?: any): Element;
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

    /** Methods available for Object targets */
    object: {
      /** Move content to an element */
      move_to(el: Element, pos?: string): any;
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
    readonly PROP: '__act__';
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

    /**
     * Get or create a binding for an element
     * @param element - Element to get binding for
     * @param create - If true, create a new binding if none exists
     */
    from(element: Element, create?: boolean): Binding | undefined;

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
     */
    scan(root: Element, bindRoot?: boolean, force?: boolean): void;
  }

  // ============================================================================
  // Internal Classes (exposed for advanced usage)
  // ============================================================================

  class Lexer {
    static debug: boolean;
    static Token: new (type: string, value: string, index: number, line: number, column: number) => Token;
    static VALUES: Record<string, string>;
    static PREFIXES: string[];
    static EXPRESSIONS: Record<string, string>;
    static OPERATORS: Record<string, string>;
    static SENTENCE_END: Record<string, string>;
    static TOKENS: Array<[string, RegExp]>;
    static TPL_TOKENS: Array<[string, RegExp]>;

    constructor(input: string);
    hasMoreTokens(): boolean;
    next(): this;
    consume(...types: string[]): this | boolean;
    peek(): Token;
    prev(): Token;
    fwd(): this;
    fwdWithComma(): this;
    tokenIs(...types: string[]): boolean;
    tokenIsEnd(): boolean;
    tokenIsValue(): boolean;
    tokenIsExpression(): boolean;
    tokenIsOperator(): string | undefined;
    expect(...types: string[]): this;
    expectValue(): this;
    expectEnd(): this;
    nextIf(...types: string[]): this | false;
    fail(message: string): never;
  }

  class Parser {
    static debug: boolean;
    constructor(source: Source);
    parse(): Scope;
    isKeyword(word: any): boolean;
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

  interface Source {
    readonly code: string;
    readonly element: Element;
    readonly type: 'directAttribute' | 'inlineScript' | 'externalScript' | 'actrun';
    readonly scope: Scope | null;
    readonly attr: Attr | null;
    readonly args: string[];
  }

  interface Scope extends Solvable {
    readonly value: Sentence[];
    isRoot(): boolean;
    lookup(ctx: Context, key: string, defaultThisScope?: boolean): Result | undefined;
  }

  interface Sentence extends Solvable {
    readonly mode: 'sync' | 'async' | 'condition' | 'branch' | 'fwd';
    readonly target?: Solvable;
  }

  interface Context {
    readonly binding: Binding;
    readonly target: any;
    readonly event: Event | null;
    readonly eventManager: EventManager;
    readonly source: Source;
    readonly data: WeakMap<Scope, Record<string, any>>;
    solve(value: any, target: any, opts?: any): Promise<any>;
    solveAll(values: any[], target: any, opts?: any): Promise<any[]>;
    asString(value: any, target: any, opts?: any): Promise<string>;
    asValueOf(value: any, target: any, opts?: any): Promise<any>;
    scopeData(scope: Scope): Record<string, any>;
    spawn(): Context;
  }

  interface Binding {
    readonly element: Element;
    readonly data: Record<string, any>;
    readonly events: Record<string, EventManager>;
    readonly blocks: Record<string, Source>;
    parent(): Binding | undefined;
    getBlock(name: string): Source | undefined;
    lookupBlock(name: string): { block: Source; binding: Binding } | undefined;
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
    halt: boolean;
    alias?: string;
    observer?: {
      intersectionObserver: IntersectionObserver;
      mutationObserver: MutationObserver | null;
    };
    run(target: any, event?: Event): Promise<any>;
    attach(context: Context): void;
    detach(context: Context): void;
  }

  /** Function marked as an Act method that receives context, target, and opts */
  interface ActMethod {
    (ctx: Context, target: any, opts: any, ...args: any[]): any;
    [Symbol.toStringTag]?: string;
  }
}

// ============================================================================
// Global API
// ============================================================================

interface Window {
  Act: typeof Act;
  /** Optional configuration object for Act.js */
  __actConfig?: Partial<Act.Config>;
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
