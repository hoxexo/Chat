const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// In-memory database (replace with real DB in production)
const users = new Map(); // email -> {id, name, email, password}
const onlineUsers = new Map(); // socketId -> userId
const messages = [];

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

// Authentication Middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access denied' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'register.html'));
});

// Register endpoint
app.post('/api/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Validation
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Check if user exists
    if (users.has(email)) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = {
      id: Date.now().toString(),
      name,
      email,
      password: hashedPassword
    };

    users.set(email, user);

    // Generate token
    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.status(201).json({
      message: 'Registration successful',
      token,
      user: { id: user.id, name: user.name, email: user.email }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Login endpoint
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Check user
    const user = users.get(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate token
    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: { id: user.id, name: user.name, email: user.email }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get online users
app.get('/api/online-users', authenticateToken, (req, res) => {
  const onlineUserIds = new Set(onlineUsers.values());
  const onlineUserList = [];

  for (const [email, user] of users) {
    if (onlineUserIds.has(user.id)) {
      onlineUserList.push({ id: user.id, name: user.name, email: user.email });
    }
  }

  res.json(onlineUserList);
});

// Get chat history
app.get('/api/messages', authenticateToken, (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const recentMessages = messages.slice(-limit);
  res.json(recentMessages);
});

// Socket.IO for real-time chat
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    return next(new Error('Authentication required'));
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return next(new Error('Invalid token'));
    }
    socket.user = user;
    next();
  });
}).on('connection', (socket) => {
  console.log('User connected:', socket.user?.name);

  // Add to online users
  if (socket.user) {
    onlineUsers.set(socket.id, socket.user.id);
    
    // Broadcast online status
    io.emit('user-online', {
      userId: socket.user.id,
      name: socket.user.name
    });

    // Send online users count
    io.emit('online-count', onlineUsers.size);
  }

  // Handle joining chat
  socket.on('join-chat', () => {
    socket.join('general');
    
    // Send welcome message
    socket.emit('welcome', {
      message: `Welcome to the chat, ${socket.user?.name}!`,
      timestamp: new Date()
    });

    // Broadcast user joined
    socket.to('general').emit('user-joined', {
      userId: socket.user?.id,
      name: socket.user?.name,
      message: `${socket.user?.name} joined the chat`
    });

    // Send recent messages
    const recentMessages = messages.slice(-20);
    socket.emit('chat-history', recentMessages);
  });

  // Handle new message
  socket.on('send-message', (data) => {
    const messageData = {
      id: Date.now().toString(),
      userId: socket.user.id,
      userName: socket.user.name,
      message: data.message,
      timestamp: new Date().toISOString(),
      room: 'general'
    };

    // Save message
    messages.push(messageData);
    
    // Limit messages array size
    if (messages.length > 1000) {
      messages.shift();
    }

    // Broadcast to all users
    io.to('general').emit('new-message', messageData);
  });

  // Handle typing indicator
  socket.on('typing', (isTyping) => {
    socket.to('general').emit('user-typing', {
      userId: socket.user?.id,
      name: socket.user?.name,
      isTyping
    });
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.user?.name);
    
    // Remove from online users
    onlineUsers.delete(socket.id);
    
    // Broadcast offline status
    io.emit('user-offline', {
      userId: socket.user?.id,
      name: socket.user?.name
    });

    // Update online count
    io.emit('online-count', onlineUsers.size);
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📱 Chat app ready at http://localhost:${PORT}`);
});