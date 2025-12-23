import { useState, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import { motion, AnimatePresence } from 'framer-motion';
import { Trophy, Send, Search, Check, LogIn, Plus } from 'lucide-react';
import confetti from 'canvas-confetti';

// --- Types ---
interface Player {
  id: string;
  name: string;
  points: number;
}

interface Submission {
  playerId: string;
  gifUrl: string;
}

interface Room {
  id: string;
  hostId: string;
  players: Player[];
  status: 'lobby' | 'topic-selection' | 'gif-selection' | 'voting' | 'reveal' | 'game-over';
  currentRound: number;
  maxRounds: number;
  topic: string;
  submissions: Submission[];
  winnerOfLastRound: string;
}

// --- Constants ---
const KLIPY_APP_KEY = import.meta.env.VITE_KLIPY_APP_KEY && import.meta.env.VITE_KLIPY_APP_KEY !== 'undefined'
  ? import.meta.env.VITE_KLIPY_APP_KEY
  : 'sandbox-mJokm7E2jH';
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001';

function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [playerName, setPlayerName] = useState('');
  const [roomIdInput, setRoomIdInput] = useState('');
  const [room, setRoom] = useState<Room | null>(null);
  const [topicInput, setTopicInput] = useState('');
  const [gifs, setGifs] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGif, setSelectedGif] = useState<string | null>(null);
  const [votedFor, setVotedFor] = useState<string | null>(null);
  const [winners, setWinners] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const savedSessionId = localStorage.getItem('gif_league_session');

    const newSocket = io(SOCKET_URL, {
      auth: { sessionId: savedSessionId }
    });

    setSocket(newSocket);

    newSocket.on('session', ({ sessionId }) => {
      localStorage.setItem('gif_league_session', sessionId);
    });

    newSocket.on('room-created', (room: Room) => setRoom(room));
    newSocket.on('player-joined', (room: Room) => {
      setRoom(room);
      // Auto-set player name if reconnected
      const me = room.players.find(p => p.id === newSocket.id);
      if (me) setPlayerName(me.name);
    });
    newSocket.on('game-started', (room: Room) => setRoom(room));
    newSocket.on('topic-submitted', (room: Room) => {
      setRoom(room);
      setSelectedGif(null);
      setGifs([]);
      setSearchQuery('');
      setWinners([]);
    });
    newSocket.on('gif-submitted', () => {
      // Optional: show progress
    });
    newSocket.on('all-gifs-submitted', (room: Room) => {
      setRoom(room);
      setVotedFor(null);
    });
    newSocket.on('round-ended', ({ room, winners: roundWinners }: { room: Room, winners: string[] }) => {
      setRoom(room);
      setWinners(roundWinners);
      if (roundWinners.includes(newSocket.id!)) {
        confetti();
      }
    });
    newSocket.on('new-round', (room: Room) => {
      setRoom(room);
      setTopicInput('');
    });
    newSocket.on('error', (msg: string) => setError(msg));

    return () => {
      newSocket.disconnect();
    };
  }, []);

  useEffect(() => {
    if (room?.status === 'gif-selection' && gifs.length === 0) {
      fetchTrendingGifs();
    }
  }, [room?.status]);

  const createRoom = () => {
    if (!playerName) return setError('Enter your name');
    socket?.emit('create-room', { playerName });
  };

  const joinRoom = () => {
    if (!playerName || !roomIdInput) return setError('Enter name and room ID');
    socket?.emit('join-room', { roomId: roomIdInput, playerName });
  };

  const startGame = () => {
    if (room) socket?.emit('start-game', { roomId: room.id });
  };

  const fetchTrendingGifs = async () => {
    setLoading(true);
    try {
      const res = await fetch(`https://api.klipy.com/api/v1/${KLIPY_APP_KEY}/gifs/trending?customer_id=${socket?.id || 'guest'}&per_page=12`);
      const data = await res.json();
      if (data.data?.data) {
        setGifs(data.data.data);
      } else if (Array.isArray(data.data)) {
        setGifs(data.data);
      }
    } catch (err) {
      console.error('Failed to fetch trending GIFs', err);
    }
    setLoading(false);
  };

  const submitTopic = () => {
    if (room && topicInput) {
      socket?.emit('submit-topic', { roomId: room.id, topic: topicInput });
    }
  };

  const searchGifs = async () => {
    if (!searchQuery) return;
    setLoading(true);
    console.log('Searching KLIPY GIFs for:', searchQuery);
    try {
      const res = await fetch(`https://api.klipy.com/api/v1/${KLIPY_APP_KEY}/gifs/search?q=${encodeURIComponent(searchQuery)}&customer_id=${socket?.id || 'guest'}&per_page=12`);
      if (!res.ok) {
        const errorData = await res.json();
        console.error('Klipy API error:', errorData);
        throw new Error(errorData.message || 'Failed to fetch GIFs');
      }
      const data = await res.json();
      console.log('Klipy data received:', data.data?.data?.length || 0, 'items');
      if (data.data?.data) {
        setGifs(data.data.data);
      } else if (Array.isArray(data.data)) {
        setGifs(data.data);
      } else {
        setGifs([]);
      }
    } catch (err: any) {
      console.error('Klipy search failed:', err);
      setError(`GIF Search Failed: ${err.message}`);
    }
    setLoading(false);
  };

  const submitGif = (url: string) => {
    setSelectedGif(url);
    socket?.emit('submit-gif', { roomId: room?.id, gifUrl: url });
  };

  const submitVote = (playerId: string) => {
    if (playerId === socket?.id) return;
    setVotedFor(playerId);
    socket?.emit('submit-vote', { roomId: room?.id, votedPlayerId: playerId });
  };

  const nextRound = () => {
    socket?.emit('next-round', { roomId: room?.id });
  };

  const isMyTurn = room?.winnerOfLastRound === socket?.id;

  return (
    <div className="app-container">
      <div className="bg-mesh"></div>
      <div className="bg-grid"></div>

      {error && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card"
          style={{ borderColor: 'var(--primary)', marginBottom: '1rem', padding: '1rem', color: 'var(--primary)' }}
        >
          {error}
          <button onClick={() => setError(null)} style={{ float: 'right', background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}>✕</button>
        </motion.div>
      )}

      {!room ? (
        <JoinScreen
          playerName={playerName}
          setPlayerName={setPlayerName}
          roomIdInput={roomIdInput}
          setRoomIdInput={setRoomIdInput}
          createRoom={createRoom}
          joinRoom={joinRoom}
        />
      ) : (
        <GameScreen
          room={room}
          socketId={socket?.id}
          isMyTurn={isMyTurn}
          topicInput={topicInput}
          setTopicInput={setTopicInput}
          submitTopic={submitTopic}
          startGame={startGame}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          searchGifs={searchGifs}
          gifs={gifs}
          selectedGif={selectedGif}
          submitGif={submitGif}
          votedFor={votedFor}
          submitVote={submitVote}
          nextRound={nextRound}
          loading={loading}
          winners={winners}
        />
      )}
    </div>
  );
}

// --- Sub-components ---

function JoinScreen({ playerName, setPlayerName, roomIdInput, setRoomIdInput, createRoom, joinRoom }: any) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="glass-card flex-column gap-2"
      style={{ maxWidth: '450px', margin: 'auto', width: '100%' }}
    >
      <div className="text-center">
        <h1 style={{ fontSize: '3rem', background: 'linear-gradient(to right, #f43f5e, #8b5cf6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', marginBottom: '0.5rem' }}>
          GIF LEAGUE
        </h1>
        <p style={{ color: 'var(--text-muted)' }}>The ultimate GIF battle game</p>
      </div>

      <div className="flex-column gap-1">
        <label>Player Name</label>
        <input
          placeholder="Enter your name..."
          value={playerName}
          onChange={e => setPlayerName(e.target.value)}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <button className="btn btn-primary" onClick={createRoom}>
          <Plus size={20} /> Create
        </button>
        <div className="flex-column gap-1">
          <input
            placeholder="Room ID"
            value={roomIdInput}
            onChange={e => setRoomIdInput(e.target.value)}
          />
          <button className="btn btn-secondary" onClick={joinRoom}>
            <LogIn size={20} /> Join
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function GameScreen({ room, socketId, isMyTurn, topicInput, setTopicInput, submitTopic, startGame, searchQuery, setSearchQuery, searchGifs, gifs, selectedGif, submitGif, votedFor, submitVote, nextRound, loading, winners }: any) {
  const SUGGESTED_TOPICS = [
    "When you see your ex in public",
    "Friday at 4:59 PM",
    "Realizing you've been on mute for 10 minutes",
    "That 'oops' moment in the group chat",
    "Your face when the pizza arrives",
    "When someone eats the leftovers you were thinking about all day",
    "Trying to look cool while failing miserably",
    "Monday mornings be like...",
    "When the code finally works on the first try",
    "Explaining a meme to your parents"
  ];

  const pickRandomTopic = () => {
    const random = SUGGESTED_TOPICS[Math.floor(Math.random() * SUGGESTED_TOPICS.length)];
    setTopicInput(random);
  };

  return (
    <div className="flex-column gap-2" style={{ flex: 1 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '1.5rem' }}>Round {room.currentRound} / {room.maxRounds}</h2>
          <div className="room-id-badge">{room.id}</div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {room.players.map((p: any) => (
            <div key={p.id} className="player-tag" style={{ border: p.id === socketId ? '1px solid var(--primary)' : '1px solid transparent' }}>
              {p.name} <span className="score-badge">{p.points}</span>
            </div>
          ))}
        </div>
      </header>

      <AnimatePresence mode="wait">
        {room.status === 'lobby' && (
          <motion.div key="lobby" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="glass-card text-center gap-1 flex-column">
            <h3>Waiting Room</h3>
            <p>{room.players.length} players joined</p>
            {room.hostId === socketId ? (
              <button className="btn btn-primary" onClick={startGame} disabled={room.players.length < 2}>
                Start Game (Min 2 players)
              </button>
            ) : (
              <p style={{ fontStyle: 'italic' }}>Waiting for host to start...</p>
            )}
          </motion.div>
        )}

        {room.status === 'topic-selection' && (
          <motion.div key="topic" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="glass-card text-center gap-1 flex-column">
            {isMyTurn ? (
              <>
                <h3>Choose a Topic</h3>
                <p>Give everyone a funny situation to respond to with a GIF!</p>
                <div className="flex-column gap-1">
                  <input
                    placeholder="e.g. When you realize it's Monday morning..."
                    value={topicInput}
                    onChange={e => setTopicInput(e.target.value)}
                  />
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button className="btn btn-secondary" style={{ flex: 1 }} onClick={pickRandomTopic}>
                      🎲 Suggest Topic
                    </button>
                    <button className="btn btn-primary" style={{ flex: 2 }} onClick={submitTopic}>
                      <Send size={18} /> Send Topic
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <h3>Waiting for Topic</h3>
                <p>{room.players.find((p: any) => p.id === room.winnerOfLastRound)?.name || 'Someone'} is choosing a topic...</p>
              </>
            )}
          </motion.div>
        )}

        {room.status === 'gif-selection' && (
          <motion.div key="gif" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="glass-card flex-column gap-1">
            <h3 className="text-center" style={{ color: 'var(--secondary)' }}>TOPIC: "{room.topic}"</h3>

            {selectedGif ? (
              <div className="text-center">
                <p>Your GIF is submitted! Waiting for others...</p>
                <img src={selectedGif} style={{ maxHeight: '300px', borderRadius: '12px', marginTop: '1rem' }} />
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    placeholder="Search for the perfect GIF..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && searchGifs()}
                  />
                  <button className="btn btn-primary" onClick={searchGifs}>
                    <Search size={20} />
                  </button>
                </div>
                {loading && <p className="text-center">Loading GIFs...</p>}
                {!loading && gifs.length === 0 && searchQuery && <p className="text-center">No GIFs found for "{searchQuery}". Try something else!</p>}
                {!searchQuery && gifs.length > 0 && <p style={{ fontSize: '0.8rem', opacity: 0.7, marginBottom: '0.5rem' }}>🔥 Showing Trending GIFs</p>}
                <div className="gif-grid">
                  {gifs.map((g: any) => {
                    const gifUrl = g.file?.hd?.gif?.url || g.file?.xs?.gif?.url;
                    return (
                      <div key={g._id || g.id} className="gif-item" onClick={() => submitGif(gifUrl)}>
                        <img
                          src={gifUrl}
                          alt="Klipy GIF"
                          onError={(e: any) => e.target.src = 'https://via.placeholder.com/200?text=GIF+Error'}
                        />
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </motion.div>
        )}

        {room.status === 'voting' && (
          <motion.div key="voting" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-column gap-1">
            <h3 className="text-center glass-card" style={{ marginBottom: '1rem' }}>Vote for the best GIF! Topic: "{room.topic}"</h3>
            <div className="gif-grid">
              {room.submissions.map((sub: any) => (
                <div
                  key={sub.playerId}
                  className={`gif-item glass-card ${votedFor === sub.playerId ? 'selected' : ''}`}
                  style={{
                    opacity: sub.playerId === socketId ? 0.5 : 1,
                    cursor: sub.playerId === socketId ? 'default' : 'pointer',
                    padding: '10px'
                  }}
                  onClick={() => sub.playerId !== socketId && !votedFor && submitVote(sub.playerId)}
                >
                  <img src={sub.gifUrl} style={{ height: 'auto', maxHeight: '300px' }} />
                  <div style={{ padding: '0.5rem', textAlign: 'center' }}>
                    {votedFor === sub.playerId && <Check color="var(--primary)" />}
                    {sub.playerId === socketId && <span style={{ fontSize: '0.8rem' }}>Your Submission</span>}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {room.status === 'reveal' && (
          <motion.div key="reveal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="glass-card flex-column gap-2 items-center">
            <h3>Round Results</h3>
            <div className="gif-grid" style={{ width: '100%' }}>
              {room.submissions.map((sub: any) => {
                const player = room.players.find((p: any) => p.id === sub.playerId);
                const isWinner = winners.includes(sub.playerId);
                return (
                  <div key={sub.playerId} className={`gif-item glass-card text-center ${isWinner ? 'winner-highlight' : ''}`}>
                    {isWinner && <div className="winner-tag">🏆 WINNER</div>}
                    <img src={sub.gifUrl} style={{ width: '100%', borderRadius: '8px' }} />
                    <p style={{ marginTop: '0.5rem', fontWeight: 'bold' }}>{player?.name}</p>
                    {isWinner && <p style={{ fontSize: '0.8rem', color: '#fbbf24' }}>+{room.players.length > 1 ? '1 point' : ''}</p>}
                  </div>
                );
              })}
            </div>
            {socketId === room.hostId && (
              <button className="btn btn-primary" onClick={nextRound}>Next Round</button>
            )}
          </motion.div>
        )}

        {room.status === 'game-over' && (
          <motion.div key="game-over" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="glass-card text-center gap-2 flex-column items-center">
            <h1 style={{ color: 'var(--primary)' }}>GAME OVER</h1>
            <Trophy size={64} color="gold" />
            <div className="flex-column gap-1" style={{ width: '300px' }}>
              {room.players.sort((a: any, b: any) => b.points - a.points).map((p: any, i: number) => (
                <div key={p.id} className="glass-card" style={{ display: 'flex', justifyContent: 'space-between', padding: '1rem' }}>
                  <span>{i + 1}. {p.name}</span>
                  <span className="score-badge">{p.points} points</span>
                </div>
              ))}
            </div>
            <button className="btn btn-primary" onClick={() => window.location.reload()}>Play Again</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div >
  );
}

export default App;
