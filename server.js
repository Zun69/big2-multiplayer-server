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
rooms[initialRoomCode1] = { clients: [], gameState: null, dealCount: 0 }; // Initialize with an empty clients array and gameState
rooms[initialRoomCode2] = { clients: [], gameState: null, dealCount: 0 }; 
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
    socket.on('getClientList', ({ roomCode }) => {
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
    socket.on('checkHost', ({ roomCode }) => {
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
    socket.on('sendMessage', ({ roomCode, message }) => {
        const username = usernameToSocketIdMap.get(socket.id);
        if (roomCode && message && username) {
            // Broadcast the message to all clients in the room
            io.to(roomCode).emit('receiveMessage', `${username}: ${message}`);
        }
    });

    // Handle toggleReadyState event, takes in isReady state from client and returns list of clients and their ready states
    socket.on('toggleReadyState', ({ roomCode, isReady }) => {
        if (!rooms[roomCode]) return;

        const client = rooms[roomCode].clients.find(client => client.id === socket.id);
        if (client) {
            client.isReady = isReady;
        }

        io.to(roomCode).emit('updateReadyState', rooms[roomCode].clients);
    });

    // Start the game for the lobby, populate gameState and generate a deck (only host can trigger this event)
    socket.on('startGame', ({ roomCode }) => {
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

            // Push the player into the players array
            players.push(player);
        });

        // initialise roomCode gameState with players
        rooms[roomCode].gameState.players = players;

        // Send the shuffled deck to all clients in the room
        io.to(roomCode).emit('shuffledDeck', { cards: deck.cards });
       
        // Emit the gameState object to all clients in the room
        io.to(roomCode).emit('initialGameState', { gameState: rooms[roomCode].gameState });
    });

    // Event handler for when a deal is complete
    socket.on('dealComplete', ({ roomCode, player }) => {
        if (rooms[roomCode]) {
            rooms[roomCode].dealCount++;

            // Find the player in rooms[roomCode].gameState.players array using clientId and update their cards property
            const clientPlayer = rooms[roomCode].gameState.players.find(p => p.clientId === player.clientId);

            if(clientPlayer) {
                // Update the existing player object with received data
                clientPlayer.cards = player.cards.map(card => ({ rank: card.rank, suit: card.suit }));

                // Optionally, update other properties specific to your application
                console.log(`Updated player with clientId ${clientPlayer.clientId} in room ${roomCode}`);
            } else {
                console.log(`Player with clientId ${player.clientId} not found in room ${roomCode}`);
            }

            // Check if dealCount reaches 4
            if (rooms[roomCode].dealCount === 4) {
                // Emit a dealComplete event to notify clients
                io.to(roomCode).emit('allDealsComplete');
                console.log(`allDealsComplete emitted for room ${roomCode}`);
                
                // Reset dealCount for the next round or game, if needed
                rooms[roomCode].dealCount = 0;
            }
        } else {
            console.log(`Room ${roomCode} not found`);
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