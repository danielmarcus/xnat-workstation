/**
 * Series geometry predicates — pure, no Cornerstone.
 *
 * A volume assumes every image shares one orientation; only the position along the
 * shared normal varies. A series that breaks that (a 3-plane localizer/scout is the
 * common case) cannot be reconstructed: stacking it as one volume interpolates between
 * unrelated planes, so most "slices" match no acquired image. Such a series has to be
 * shown image by image.
 */

type Vec3 = [number, number, number];

/** Two planes count as the same orientation within this angle between their normals. */
const SAME_PLANE_TOLERANCE_DEG = 1;
const COS_TOLERANCE = Math.cos((SAME_PLANE_TOLERANCE_DEG * Math.PI) / 180);

/** Unit slice normal (row × column) of an ImageOrientationPatient, or null if unusable. */
export function sliceNormal(iop: ArrayLike<number> | null | undefined): Vec3 | null {
  if (!iop || iop.length < 6) return null;
  const r: Vec3 = [Number(iop[0]), Number(iop[1]), Number(iop[2])];
  const c: Vec3 = [Number(iop[3]), Number(iop[4]), Number(iop[5])];
  const n: Vec3 = [r[1] * c[2] - r[2] * c[1], r[2] * c[0] - r[0] * c[2], r[0] * c[1] - r[1] * c[0]];
  const len = Math.hypot(n[0], n[1], n[2]);
  if (!Number.isFinite(len) || len < 1e-6) return null;
  return [n[0] / len, n[1] / len, n[2] / len];
}

/**
 * Group images by plane orientation. Returns, for each input, the index of its group
 * (groups numbered in order of first appearance), or null when it has no usable
 * orientation. Opposite normals are the same plane, so the test is on |cos|.
 */
export function orientationGroups(orientations: Array<ArrayLike<number> | null | undefined>): Array<number | null> {
  const representatives: Vec3[] = [];
  return orientations.map((iop) => {
    const n = sliceNormal(iop);
    if (!n) return null;
    const found = representatives.findIndex(
      (m) => Math.abs(m[0] * n[0] + m[1] * n[1] + m[2] * n[2]) >= COS_TOLERANCE,
    );
    if (found >= 0) return found;
    representatives.push(n);
    return representatives.length - 1;
  });
}

/** True when the images span more than one plane orientation (e.g. a 3-plane localizer). */
export function hasMixedOrientation(orientations: Array<ArrayLike<number> | null | undefined>): boolean {
  return orientationGroups(orientations).some((g) => g !== null && g > 0);
}
