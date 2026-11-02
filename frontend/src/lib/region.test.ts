import { expect, it } from 'vitest'
import { pixelRegion, regionBetween } from './region'

it('handles reverse drags and clamps pointers outside the image', () => {
  expect(regionBetween({x: 0.8, y: 0.7}, {x: -0.2, y: 1.2})).toEqual({x: 0, y: 0.7, width: 0.8, height: 0.30000000000000004})
})
it('exports against the original pixels, including edge selections', () => {
  expect(pixelRegion({x: 0.1, y: 0.2, width: 0.9, height: 0.8}, 1024, 768)).toEqual({x: 102, y: 153, width: 922, height: 615})
  expect(pixelRegion(regionBetween({x: 0, y: 0}, {x: 1, y: 1}), 600, 400)).toEqual({x: 0, y: 0, width: 600, height: 400})
})
