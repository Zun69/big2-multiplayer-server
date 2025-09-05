'use strict';

// Big 2 validator with special straights: A-2-3-4-5 and J-Q-K-A-2 allowed.
// Card: { rank: 1..13, suit: 0..3 }  (1=Ace, 2=Two, 3..13=3..K)

const RANK_ACE = 1;
const RANK_TWO = 2;

function rankWeight(rank) {
  if (rank === RANK_ACE) return 14; // Ace high above K
  if (rank === RANK_TWO) return 15; // Two highest
  return rank;                      // 3..13
}

// Put this near the top of validator.js (above beats) or inside beats:
const fiveCardRank = {
  straight: 1,
  flush: 2,
  fullhouse: 3,
  fourkind: 4,
  straightflush: 5
};

function sortByRankThenSuit(cards) {
  return [...cards].sort((a, b) => {
    const da = rankWeight(a.rank) - rankWeight(b.rank);
    if (da !== 0) return da;
    return a.suit - b.suit;
  });
}

function isFlush(cards) {
  const s = cards[0].suit;
  return cards.every(c => c.suit === s);
}

function isStraight(cards) {
  if (cards.length !== 5) return false;

  const weights = sortByRankThenSuit(cards).map(c => rankWeight(c.rank));

  // no duplicates
  for (let i = 1; i < weights.length; i++) if (weights[i] === weights[i-1]) return false;

  // normal consecutive
  let ok = true;
  for (let i = 1; i < weights.length; i++) if (weights[i] !== weights[i-1] + 1) { ok = false; break; }
  if (ok) return { ok: true, high: weights[4] };

  // special sets (order-agnostic)
  const set = new Set(weights);
  const a2345 = new Set([14, 15, 3, 4, 5]);    // A-2-3-4-5 (high=5)
  const jqka2 = new Set([11, 12, 13, 14, 15]); // J-Q-K-A-2 (high=2)
  const _23456 = new Set([15, 3, 4, 5, 6]);    // 2-3-4-5-6 (high=6)  ← NEW

  const eq = (A, B) => A.size === B.size && [...A].every(x => B.has(x));
  if (eq(set, a2345))  return { ok: true, high: 5 };
  if (eq(set, jqka2))  return { ok: true, high: 15 };
  if (eq(set, _23456)) return { ok: true, high: 6 }; // ← NEW

  return false;
}


function counts(cards) {
  const m = new Map();
  for (const c of cards) {
    const w = rankWeight(c.rank);
    m.set(w, (m.get(w) || 0) + 1);
  }
  return m;
}

function classify(cards) {
  const n = cards.length;

  // SINGLE
  if (n === 1) {
    return {
      type: 'single',
      key: rankWeight(cards[0].rank),
      suit: cards[0].suit
    };
  }

  // PAIR (add highest-suit tiebreaker)
  if (n === 2) {
    const [a, b] = cards;
    const wa = rankWeight(a.rank);
    const wb = rankWeight(b.rank);
    if (wa === wb) {
      return {
        type: 'pair',
        key: wa,                           // pair rank (with A=14, 2=15)
        suit: Math.max(a.suit, b.suit)     // highest suit in the pair (♦0 < ♣1 < ♥2 < ♠3)
      };
    }
    return null;
  }

  // TRIPLE
  if (n === 3) {
    const w = cards.map(c => rankWeight(c.rank));
    if (w[0] === w[1] && w[1] === w[2]) {
      return { type: 'triple', key: w[0] };
    }
    return null;
  }

  // FIVE-CARD HANDS
  if (n === 5) {
    return classifyFive(cards);
  }

  return null;
}

function classifyFive(cards) {
  const flush = isFlush(cards);
  const straight = isStraight(cards);
  const cnts = counts(cards);
  const groups = [...cnts.entries()].sort((a,b) => b[1]-a[1] || b[0]-a[0]);

  // straight flush / 4K / full house
  if (straight && flush) return { type: 'straightflush', key: straight.high };
  if (groups[0][1] === 4) return { type: 'fourkind', key: groups[0][0], kicker: groups[1][0] };
  if (groups[0][1] === 3 && groups[1][1] === 2) return { type: 'fullhouse', key: groups[0][0], pair: groups[1][0] };

  // flush: compare SUIT first, then highest rank in the flush
  if (flush) {
    const suit = cards[0].suit; // isFlush() guarantees all the same
    const top  = Math.max(...cards.map(c => rankWeight(c.rank)));
    return { type: 'flush', suit, top };
  }

  // straight: use high card (isStraight already handles A-2-3-4-5 and J-Q-K-A-2; add 2-3-4-5-6 there)
  if (straight) return { type: 'straight', key: straight.high };

  return null;
}

function beats(candidate, target) {
  if (!target) return true; // free lead

  const candIs5 = !!fiveCardRank[candidate.type];
  const targIs5 = !!fiveCardRank[target.type];

  // If both are 5-card hands, use category hierarchy
  if (candIs5 && targIs5) {
    const ca = fiveCardRank[candidate.type];
    const ta = fiveCardRank[target.type];

    if (ca !== ta) {
      // Higher category wins (e.g., flush > straight)
      return ca > ta;
    }

    // Same 5-card category → type-specific tie-breakers
    switch (candidate.type) {
      case 'straight':
      case 'straightflush':
        return candidate.key > target.key;

      case 'fullhouse':
        if (candidate.key !== target.key) return candidate.key > target.key;
        return (candidate.pair || 0) > (target.pair || 0);

      case 'fourkind':
        if (candidate.key !== target.key) return candidate.key > target.key;
        return (candidate.kicker || 0) > (target.kicker || 0);

      case 'flush':
        // Suit first (0♦ < 1♣ < 2♥ < 3♠)
        if (candidate.suit !== target.suit) return candidate.suit > target.suit;
        // Same suit → highest rank in the flush
        return candidate.top > target.top;

      default:
        return false;
    }
  }

  // Not both 5-card hands → must be same type to compare
  if (candidate.type !== target.type) return false;

  switch (candidate.type) {
    case 'single':
      // Rank first, suit breaks ties
      if (candidate.key !== target.key) return candidate.key > target.key;
      return candidate.suit > target.suit;

    case 'pair':
      // Pair rank first; if equal, suit of the highest card breaks ties
      if (candidate.key !== target.key) return candidate.key > target.key;
      return (candidate.suit || 0) > (target.suit || 0);

    case 'triple':
      // Just compare the rank of the triple (no suits matter here)
      return candidate.key > target.key;

    // 5-card same type fallback (already handled above, but safe)
    case 'straight':
    case 'straightflush':
      return candidate.key > target.key;

    case 'fullhouse':
      if (candidate.key !== target.key) return candidate.key > target.key;
      return (candidate.pair || 0) > (target.pair || 0);

    case 'fourkind':
      if (candidate.key !== target.key) return candidate.key > target.key;
      return (candidate.kicker || 0) > (target.kicker || 0);

    case 'flush':
      if (candidate.suit !== target.suit) return candidate.suit > target.suit;
      return candidate.top > target.top;

    default:
      return false;
  }
}

function ownsCards(hand, cards) {
  const mult = new Map();
  for (const h of hand) {
    const k = `${h.suit}-${h.rank}`;
    mult.set(k, (mult.get(k) || 0) + 1);
  }
  for (const c of cards) {
    const k = `${c.suit}-${c.rank}`;
    const v = mult.get(k) || 0;
    if (v <= 0) return false;
    mult.set(k, v - 1);
  }
  return true;
}

module.exports = { classify, beats, ownsCards, rankWeight };
