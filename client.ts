/**
 * @module
 * Client-side script that provides the handler proxy for lazy-loading
 * event handlers. This runs automatically when loaded in the browser.
 *
 * @example
 * ```html
 * <script type="module" src="/clientFunctions.js"></script>
 * ```
 */

/**
 * Type for the global handlers proxy object
 */
type HandlerProxy = {
  // deno-lint-ignore no-explicit-any
  [key: string]: (...args: any[]) => void | Promise<void>;
};

/**
 * Creates a handler proxy that lazy-loads handler functions on demand.
 * When a handler is called, it will dynamically import the corresponding
 * JavaScript file and cache it for subsequent calls.
 *
 * @param basePath - Base path for loading handler scripts (default: ".")
 * @returns The proxy object for handlers
 */
function createHandlerProxy(basePath = "."): HandlerProxy {
  return new Proxy<HandlerProxy>({} as HandlerProxy, {
    get(target, prop, receiver): ((...args: unknown[]) => unknown) | undefined {
      if (typeof prop === "symbol") return undefined;

      if (prop in target) {
        // deno-lint-ignore no-explicit-any
        return (...args: any[]): unknown => {
          const [thisValue, ...rest] = args;
          return Reflect.get(target, prop, receiver).call(thisValue, ...rest);
        };
      }
      const callFunctionName = prop.toString();
      const scriptContent = import(`${basePath}/${callFunctionName}.js`).then(
        ({ default: scriptContent }) => {
          console.log(`Handler function "${callFunctionName}" imported.`);
          target[callFunctionName] = scriptContent;
          return scriptContent;
        },
      );

      // deno-lint-ignore no-explicit-any
      return async (...args: any[]): Promise<unknown> => {
        const scriptFunction = await scriptContent;
        const [thisValue, ...rest] = args;
        return scriptFunction.call(thisValue, ...rest);
      };
    },
  });
}

/**
 * Sets up the global `handlers` object on `globalThis`.
 *
 * @param basePath - Base path for loading handler scripts (default: ".")
 */
function setupHandlers(basePath = "."): void {
  // deno-lint-ignore no-explicit-any
  (globalThis as any).handlers = createHandlerProxy(basePath);
}

// Auto-initialize when loaded in browser
setupHandlers();
