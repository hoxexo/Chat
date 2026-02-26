// Global variables
let socket;
let currentUser = null;
let typingTimeout;

// Check authentication on page load
document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('token');
    const userData = localStorage.getItem('user');
    
    if (token && userData) {
        currentUser = JSON.parse(userData);
        
        // If on auth pages, redirect to chat
        if (window.location.pathname.includes('login') || 
            window.location.pathname.includes('register')) {
            window.location.href = '/';
        } else {
            initializeChat();
        }
    } else {
        // If not on auth pages, redirect to login
        if (!window.location.pathname.includes('login') && 
            !window.location.pathname.includes('register')) {
            window.location.href = '/login';
        }
    }
});

// Handle login
async function handleLogin(event) {
    event.preventDefault();
    
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const errorElement = document.getElementById('errorMessage');
    const loginBtn = document.getElementById('loginBtn');
    
    try {
        loginBtn.disabled = true;
        loginBtn.textContent = 'Logging in...';
        errorElement.style.display = 'none';
        
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, password })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Login failed');
        }
        
        // Save auth data
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        currentUser = data.user;
        
        // Redirect to chat
        window.location.href = '/';
    } catch (error) {
        errorElement.textContent = error.message;
        errorElement.style.display = 'block';
    } finally {
        loginBtn.disabled = false;
        loginBtn.textContent = 'Login';
    }
}

// Handle register
async function handleRegister(event) {
    event.preventDefault();
    
    const name = document.getElementById('name').value;
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const errorElement = document.getElementById('errorMessage');
    const registerBtn = document.getElementById('registerBtn');
    
    // Validate passwords match
    if (password !== confirmPassword) {
        errorElement.textContent = 'Passwords do not match';
        errorElement.style.display = 'block';
        return;
    }
    
    try {
        registerBtn.disabled = true;
        registerBtn.textContent = 'Registering...';
        errorElement.style.display = 'none';
        
        const response = await fetch('/api/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name, email, password })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Registration failed');
        }
        
        // Save auth data
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        currentUser = data.user;
        
        // Redirect to chat
        window.location.href = '/';
    } catch (error) {
        errorElement.textContent = error.message;
        errorElement.style.display = 'block';
    } finally {
        registerBtn.disabled = false;
        registerBtn.textContent = 'Register';
    }
}

// Initialize chat
function initializeChat() {
    document.getElementById('chatContainer').style.display = 'flex';
    document.getElementById('userNameDisplay').textContent = currentUser.name;
    
    // Connect to socket
    const token = localStorage.getItem('token');
    socket = io({
        auth: { token }
    });
    
    // Socket event handlers
    socket.on('connect', () => {
        console.log('Connected to chat');
        socket.emit('join-chat');
        fetchOnlineUsers();
    });
    
    socket.on('connect_error', (error) => {
        console.error('Socket connection error:', error);
        if (error.message === 'Authentication required' || error.message === 'Invalid token') {
            logout();
        }
    });
    
    socket.on('welcome', (data) => {
        addSystemMessage(data.message);
    });
    
    socket.on('user-joined', (data) => {
        addSystemMessage(data.message);
    });
    
    socket.on('chat-history', (messages) => {
        messages.forEach(msg => displayMessage(msg));
    });
    
    socket.on('new-message', (data) => {
        displayMessage(data);
    });
    
    socket.on('user-online', (data) => {
        addOnlineUser(data);
        addSystemMessage(`${data.name} is online`);
    });
    
    socket.on('user-offline', (data) => {
        removeOnlineUser(data.userId);
        addSystemMessage(`${data.name} went offline`);
    });
    
    socket.on('online-count', (count) => {
        document.getElementById('onlineCount').textContent = `${count} online`;
    });
    
    socket.on('user-typing', (data) => {
        const indicator = document.getElementById('typingIndicator');
        if (data.isTyping) {
            indicator.textContent = `${data.name} is typing...`;
        } else {
            indicator.textContent = '';
        }
    });
    
    socket.on('disconnect', () => {
        addSystemMessage('Disconnected from server');
    });
    
    // Message input handlers
    const messageInput = document.getElementById('messageInput');
    messageInput.addEventListener('input', handleTyping);
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
}

// Handle typing indicator
function handleTyping() {
    socket.emit('typing', true);
    
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        socket.emit('typing', false);
    }, 1000);
}

// Send message
function sendMessage() {
    const input = document.getElementById('messageInput');
    const message = input.value.trim();
    
    if (message) {
        socket.emit('send-message', { message });
        input.value = '';
        
        // Clear typing indicator
        clearTimeout(typingTimeout);
        socket.emit('typing', false);
    }
}

// Display message
function displayMessage(messageData) {
    const messagesContainer = document.getElementById('messages');
    const messageElement = document.createElement('div');
    messageElement.className = `message ${messageData.userId === currentUser.id ? 'own-message' : ''}`;
    
    const time = new Date(messageData.timestamp).toLocaleTimeString([], { 
        hour: '2-digit', 
        minute: '2-digit' 
    });
    
    messageElement.innerHTML = `
        <div class="message-content">
            <div class="message-header">
                <span class="message-sender">${messageData.userName}</span>
                <span class="message-time">${time}</span>
            </div>
            <div class="message-text">${escapeHtml(messageData.message)}</div>
        </div>
    `;
    
    messagesContainer.appendChild(messageElement);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Add system message
function addSystemMessage(text) {
    const messagesContainer = document.getElementById('messages');
    const messageElement = document.createElement('div');
    messageElement.className = 'system-message';
    messageElement.textContent = text;
    messagesContainer.appendChild(messageElement);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Fetch online users
async function fetchOnlineUsers() {
    try {
        const token = localStorage.getItem('token');
        const response = await fetch('/api/online-users', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (response.ok) {
            const users = await response.json();
            users.forEach(user => addOnlineUser(user));
        }
    } catch (error) {
        console.error('Failed to fetch online users:', error);
    }
}

// Add online user to sidebar
function addOnlineUser(user) {
    const container = document.getElementById('onlineUsers');
    
    // Check if user already exists
    if (document.getElementById(`user-${user.userId}`)) {
        return;
    }
    
    const userElement = document.createElement('div');
    userElement.id = `user-${user.userId}`;
    userElement.className = 'online-user';
    userElement.innerHTML = `
        <span class="status-dot"></span>
        <span class="user-name">${user.name}</span>
    `;
    
    container.appendChild(userElement);
}

// Remove online user from sidebar
function removeOnlineUser(userId) {
    const userElement = document.getElementById(`user-${userId}`);
    if (userElement) {
        userElement.remove();
    }
}

// Logout
function logout() {
    if (socket) {
        socket.disconnect();
    }
    
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login';
}

// Escape HTML to prevent XSS
function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}