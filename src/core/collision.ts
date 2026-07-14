import { PHYS } from './physics';
import type { Car, CollisionImpact } from './model';

export function collideCars(list: readonly (Car | null | undefined)[], R?: number): CollisionImpact[] {
  const cr = R || PHYS.colR2;
  const half = 1.35;
  const contactSlop = 0.03;
  const coarse = 2 * (half + cr), coarse2 = coarse * coarse;
  const out: CollisionImpact[] = [];
  for (let a = 0; a < list.length; a++){
    const A = list[a];
    if (!A) continue;
    for (let b = a + 1; b < list.length; b++){
      const B = list[b];
      if (!B) continue;
      const dx0 = B.x - A.x, dy0 = B.y - A.y;
      if (dx0 * dx0 + dy0 * dy0 > coarse2) continue;
      const ca = Math.cos(A.h), sa = Math.sin(A.h);
      const cb = Math.cos(B.h), sb = Math.sin(B.h);
      let bestPen = 0, nx = 0, ny = 0;
      for (const qa of [-half, half]){
        const ax = A.x + ca * qa, ay = A.y + sa * qa;
        for (const qb of [-half, half]){
          const bx = B.x + cb * qb, by = B.y + sb * qb;
          const dx = bx - ax, dy = by - ay, d2 = dx * dx + dy * dy;
          if (d2 >= 4 * cr * cr) continue;
          const d = Math.sqrt(Math.max(d2, 1e-12));
          const pen = 2 * cr - d;
          if (pen > bestPen){
            bestPen = pen;
            if (d2 < 1e-12){
              const dl = Math.hypot(dx0, dy0) || 1;
              nx = dx0 / dl; ny = dy0 / dl;
            } else { nx = dx / d; ny = dy / d; }
          }
        }
      }
      if (bestPen <= contactSlop) continue;
      // Resolve with a small clearance instead of leaving the pair exactly on
      // the contact boundary. Longitudinal capsules land at the follow law's
      // 5 m minimum gap; lateral touches land above room's engage threshold.
      const pen = (bestPen + 0.30) / 2;
      A.x -= nx * pen; A.y -= ny * pen;
      B.x += nx * pen; B.y += ny * pen;
      // world velocities
      let awx = A.vx * ca - A.vy * sa, awy = A.vx * sa + A.vy * ca;
      let bwx = B.vx * cb - B.vy * sb, bwy = B.vx * sb + B.vy * cb;
      const rvx = bwx - awx, rvy = bwy - awy;
      const rel = rvx * nx + rvy * ny;
      if (rel < 0){
        const e = 0.2, jimp = -(1 + e) * rel / 2;
        awx -= jimp * nx; awy -= jimp * ny;
        bwx += jimp * nx; bwy += jimp * ny;
        const damp = 1 - 0.015 * (Math.abs(rel) / (Math.hypot(rvx, rvy) + 1e-6));
        awx *= damp; awy *= damp; bwx *= damp; bwy *= damp;
        A.vx = awx * ca + awy * sa; A.vy = -awx * sa + awy * ca;
        B.vx = bwx * cb + bwy * sb; B.vy = -bwx * sb + bwy * cb;
        out.push({ i: a, j: b, imp: Math.abs(rel) });
      }
    }
  }
  return out;
}
