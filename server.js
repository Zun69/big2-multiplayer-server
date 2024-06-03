const http = require('http');
const express = require('express');
const socketIo = require('socket.io');
const cors = require('cors'); //allow cross origin requests

const app = express();
const server = http.createServer(app);

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
rooms[initialRoomCode1] = true;
rooms[initialRoomCode2] = true;
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
    usernameToSocketIdMap.set(socket.username, socket.id);

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

                // Notify the client that joining was successful
                socket.emit('joinedRoom');
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
    });
});

app.get('/generate-room', (req, res) => {
    const roomCode = generateRoomCode();
    rooms[roomCode] = true; // Store the room code

    // Log the room code
    console.log('Generated room code:', roomCode);

    res.send({ roomCode });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

//TO DO
//when player joins assign an id to them

//deal funciton = shuffle the deck on the server and deal the cards to the players, emit a message once all players are confirmed to have all cards