export interface Point { x: number; y: number }
export interface Region { x: number; y: number; width: number; height: number }
const clamp = (value: number) => Math.max(0, Math.min(1, value))

/** Normalized coordinates keep the selection stable when the preview resizes. */
export function regionBetween(start: Point, end: Point): Region {
  const x = Math.min(clamp(start.x), clamp(end.x))
  const y = Math.min(clamp(start.y), clamp(end.y))
  return {x, y, width: Math.abs(clamp(end.x) - clamp(start.x)), height: Math.abs(clamp(end.y) - clamp(start.y))}
}

export function pixelRegion(region: Region, width: number, height: number): Region {
  const x = Math.floor(clamp(region.x) * width + 1e-8)
  const y = Math.floor(clamp(region.y) * height + 1e-8)
  return {x, y, width: region.width <= 0 ? 0 : Math.min(width, Math.ceil(clamp(region.x + region.width) * width - 1e-8)) - x,
    height: region.height <= 0 ? 0 : Math.min(height, Math.ceil(clamp(region.y + region.height) * height - 1e-8)) - y}
}
