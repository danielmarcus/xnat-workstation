// Intensity threshold — the example module (API 1.0). See docs/module-authoring.md.
//
// run(input, api) receives the box the user chose (input.dims = [nx, ny, nz], x fastest), the
// image in modality units (HU on CT) and the parameters; it returns a mask, one byte per voxel
// of the box (1 = add to the segment). Workstation previews it, and ⏎ commits one undo step.

export async function run(input, api) {
  const { dims, image, params } = input;
  const [nx, ny, nz] = dims;
  const plane = nx * ny;
  const mask = new Uint8Array(image.length);
  let count = 0;
  api.log(`Window ${params.lower} to ${params.upper}, ${nz} slice${nz === 1 ? '' : 's'}`);
  for (let z = 0; z < nz; z++) {
    if (api.cancelled()) { api.warn('Cancelled'); return { mask: new Uint8Array(image.length) }; }
    for (let i = z * plane; i < (z + 1) * plane; i++) {
      if (image[i] >= params.lower && image[i] <= params.upper) { mask[i] = 1; count++; }
    }
    if (params.largestOnly) count -= keepLargest(mask, z * plane, nx, ny);
    api.progress((z + 1) / nz, `slice ${z + 1} / ${nz}`);
  }
  api.log(`${count} voxels`);
  return { mask };
}

/** Keep the largest 4-connected island of one slice; returns how many voxels it removed. */
function keepLargest(mask, offset, nx, ny) {
  const label = new Int32Array(nx * ny);
  const sizes = [0];
  const stack = [];
  for (let s = 0; s < nx * ny; s++) {
    if (!mask[offset + s] || label[s]) continue;
    const id = sizes.length;
    let size = 0;
    stack.push(s);
    label[s] = id;
    while (stack.length) {
      const p = stack.pop();
      size++;
      const x = p % nx, y = (p - x) / nx;
      for (const q of [x > 0 ? p - 1 : -1, x < nx - 1 ? p + 1 : -1, y > 0 ? p - nx : -1, y < ny - 1 ? p + nx : -1]) {
        if (q >= 0 && mask[offset + q] && !label[q]) { label[q] = id; stack.push(q); }
      }
    }
    sizes.push(size);
  }
  let best = 0;
  for (let i = 1; i < sizes.length; i++) if (sizes[i] > (sizes[best] || 0)) best = i;
  let removed = 0;
  for (let s = 0; s < nx * ny; s++) if (mask[offset + s] && label[s] !== best) { mask[offset + s] = 0; removed++; }
  return removed;
}
