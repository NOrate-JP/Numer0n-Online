// =============================================================
//  詰めヌメロン（β）：答えが必ず1通りになる盤面を自動生成
// =============================================================
import * as R from './rules.js';

const pick = (a) => a[Math.floor(Math.random() * a.length)];

/** clue が候補 c と矛盾しないか */
export function fits(c, clue) {
  switch (clue.type) {
    case 'call': { const j = R.judge(c, clue.num); return j.eat === clue.eat && j.bite === clue.bite; }
    case 'highlow': return R.highLowOf(c) === clue.result;
    case 'slash': return R.slashOf(c) === clue.value;
    case 'target': return R.targetOf(c, clue.digit) === clue.pos;
  }
  return true;
}

export function solve(D, clues) {
  return R.allNumbers(D).filter((c) => clues.every((cl) => fits(c, cl)));
}

/**
 * @param D 桁数
 * @param level 'normal' | 'hard'  （hardはヒントが少なく、アイテムなし）
 */
export function generatePuzzle(D = 3, level = 'normal') {
  const all = R.allNumbers(D);
  const minClues = (D === 3 ? 4 : 5) + (level === 'hard' ? -1 : 0);
  const itemRate = level === 'hard' ? 0 : 0.25;
  for (let attempt = 0; attempt < 400; attempt++) {
    const secret = pick(all);
    let cands = all.slice();
    const clues = [];
    const usedItems = new Set();
    for (let guard = 0; cands.length > 1 && guard < 40; guard++) {
      const canFinish = clues.length >= minClues - 1;
      // アイテムのヒント
      if (clues.length >= 1 && Math.random() < itemRate) {
        const ks = ['highlow', 'slash', 'target'].filter((k) => !usedItems.has(k));
        if (ks.length) {
          const k = pick(ks);
          let clue;
          if (k === 'highlow') clue = { type: 'highlow', result: R.highLowOf(secret) };
          if (k === 'slash') clue = { type: 'slash', value: R.slashOf(secret) };
          if (k === 'target') { const d = Math.floor(Math.random() * 10); clue = { type: 'target', digit: d, pos: R.targetOf(secret, d) }; }
          const nc = cands.filter((c) => fits(c, clue));
          if (nc.length < cands.length && (nc.length > 1 || canFinish)) { cands = nc; clues.push(clue); usedItems.add(k); }
          continue;
        }
      }
      // コールのヒント：ほどよく絞れるものを選ぶ
      let best = null;
      const ratio = level === 'hard' ? 0.25 : 0.4;
      for (let i = 0; i < 60; i++) {
        const g = pick(all);
        if (g === secret || clues.some((c) => c.num === g)) continue;
        const j = R.judge(secret, g);
        const clue = { type: 'call', num: g, eat: j.eat, bite: j.bite };
        const nc = cands.filter((c) => fits(c, clue));
        if (nc.length === cands.length) continue;
        if (nc.length === 1 && !canFinish) continue;
        const score = nc.length === 1 ? 0 : Math.abs(nc.length - cands.length * ratio) + Math.random();
        if (!best || score < best.score) best = { clue, nc, score };
      }
      if (!best) continue;
      cands = best.nc; clues.push(best.clue);
    }
    if (cands.length === 1 && cands[0] === secret && clues.length >= minClues) {
      // 念のため一意性を検証
      const sol = solve(D, clues);
      if (sol.length === 1 && sol[0] === secret) return { D, level, secret, clues };
    }
  }
  return null;
}
