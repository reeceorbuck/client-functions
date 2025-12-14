/**
 * @module
 * Build utilities for compiling client functions and scripts to JavaScript files.
 * Use this in your build process to output handler files to a directory that
 * can be served statically.
 *
 * @example
 * ```ts
 * import { buildScriptFiles } from "@reece/client-functions/build";
 *
 * await buildScriptFiles({
 *   clientDir: "./client",
 *   publicDir: "./public",
 * });
 * ```
 */

import * as esbuild from "esbuild";
import { handlers } from "./mod.ts";

/**
 * Configuration options for building script files
 */
export interface BuildOptions {
  /**
   * Directory containing client-side TypeScript files to transpile.
   * @default "./client"
   */
  clientDir?: string;

  /**
   * Output directory for built JavaScript files.
   * @default "./public"
   */
  publicDir?: string;

  /**
   * Whether to clean up files in publicDir that are no longer registered.
   * @default true
   */
  cleanup?: boolean;

  /**
   * Whether to log build progress to console.
   * @default true
   */
  verbose?: boolean;

  /**
   * Whether to minify the output JavaScript files.
   * @default false
   */
  minify?: boolean;
}

/**
 * Result of the build process
 */
export interface BuildResult {
  /** Names of all built/existing handler files (without extension) */
  files: string[];
  /** Performance timing measurements */
  timings: {
    scan: number;
    build: number;
    cleanup: number;
    total: number;
  };
}

/**
 * Build all registered client functions and client scripts to JavaScript files.
 *
 * This function:
 * 1. Scans the clientDir for .ts/.tsx files
 * 2. Builds handler files from all registered ClientFunctions
 * 3. Transpiles client TypeScript files to JavaScript
 * 4. Optionally cleans up old files no longer in use
 *
 * @param options - Build configuration options
 * @returns Build result with file list and timing information
 *
 * @example
 * ```ts
 * import { ClientFunction, handlers } from "@reece/client-functions";
 * import { buildScriptFiles } from "@reece/client-functions/build";
 *
 * // Define your handlers
 * const handleClick = new ClientFunction("handleClick", function() {
 *   console.log("clicked");
 * }, import.meta.url);
 *
 * // Build all handlers to ./public
 * const result = await buildScriptFiles({
 *   publicDir: "./public",
 *   clientDir: "./client",
 * });
 *
 * console.log("Built files:", result.files);
 * ```
 */
export async function buildScriptFiles(
  options: BuildOptions = {},
): Promise<BuildResult> {
  const {
    clientDir = "./client",
    publicDir = "./public",
    cleanup = true,
    verbose = true,
    minify = false,
  } = options;

  const log = verbose ? console.log.bind(console) : () => {};

  performance.mark("buildScriptFiles:begin");

  // Ensure output directory exists
  await Deno.mkdir(publicDir, { recursive: true }).catch(() => {});

  performance.mark("buildScriptFiles:scanStart");
  let clientFiles: Deno.DirEntry[] = [];
  try {
    clientFiles = (await Array.fromAsync(Deno.readDir(clientDir)))
      .filter((entry) => entry.isFile)
      .filter(
        (entry) => entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"),
      );
  } catch {
    // clientDir doesn't exist, that's fine
  }
  performance.mark("buildScriptFiles:scanEnd");

  log(
    "Client script files to process:",
    clientFiles.map((s) => s.name),
  );

  performance.mark("buildScriptFiles:buildStart");
  const files = await Promise.all([
    // Build client.ts as clientFunctions.js
    (async () => {
      const clientFunctionsOut = `${publicDir}/clientFunctions.js`;
      const clientFunctionsSrc = new URL("./client.ts", import.meta.url);
      const denoJsonUrl = new URL("./deno.json", import.meta.url);
      
      // Get the package version
      const denoJsonText = denoJsonUrl.protocol === "file:"
        ? await Deno.readTextFile(denoJsonUrl)
        : await fetch(denoJsonUrl).then((r) => r.text());
      const { version } = JSON.parse(denoJsonText) as { version: string };
      const versionComment = `// @reece/client-functions v${version}`;
      
      // Check if output exists and has matching version
      const existingCode = await Deno.readTextFile(clientFunctionsOut).catch(() => null);
      if (existingCode?.startsWith(versionComment)) {
        log(`clientFunctions.js already up to date (v${version}), skipping.`);
        return "clientFunctions";
      }
      
      // Read source - use fetch for remote URLs, readTextFile for local
      const inputCode = clientFunctionsSrc.protocol === "file:"
        ? await Deno.readTextFile(clientFunctionsSrc)
        : await fetch(clientFunctionsSrc).then((r) => r.text());
      
      const result = await esbuild.transform(inputCode, {
        loader: "ts",
        format: "esm",
        target: ["esnext"],
        sourcemap: false,
        minify,
      });
      
      // Prepend version comment to output
      const outputCode = `${versionComment}\n${result.code}`;
      await Deno.writeTextFile(clientFunctionsOut, outputCode);
      log(`clientFunctions.js written: ${clientFunctionsOut}`);
      return "clientFunctions";
    })(),
    ...Array.from(handlers.values()).map(async (handler) => {
      const { filename } = handler;
      log("Registered handler: ", filename);

      const fileExists = await Deno.stat(`${publicDir}/${filename}.js`)
        .then(() => true)
        .catch(() => false);

      if (fileExists) {
        log(`File for handler ${filename} already exists, skipping build.`);
        return filename;
      }

      log(`Building file for handler:`, handler.buildCode);
      const functionCode = await handler.buildCode(minify);
      return Deno.writeTextFile(`${publicDir}/${filename}.js`, functionCode)
        .then(
          () => {
            log(`Handler file written: ${publicDir}/${filename}.js`);
            return filename;
          },
        );
    }),
    ...clientFiles.map((entry) =>
      transpileClientFile(entry.name, clientDir, publicDir, verbose, minify)
    ),
  ]);
  performance.mark("buildScriptFiles:buildEnd");

  log("Handler files: ", files);

  // Clean up files that are no longer registered
  performance.mark("buildScriptFiles:cleanupStart");
  if (cleanup) {
    for await (const dirEntry of Deno.readDir(publicDir)) {
      if (dirEntry.isFile && dirEntry.name.endsWith(".js")) {
        const fileName = dirEntry.name.split(".")[0];
        if (!files.includes(fileName)) {
          log("Removing file: ", dirEntry.name);
          await Deno.remove(`${publicDir}/${dirEntry.name}`);
        }
      }
    }
  }
  performance.mark("buildScriptFiles:cleanupEnd");
  performance.mark("buildScriptFiles:end");

  const scanMeasure = performance.measure(
    "buildScriptFiles:scan",
    "buildScriptFiles:scanStart",
    "buildScriptFiles:scanEnd",
  );
  const buildMeasure = performance.measure(
    "buildScriptFiles:build",
    "buildScriptFiles:buildStart",
    "buildScriptFiles:buildEnd",
  );
  const cleanupMeasure = performance.measure(
    "buildScriptFiles:cleanup",
    "buildScriptFiles:cleanupStart",
    "buildScriptFiles:cleanupEnd",
  );
  const totalMeasure = performance.measure(
    "buildScriptFiles:total",
    "buildScriptFiles:begin",
    "buildScriptFiles:end",
  );

  return {
    files,
    timings: {
      scan: scanMeasure.duration,
      build: buildMeasure.duration,
      cleanup: cleanupMeasure.duration,
      total: totalMeasure.duration,
    },
  };
}

/**
 * Transpile a single TypeScript/TSX file to JavaScript.
 *
 * Uses mtime-based caching to skip files that haven't changed.
 *
 * @param fileName - Name of the file to transpile
 * @param clientDir - Source directory
 * @param publicDir - Output directory
 * @param verbose - Whether to log progress
 * @returns The base name of the output file (without extension)
 */
export async function transpileClientFile(
  fileName: string,
  clientDir = "./client",
  publicDir = "./public",
  verbose = true,
  minify = false,
): Promise<string> {
  const log = verbose ? console.log.bind(console) : () => {};

  const inPath = `${clientDir}/${fileName}`;
  const outBaseName = fileName.replace(/\.(ts|tsx)$/i, "");
  const outPath = `${publicDir}/${outBaseName}.js`;

  const sourceStat = await Deno.stat(inPath);
  const sourceMtimeMs = sourceStat.mtime?.getTime() ?? null;

  const existingOutStat = await Deno.stat(outPath).catch(() => null);
  const outMtimeMs = existingOutStat?.mtime?.getTime() ?? null;

  // mtime-based cache: if output exists and is newer/equal to source, skip.
  if (
    sourceMtimeMs !== null &&
    outMtimeMs !== null &&
    outMtimeMs >= sourceMtimeMs
  ) {
    log(`Client script unchanged, skipping: ${outPath}`);
    return outBaseName;
  }

  const inputCode = await Deno.readTextFile(inPath);
  const loader = fileName.toLowerCase().endsWith(".tsx") ? "tsx" : "ts";
  const result = await esbuild.transform(inputCode, {
    loader,
    format: "esm",
    target: ["esnext"],
    sourcemap: false,
    minify,
  });

  await Deno.writeTextFile(outPath, result.code);
  log(`Client script written: ${outPath}`);
  return outBaseName;
}
