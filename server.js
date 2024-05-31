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

// Automatically generate a room code when the server starts
const initialRoomCode = generateRoomCode();
rooms[initialRoomCode] = true;
console.log('Automatically generated room code:', initialRoomCode);

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

    // Log the socket ID when a client connects
    console.log(`Client connected: ${socket.id}`);

    socket.on('joinRoom', (data) => {
        const { roomCode } = data;
        
        if (roomCode && rooms[roomCode]) {
            // Join the room if the code is valid
            socket.join(roomCode);

            console.log(`Client: ${socket.id} joined room ${roomCode}`);

            // Notify the client that joining was successful
            socket.emit('joinedRoom');
        } else {
            // Send an error message if the code is invalid
            socket.emit('errorMessage', 'Invalid room code');
        }
    });

    // Handle errors in connection logic
    socket.on('error', (err) => {
        console.error('Socket error:', err);
    });

    // Listen for disconnect event
    socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);
        // You can perform cleanup or additional tasks here if needed
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