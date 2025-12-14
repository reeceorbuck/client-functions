/**
 * Type for the global handlers proxy object
 */
export type HandlerProxy = {
  [key: string]: (...args: any[]) => void | Promise<void>;
};

/**
 * Creates a handler proxy that lazy-loads handler functions on demand.
 * @param basePath - Base path for loading handler scripts (default: ".")
 * @returns The proxy object for handlers
 */
export function createHandlerProxy(basePath?: string): HandlerProxy;

/**
 * Sets up the global `handlers` object on `globalThis`.
 * @param basePath - Base path for loading handler scripts (default: ".")
 */
export function setupHandlers(basePath?: string): void;
