/**
 * @module
 * Server-side module for defining client functions that can be serialized and
 * sent to the browser. Use this to define event handlers in your server code
 * that will be automatically bundled and loaded on-demand in the client.
 *
 * @example
 * ```ts
 * import { ClientFunction, handlers } from "@reece/client-functions";
 *
 * const handleClick = new ClientFunction("handleClick", function(this: HTMLElement, event: MouseEvent) {
 *   console.log("Button clicked!", this, event);
 * }, import.meta.url);
 *
 * // Use in JSX: <button onclick={handleClick.handleClick}>Click me</button>
 * ```
 */

import * as esbuild from "esbuild";

/**
 * Cache structure for storing function hashes to avoid recomputation
 */
type ClientFunctionCacheV1 = {
  version: 1;
  files: Record<
    string,
    {
      mtimeMs: number;
      handlers: Record<string, string>;
    }
  >;
};

const CACHE_PATH = "./.clientFunctionCache.json";
let cacheLoaded = false;
let cacheDirty = false;
let cacheFlushScheduled = false;

let cache: ClientFunctionCacheV1 = {
  version: 1,
  files: {},
};

function loadCacheOnce() {
  if (cacheLoaded) return;
  cacheLoaded = true;
  try {
    const text = Deno.readTextFileSync(CACHE_PATH);
    const parsed = JSON.parse(text) as Partial<ClientFunctionCacheV1>;
    if (
      parsed &&
      parsed.version === 1 &&
      parsed.files &&
      typeof parsed.files === "object"
    ) {
      cache = parsed as ClientFunctionCacheV1;
    }
  } catch {
    // ignore missing/invalid cache
  }
}

function scheduleCacheFlush() {
  if (!cacheDirty || cacheFlushScheduled) return;
  cacheFlushScheduled = true;
  queueMicrotask(() => {
    cacheFlushScheduled = false;
    if (!cacheDirty) return;
    try {
      Deno.writeTextFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
      cacheDirty = false;
    } catch {
      // ignore write errors
    }
  });
}

const sourceFileMtimeMemo = new Map<string, number | null>();

function getSourceFileMtimeMs(sourceFileUrl: string): number | null {
  const memo = sourceFileMtimeMemo.get(sourceFileUrl);
  if (memo !== undefined) return memo;
  try {
    const stat = Deno.statSync(new URL(sourceFileUrl));
    const value = stat.mtime ? stat.mtime.getTime() : null;
    sourceFileMtimeMemo.set(sourceFileUrl, value);
    return value;
  } catch {
    sourceFileMtimeMemo.set(sourceFileUrl, null);
    return null;
  }
}

// deno-lint-ignore no-explicit-any
type AnyFunction = (...args: any[]) => any;

/**
 * Map of all registered handlers. Use this to iterate over handlers
 * and build their client-side code.
 */
export const handlers: Map<AnyFunction, ClientFunctionImpl> = new Map<
  AnyFunction,
  ClientFunctionImpl
>();

const importsBySourceFileUrl = new Map<string, Map<string, string>>();

function getImportRegistry(sourceFileUrl?: string): Map<string, string> {
  const key = sourceFileUrl ?? "__global__";
  const existing = importsBySourceFileUrl.get(key);
  if (existing) return existing;
  const created = new Map<string, string>();
  importsBySourceFileUrl.set(key, created);
  return created;
}

class ClientFunctionImpl<
  T extends AnyFunction = AnyFunction,
  FName extends string = string,
> {
  /** The name of the function */
  fnName: FName;
  /** The original function */
  fn: T;
  /** The generated filename (without extension) */
  filename: string;
  /** The source file URL where this function was defined */
  sourceFileUrl?: string;

  /**
   * Create a new ClientFunction that can be used as an event handler.
   *
   * @param fnName - The name of the function (used for the handler attribute)
   * @param fn - The function to wrap
   * @param sourceFileUrl - Optional source file URL (usually `import.meta.url`)
   */
  constructor(fnName: FName, fn: T, sourceFileUrl?: string) {
    if (typeof fn !== "function") {
      throw new Error("ClientFunction requires a function");
    }

    loadCacheOnce();

    let cachedFilename: string | undefined;
    let sourceMtimeMs: number | null = null;
    if (sourceFileUrl) {
      sourceMtimeMs = getSourceFileMtimeMs(sourceFileUrl);
      if (sourceMtimeMs !== null) {
        const existingEntry = cache.files[sourceFileUrl];
        if (!existingEntry || existingEntry.mtimeMs !== sourceMtimeMs) {
          cache.files[sourceFileUrl] = { mtimeMs: sourceMtimeMs, handlers: {} };
          cacheDirty = true;
          scheduleCacheFlush();
        }

        cachedFilename = cache.files[sourceFileUrl].handlers[fnName];
      }
    }

    let resolvedFilename: string;
    if (cachedFilename) {
      resolvedFilename = cachedFilename;
    } else {
      console.log(
        "Generating filename for ClientFunction by hashing: ",
        fnName,
      );
      const str = fn.toString();
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
      }
      resolvedFilename = `${fnName}_${Math.abs(hash).toString(16)}`;

      if (sourceFileUrl && sourceMtimeMs !== null) {
        cache.files[sourceFileUrl] ??= { mtimeMs: sourceMtimeMs, handlers: {} };
        cache.files[sourceFileUrl].handlers[fnName] = resolvedFilename;
        cacheDirty = true;
        scheduleCacheFlush();
      }
    }

    Object.defineProperty(fn, "name", { value: fnName });
    this.fnName = fnName;
    this.fn = fn;
    this.filename = resolvedFilename;
    this.sourceFileUrl = sourceFileUrl;
    // deno-lint-ignore no-explicit-any
    (this as any)[fnName] =
      `handlers.${this.filename}(this, event)` as unknown as T;

    handlers.set(fn, this);
    const registry = getImportRegistry(sourceFileUrl);
    registry.set(fnName, this.filename);
  }

  /**
   * Register this function as an import in another source file.
   * This allows the function to be imported in other client functions.
   */
  register(targetSourceFileUrl: string | URL): this {
    const key = typeof targetSourceFileUrl === "string"
      ? targetSourceFileUrl
      : targetSourceFileUrl.toString();

    const registry = getImportRegistry(key);
    registry.set(this.fnName, this.filename);
    return this;
  }

  /**
   * Build the client-side JavaScript code for this handler.
   * Uses esbuild to transform TypeScript to JavaScript.
   */
  async buildCode(): Promise<string> {
    console.log("Building code for handler: ", this.fn.name);

    const registry = getImportRegistry(this.sourceFileUrl);
    const importLines: string[] = [];
    for (const [name, filename] of registry.entries()) {
      // Avoid self-imports; they are unnecessary and can create circular deps.
      if (name === this.fnName || filename === this.filename) continue;
      importLines.push(
        `import { default as ${name} } from "./${filename}.js";`,
      );
    }

    const functionCode = `${
      importLines.join(
        "\n",
      )
    }\nexport default ${this.fn.toString()}`;
    console.log("Function code: ", functionCode);
    const result = await esbuild.transform(functionCode, {
      loader: "ts",
      format: "esm",
      target: ["esnext"],
      sourcemap: false,
    }).catch((err) => {
      console.error("Esbuild transform error: ", err);
      return { code: functionCode };
    });

    return result.code;
  }
}

/**
 * Create a client-side function that can be used as an event handler.
 *
 * The returned object has a property with the function name that contains
 * the handler string for use in HTML/JSX attributes.
 *
 * @example
 * ```ts
 * const handleClick = new ClientFunction("handleClick", function(event: MouseEvent) {
 *   alert("Clicked!");
 * }, import.meta.url);
 *
 * // In JSX:
 * <button onclick={handleClick.handleClick}>Click me</button>
 * ```
 */
export const ClientFunction = ClientFunctionImpl as {
  new <T extends AnyFunction = AnyFunction, FName extends string = string>(
    fnName: FName,
    fn: T,
    sourceFileUrl?: string,
  ): ClientFunctionImpl<T, FName> & { [K in FName]: T };
};

export type { AnyFunction };
