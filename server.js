const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Database (temporary - in memory)
const users = [];
const messages = [];
const onlineUsers = new Map();

// JWT Secret
const JWT_SECRET = 'your-secret-key-123';

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

// Register API
app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        
        // Check if user exists
        const userExists = users.find(u => u.email === email);
        if (userExists) {
            return res.status(400).json({ error: 'User already exists' });
        }
        
        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Create user
        const user = {
            id: Date.now().toString(),
            username,
            email,
            password: hashedPassword
        };
        
        users.push(user);
        
        // Create token
        const token = jwt.sign(
            { id: user.id, username: user.username, email: user.email },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        res.json({ 
            success: true, 
            token,
            user: { id: user.id, username: user.username, email: user.email }
        });
        
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Login API
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        // Find user
        const user = users.find(u => u.email === email);
        if (!user) {
            return res.status(400).json({ error: 'User not found' });
        }
        
        // Check password
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(400).json({ error: 'Invalid password' });
        }
        
        // Create token
        const token = jwt.sign(
            { id: user.id, username: user.username, email: user.email },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        res.json({ 
            success: true, 
            token,
            user: { id: user.id, username: user.username, email: user.email }
        });
        
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Socket.io
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
        return next(new Error('Authentication error'));
    }
    
    try {
        const user = jwt.verify(token, JWT_SECRET);
        socket.user = user;
        next();
    } catch (err) {
        next(new Error('Authentication error'));
    }
}).on('connection', (socket) => {
    console.log('User connected:', socket.user?.username);
    
    // Add to online users
    onlineUsers.set(socket.id, socket.user);
    
    // Send online users to all
    io.emit('online-users', Array.from(onlineUsers.values()));
    
    // Send previous messages
    socket.emit('previous-messages', messages.slice(-50));
    
    // Handle new message
    socket.on('send-message', (message) => {
        const messageData = {
            id: Date.now().toString(),
            userId: socket.user.id,
            username: socket.user.username,
            message: message,
            timestamp: new Date().toISOString()
        };
        
        messages.push(messageData);
        io.emit('new-message', messageData);
    });
    
    // Handle typing
    socket.on('typing', (isTyping) => {
        socket.broadcast.emit('user-typing', {
            userId: socket.user.id,
            username: socket.user.username,
            isTyping
        });
    });
    
    // Handle disconnect
    socket.on('disconnect', () => {
        onlineUsers.delete(socket.id);
        io.emit('online-users', Array.from(onlineUsers.values()));
        console.log('User disconnected:', socket.user?.username);
    });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
