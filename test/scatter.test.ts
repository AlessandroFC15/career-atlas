import { describe, expect, it } from 'vitest';
import { scatterPoint } from '../src/scatter';

describe('scatterPoint', () => {
  it('is deterministic: same input yields the same point', () => {
    expect(scatterPoint(3, 10)).toEqual(scatterPoint(3, 10));
  });

  it('keeps every point inside the unit disk', () => {
    for (const count of [1, 2, 7, 25, 100]) {
      for (let i = 0; i < count; i++) {
        const { x, y } = scatterPoint(i, count);
        expect(x * x + y * y).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });

  it('holds every star off the dead center (the "you" star)', () => {
    for (const count of [1, 5, 30]) {
      for (let i = 0; i < count; i++) {
        const { x, y } = scatterPoint(i, count);
        expect(Math.hypot(x, y)).toBeGreaterThanOrEqual(0.22 - 1e-9);
      }
    }
  });

  it('handles the degenerate empty field without throwing', () => {
    expect(scatterPoint(0, 0)).toEqual({ x: 0, y: 0 });
  });
});
