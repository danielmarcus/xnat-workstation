# Writing a module

A **module** adds an operation to Workstation's Operations section (in the Annotations side
panel). It is a small package of JavaScript (and, if you like, WebAssembly) that receives part of
an image and returns a mask. Workstation does everything else: it chooses the region, shows the
parameters, runs the module in a sandbox, previews the result, honours locked segments, and
commits it as one undo step.

This guide covers the API (1.0), the manifest, packaging and signing, and testing. How modules
are kept apart from the app and your data is in [module-security.md](module-security.md); how an
edition bundles modules is in [editions.md](editions.md).

## Quick start

From a checkout of the repository (Node 20+, after `npm install`), copy the example, give it an
id of its own, make a publisher key, then pack, sign and check it:

<!-- quickstart:start -->
```bash
cp -R modules/examples/threshold my-module
sed -i.bak 's/org.xnat.examples.threshold/org.example.my-threshold/; s/"Intensity threshold"/"My threshold"/' my-module/manifest.json
rm my-module/manifest.json.bak
npm run module:keygen -- my-publisher
npm run module:pack -- my-module my-module.xwmodule --key my-publisher.private.pem --signer "My Lab"
npm run module:verify -- my-module.xwmodule --trust my-publisher.public.json
```
<!-- quickstart:end -->

`module:verify` prints the module, `VERIFIED` and the key that signed it. To install it:

1. **Settings › Modules › Add trusted publisher…** and choose `my-publisher.public.json`.
2. **Install module…** and choose `my-module.xwmodule` (or drop it on the Modules page). It
   installs as **Verified** without a warning, and appears in the Operations picker's
   **Modules** group as *My threshold*.

Keep `my-publisher.private.pem` secret — whoever holds it can publish as you. Give people the
`public.json`. (This quick start is run as written by
`e2e/specs/modules/module-authoring-guide.e2e.ts`.)

## The package

A `.xwmodule` file is a zip of:

| File | |
|---|---|
| `manifest.json` | What the module is, reads, writes and asks for (below) |
| the entry script | An ES module exporting `run` (the manifest's `entry`) |
| anything else | Further scripts it imports, `.wasm` files, data — loaded by relative URL |
| `signature.json` | Added by `module:pack --key` / `module:sign`; never write it yourself |

Limits: 500 files, 128 MB a file, 256 MB in all; paths are relative, no `..`, no absolute
paths, no links.

## The manifest

```json
{
  "id": "org.example.my-threshold",
  "name": "My threshold",
  "version": "1.0.0",
  "apiVersion": "1.0",
  "runtime": "wasm-worker",
  "publisher": "My Lab",
  "license": "MIT",
  "description": "Shown in Settings › Modules and under the operation's name.",
  "entry": "module.js",
  "params": [
    { "key": "lower", "label": "From", "kind": "number", "min": -1000, "max": 3000, "step": 10, "default": 200, "unit": "HU" },
    { "key": "mode", "label": "Mode", "kind": "select", "options": [{ "value": "a", "label": "A" }, { "value": "b", "label": "B" }], "default": "a" },
    { "key": "largestOnly", "label": "Keep the largest island", "kind": "boolean", "default": false, "advanced": true }
  ],
  "reads": { "image": true, "members": "none", "seeds": false, "roi": false },
  "writes": { "target": "active", "mode": "add" },
  "scopes": ["slice", "range", "volume", "roi"],
  "postSteps": [{ "op": "fillHoles" }],
  "bytesPerVoxel": 6
}
```

| Field | |
|---|---|
| `id` | Reverse-DNS, lower case. Installing a package with the same id replaces it (an edition's bundled module cannot be replaced) |
| `version` | Semantic version |
| `apiVersion` | The API it was written for, `major.minor`. A host runs modules of its own major |
| `runtime` | `wasm-worker` — the only runtime API 1.0 has. A package naming another is refused, by name |
| `entry` | The `.js` / `.mjs` that exports `run` |
| `params` | The controls the operation shows, in order. `number` (a slider: `min`, `max`, `step`, `default` — the default must be `min` plus a whole number of steps, or the slider would show another value), `select`, `boolean`. `advanced: true` folds it under *Advanced*; `hint` is its tooltip |
| `reads` | What is posted to it — **nothing else is**. `image`: the image in the box; `members`: `none`, `active` or `all` segment masks; `seeds`: the seed strokes painted in the Seeded segmentation operation; `roi`: the ROI limit's rectangle |
| `writes.target` | `active` — the active segment; or `new` — segments it creates, listed in `newMembers` (1–8, each `{ name, color: [r, g, b] }`) |
| `writes.mode` | `add` — the mask joins the segment; `replace` — inside the box, the segment becomes the mask |
| `writes.claims` | `true` lets it take voxels from other (unlocked) segments; otherwise they keep theirs |
| `scopes` | Which of *Slice* (the one on screen), *Range* (of slices), *Volume*, *ROI limit* (its rectangle, through the volume) the user may choose |
| `postSteps` | Built-in Cleanup operations applied to the result, slice by slice (ids from the Cleanup catalog that need only the mask, e.g. `fillHoles`, `keepLargest`, `removeSpeckles`, `smoothEdges`) |
| `bytesPerVoxel` | Your peak memory per voxel of the box, for the memory estimate and guard (default 16) |

## API 1.0

```js
export async function run(input, api) {
  // …
  return { mask, table };
}
```

`run` may be synchronous or async. **`input`**:

| | |
|---|---|
| `api` | `"1.0"` |
| `dims` | `[nx, ny, nz]` — the box. Voxel `(x, y, z)` is at `x + nx * (y + ny * z)`: x fastest, then rows, then slices |
| `spacing` | `[sx, sy, sz]` in mm |
| `modality` | `"CT"`, `"MR"`, … |
| `scope` | The scope the user chose |
| `currentSlice` | The slice on screen, as a z in the box (−1 when it is outside the box) |
| `params` | `{ key: value }` for every parameter |
| `image` | `Float32Array` of `nx·ny·nz`, in modality units (HU on CT) — when `reads.image` |
| `members` | `[{ segmentIndex, name, active, mask: Uint8Array }]` — when `reads.members` |
| `seeds` | `[{ cls, radius, points: [[x, y, z], …] }]`, box coordinates; `cls` is `"active"`, `"background"` or another segment's index; `radius` in voxels — when `reads.seeds` |
| `roi` | `{ x0, y0, x1, y1 }`, box coordinates, or absent if none is drawn — when `reads.roi` |

The box is in the image's own grid (index space), so an oblique acquisition needs nothing
special.

**`api`**: `api.progress(fraction, note?)` drives the progress bar; `api.cancelled()` is true once
the user has pressed Cancel — check it in loops and return early (after 2 s a module that has not
returned is stopped anyway); `api.log(…)`, `api.warn(…)`, `api.error(…)` — and `console.*` —
write to the operation's log, which the user can copy or download.

**The result**: `mask`, a `Uint8Array` with one value per voxel of the box — `0` / `1` for
`target: "active"`; for `target: "new"`, `k` puts the voxel in the `k`-th of `newMembers` (only
segments that receive voxels are created). Any other length, or a value above the declared
labels, is refused with the reason. Optionally `table: { columns: [...], rows: [[...], …] }`,
shown under the operation. Throw an `Error` to fail with a message.

## What a module cannot do

A module runs in a sandbox of its own (see [module-security.md](module-security.md)): no network,
no files, no Node, no access to the app, XNAT or other modules. It can `import` and `fetch` only
its own package's files (`import('./lib.js')`, `fetch(new URL('./model.wasm', import.meta.url))`)
and compile WebAssembly. Each run starts fresh — nothing persists between runs.

## Signing and trust

| Tier | |
|---|---|
| **Verified** | Signed by a publisher the user (or the edition) trusts — installs without a warning |
| **Community** | Unsigned, or signed by a key nobody here trusts — installs after the user confirms (and only while *Allow community modules* is on) |
| **Bundled** | Shipped inside an edition's signed application (see [editions.md](editions.md)) |

Signatures are Ed25519 over a SHA-256 digest of every file but `signature.json`; any change to
any file invalidates them. A key id is the first 16 hex digits of the SHA-256 of the public key.
`module:sign` re-signs an existing package (e.g. a reviewer countersigning); `module:verify`
checks a package as the app will.

## Testing a module

- Write `run` as a pure function and test it with Node on synthetic input (`dims`, a
  `Float32Array` image, `params`) — see `modules/examples/postop-edema` and its phantom
  (`e2e/fixtures/dicom/generate.cjs`, `mr-flair-postop`).
- `npm run module:verify -- your.xwmodule` before you share it.
- In the app, install it and look at the log (*▸ Log* under the operation).

Examples: `modules/examples/threshold` (the smallest), `modules/examples/postop-edema` (a
SegWorks add-on re-authored; two new segments; the ROI limit), `modules/builtins/fast-growcut`
(a built-in operation as a module, bundled from TypeScript by `npm run build:modules`).
