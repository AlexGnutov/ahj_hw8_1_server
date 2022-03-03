const http = require('http');
const Koa = require('koa');
const koaBody = require('koa-body');
const WS = require('ws');

const app = new Koa();

app.use(koaBody({
    urlencoded: true,
}));

app.use(async (ctx, next) => {
    const origin = ctx.request.get('Origin');
    // If origin not set - follow to next route
    if (!origin) {
        return await next();
    }
    const headers = { 'Access-Control-Allow-Origin': '*', };

    // If it is main request - set the header above
    if (ctx.request.method !== 'OPTIONS') {
        ctx.response.set({ ...headers });
        try {
            return await next();
        } catch (e) {
            e.headers = { ...e.headers, ...headers };
            throw e;
        }
    }
    // If special method requested (and special headers) - set them
    if (ctx.request.get('Access-Control-Request-Method')) {
        ctx.response.set({
            ...headers,
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH',
        });

        if (ctx.request.get('Access-Control-Request-Headers')) {
            ctx.response.set('Access-Control-Allow-Headers', ctx.request.get('Access-Control-Request-Headers'));
        }

        ctx.response.status = 204;
    }
});

const port = process.env.PORT || 8080;
const server = http.createServer(app.callback());
const wss = new WS.WebSocketServer({server});

const chatUsers = [];
const chatMessages = [];

// Web socket routes
wss.on('connection', (ws, req) => {
    let currentUser = '';
    ws.on('message', (bytes, isBinary) => {
        const message = isBinary ? bytes : bytes.toString();
        const data = JSON.parse(message);

        if (data.header === 'user-login') {
            // Check, if username is not busy
            if (!chatUsers.includes(data.username)) {
                currentUser = data.username;
                chatUsers.push(currentUser); // add username to chatUsers list
                const updateData = {
                    header: 'update-data',
                    username: currentUser,
                    users: chatUsers,
                    messages: chatMessages,
                };
                // Send new user chat users and messages
                ws.send(JSON.stringify(updateData));
                // Send to all users joined username
                wss.clients.forEach(function each(client) {
                    if (client !== ws && client.readyState === ws.OPEN) {
                        const data = {
                            header: 'user-joined',
                            username: currentUser,
                        };
                        client.send(JSON.stringify(data));
                    }
                });
            } else {
                // Send user-busy reply, when username is already occupied
                const reply = {
                    header: 'username-busy',
                }
                ws.send(JSON.stringify(reply));
            }
        }
        if (data.header === 'user-message') {
            // Assemble new message
            const newMessage = {
                header: 'new-message',
                username: data.username,
                text: data.text,
                date: new Date().toLocaleDateString(),
            }
            // Save message in server storage
            chatMessages.push(newMessage);
            // Broadcast the message to all users (including self)
            wss.clients.forEach(function each(client) {
                if (client.readyState === ws.OPEN) {
                    client.send(JSON.stringify(newMessage), { binary: isBinary });
                }
            });
        }
    });
    // Send to others that user has disconnected
    ws.on('close', () => {
        // remove user from used names list
        const index = chatUsers.indexOf(currentUser);
        if (index >= 0) {
            chatUsers.splice(index, 1);
        }
        // send message to other users
        wss.clients.forEach(function each(client) {
            if (client !== ws && client.readyState === ws.OPEN) {
                const data = {
                    header: 'user-left',
                    username: currentUser,
                };
                client.send(JSON.stringify(data));
            }
        });
    })
});

server.listen(port);
