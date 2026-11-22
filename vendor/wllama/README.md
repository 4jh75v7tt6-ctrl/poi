# wllama 2.3.7 for POI

This folder contains a local ESM packaging of the exact upstream wllama 2.3.7
TypeScript sources and the unmodified upstream single-thread WebAssembly binary.
The source commit is `5e63e3b226a077b33dc7c608f1fe630f3d21f539`.

## Runtime files

- `index.js` is the single ESM entry. Its worker programs are embedded strings;
  it does not import another JavaScript module or a CDN dependency.
- `wllama.wasm` is the official `src/single-thread/wllama.wasm` at that commit.

Both runtime files must be available locally or in the application cache. The
model is a separate initial download. The selected Qwen2.5-0.5B-Instruct Q4_K_M
GGUF is 491,400,032 bytes and is not included in this folder. Its immutable URL,
expected SHA-256, and license are recorded in `PROVENANCE.json`.

The ESM was compiled locally because the source files were available through the
GitHub read connector while the npm bundle was served inline. It is not presented
as the byte-for-byte npm `index.min.js` distribution. No upstream inference or
cache logic was changed.

## Reproduce the ESM

Use the exact upstream checkout above, Node 24.22.3, and Playwright 1.62.1. The
build script uses the Babel copy already included in Playwright; it downloads
nothing. Set `CODEX_PRIMARY_RUNTIME_NODE_MODULES` when using the provided runtime,
or install the pinned Playwright build dependency in the normal Node resolution
path in a separate development environment.

```sh
node dist/vendor/wllama/build-from-sources.cjs /path/to/wllama-2.3.7
```

The script checks the Git blob SHA-1 of all nine source files, erases TypeScript,
transforms the module syntax using Babel, and wraps the closed module graph in a
small local loader. It rejects missing dependencies and external imports. The
loader preserves module caching and the upstream circular references. The output
has the same named public API as upstream `src/index.ts`.

`PROVENANCE.json` records the inputs, output hashes, build command, and licenses.
A second build produced identical bytes. The resulting module was imported and
its public API instantiated under Node; the WASM was validated and compiled.
Those checks do not demonstrate model quality, inference performance, or physical
iPhone compatibility.

## Browser scope

The selected mode is CPU inference in one worker, using WebAssembly SIMD128,
legacy exception handling, and 32-bit memory. It does not require JSPI, MEMORY64,
WebGPU, or multithreaded SharedArrayBuffer support. OPFS is used for the model
cache. Safari 16.4 or later is a feature-based baseline to check, not a device
certification. Actual model loading and generation still need to succeed on the
target phone with its available memory and storage.

All retained third-party license texts are in the `LICENSE-*.txt` files.
