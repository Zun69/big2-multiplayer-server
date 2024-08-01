class GameState {
    constructor(players, gameDeck, lastHand, turn, lastValidHand, finishedDeck, playersFinished, playedHistory, playedHand, losingPlayer) {
      this.players = players;
      this.gameDeck = gameDeck;
      this.lastHand = lastHand;
      this.turn = turn;
      this.lastValidHand = lastValidHand;
      this.finishedDeck = finishedDeck;
      this.playersFinished = playersFinished;
      this.playedHistory = playedHistory;
      this.playedHand = playedHand; // Storing last played hand length
      this.losingPlayer = losingPlayer; // Store clientId of player that loses
    }
  }
  
  module.exports = GameState;