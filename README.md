# @reece/client-functions

A Deno library for defining server-side functions that automatically become
lazy-loaded client-side event handlers.

## Features

- 🚀 **Server-side definition** - Define event handlers in your server code
- 📦 **Automatic bundling** - Functions are transpiled with esbuild
- ⚡ **Lazy loading** - Handlers are only loaded when first used
- 🔗 **Import support** - Client functions can import other client functions
- 💾 **Caching** - Function hashes are cached to avoid recomputation
- 🛠️ **Build utilities** - Easily compile all handlers to a public directory

## Installation

```bash
deno add @reece/client-functions
```

## Usage

### Server-side (mod.ts)

```ts
import { ClientFunction, handlers } from "@reece/client-functions";

// Define a client function
const handleClick = new ClientFunction(
  "handleClick",
  function (this: HTMLElement, event: MouseEvent) {
    console.log("Button clicked!", this, event);
    this.textContent = "Clicked!";
  },
  import.meta.url,
);

// Use in JSX/HTML - the property name matches the function name
const html = `<button onclick="${handleClick.handleClick}">Click me</button>`;
```

### Building handler files

Use the build module to compile all registered handlers to JavaScript files:

```ts
import { buildScriptFiles } from "@reece/client-functions/build";

// Build all handlers to ./public directory
const result = await buildScriptFiles({
  clientDir: "./client", // Directory with client .ts/.tsx files
  publicDir: "./public", // Output directory for .js files
  cleanup: true, // Remove old files no longer in use
  verbose: true, // Log progress
});

console.log("Built files:", result.files);
console.log("Build time:", result.timings.total, "ms");
```

### Client-side

Include the client module in your HTML to enable the lazy-loading handler proxy:

**Option 1: Use the pre-built minified version (recommended for browsers)**

```html
<script type="module">
  import { setupHandlers } from "https://jsr.io/@reece/client-functions/0.1.0/client.min.js";
  setupHandlers(); // Sets up globalThis.handlers
</script>
```

Or copy `client.min.js` to your static files and serve it locally:

```html
<script type="module">
  import { setupHandlers } from "/static/client.min.js";
  setupHandlers("/static/handlers"); // Load handlers from /static/handlers/*.js
</script>
```

**Option 2: Import from JSR (for bundlers)**

```html
<script type="module">
  import { setupHandlers } from "@reece/client-functions/client";
  setupHandlers(); // Sets up globalThis.handlers
</script>
```

Or if you're bundling your client code:

```ts
import { setupHandlers } from "@reece/client-functions/client";
setupHandlers();
```

You can also specify a custom base path for loading handler scripts:

```ts
setupHandlers("/static/handlers"); // Will load from /static/handlers/handlerName.js
```

### Importing between client functions

Client functions can import other client functions:

```ts
// Define a utility function
const logEvent = new ClientFunction(
  "logEvent",
  function (eventType: string, data: unknown) {
    console.log(`[${eventType}]`, data);
  },
  import.meta.url,
);

// Use it in another handler (same source file)
const handleSubmit = new ClientFunction(
  "handleSubmit",
  function (this: HTMLFormElement, event: SubmitEvent) {
    event.preventDefault();
    logEvent("submit", new FormData(this));
  },
  import.meta.url,
);

// Or register for use in a different source file
logEvent.register(import.meta.url);
```

## API

### `ClientFunction`

```ts
new ClientFunction<T, FName>(fnName: FName, fn: T, sourceFileUrl?: string)
```

Creates a new client function.

- `fnName` - The name of the function (becomes a property on the instance)
- `fn` - The function to wrap
- `sourceFileUrl` - Optional source file URL for caching and imports (use
  `import.meta.url`)

### `handlers`

```ts
export const handlers: Map<Function, ClientFunctionImpl>;
```

A Map of all registered handlers. Useful for iterating and building all client
code.

### `buildScriptFiles(options?: BuildOptions): Promise<BuildResult>`

Builds all registered client functions and client TypeScript files to
JavaScript.

**Options:**

- `clientDir` - Source directory for .ts/.tsx files (default: `"./client"`)
- `publicDir` - Output directory for .js files (default: `"./public"`)
- `cleanup` - Remove files no longer in use (default: `true`)
- `verbose` - Log progress to console (default: `true`)

**Returns:**

- `files` - Array of built file names (without extension)
- `timings` - Object with `scan`, `build`, `cleanup`, and `total` durations in
  ms

### `transpileClientFile(fileName, clientDir?, publicDir?, verbose?): Promise<string>`

Transpile a single TypeScript/TSX file to JavaScript. Uses mtime-based caching.

### `HandlerProxy` (client-side)

The type for the global `handlers` object that lazy-loads handler functions on
demand.

### `setupHandlers(basePath?: string): void`

Sets up the global `handlers` object on `globalThis`. Call this once when your
client-side code initializes.

### `createHandlerProxy(basePath?: string): HandlerProxy`

Creates a handler proxy without setting it globally. Useful if you need multiple
proxies or custom setup.

## License

MIT
