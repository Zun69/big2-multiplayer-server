const http = require('http');
const express = require('express');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Function to generate a random room code
function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase(); // Generate a 6-character alphanumeric code
}

// Store room codes and corresponding sockets
const rooms = {};

io.on('connection', (socket) => {
    console.log('A client has connected.');

    socket.on('joinRoom', (data) => {
        const { roomCode } = data;
        
        if (roomCode && rooms[roomCode]) {
            // Join the room if the code is valid
            socket.join(roomCode);
            console.log(`Client joined room ${roomCode}`);
        } else {
            // Send an error message if the code is invalid
            socket.emit('errorMessage', 'Invalid room code');
        }
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
