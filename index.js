const express = require('express');
const { WebcastPushConnection } = require('tiktok-live-connector');
const Groq = require('groq-sdk');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server);

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
let tiktokConn = null;

// Hàm kết nối TikTok
function connectTikTok(username) {
    if (tiktokConn) {
        tiktokConn.disconnect(); // Ngắt kết nối cũ nếu có
    }

    tiktokConn = new WebcastPushConnection(username);

    tiktokConn.connect().then(state => {
        io.emit('status', `Đã kết nối với: ${username}`);
        console.log(`Connected to ${username}`);
    }).catch(err => {
        io.emit('status', `Lỗi: ${err.message}`);
    });

    // Lắng nghe bình luận
    tiktokConn.on('chat', async (data) => {
        try {
            const completion = await groq.chat.completions.create({
                messages: [
                    { role: "system", content: "Bạn là trợ lý ảo Chị Google. Trả lời cực ngắn, hài hước, xưng chị gọi em." },
                    { role: "user", content: `Bình luận từ ${data.uniqueId}: ${data.comment}` }
                ],
                model: "llama-3.3-70b-versatile",
            });
            const reply = completion.choices[0]?.message?.content;
            if (reply) io.emit('speak', { user: data.uniqueId, text: reply });
        } catch (e) {
            console.log("Lỗi AI");
        }
    });
}

// Nhận yêu cầu đổi ID từ giao diện
io.on('connection', (socket) => {
    socket.on('set-id', (username) => {
        connectTikTok(username);
    });
});

app.use(express.static('public'));
server.listen(process.env.PORT || 3000);
