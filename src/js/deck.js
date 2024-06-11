'use strict';

const Deck = (function () {
  'use strict';

  function _card(i) {
    const rank = i % 13 + 1;
    const suit = Math.floor(i / 13);

    const self = { i, rank, suit, pos: i, side: 'front' };

    self.setSide = function (newSide) { self.side = newSide; };

    return self;
  }

  function Deck() {
    const deck = { cards: Array.from({ length: 52 }, (_, i) => _card(i)) };

    deck.shuffle = function () {
      fisherYates(deck.cards);
    };

    deck.sort = function (reverse) {
      const rankOrder = [2, 1, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3];
      deck.cards.sort((a, b) => reverse ? rankOrder.indexOf(a.rank) - rankOrder.indexOf(b.rank) : rankOrder.indexOf(b.rank) - rankOrder.indexOf(a.rank));
    };

    // Method to calculate card hash
    deck.cardHash = function () {
      const cardValueMap = new Map();
      deck.cards.forEach((card, i) => {
        cardValueMap.set(`${card.suit} ${card.rank}`, i + 1);
      });
      return cardValueMap;
    };

    return deck;
  }

  function fisherYates(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  return Deck;
})();

module.exports = Deck;