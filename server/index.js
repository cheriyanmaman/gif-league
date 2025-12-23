import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const allowedOrigins = [
    "http://localhost:5173",
    "http://192.168.0.5:5173",
    "https://gif-league-1.onrender.com",
    process.env.FRONTEND_URL,
].filter(Boolean);

app.use(cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : "*",
    methods: ["GET", "POST"]
}));

const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: allowedOrigins.length > 0 ? allowedOrigins : "*",
        methods: ["GET", "POST"]
    }
});

const rooms = new Map();
const sessions = new Map(); // sessionId -> { socketId, roomId, playerName }

function generateRoomId() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

const SESSION_EXPIRY = 5 * 60 * 1000; // 5 minutes inactivity cleanup

setInterval(() => {
    const now = Date.now();
    for (const [sessionId, session] of sessions.entries()) {
        if (now - session.lastSeen > SESSION_EXPIRY) {
            sessions.delete(sessionId);
            console.log(`Cleaned up expired session: ${sessionId}`);
        }
    }
}, 60000); // Check every minute

io.use((socket, next) => {
    const sessionId = socket.handshake.auth.sessionId;
    if (sessionId) {
        const session = sessions.get(sessionId);
        if (session) {
            socket.sessionId = sessionId;
            socket.playerName = session.playerName;
            socket.roomId = session.roomId;
            return next();
        }
    }
    const newSessionId = Math.random().toString(36).substring(2, 15);
    socket.sessionId = newSessionId;
    next();
});

io.on('connection', (socket) => {
    console.log('User connected:', socket.id, 'Session:', socket.sessionId);

    // Send session ID back to client
    socket.emit('session', { sessionId: socket.sessionId });

    // Update lastSeen
    const session = sessions.get(socket.sessionId);
    if (session) {
        session.lastSeen = Date.now();
    } else {
        sessions.set(socket.sessionId, { lastSeen: Date.now() });
    }

    // Handle reconnection
    if (socket.roomId && rooms.has(socket.roomId)) {
        const room = rooms.get(socket.roomId);
        const player = room.players.find(p => p.sessionId === socket.sessionId);
        if (player) {
            player.id = socket.id; // Update socket ID in room
            socket.join(socket.roomId);
            console.log(`Player ${player.name} reconnected to room ${socket.roomId}`);
            socket.emit('player-joined', room); // Tell reconnected player the current state
            io.to(socket.roomId).emit('player-joined', room); // Update others
        }
    }

    socket.on('create-room', ({ playerName }) => {
        const roomId = generateRoomId();
        const room = {
            id: roomId,
            hostId: socket.id,
            players: [{ id: socket.id, sessionId: socket.sessionId, name: playerName, points: 0 }],
            status: 'lobby',
            currentRound: 0,
            maxRounds: 10,
            topic: '',
            submissions: [],
            votes: [],
            winnerOfLastRound: socket.id
        };
        rooms.set(roomId, room);
        sessions.set(socket.sessionId, { socketId: socket.id, roomId, playerName, lastSeen: Date.now() });
        socket.roomId = roomId;
        socket.join(roomId);
        socket.emit('room-created', room);
        console.log(`Room created: ${roomId} by ${playerName}`);
    });

    socket.on('join-room', ({ roomId, playerName }) => {
        const room = rooms.get(roomId);
        if (room) {
            // Check if player is already in room (rejoining with same session)
            const existingPlayer = room.players.find(p => p.sessionId === socket.sessionId);
            if (existingPlayer) {
                existingPlayer.id = socket.id;
                socket.join(roomId);
                socket.roomId = roomId;
                io.to(roomId).emit('player-joined', room);
                return;
            }

            if (room.status !== 'lobby') {
                socket.emit('error', 'Game already started');
                return;
            }
            const player = { id: socket.id, sessionId: socket.sessionId, name: playerName, points: 0 };
            room.players.push(player);
            sessions.set(socket.sessionId, { socketId: socket.id, roomId, playerName, lastSeen: Date.now() });
            socket.roomId = roomId;
            socket.join(roomId);
            io.to(roomId).emit('player-joined', room);
            console.log(`Player ${playerName} joined room ${roomId}`);
        } else {
            socket.emit('error', 'Room not found');
        }
    });

    socket.on('start-game', ({ roomId }) => {
        const room = rooms.get(roomId);
        if (room && room.hostId === socket.id) {
            room.status = 'topic-selection';
            room.currentRound = 1;
            io.to(roomId).emit('game-started', room);
        }
    });

    socket.on('submit-topic', ({ roomId, topic }) => {
        const room = rooms.get(roomId);
        if (room && (room.winnerOfLastRound === socket.id || room.hostId === socket.id && !room.winnerOfLastRound)) {
            room.topic = topic;
            room.status = 'gif-selection';
            room.submissions = [];
            io.to(roomId).emit('topic-submitted', room);
        }
    });

    socket.on('submit-gif', ({ roomId, gifUrl }) => {
        const room = rooms.get(roomId);
        if (room && room.status === 'gif-selection') {
            // Update submission if player already submitted
            const existingIdx = room.submissions.findIndex(s => s.playerId === socket.id);
            if (existingIdx !== -1) {
                room.submissions[existingIdx].gifUrl = gifUrl;
            } else {
                room.submissions.push({ playerId: socket.id, gifUrl });
            }

            if (room.submissions.length === room.players.length) {
                room.status = 'voting';
                room.votes = [];
                io.to(roomId).emit('all-gifs-submitted', room);
            } else {
                io.to(roomId).emit('gif-submitted', {
                    playerCount: room.players.length,
                    submissionCount: room.submissions.length
                });
            }
        }
    });

    socket.on('submit-vote', ({ roomId, votedPlayerId }) => {
        const room = rooms.get(roomId);
        if (room && room.status === 'voting') {
            // Prevent self-voting or duplicate voting
            if (votedPlayerId === socket.id) return;
            const existingVoteIdx = room.votes.findIndex(v => v.voterId === socket.id);
            if (existingVoteIdx !== -1) {
                room.votes[existingVoteIdx].votedPlayerId = votedPlayerId;
            } else {
                room.votes.push({ voterId: socket.id, votedPlayerId });
            }

            if (room.votes.length === room.players.length) { // Everyone MUST vote for someone else
                // Calculate points
                const voteCounts = {};
                room.votes.forEach(v => {
                    voteCounts[v.votedPlayerId] = (voteCounts[v.votedPlayerId] || 0) + 1;
                });

                let maxVotes = 0;
                let winners = [];
                Object.entries(voteCounts).forEach(([playerId, count]) => {
                    if (count > maxVotes) {
                        maxVotes = count;
                        winners = [playerId];
                    } else if (count === maxVotes) {
                        winners.push(playerId);
                    }
                });

                // Award points
                winners.forEach(winnerId => {
                    const p = room.players.find(p => p.id === winnerId);
                    if (p) p.points += 1;
                });

                room.winnerOfLastRound = winners[0];
                room.status = 'reveal';

                if (room.currentRound >= room.maxRounds) {
                    room.status = 'game-over';
                }

                io.to(roomId).emit('round-ended', { room, winners, voteCounts });
            } else {
                io.to(roomId).emit('vote-submitted', {
                    playerCount: room.players.length,
                    voteCount: room.votes.length
                });
            }
        }
    });

    socket.on('next-round', ({ roomId }) => {
        const room = rooms.get(roomId);
        if (room && room.status === 'reveal') {
            room.currentRound += 1;
            room.status = 'topic-selection';
            room.submissions = [];
            room.votes = [];
            io.to(roomId).emit('new-round', room);
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        // We keep the session for 5 minutes 
    });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
