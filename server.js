const http = require('http');
const express = require('express');
const socketIo = require('socket.io');
const cors = require('cors'); //allow cross origin requests

const app = express();
const server = http.createServer(app);
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
rooms[initialRoomCode1] = { clients: [] }; // Initialize with an empty clients array (for storing client's ready state)
rooms[initialRoomCode2] = { clients: [] }; // Initialize with an empty clients array
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

    socket.on('joinRoom', (data) => {
        // Extracting roomCode data object
        const { roomCode } = data;

        if (roomCode && rooms[roomCode]) {
            const room = io.sockets.adapter.rooms.get(roomCode);
            const numClients = room ? room.size : 0;

            if (numClients < MAX_CLIENTS_PER_ROOM) {
                // Join the room if the code is valid and the room is not full
                socket.join(roomCode);

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

                // Map socket IDs to usernames and socket IDs
                const clients = socketIds.map(socketId => {
                    const username = usernameToSocketIdMap.get(socketId);
                    return { username, socketId };
                }).filter(client => client.username !== undefined);

                // Emit the current client list with usernames and socket IDs for the specified room back to the client
                socket.emit('clientList', clients);
            }
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