const express = require('express');
const { WebcastPushConnection } = require('tiktok-live-connector');
const Groq = require('groq-sdk');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server);

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
let tiktokConn = null;

function connectTikTok(username) {
    if (tiktokConn) { tiktokConn.disconnect(); }

    // Thêm các tùy chọn để tránh bị TikTok chặn
    tiktokConn = new WebcastPushConnection(username, {
        processDelayMS: 100,
        enableExtendedGiftInfo: true
    });

    tiktokConn.connect().then(state => {
        io.emit('status', `✅ Đã kết nối: ${username}`);
    }).catch(err => {
        // Nếu lỗi Websocket, hệ thống sẽ báo lại cho UI
        io.emit('status', `❌ Lỗi kết nối: ${err.message}`);
        console.error(err);
    });

    tiktokConn.on('chat', async (data) => {
        try {
            const completion = await groq.chat.completions.create({
                messages: [
                    { role: "system", content: "Bạn là chị Google hài hước. Trả lời dưới 10 chữ." },
                    { role: "user", content: data.comment }
                ],
                model: "llama-3.3-70b-versatile",
            });
            const reply = completion.choices[0]?.message?.content;
            if (reply) io.emit('speak', { user: data.uniqueId, text: reply });
        } catch (e) { console.log("Lỗi AI"); }
    });
}

io.on('connection', (socket) => {
    socket.on('set-id', (id) => connectTikTok(id));
});

app.use(express.static('public'));
server.listen(process.env.PORT || 3000);
