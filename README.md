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

Use the build function to compile all registered handlers to JavaScript files:

```ts
import { buildScriptFiles } from "@reece/client-functions";

// Build all handlers to ./public directory
const result = await buildScriptFiles({
  clientDir: "./client", // Directory with client .ts/.tsx files
  publicDir: "./public", // Output directory for .js files
  cleanup: true, // Remove old files no longer in use
  verbose: true, // Log progress
  minify: false, // Minify output files
});

console.log("Built files:", result.files);
console.log("Build time:", result.timings.total, "ms");
```

This will also output `clientFunctions.js` to your public directory, which sets up the handler proxy automatically.

### Client-side

Include the built `clientFunctions.js` in your HTML to enable the lazy-loading handler proxy:

```html
<script type="module" src="/public/clientFunctions.js"></script>
```

The script automatically sets up `globalThis.handlers` when loaded, so your event handlers like `onclick="handlers.handleClick(this, event)"` will work immediately.

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
JavaScript. Also builds `clientFunctions.js` from the library's client script.

**Options:**

- `clientDir` - Source directory for .ts/.tsx files (default: `"./client"`)
- `publicDir` - Output directory for .js files (default: `"./public"`)
- `cleanup` - Remove files no longer in use (default: `true`)
- `verbose` - Log progress to console (default: `true`)
- `minify` - Minify output JavaScript files (default: `false`)

**Returns:**

- `files` - Array of built file names (without extension)
- `timings` - Object with `scan`, `build`, `cleanup`, and `total` durations in
  ms

### `transpileClientFile(fileName, clientDir?, publicDir?, verbose?, minify?): Promise<string>`

Transpile a single TypeScript/TSX file to JavaScript. Uses mtime-based caching.

## License

MIT
