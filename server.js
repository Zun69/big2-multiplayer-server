const http = require('http');
const express = require('express');
const socketIo = require('socket.io');
const cors = require('cors'); //allow cross origin requests

const app = express();
const server = http.createServer(app);

const Player = require('./src/js/player.js');
const GameState = require('./src/js/gameState.js'); // import objects to server
const Deck = require('./src/js/deck.js')

// Use CORS middleware
app.use(cors());

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
    wonRoundStatusCount: 0,
    checkWonRoundCount: 0,
    finishedDeckCount: 0,
    resetPassedCount: 0,
    sortHandsAfterTurnCount: 0,
    setLastValidHandCount: 0,
    checkPlayersFinishedCount: 0,
    finishedGameCount: 0,
    incrementTurnCount: 0,
    passTurnCount: 0,
    getLastHandCount: 0
};

rooms[initialRoomCode2] = { 
    clients: [],
    gameState: null, 
    dealCount: 0,
    sortHandsCount: 0,
    wonRoundStatusCount: 0,
    checkWonRoundCount: 0,
    finishedDeckCount: 0,
    resetPassedCount: 0,
    sortHandsAfterTurnCount: 0,
    setLastValidHandCount: 0,
    checkPlayersFinishedCount: 0,
    finishedGameCount: 0,
    incrementTurnCount: 0,
    passTurnCount: 0,
    getLastHandCount: 0
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

    socket.on('joinRoom', (data) => {
        // Extracting roomCode data object
        const { roomCode } = data;

        if (roomCode && rooms[roomCode]) {
            const room = io.sockets.adapter.rooms.get(roomCode);
            const numClients = room ? room.size : 0;

            if (numClients < MAX_CLIENTS_PER_ROOM) {
                // Join the room if the code is valid and the room is not full
                socket.join(roomCode);

                // Assign host if this is the first client
                if (numClients === 0) {
                    rooms[roomCode].host = socket.id;
                }

                console.log(`Client: ${socket.username} (${socket.id}) joined room ${roomCode}`);
                const client = { id: socket.id, username: socket.username, isReady: false };
                rooms[roomCode].clients.push(client);
                
                // Notify the client that joining was successful
                socket.emit('joinedRoom');

                // Broadcast the updated client list to the room
                io.to(roomCode).emit('updateReadyState', rooms[roomCode].clients);
            } else {
                // Send an error message if the room is full
                socket.emit('errorMessage', 'Room is full');
            }
        } else {
            // Send an error message if the code is invalid
            socket.emit('errorMessage', 'Invalid room code');
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
        if (!rooms[roomCode]) return;

        const client = rooms[roomCode].clients.find(client => client.id === socket.id);
        if (client) {
            client.isReady = isReady;
        }

        io.to(roomCode).emit('updateReadyState', rooms[roomCode].clients);
    });

    // Start the game for the lobby, populate gameState and generate a deck (only host can trigger this event)
    socket.on('startGame', (roomCode) => {
        // Notify all clients that the game has started
        io.to(roomCode).emit('gameStarted');

        // Create and assign a new GameState object for the specified room
        const gameState = new GameState();
        rooms[roomCode].gameState = gameState;

        // Create empty array that will be filled by four player objects
        const players = [];

        // Create and shuffle a new deck, then emit it to all clients
        const deck = new Deck();
        deck.shuffle(); // Shuffle the deck

        // Retrieve the room clients using the roomCode
        const roomClients = rooms[roomCode].clients;

        // Iterate over each client in the room
        roomClients.forEach((client, index) => {
            // Retrieve the username using the client's socket ID
            const username = usernameToSocketIdMap.get(client.id);
            const player = new Player(username);

            // set player.clientTd to forEach index (should be 0-3)
            player.clientId = index;
            player.socketId = client.id;

            // Push the player into the players array
            players.push(player);
            
            io.to(client.id).emit('clientSocketId', client.id);
        });

        // initialise roomCode gameState with players
        rooms[roomCode].gameState.players = players;

        // Send the shuffled deck to all clients in the room
        io.to(roomCode).emit('shuffledDeck', { cards: deck.cards });
       
        // Emit the gameState object to all clients in the room
        io.to(roomCode).emit('initialGameState', { gameState: rooms[roomCode].gameState });
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

    socket.on('sortHandsComplete', (roomCode, player) => {
        if (rooms[roomCode]) {
            // Find the player in rooms[roomCode].gameState.players array using clientId and update their cards property
            const serverPlayer = rooms[roomCode].gameState.players.find(p => p.clientId === player.clientId);

            if(serverPlayer) {
                // Update the server player's cards with client player's cards
                serverPlayer.cards = player.cards;

                // If cards updated server side increment count
                rooms[roomCode].sortHandsCount++;

                // Optionally, update other properties specific to your application
                console.log(`Updated player with clientId ${serverPlayer.clientId} in room ${roomCode}`);
            } else {
                console.log(`Player with clientId ${player.clientId} not found in room ${roomCode}`);
            }

            // Check if dealCount reaches 4
            if (rooms[roomCode].sortHandsCount === 4) {
                // Reset sortHandsCount for the next round or game, if needed
                rooms[roomCode].sortHandsCount = 0;

                // Emit a allSortingComplete event to notify clients
                io.to(roomCode).emit('allSortingComplete');
                console.log(`allSortingComplete emitted for room ${roomCode}`);
            }

        } else {
            console.log(`Room ${roomCode} not found`);
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

    // Let clients know if a player in the room has won a round and emit appropriate event
    socket.on('checkWonRound', (roomCode) => {
        if(rooms[roomCode]) {
            rooms[roomCode].checkWonRoundCount++;

            if(rooms[roomCode].checkWonRoundCount === 4) {
                // Count the number of players who have passed
                const passedPlayersCount = rooms[roomCode].gameState.players.filter(player => player.passed).length;
                rooms[roomCode].checkWonRoundCount = 0;

                if (passedPlayersCount === 3) {
                    // Reset the passed status for all players
                    rooms[roomCode].gameState.players.forEach(player => player.passed = false);

                    // Let clients know it's okay to start the finishDeckAnimation
                    io.to(roomCode).emit('wonRound');
                    console.log("emitted checkWonRound");
                }
                else {
                    io.to(roomCode).emit('noWonRound');
                    console.log("emitted noWonRound");
                }
            }
        }
    });

    // Clients emit this message once all 4 of their finish deck animations have finished
    socket.on('finishDeckAnimation', (roomCode, wonRoundPlayer, finishedDeck) => {
        //if roomcode extist, 
        //ifHost, send clientId of current turn, update gameState's gameDeck, finishedDeck
        if(rooms[roomCode]) {
            rooms[roomCode].finishedDeckCount++;

            if (rooms[roomCode].finishedDeckCount === 4) {
                const serverPlayer = rooms[roomCode].gameState.players.find(p => p.clientId === wonRoundPlayer.clientId);

                if (serverPlayer) {
                    console.log("wonRound player found");
                    serverPlayer.wonRound = true;

                    // Update room's gameState, remove all cards from gameDeck for the free turn
                    rooms[roomCode].gameState.finishedDeck = finishedDeck;
                    rooms[roomCode].gameState.gameDeck.length = 0;
                    rooms[roomCode].finishedDeckCount = 0;

                    // Emit player and gameState.gameDeck so client can update their local equivalents
                    io.to(roomCode).emit('finishDeckComplete', serverPlayer, rooms[roomCode].gameState.gameDeck)
                }
            }
        }
    });

    socket.on('playedHand', (roomCode, hand, clientPlayer, gameDeck, playersFinished) => {
        if(rooms[roomCode]) {
            let emitPlayer;
            // Update gameState to match current client's (latest version because its their turn)
            rooms[roomCode].gameState.gameDeck = gameDeck;
            rooms[roomCode].gameState.playersFinished = playersFinished;

            // Update clientId player's cards, and emit back to clients, also emit the cards they played
            for (let player of rooms[roomCode].gameState.players) {
                if(player.clientId == clientPlayer.clientId) {
                    // Update player's server side cards to match client side
                    player.cards = clientPlayer.cards;
                    emitPlayer = player;
                }
            }

            // Emit hand (to make opponents play that hand), player, and gameState.gameDeck so client can update their local equivalents
            io.to(roomCode).emit('receivePlayerHand', hand, emitPlayer, rooms[roomCode].gameState.gameDeck, rooms[roomCode].gameState.playersFinished)
        }

    });

    socket.on('resetPlayersPassed', (roomCode, clientId) => {
        if(rooms[roomCode]) {
            for (let player of rooms[roomCode].gameState.players) {
                // Reset wonRound status of found player
                if (player.clientId === clientId) {
                    player.passed = false;

                    // If player status changed, increment passed count
                    rooms[roomCode].resetPassedCount++; 
                }
            }

            // Check if resetPassedCount reaches 4
            if (rooms[roomCode].resetPassedCount === 4) {
                // Reset resetPassedCount for the next round or game, if needed
                rooms[roomCode].resetPassedCount = 0;

                // Emit a wonRoundReset event to notify clients and emit updated server side players
                io.to(roomCode).emit('resetPassedComplete', rooms[roomCode].gameState.players);

                console.log(`resetPassedCount emitted for room ${roomCode}`);
            }
        }
    });

    socket.on('sortPlayerHandAfterTurn', (roomCode, clientPlayer) => {
        if (rooms[roomCode]) {
            const isHost = rooms[roomCode].host === socket.id;

            // Increment count after client has finished sorting after turn animation locally
            rooms[roomCode].sortHandsAfterTurnCount++;

            if(isHost) {
                // Find the player in rooms[roomCode].gameState.players array using clientId and update their cards property
                const serverPlayer = rooms[roomCode].gameState.players.find(p => p.clientId === clientPlayer.clientId);

                if(serverPlayer) {
                    // Update the existing player object with received data
                    serverPlayer.cards = clientPlayer.cards;
    
                    // Optionally, update other properties specific to your application
                    console.log(`Updated player with clientId ${serverPlayer.clientId} in room ${roomCode}`);
                } else {
                    console.log(`Player with clientId ${clientPlayer.clientId} not found in room ${roomCode}`);
                }
            }

            // Check if dealCount reaches 4
            if (rooms[roomCode].sortHandsAfterTurnCount === 4) {
                // Reset sortHandsAfterTurnCount for the next round or game, if needed
                rooms[roomCode].sortHandsAfterTurnCount = 0;

                // Emit a allSortingComplete event to notify clients
                io.to(roomCode).emit('sortAfterTurnComplete');
                console.log(`sortAfterTurnComplete emitted for room ${roomCode}`);
            }

        } else {
            console.log(`Room ${roomCode} not found`);
        }
    });

    socket.on('setLastValidHand', (roomCode, playedHand) => {
        if(rooms[roomCode]) {
            const isHost = rooms[roomCode].host === socket.id;

            // Increment count 
            rooms[roomCode].setLastValidHandCount++;

            // just get the current length of playedHand from host client (instead of 4)
            if(isHost) {
                rooms[roomCode].gameState.playedHand = playedHand;
                rooms[roomCode].gameState.lastValidHand = playedHand;
            }
            
            // Check if dealCount reaches 4
            if (rooms[roomCode].setLastValidHandCount === 4) {
                // Reset sortHandsAfterTurnCount for the next round or game, if needed
                rooms[roomCode].setLastValidHandCount = 0;

                // Emit a allSortingComplete event to notify clients
                io.to(roomCode).emit('setLastValidHandComplete', rooms[roomCode].gameState.playedHand, rooms[roomCode].gameState.lastValidHand);
                console.log(`setLastValidHandComplete emitted for room ${roomCode}`);
            }
        }
    });

    // Receive current turn's player and check if they have 0 cards, if yes then update server gameState accordingly
    socket.on('checkIfPlayerHasFinished', (roomCode, clientPlayer, clientPlayersFinished) => {
        if(rooms[roomCode]) {
            // increment count for every client emit
            rooms[roomCode].checkPlayersFinishedCount++;

            // Only the last client's emitted updates will update the server's room gamestate
            if(rooms[roomCode].checkPlayersFinishedCount === 4) {
                console.log("reached checkIfPlayerHasFinished")
                // Reset checkPlayersFinishedCount for the next round or game, if needed
                rooms[roomCode].checkPlayersFinishedCount = 0;

                console.log("client playersFinishedLength: " + clientPlayersFinished.length)

                if (clientPlayersFinished.length >= 1) {
                    // update room's playersFinished array with latest client version
                    rooms[roomCode].gameState.playersFinished = clientPlayersFinished;

                    for (let clientId of clientPlayersFinished) {
                        // Find the player in rooms[roomCode].gameState.players array using clientId and update their cards property
                        let serverPlayer = rooms[roomCode].gameState.players.find(p => p.clientId === clientId);

                        if (serverPlayer) {
                            console.log("finished game player found: " + clientId);
                            serverPlayer.cards = clientPlayer.cards;
                            serverPlayer.finishedGame = true;
                        }
                    }
                }

                // If client side playersFinished array length is 3 
                if(clientPlayersFinished.length === 3) {
                    // Find the missing clientId of the losing player
                    // Sum of numbers 0 through 3
                    const totalSum = 6; 
    
                    // The reduce method is used to sum up the numbers in the clientPlayersFinished array
                    const currentSum = clientPlayersFinished.reduce((sum, num) => sum + num, 0);
    
                    // The missing clientId is found by subtracting the currentSum from the totalSum.
                    const losingPlayerClientId = totalSum - currentSum;
    
                    rooms[roomCode].gameState.losingPlayer = losingPlayerClientId;

                    rooms[roomCode].gameState.playersFinished.push(losingPlayerClientId);
                }

                // If losing player is in playersFinished array, emit array and clientId of losing player, to let clients know game is over
                if(rooms[roomCode].gameState.playersFinished.length === 4) {
                    io.to(roomCode).emit('gameHasFinished', rooms[roomCode].gameState.playersFinished, rooms[roomCode].gameState.losingPlayer);
                    console.log(`gameHasFinished emitted for room ${roomCode}`);
                }
                // Else if 1-3 clients have finished the game
                else if(rooms[roomCode].gameState.playersFinished.length >= 1 && rooms[roomCode].gameState.playersFinished.length <= 3) {
                    io.to(roomCode).emit('gameHasNotFinished', rooms[roomCode].gameState.playersFinished);
                    console.log(`gameHasNotFinished emitted for room ${roomCode}`);
                }
                // Else no clients have finished the game
                else {
                    io.to(roomCode).emit('noClientHasFinished', rooms[roomCode].gameState.playersFinished);
                    console.log(`noClientHasFinished emitted for room ${roomCode}`);
                }
            }
        }
    });

    // Clients emit this message once all 4 of their finish game animations have finished
    socket.on('finishGameAnimation', (roomCode, clientPlayers, clientGameDeck, clientFinishedDeck) => {
        //if roomcode extist, 
        //ifHost, send clientId of current turn, update gameState's gameDeck, finishedDeck
        if(rooms[roomCode]) {
            const isHost = rooms[roomCode].host === socket.id;
            rooms[roomCode].finishedGameCount++;
            
            if(isHost) {
                rooms[roomCode].gameState.players = clientPlayers;

                rooms[roomCode].gameState.gameDeck = clientGameDeck;

                rooms[roomCode].gameState.finishedDeck = clientFinishedDeck;
            }

            if(rooms[roomCode].finishedGameCount === 4) {
                // Reset wonRoundStatusCount for the next round
                rooms[roomCode].finishedGameCount = 0;

                // Emit player and gameState.gameDeck so client can update their local equivalents
                io.to(roomCode).emit('finishGameAnimationComplete')
            }
        }
    });

    socket.on('incrementTurn', (roomCode, currentTurnClientId) => {
        if(rooms[roomCode]) {
            const isHost = rooms[roomCode].host === socket.id;
            rooms[roomCode].incrementTurnCount++;

            if(isHost) {
                rooms[roomCode].gameState.turn = currentTurnClientId;

                // increment turn to next clientId depedning on whose turn it is
                switch(rooms[roomCode].gameState.turn) {
                    case 0:
                        rooms[roomCode].gameState.turn = 1;
                        break;
                    case 1:
                        rooms[roomCode].gameState.turn = 2;
                        break;
                    case 2:
                        rooms[roomCode].gameState.turn = 3;
                        break;
                    case 3:
                        rooms[roomCode].gameState.turn = 0;
                        break;
                }
            }

            if(rooms[roomCode].incrementTurnCount === 4) {
                // Reset wonRoundStatusCount for the next round
                rooms[roomCode].incrementTurnCount = 0;

                // Emit current clientId of player who's turn it is
                io.to(roomCode).emit('turnIncremented', rooms[roomCode].gameState.turn);
            }
        }
    });

    socket.on('passTurn', (roomCode, currentTurnClientId) => {
        if(rooms[roomCode]) {
            const isHost = rooms[roomCode].host === socket.id;
            const serverPlayer = rooms[roomCode].gameState.players.find(p => p.clientId === currentTurnClientId);

            rooms[roomCode].passTurnCount++;

            if(isHost) {
                if(serverPlayer){
                    // Change server player passed property to true
                    serverPlayer.passed = true;

                    rooms[roomCode].gameState.turn = currentTurnClientId;

                    // increment turn to next clientId depedning on whose turn it is
                    switch(rooms[roomCode].gameState.turn) {
                        case 0:
                            rooms[roomCode].gameState.turn = 1;
                            break;
                        case 1:
                            rooms[roomCode].gameState.turn = 2;
                            break;
                        case 2:
                            rooms[roomCode].gameState.turn = 3;
                            break;
                        case 3:
                            rooms[roomCode].gameState.turn = 0;
                            break;
                    }
                }
                else {
                    console.log("Server Player not found");
                }
            }

            if(rooms[roomCode].passTurnCount === 4) {
                // Reset wonRoundStatusCount for the next round
                rooms[roomCode].passTurnCount = 0;

                // Emit current serverPlayer so clients can update their local passed status
                io.to(roomCode).emit('passedTurn', serverPlayer, rooms[roomCode].gameState.turn);
            }
        }
    });

    socket.on('getLastHand', (roomCode, clientLastHand) => {
        if(rooms[roomCode]) {
            const isHost = rooms[roomCode].host === socket.id;
            rooms[roomCode].getLastHandCount++;

            if(isHost) {
                // update server lastHand game state
                rooms[roomCode].gameState.lastHand = clientLastHand;
            }

            if(rooms[roomCode].getLastHandCount === 4) {
                // Reset wonRoundStatusCount for the next round
                rooms[roomCode].getLastHandCount = 0;

                // Emit lastHand of server that the host updated 
                io.to(roomCode).emit('gotLastHand', rooms[roomCode].gameState.lastHand);
                console.log(`gotLastHand emitted for room ${roomCode}`);
            }
        }
    });


    // Handle errors in connection logic
    socket.on('error', (err) => {
        console.error('Socket error:', err);
    });

    // Listen for disconnect event
    socket.on('disconnect', () => {
        // Log the disconnection
        console.log(`Client disconnected: ${socket.username} (${socket.id})`);
        
        // Remove the mapping of username to socket ID when a client disconnects
        usernameToSocketIdMap.delete(socket.username);
        
        for (let roomCode in rooms) {
            rooms[roomCode].clients = rooms[roomCode].clients.filter(client => client.id !== socket.id);
            io.to(roomCode).emit('updateReadyState', rooms[roomCode].clients);

            // Remove host if they disconnect
            if (rooms[roomCode].host === socket.id) {
                rooms[roomCode].host = null;
                console.log(`Host disconnected from room ${roomCode}`);
            }
        }
    });

    
});

/*app.get('/generate-room', (req, res) => {
    const roomCode = generateRoomCode();
    rooms[roomCode] = { clients: [] }; // Initialize with an empty clients array

    // Log the room code
    console.log('Generated room code:', roomCode);

    res.send({ roomCode });
});*/

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

//TO DO
//when player joins assign an id to them

//deal funciton = shuffle the deck on the server and deal the cards to the players, emit a message once all players are confirmed to have all cards