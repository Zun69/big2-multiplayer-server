const http = require('http');
const express = require('express');
const socketIo = require('socket.io');
const cors = require('cors'); //allow cross origin requests

const app = express();
const server = http.createServer(app);

const GameState = require('./src/js/gameState.js'); // import objects to server
const Deck = require('./src/js/deck.js')
const { classify, beats, ownsCards } = require('./src/js/validator.js');

// Use CORS middleware
app.use(cors());

// Helper functions (top-level, outside io.on)
function getPlayerIndex(rooms, roomCode, socketId) {
  const room = rooms[roomCode];
  if (!room) return -1;
  return room.clients.findIndex(c => c.id === socketId);
}

function nextActivePlayer(state, fromIdx) {
  for (let step = 1; step <= state.players.length; step++) {
    const idx = (fromIdx + step) % state.players.length;
    const p = state.players[idx];
    if (p && Array.isArray(p.cards) && p.cards.length > 0) return idx;
  }
  return fromIdx;
}

function removeFromHand(hand, cards) {
  for (const c of cards) {
    const i = hand.findIndex(h => h.rank === c.rank && h.suit === c.suit);
    if (i === -1) return false;
    hand.splice(i, 1);
  }
  return true;
}

const io = socketIo(server, {
    cors: {
        origin: "*", // Your client URL
        methods: ["GET", "POST"]
    }
});

// Function to generate a random room code
function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase(); // Generate a 6-character alphanumeric code
}

// Store room codes and corresponding sockets
const rooms = {};
const MAX_CLIENTS_PER_ROOM = 4;

// Create a map to store the mapping of username to socket ID
const usernameToSocketIdMap = new Map();

// Automatically generate room codes when the server starts
const initialRoomCode1 = generateRoomCode();
const initialRoomCode2 = generateRoomCode();

// Initialize with an empty clients array and gameState
rooms[initialRoomCode1] = { 
    clients: [],
    gameState: null, 
    dealCount: 0,
    sortHandsCount: 0,
    playHandAckCount: 0,
    finishedDeckCount: 0,
    resetPassedCount: 0,
    sortAfterTurnCount: 0,
    checkPlayersFinishedCount: 0,
    finishedGameCount: 0,
    completedGameLoopCount: 0
};

rooms[initialRoomCode2] = { 
    clients: [],
    gameState: null, 
    dealCount: 0,
    sortHandsCount: 0,
    sortAfterTurnCount: 0,
    playHandAckCount: 0,
    finishedDeckCount: 0,
    resetPassedCount: 0,
    checkPlayersFinishedCount: 0,
    finishedGameCount: 0,
    completedGameLoopCount: 0
}; 

console.log('Automatically generated room codes:', initialRoomCode1, initialRoomCode2);

// Read valid credentials from a text file
const fs = require('fs');
const validCredentials = loadValidCredentialsFromFile('validCredentials.txt');

function loadValidCredentialsFromFile(filename) {
    try {
        const data = fs.readFileSync(filename, 'utf8');
        const credentials = {};
        const lines = data.split('\n');
        lines.forEach(line => {
            const [username, password] = line.split(':');
            credentials[username.trim()] = password.trim();
        });
        return credentials;
    } catch (err) {
        console.error('Error loading valid credentials:', err);
        return {};
    }
}

// Helper: build a 52-card visual deck for a given seat.
// - For this seat's 13 slots -> real cards (from their hand, round-robin).
// - All other 39 slots -> placeholders (4♠ as requested).
function buildVisualDeckForSeat(hand, seatIndex /* 0..3 */) {
  const visual = new Array(52);
  let myCursor = 0;

  for (let slot = 0; slot < 52; slot++) {
    if (slot % 4 === seatIndex) {
      // This slot deals to this seat → put a real card
      visual[slot] = hand[myCursor++];
    } else {
      // Placeholder: 4♠ (rank=4, suit=3)
      visual[slot] = { rank: 4, suit: 3 };
    }
  }
  return visual;
}


// Start the game for the lobby, populate gameState and generate a deck
function startGameForRoom(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

    // prevent double-starts
    if (room.gameState) return;

    // Create a new GameState object for this room
    const gameState = new GameState();
    room.gameState = gameState;
    room.playersFinished = [];
    room.losingPlayer = null;

    // Build & shuffle deck, deal, assign players, work out first turn
    const deck = new Deck();
    deck.shuffle();

    const hands = [[], [], [], []];
    for (let i = 0; i < 52; i++) hands[i % 4].push(deck.cards[i]);

    room.gameState.players = room.clients.map((client, idx) => ({
        clientId: idx,
        socketId: client.id,
        username: client.username,
        cards: hands[idx],
        passed: false,
        finishedGame: false,
        wonRound: false
    }));  // matches your current shape. :contentReference[oaicite:1]{index=1}

    // hostClientId + first turn (3♦) + broadcast start
    const hostSocketId = rooms[roomCode].host;
    const hostPlayer = room.gameState.players.find(p => p.socketId === hostSocketId);
    const hostClientId = hostPlayer ? hostPlayer.clientId : 0;

    const firstPlayer = room.gameState.players.find(p =>
        p.cards.some(c => c.rank === 3 && c.suit === 0)
    );
    if (firstPlayer) {
        room.gameState.turn = firstPlayer.clientId;
        io.to(roomCode).emit('firstTurnClientId', firstPlayer.clientId);
    }

    io.to(roomCode).emit('gameStarted'); // your client already waits on this to leave lobby. :contentReference[oaicite:2]{index=2}

    const playersSnapshot = room.gameState.players.map(p => ({
        clientId: p.clientId, socketId: p.socketId, username: p.username
    }));
    io.to(roomCode).emit('playersSnapshot', { players: playersSnapshot });
    io.to(roomCode).emit('hostClientId', hostClientId);

    room.gameState.players.forEach((player, idx) => {
        const visualDeck = buildVisualDeckForSeat(player.cards, idx);
        io.to(player.socketId).emit('visualDealDeck', { cards: visualDeck, clientId: player.clientId });
    });
}

function resetRoomForLobby(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

    // clear game objects/state
    room.gameState = null;
    room.playersFinished = [];
    room.losingPlayer = null;

    // reset all the per-round counters you use
    room.dealCount = 0;
    room.sortHandsCount = 0;
    room.playHandAckCount = 0;
    room.finishedDeckCount = 0;
    room.resetPassedCount = 0;
    room.sortAfterTurnCount = 0;
    room.checkPlayersFinishedCount = 0;
    room.finishedGameCount = 0;
    room.completedGameLoopCount = 0;

    // clear any “starting” guard you use
    room._starting = false;
}

function emitGameCompletionState(roomCode) {
  const room = rooms[roomCode];
  if (!room || !room.gameState) return;

  const state = room.gameState;
  const finished = room.playersFinished || [];

  // No one finished yet
  if (finished.length === 0) {
    io.to(roomCode).emit('noClientHasFinished', finished);
    return;
  }

  // Some have finished, but not enough to end the game
  if (finished.length < 3) {
    io.to(roomCode).emit('gameHasNotFinished', finished);
    return;
  }

  // finished.length === 3 → determine loser (the only player with cards left)
  const survivor = state.players.find(p => (p.cards?.length || 0) > 0);
  const losingPlayer = survivor ? survivor.username : null;
  room.losingPlayer = losingPlayer;
  console.log("Losing player" + losingPlayer);

  // Add loser as the last element in finished array
  const allFinished = [...finished, losingPlayer];

  io.to(roomCode).emit('gameHasFinished', allFinished, losingPlayer);
}

// io.use middleware intercepts every connection attempt before it reaches the io.on connection event handler. returns next if client has valid credentials, else auth fails
io.use((socket, next) => {
    const { username, password } = socket.handshake.auth;

    if (validCredentials[username] === password) {
        socket.username = username;
        console.log('Authentication successful');
        return next();
    } else {
        console.log('Authentication failed');
        return next(new Error('Authentication failed'));
    }
});

io.on('connection', (socket) => {
    // Handle successful authentication
    socket.emit('authenticated');

    // Log the socket ID and username when a client connects
    console.log(`Client connected: ${socket.id}, Username: ${socket.username}`);

    // Store the mapping of username to socket ID
    usernameToSocketIdMap.set(socket.id, socket.username);

    // Event handler for when a client emits an event to get their username
    socket.on('getUsername', () => {
        const username = usernameToSocketIdMap.get(socket.id);
        if (username) {
            // Emit the username back to the client
            socket.emit('username', { username });
        } else {
            // Handle the case where the username is not found (optional)
            socket.emit('username', { error: 'Username not found' });
        }
    });

    socket.on('joinRoom', ({ roomCode }) => {
        if (!roomCode || !rooms[roomCode]) {
            socket.emit('errorMessage', 'Invalid room code');
            return;
        }

        // Count live sockets BEFORE joining
        const preSet = io.sockets.adapter.rooms.get(roomCode);
        const preCount = preSet ? preSet.size : 0;

        // If the room is currently empty but still has a gameState from last round, reset it.
        if (preCount === 0 && rooms[roomCode].gameState) {
            console.log(`[joinRoom] room ${roomCode} reopening empty; resetting stale gameState.`);
            resetRoomForLobby(roomCode);
            // also clear any stale clients list since nobody is connected yet
            rooms[roomCode].clients = [];
            rooms[roomCode].host = null;
        }

        // Capacity guard
        if (preCount >= MAX_CLIENTS_PER_ROOM) {
            socket.emit('errorMessage', 'Room is full');
            return;
        }

        // Join first so this socket is in the live set
        socket.join(roomCode);

        // Recompute live sockets
        const liveSet = io.sockets.adapter.rooms.get(roomCode) || new Set();

        const room = rooms[roomCode];
        const clients = room.clients;

        // Prune any stored clients not actually connected
        for (let i = clients.length - 1; i >= 0; i--) {
            if (!liveSet.has(clients[i].id)) clients.splice(i, 1);
        }

        // Add current socket if missing
        if (!clients.some(c => c.id === socket.id)) {
            clients.push({ id: socket.id, username: socket.username, isReady: false });
        }

        // Assign host if none or host is not live
        if (!room.host || !liveSet.has(room.host)) {
            room.host = clients.find(c => liveSet.has(c.id))?.id || socket.id;
        }

        console.log(`Client: ${socket.username} (${socket.id}) joined room ${roomCode}`);

        socket.emit('joinedRoom');

        // Send updated ready state isHost for ui reasons, might get rid of host later
        const payload = clients.map(c => ({ ...c, isHost:c.id === room.host }));
        io.to(roomCode).emit('updateReadyState', payload);
    });

    // Client will emit this event when they click go back in the room's lobby menu
    socket.on('leaveRoom', (roomCode) => {
        if (rooms[roomCode]) {
            const clientIndex = rooms[roomCode].clients.findIndex(client => client.id === socket.id);
            if (clientIndex !== -1) {
                rooms[roomCode].clients.splice(clientIndex, 1);
            }
    
            // Notify other clients in the room about the updated client list
            io.to(roomCode).emit('updateReadyState', rooms[roomCode].clients);
    
            // Leave the room
            socket.leave(roomCode);
    
            console.log(`Client: ${socket.username} (${socket.id}) left room ${roomCode}`);
        }
    });

    // event listener for getting available rooms
    socket.on('getAvailableRooms', () => {
        const availableRooms = [];
        
        for (const roomCode in rooms) {
            if (rooms.hasOwnProperty(roomCode)) {
                const numClients = io.sockets.adapter.rooms.get(roomCode)?.size || 0;
                availableRooms.push({ roomCode, numClients });
            }
        }
    
        socket.emit('availableRooms', availableRooms);
    });

    // Handle the request for an updated client list
    socket.on('getClientList', (roomCode) => {
        if (roomCode) {
            const room = io.sockets.adapter.rooms.get(roomCode);
            if (room) {
                // Retrieve socket IDs in the room
                const socketIds = Array.from(room);

                // Map socket IDs to usernames and socket IDs, and check if each client is the host
                const clients = socketIds.map(socketId => {
                    const username = usernameToSocketIdMap.get(socketId);
                    const isHost = rooms[roomCode].host === socketId;
                    return { username, socketId, isHost };
                }).filter(client => client.username !== undefined); // Filter out undefined usernames

                // Emit the current client list with usernames and socket IDs for the specified room back to the client
                socket.emit('clientList', clients);
            }
        }
    });

    // Event handler to check if the client is the host of a room
    socket.on('checkHost', (roomCode) => {
        if (roomCode) {
            const room = rooms[roomCode];
            if (room) {
                // Check if the requesting client's socket ID matches the host socket ID
                const isHost = room.host === socket.id;

                // Emit the result back to the client
                socket.emit('hostStatus', { isHost });
            } else {
                // Emit an error message if the room does not exist
                socket.emit('hostStatus', { error: 'Room does not exist' });
            }
        } else {
            // Emit an error message if the room code is not provided
            socket.emit('hostStatus', { error: 'Room code is required' });
        }
    });

    // Handle sending messages
    socket.on('sendMessage', (roomCode, message) => {
        const username = usernameToSocketIdMap.get(socket.id);
        if (roomCode && message && username) {
            // Broadcast the message to all clients in the room
            io.to(roomCode).emit('receiveMessage', `${username}: ${message}`);
        }
    });

    // Handle toggleReadyState event, takes in isReady state from client and returns list of clients and their ready states
    socket.on('toggleReadyState', (roomCode, isReady) => {
        const room = rooms[roomCode];
        if (!room) return;

        const me = room.clients.find(c => c.id === socket.id);
        if (me) me.isReady = isReady;

        io.to(roomCode).emit('updateReadyState', room.clients);

        // robust 4/4 check
        const roomSet = io.sockets.adapter.rooms.get(roomCode) || new Set();
        if (roomSet.size !== 4) return;

        // count only currently connected clients
        const live = new Set(roomSet);
        const liveClients = room.clients.filter(c => live.has(c.id));

        const allReady = liveClients.length === 4 && liveClients.every(c => c.isReady);
        if (allReady && !room.gameState && !room._starting) {
            room._starting = true;
            startGameForRoom(roomCode); // start new game for room with fresh gameState
            setTimeout(() => { room._starting = false; }, 1000);
        }
    });


    // === authoritative play (server validates) ===
    socket.removeAllListeners('playCards');

    socket.on('playCards', ({ roomCode, cards, positions }) => {
        const room = rooms[roomCode];
        if (!room || !room.gameState) return;

        const state = room.gameState;
        const me = getPlayerIndex(rooms, roomCode, socket.id);

        // helper for consistent rejection shape
        const reject = (reason) => socket.emit('playRejected', {
            verdict: 'not validated',
            reason
        });

        if (me === -1 || state.turn !== me) {
            return reject('Not your turn');
        }

        const player = state.players[me];

        // 1) own the exact cards?
        if (!ownsCards(player.cards, cards)) {
            return reject('You do not own those cards');
        }

        // 2) is the proposed hand legal?
        const cand = classify(cards);
        if (!cand) {
            return reject('Illegal hand');
        }

        // 2.5) first move must contain 3♦
        if (state.isFirstMove) {
            const hasThreeDiamonds = cards.some(c => c.rank === 3 && c.suit === 0);
            if (!hasThreeDiamonds) return reject('First move must include 3♦');
        }

        // 3) does it beat current target (if any)?
        const target = state.lastValidHand ? classify(state.lastValidHand) : null;
        if (!beats(cand, target)) {
            return reject('Does not beat');
        }

        // 4) apply to server state
        if (!removeFromHand(player.cards, cards)) {
            return reject('Internal mismatch');
        }

        state.gameDeck = cards;
        state.lastValidHand = cards;
        state.lastWinner = me; 
        state.playedHand = cards.length;
        state.playedHistory = state.playedHistory || [];
        state.playedHistory.push({ by: me, cards });
        
        // reset passes on a valid play
        state.players.forEach(p => { p.passed = false; });

        // start a fresh per-trick pass tracker
        // finished seats (with zero cards) are auto-counted as "already passed"
        state.passTracker = new Set();
        for (let i = 0; i < state.players.length; i++) {
            if (i === me) continue; // the last winner never needs to pass to clear
            const hasCards = (state.players[i]?.cards?.length || 0) > 0;
            if (!hasCards) state.passTracker.add(i);
        }

        if (state.isFirstMove) state.isFirstMove = false;

        // 5) advance turn
        state.turn = nextActivePlayer(state, me);

        // 6) broadcast the public outcome (now includes verdict)
        io.to(roomCode).emit('cardsPlayed', {
            verdict: 'validated',
            type: 'play',
            clientId: player.clientId,
            players: publicisePlayers(state),
            cards,
            positions,
            nextTurn: state.turn,
            lastValidHand: state.lastValidHand,
        });

        // inside your play/turn handling on the server
        if (player.cards.length === 0 && !player.finishedGame) {
            player.finishedGame = true;
            room.playersFinished.push(player.username);

            io.to(roomCode).emit("playerFinished", {
                clientId: player.clientId,
                playersFinished: room.playersFinished   // authoritative order
            });
        }

        // fter any play, tell clients whether the game is done or not
        emitGameCompletionState(roomCode);
    });

    // Clients emit this message once their finish deck animations have finished
    socket.removeAllListeners('playHandAck');
    socket.on('playHandAck', (roomCode) => {
        const room = rooms[roomCode];
        if (!room) return;
        room.playHandAckCount = (room.playHandAckCount || 0) + 1;
        if (room.playHandAckCount === 4) {
            console.log(`[${roomCode}] all 4 clients finished playing card animations`);
            room.playHandAckCount = 0;
            io.to(roomCode).emit('allHandAckComplete'); 
        }
    });

    // When client has been dealt to, update clients server side cards, and emit allDealsComplete when all 4 clients are done
    socket.on('dealComplete', ( roomCode, player ) => {
        if (rooms[roomCode]) {
            rooms[roomCode].dealCount++;
            
            // Find the player in rooms[roomCode].gameState.players array using clientId and update their cards property
            const clientPlayer = rooms[roomCode].gameState.players.find(p => p.clientId === player.clientId);

            if(clientPlayer) {
                // Update the existing player object with received data
                clientPlayer.cards = player.cards;

                // Optionally, update other properties specific to your application
                console.log(`Updated player with clientId ${clientPlayer.clientId} in room ${roomCode}`);
            } else {
                console.log(`Player with clientId ${player.clientId} not found in room ${roomCode}`);
            }

            // Check if dealCount reaches 4
            if (rooms[roomCode].dealCount === 4) {
                // Reset dealCount for the next round or game, if needed
                rooms[roomCode].dealCount = 0;

                // Emit a dealComplete event to notify clients
                io.to(roomCode).emit('allDealsComplete');
                console.log(`allDealsComplete emitted for room ${roomCode}`);
            }
        } else {
            console.log(`Room ${roomCode} not foundss`);
        }
    });

    // Client finished the initial sort at game start
    socket.on('sortHandsComplete', (roomCode /*, playerOptional */) => {
        const room = rooms[roomCode];
        if (!room || !room.gameState) return;

        // bump counter
        room.sortHandsCount = (room.sortHandsCount || 0) + 1;

        // when all players have acked, release the barrier and reset
        const expected = room.gameState.players.length || 4;
        if (room.sortHandsCount >= expected) {
            room.sortHandsCount = 0;
            io.to(roomCode).emit('allSortingComplete');
        }
    });


    socket.removeAllListeners('sortPlayerHandAfterTurn')
    // Client finished the initial sort at game start
    socket.on('sortPlayerHandAfterTurn', (roomCode) => {
        const room = rooms[roomCode];
        if (!room || !room.gameState) return;

        // bump counter
        room.sortAfterTurnCount = (room.sortAfterTurnCount || 0) + 1;

        // when all players have acked, release the barrier and reset
        const expected = room.gameState.players.length || 4;
        if (room.sortAfterTurnCount >= expected) {
            room.sortAfterTurnCount = 0;
            io.to(roomCode).emit('sortAfterTurnComplete');
        }
    });

    // Return clientId of player who has the 3 of diamonds
    socket.on('getFirstTurn', (roomCode) => {
        if(rooms[roomCode]) {
            const isHost = rooms[roomCode].host === socket.id

            if(isHost){
                // Iterate through each player in the room
                for (let player of rooms[roomCode].gameState.players) {
                    // Check if the player has the specified card
                    let hasCard = player.cards.some(card => card.rank === 3 && card.suit === 0);
                    if (hasCard) {
                        console.log('player found' + player.clientId)
                        // Update room's gameState's turn to 3d player's clientId
                        rooms[roomCode].gameState.turn = player.clientId;

                        // Emit the clientId of player with 3d to all clients in the room
                        io.to(roomCode).emit('firstTurnClientId', player.clientId);
                    }
                }
            }
        } else {
            console.log(`Room ${roomCode} not found`);
        }
    });

    // Listen for a client asking: "what was the last hand played?"
    socket.on('getLastHand', (roomCode) => {
        const room = rooms[roomCode];

        // If the room doesn't exist or no game is running, just ignore
        if (!room || !room.gameState) return;

        // Pull the server's record of the last valid hand played.
        // - If no one has played yet (first turn, or just cleared after 3 passes),
        //   then lastValidHand will be null → so default to empty array [].
        const last = room.gameState.lastValidHand || [];

        // Send that array straight back to the requesting client.
        // This is only for display (so the UI can show "Last Hand: ...").
        socket.emit('gotLastHand', last);
    });

    // Reset player's wonRound status at the beginning of the round
    socket.on('resetPlayerWonRoundStatus', (roomCode) => {
        // Search for players in room using roomCode and clientId
        if(rooms[roomCode]) {
            // Iterate over each client in the room
            rooms[roomCode].gameState.players.forEach((player) => {
                player.wonRound = false;

                // Emit a wonRoundReset event to notify clients and emit updated players
                io.to(player.socketId).emit('wonRoundReset', player);
            });

        } else {
            console.log(`Room ${roomCode} not found`);
        }
    });

    // Clients emit this message once their finish deck animations have finished
    socket.removeAllListeners('finishDeckAnimation');
    socket.on('finishDeckAnimation', (roomCode) => {
        const room = rooms[roomCode];
        if (!room) return;
        room.finishedDeckCount = (room.finishedDeckCount || 0) + 1;
        if (room.finishedDeckCount === 4) {
            room.finishedDeckCount = 0;
            io.to(roomCode).emit('finishDeckAnimationComplete'); 
            console.log(`[${roomCode}] all 4 clients finished deck animations`);
        }
    });

    // Clients emit this message once all 4 of their finish game animations have finished
    socket.removeAllListeners('finishGameAnimation');
    socket.on('finishGameAnimation', (roomCode) => {
        const room = rooms[roomCode];
        if (!room) return;
        room.finishedGameCount = (room.finishedGameCount || 0) + 1;

        if (room.finishedGameCount === 4) {
            room.finishedGameCount = 0;
            io.to(roomCode).emit('finishGameAnimationComplete');
            resetRoomForLobby(roomCode); // reset GameLobby state, would have to log results into db before this
            console.log(`[${roomCode}] all 4 clients finished game animations`);
        }
    });

    // helper: convert server player state to "public" payload
    function publicisePlayers(state) {
        // expose only what others can know
        return state.players.map((p, i) => ({
            seat: i,
            id: p.clientId,         
            passed: !!p.passed,
            finishedGame: (p.cards || []).length === 0,
            wonRound: !!p.wonRound,
        }));
    }

    socket.removeAllListeners('passTurn'); // avoid dupes if hot-reloading
    socket.on('passTurn', (roomCode) => {
        const room = rooms[roomCode];
        if (!room || !room.gameState) return;

        const state = room.gameState;
        const me = getPlayerIndex(rooms, roomCode, socket.id);
        if (me === -1 || state.turn !== me) return; // ignore out-of-turn

        // 1) mark this player as passed (UI + server bookkeeping)
        const meId = state.players[me]?.clientId;
        state.players[me].passed = true;

        // 2) make sure a per-trick pass tracker exists, then record this distinct passer
        if (!state.passTracker) state.passTracker = new Set();
        state.passTracker.add(me);

        // 3) only clear if there is a target on the table
        const hasTarget = Array.isArray(state.lastValidHand) && state.lastValidHand.length > 0;

        if (hasTarget && state.passTracker.size >= 3) {
            // --- clear the trick ---
            state.finishedDeck = state.finishedDeck || [];
            if (state.gameDeck && state.gameDeck.length) {
            // archive the table pile; client will animate into finished pile after ack
            state.finishedDeck.push(state.gameDeck);
            }

            // wipe the current target
            state.gameDeck = [];
            state.lastValidHand = [];

            // reset per-trick flags
            state.players.forEach(p => { p.passed = false; p.wonRound = false; });

            // leader = lastWinner (or fallback to current seat); if they finished, pick next active
            let leader = (typeof state.lastWinner === 'number') ? state.lastWinner : me;
            if ((state.players[leader]?.cards?.length ?? 0) === 0) {
            leader = nextActivePlayer(state, leader);
            }

            state.players[leader].wonRound = true;
            state.turn = leader;

            // new trick → throw away the tracker until the next valid play seeds it again
            state.passTracker = null;

            io.to(roomCode).emit('wonRound', {
            players: publicisePlayers(state),
            lastValidHand: state.lastValidHand,
            type: 'passWonRound',
            });
            return;
        }

        // --- normal pass → advance to the next active (skips finished seats) ---
        const nextIdx = nextActivePlayer(state, me);
        state.turn = nextIdx;

        io.to(roomCode).emit('passedTurn', {
            type: 'pass',
            passedBy: meId,                                      // client expects a clientId here
            nextTurn: state.players[nextIdx]?.clientId,          // …and a clientId here
            lastValidHand: state.lastValidHand,
        });
    });


    socket.on('completedGameLoop', (roomCode) => {
        if(rooms[roomCode]) {
            rooms[roomCode].completedGameLoopCount++;

            if(rooms[roomCode].completedGameLoopCount++) {
                // Reset wonRoundStatusCount for the next round
                rooms[roomCode].completedGameLoopCount = 0;

                // Emit lastHand of server that the host updated 
                io.to(roomCode).emit('allCompletedGameLoop');
                console.log(`completedGameLoop emitted for room ${roomCode}`);
            }
        }
    });


    socket.on('processResults', (roomCode, clientResults) => {
        
    });

    // Handle errors in connection logic
    socket.on('error', (err) => {
        console.error('Socket error:', err);
    });

    // Listen for disconnect event
    socket.on('disconnect', () => {
        usernameToSocketIdMap.delete(socket.id);

        for (const roomCode in rooms) {
            const room = rooms[roomCode];
            const before = room.clients.length;
            room.clients = room.clients.filter(c => c.id !== socket.id);

            // if host left, pick the first remaining as new host
            if (room.host === socket.id) {
                room.host = room.clients[0]?.id ?? null;
            }
            if (room.clients.length !== before) {
                io.to(roomCode).emit('updateReadyState', room.clients);
            }
        }
    });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});