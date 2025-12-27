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
    /** Global methods available to all targets */
    globals: {
      listens_to(eventName: string): boolean;
      is_running(eventName?: string | null): boolean | number | null;
      tick(): Promise<void>;
      wait(time: number | string): Promise<void>;
      log_raw(...args: any[]): void;
      log(...args: any[]): void;
      warn(...args: any[]): void;
      error(...args: any[]): void;
      time_to_ms(time: number | string): number;
      random(min: number, max: number): number;
      delay: ActMethod;
      lock: ActMethod;
      unlock: ActMethod;
      is_locked: ActMethod;
      [key: string]: ((...args: any[]) => any) | ActMethod;
    };

    /** Methods available for Element targets */
    Element: {
      matches(selector: string): boolean | null;
      hide(): void;
      show(): void;
      transition(...args: any[]): Promise<void>;
      move_to(element: Element | Result | string, position?: string): Element;
      empty(): void;
      prepend(content: any): Element;
      append(content: any): Element;
      fade(inout: 'in' | 'out', time?: number | string, timing?: string): Promise<void>;
      remove(): void;
      collapse(time?: number | string, timing?: string): Promise<void>;
      is_in_view(partially?: boolean): boolean | 'partially';
      next(selector?: string): Element | null;
      previous(selector?: string): Element | null;
      parent(): Node | null;
      on_match: ActMethod;
      take(taken: any, selector?: string): Element;
      toggle: ActMethod;
      add: ActMethod;
      has: ActMethod;
      trigger(e: string, bubbles?: boolean, detail?: any): Element;
      [key: string]: ((...args: any[]) => any) | ActMethod;
    };

    /** Methods available for Array targets */
    Array: {
      map(fn: (item: any, i: number, arr: any[]) => any): Promise<any[]>;
      filter(fn: (item: any, i: number, arr: any[]) => any): Promise<any[]>;
      for_each(fn: (item: any, i: number, arr: any[]) => any): Promise<void>;
      find(fn: (item: any, i: number, arr: any[]) => any): Promise<any>;
      find_index(fn: (item: any, i: number, arr: any[]) => any): Promise<number>;
      some(fn: (item: any, i: number, arr: any[]) => any): Promise<boolean>;
      every(fn: (item: any, i: number, arr: any[]) => any): Promise<boolean>;
      [key: string]: (...args: any[]) => any;
    };

    /** Methods available for Object/Array/Collection targets */
    object: {
      first(): any;
      last(): any;
      move_to(el: Element, pos?: string): any[];
      [key: string]: (...args: any[]) => any;
    };

    /** Methods available for Function targets */
    function: Record<string, (...args: any[]) => any>;

    /** Methods available for String targets */
    string: {
      after(str: string): string;
      before(str: string): string;
      between(start: string, end: string): string;
      capitalize(): string;
      [key: string]: (...args: any[]) => any;
    };

    boolean: Record<string, (...args: any[]) => any>;
    number: Record<string, (...args: any[]) => any>;
    bigint: Record<string, (...args: any[]) => any>;
    symbol: Record<string, (...args: any[]) => any>;
    undefined: Record<string, (...args: any[]) => any>;

    /** Keyword operations (like if, each, loop, etc.) */
    keywords: {
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
      [key: string]: (ctx: Context, target: any, opts: any, args: any[]) => any;
    };

    /** Prefix operations (like not, local, scoped, etc.) */
    prefixes: Record<string, (ctx: Context, target: any, opts: any, value: any) => Promise<any>>;

    /** Reserved word values (like me, debugger, etc.) */
    words: Record<string, any>;
  }

  const Library: Library;

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

    constructor(input: string);
    hasMoreTokens(): boolean;
    next(): this;
    consume(...types: string[]): this | boolean;
    peek(): Token;
  }

  class Parser {
    static debug: boolean;
    constructor(source: Source);
    parse(): Scope;
  }

  // ============================================================================
  // Errors & Signals
  // ============================================================================

  class ActError extends Error { }

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
  }

  interface Result {
    readonly value: any;
    readonly from: Solvable | undefined;
    readonly through: Result;
    valueOf(): any;
    toString(...args: any[]): string;
    set?(value: any): any;
  }

  interface Solvable {
    readonly scope: Scope;
    readonly source: Source;
    readonly value: any;
    solve(ctx: Context, target: any, opts: any): Promise<any>;
  }

  interface Source {
    readonly code: string;
    readonly element: Element;
    readonly type: string;
    readonly scope: Scope;
  }

  interface Scope extends Solvable {
    readonly value: Sentence[];
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
  }

  interface EventManager {
    readonly binding: Binding;
    readonly name: string;
    readonly scope: Scope;
    readonly source: Source;
    readonly options: Record<string, any>;
    readonly contexts: Set<Context>;
    lock: boolean;
    halt: boolean;
    run(target: any, event?: Event): Promise<any>;
    attach(context: Context): void;
    detach(context: Context): void;
  }

  /** Wrapper class for library methods that receive context, target, and opts */
  interface ActMethod {
    method: Function;
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
