// validator.node.test.js
// Run with: node validator.node.test.js
const assert = require('assert').strict;
const { classify, beats, ownsCards, rankWeight } = require('./src/js/validator.js');

// Suits: 0♦, 1♣, 2♥, 3♠
const D = 0, C = 1, H = 2, S = 3; 
const c = (rank, suit) => ({ rank, suit }); // 1=Ace, 2=Two, 3..13=3..K

let passed = 0;
function test(name, fn) {
  try {
    fn();
    console.log('✓', name);
    passed++;
  } catch (e) {
    console.error('✗', name);
    console.error('  ', e.message);
    process.exit(1);
  }
}

// ---------- rankWeight ----------
test('rankWeight: Ace=14, Two=15, 3..13 map to self', () => {
  assert.equal(rankWeight(1), 14);
  assert.equal(rankWeight(2), 15);
  assert.equal(rankWeight(3), 3);
  assert.equal(rankWeight(13), 13);
});

// ---------- classify: singles/pairs/triples ----------
test('classify single → {type, key=rankWeight, suit}', () => {
  const aS = c(1, S);
  const cls = classify([aS]);
  assert.equal(cls.type, 'single');
  assert.equal(cls.key, 14);
  assert.equal(cls.suit, S);
});

test('classify pair → {type, key (rank), suit=highest suit in pair}', () => {
  const twoH = c(2, H), twoS = c(2, S);
  const cls = classify([twoH, twoS]);
  assert.equal(cls.type, 'pair');
  assert.equal(cls.key, 15); // Two → 15
  assert.equal(cls.suit, S); // highest suit
});

test('classify triple → {type, key} (suits don’t matter)', () => {
  const cls = classify([c(3,D), c(3,C), c(3,H)]);
  assert.equal(cls.type, 'triple');
  assert.equal(cls.key, 3);
});

// ---------- beats: singles/pairs/triples ----------
test('single beats: rank first, suit breaks ties', () => {
  const sixD = classify([c(6,D)]);
  const fiveS = classify([c(5,S)]);
  const fiveH = classify([c(5,H)]);
  assert.equal(beats(sixD, fiveS), true);   // 6 > 5
  assert.equal(beats(fiveS, fiveH), true);  // 5♠ > 5♥
  assert.equal(beats(fiveH, fiveS), false); // 5♥ < 5♠
});

test('pair beats: rank first; if equal, highest suit in pair breaks ties', () => {
  const pair2_highSuit = classify([c(2,H), c(2,S)]); // suit=S
  const pair2_lowSuit  = classify([c(2,D), c(2,C)]); // suit=C
  assert.equal(beats(pair2_highSuit, pair2_lowSuit), true);
  assert.equal(beats(pair2_lowSuit, pair2_highSuit), false);

  const pair3 = classify([c(3,H), c(3,S)]); // key=3 (3 < 2 since Two=15)
  assert.equal(beats(pair3, pair2_highSuit), false);
  assert.equal(beats(pair2_highSuit, pair3), true);
});

test('triple beats: compare by rank only', () => {
  const triple3 = classify([c(3,D), c(3,C), c(3,H)]);
  const triple4 = classify([c(4,D), c(4,C), c(4,H)]);
  assert.equal(beats(triple4, triple3), true);
  assert.equal(beats(triple3, triple4), false);
});

// ---------- straights (incl. special cases) ----------
test('straight compare by high card (normal)', () => {
  const s34567 = classify([c(3,D), c(4,C), c(5,H), c(6,S), c(7,D)]);
  const s45678 = classify([c(4,D), c(5,C), c(6,H), c(7,S), c(8,D)]);
  assert.equal(s34567.type, 'straight');
  assert.equal(beats(s45678, s34567), true);
});

test('A-2-3-4-5 allowed; high=5', () => {
  const a2345 = classify([c(1,S), c(2,H), c(3,D), c(4,C), c(5,D)]);
  assert.equal(a2345.type, 'straight');
  assert.equal(a2345.key, 5);
});

test('J-Q-K-A-2 allowed; high=2 (weight 15)', () => {
  const jqka2 = classify([c(11,D), c(12,C), c(13,H), c(1,S), c(2,D)]);
  assert.equal(jqka2.type, 'straight');
  assert.equal(jqka2.key, 15);
});

test('2-3-4-5-6 allowed; high=6', () => {
  const _23456 = classify([c(2,D), c(3,C), c(4,H), c(5,S), c(6,D)]);
  assert.equal(_23456.type, 'straight');
  assert.equal(_23456.key, 6);
});

// ---------- flush (suit-first, then highest rank in the flush) ----------
test('classify flush exposes suit and top', () => {
  const fS = classify([c(3,S), c(6,S), c(9,S), c(11,S), c(13,S)]);
  assert.equal(fS.type, 'flush');
  assert.equal(fS.suit, S);
  assert.equal(fS.top, 13);
});

test('flush > straight (5-card hierarchy)', () => {
  const straight = classify([c(3,D), c(4,C), c(5,H), c(6,S), c(7,D)]);
  const flush    = classify([c(3,S), c(6,S), c(9,S), c(11,S), c(13,S)]);
  assert.equal(beats(flush, straight), true);
});

test('flush tiebreak: suit first, then top rank if same suit', () => {
  const flushH = classify([c(5,H), c(7,H), c(9,H), c(11,H), c(13,H)]); // ♥
  const flushS = classify([c(5,S), c(7,S), c(9,S), c(11,S), c(13,S)]); // ♠
  assert.equal(beats(flushS, flushH), true); // spade flush > heart flush

  const flushS_lowTop = classify([c(3,S), c(5,S), c(7,S), c(8,S), c(9,S)]);
  const flushS_hiTop  = classify([c(4,S), c(6,S), c(8,S), c(9,S), c(12,S)]);
  assert.equal(beats(flushS_hiTop, flushS_lowTop), true); // same suit → higher top wins
});

// ---------- full house ----------
test('full house: triple rank first, then pair rank', () => {
  const fh_3over2 = classify([c(3,D), c(3,C), c(3,H), c(2,D), c(2,C)]);
  const fh_4overA = classify([c(4,D), c(4,C), c(4,H), c(1,D), c(1,C)]);
  assert.equal(fh_3over2.type, 'fullhouse');
  assert.equal(beats(fh_4overA, fh_3over2), true);

  const fh_3over4 = classify([c(3,D), c(3,C), c(3,H), c(4,D), c(4,C)]);
  const fh_3over5 = classify([c(3,D), c(3,C), c(3,H), c(5,D), c(5,C)]);
  assert.equal(beats(fh_3over5, fh_3over4), true);
});

// ---------- four of a kind (+ kicker) ----------
test('four of a kind: quad rank first, then kicker', () => {
  const four3_kA = classify([c(3,D), c(3,C), c(3,H), c(3,S), c(1,D)]);
  const four4_k3 = classify([c(4,D), c(4,C), c(4,H), c(4,S), c(3,D)]);
  assert.equal(four3_kA.type, 'fourkind');
  assert.equal(beats(four4_k3, four3_kA), true);

  const four4_kA = classify([c(4,D), c(4,C), c(4,H), c(4,S), c(1,D)]);
  assert.equal(beats(four4_kA, four4_k3), true); // same quad → higher kicker wins
});

// ---------- straight flush ----------
test('straight flush: compare by high card', () => {
  const sf_34567 = classify([c(3,S), c(4,S), c(5,S), c(6,S), c(7,S)]);
  const sf_45678 = classify([c(4,S), c(5,S), c(6,S), c(7,S), c(8,S)]);
  assert.equal(sf_34567.type, 'straightflush');
  assert.equal(beats(sf_45678, sf_34567), true);
});

// ---------- 5-card hierarchy cross-type ----------
test('5-card hierarchy: Straight < Flush < Full House < Four-kind < Straight Flush', () => {
  const straight = classify([c(3,D), c(4,C), c(5,H), c(6,S), c(7,D)]);
  const flush    = classify([c(3,S), c(6,S), c(9,S), c(11,S), c(13,S)]);
  const fullH    = classify([c(9,D), c(9,C), c(9,H), c(5,D), c(5,C)]);
  const fourK    = classify([c(10,D), c(10,C), c(10,H), c(10,S), c(3,D)]);
  const sflush   = classify([c(9,S), c(10,S), c(11,S), c(12,S), c(13,S)]);

  assert.equal(beats(flush, straight), true);
  assert.equal(beats(fullH, flush), true);
  assert.equal(beats(fourK, fullH), true);
  assert.equal(beats(sflush, fourK), true);
});

// ---------- ownsCards ----------
test('ownsCards true when all proposed cards exist with multiplicity', () => {
  const hand = [c(3,D), c(3,C), c(4,D), c(4,C), c(5,D)];
  assert.equal(ownsCards(hand, [c(3,D), c(4,C)]), true);
});

test('ownsCards false when card missing or multiplicity exceeded', () => {
  const hand = [c(3,D), c(3,C)];
  assert.equal(ownsCards(hand, [c(3,D), c(3,D)]), false);
  assert.equal(ownsCards(hand, [c(2,D)]), false);
});

// ---------- free lead ----------
test('free lead: beats(candidate, null) is true for any legal hand', () => {
  const anyFive = classify([c(3,D), c(4,C), c(5,H), c(6,S), c(7,D)]);
  assert.equal(beats(anyFive, null), true);
});

console.log(`\nAll tests passed (${passed}) ✔`);
