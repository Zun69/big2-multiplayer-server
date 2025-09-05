class GameState {
  constructor() {
    // minimal constructor + explicit setters, so I can just make a new gamestate without filling in constructor in server.js
    this.players = [];
    this.gameDeck = [];
    this.lastHand = [];
    this.turn = null;
    this.lastValidHand = null;
    this.finishedDeck = [];
    this.playersFinished = [];
    this.playedHistory = [];
    this.playedHand = null;
    this.losingPlayer = null;
    this.lastWinner = null;
    this.isFirstMove = true;
  }
}
module.exports = GameState;