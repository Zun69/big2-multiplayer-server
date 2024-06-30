'use strict';

const Deck = (function () {
  function _card(i) {
    const rank = i % 13 + 1;
    const suit = Math.floor(i / 13);
    return { rank, suit };
  }

  function Deck() {
    this.cards = Array.from({ length: 52 }, (_, i) => _card(i));
  }

  Deck.prototype.shuffle = function () {
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
  };

  Deck.prototype.sort = function (reverse) {
    const rankOrder = [2, 1, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3];
    this.cards.sort((a, b) => reverse ? rankOrder.indexOf(a.rank) - rankOrder.indexOf(b.rank) : rankOrder.indexOf(b.rank) - rankOrder.indexOf(a.rank));
  };

  Deck.prototype.cardHash = function () {
    const cardValueMap = new Map();
    this.cards.forEach((card, i) => {
      cardValueMap.set(`${card.suit} ${card.rank}`, i + 1);
    });
    return cardValueMap;
  };

  return Deck;
})();

module.exports = Deck;
