export interface LabelRect {
  x: number
  y: number
  width: number
  height: number
}
export interface LabelPoint {
  x: number
  y: number
}
export interface MapLabel extends LabelRect {
  anchor: LabelPoint
  leader: LabelPoint
}
export const overlaps = (a: LabelRect, b: LabelRect, gap = 6) =>
  a.x < b.x + b.width + gap &&
  a.x + a.width + gap > b.x &&
  a.y < b.y + b.height + gap &&
  a.y + a.height + gap > b.y

/** Try the middle 50–60% of the relationship first, then move its label off the footprint.
 * A leader preserves the association. If the screen is full, omit the overlay instead of
 * covering either endpoint; the final result remains available in the existing left panel. */
export function placeMapLabel(
  anchors: LabelPoint[],
  width: number,
  height: number,
  viewport: { width: number; height: number },
  obstacles: LabelRect[],
): MapLabel | null {
  const valid = (r: LabelRect) =>
    r.x >= 12 &&
    r.y >= 12 &&
    r.x + r.width <= viewport.width - 12 &&
    r.y + r.height <= viewport.height - 12 &&
    obstacles.every((o) => !overlaps(r, o))
  for (const distance of [22, 40, 64, 96, 136, 180, 240, 320, 420]) {
    for (const anchor of anchors)
      for (const [dx, dy] of [
        [0, 1],
        [0, -1],
        [1, 0],
        [-1, 0],
        [1, 1],
        [-1, 1],
        [1, -1],
        [-1, -1],
      ]) {
        const rect = {
          x: anchor.x + dx! * distance - width / 2,
          y: anchor.y + dy! * distance - height / 2,
          width,
          height,
        }
        if (valid(rect))
          return {
            ...rect,
            anchor,
            leader: {
              x: Math.max(rect.x, Math.min(rect.x + width, anchor.x)),
              y: Math.max(rect.y, Math.min(rect.y + height, anchor.y)),
            },
          }
      }
  }
  return null
}
