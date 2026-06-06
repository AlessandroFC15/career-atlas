import { useEffect, useState } from 'react';
import type { GraphNode } from '../../types';

/** Sample a logo's dominant (brand) colour, biased toward saturated pixels and
 *  ignoring white/black/grey, so the corona glows the company's own hue. */
export function sampleDominantColor(dataUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const size = 20;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);
        let r = 0;
        let g = 0;
        let b = 0;
        let total = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 128) continue; // transparent
          const cr = data[i];
          const cg = data[i + 1];
          const cb = data[i + 2];
          const max = Math.max(cr, cg, cb);
          const min = Math.min(cr, cg, cb);
          if (max > 240 && min > 240) continue; // near-white
          if (max < 24) continue; // near-black
          const weight = 1 + (max - min) / 48; // favour saturated pixels
          r += cr * weight;
          g += cg * weight;
          b += cb * weight;
          total += weight;
        }
        if (total < 1) return resolve(null);
        resolve(`rgb(${Math.round(r / total)}, ${Math.round(g / total)}, ${Math.round(b / total)})`);
      } catch {
        resolve(null); // tainted canvas etc.
      }
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

/** Map of node id → dominant logo colour, sampled once per graph. */
export function useLogoColors(nodes: GraphNode[]): Record<string, string> {
  const [colors, setColors] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      nodes.map(async (n) => {
        const c = n.logoDataUrl ? await sampleDominantColor(n.logoDataUrl) : null;
        return [n.id, c] as const;
      }),
    ).then((entries) => {
      if (cancelled) return;
      const next: Record<string, string> = {};
      for (const [id, c] of entries) if (c) next[id] = c;
      setColors(next);
    });
    return () => {
      cancelled = true;
    };
  }, [nodes]);
  return colors;
}
