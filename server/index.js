import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());

const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const rooms = new Map();

function generateRoomId() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('create-room', ({ playerName }) => {
        const roomId = generateRoomId();
        const room = {
            id: roomId,
            hostId: socket.id,
            players: [{ id: socket.id, name: playerName, points: 0 }],
            status: 'lobby',
            currentRound: 0,
            maxRounds: 10,
            topic: '',
            submissions: [],
            votes: [],
            winnerOfLastRound: socket.id
        };
        rooms.set(roomId, room);
        socket.join(roomId);
        socket.emit('room-created', room);
        console.log(`Room created: ${roomId} by ${playerName}`);
    });

    socket.on('join-room', ({ roomId, playerName }) => {
        const room = rooms.get(roomId);
        if (room) {
            if (room.status !== 'lobby') {
                socket.emit('error', 'Game already started');
                return;
            }
            const player = { id: socket.id, name: playerName, points: 0 };
            room.players.push(player);
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
        if (room && room.winnerOfLastRound === socket.id) {
            room.topic = topic;
            room.status = 'gif-selection';
            room.submissions = [];
            io.to(roomId).emit('topic-submitted', room);
        }
    });

    socket.on('submit-gif', ({ roomId, gifUrl }) => {
        const room = rooms.get(roomId);
        if (room && room.status === 'gif-selection') {
            const submission = { playerId: socket.id, gifUrl };
            room.submissions.push(submission);

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
            room.votes.push({ voterId: socket.id, votedPlayerId });

            if (room.votes.length === room.players.length) {
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

                room.winnerOfLastRound = winners[0]; // For next round topic selection (first winner if tie)
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
        // Handle player removal if needed
    });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
