const express = require('express');
const { WebcastPushConnection } = require('tiktok-live-connector');
const Groq = require('groq-sdk');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server);

// Lấy API Key từ Environment Variable trên Render
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
let tiktokConn = null;

// Hàm khởi tạo kết nối TikTok
function connectTikTok(username) {
    if (tiktokConn) {
        tiktokConn.disconnect();
    }

    tiktokConn = new WebcastPushConnection(username);

    tiktokConn.connect().then(state => {
        io.emit('status', `✅ Đã kết nối với: ${username}`);
        console.log(`Kết nối thành công: ${username}`);
    }).catch(err => {
        io.emit('status', `❌ Lỗi: ${err.message}`);
    });

    // Lắng nghe bình luận
    tiktokConn.on('chat', async (data) => {
        try {
            const completion = await groq.chat.completions.create({
                messages: [
                    { 
                        role: "system", 
                        content: "Bạn là Chị Google đang livestream. Hãy trả lời bình luận của người xem cực kỳ ngắn gọn (dưới 15 từ), hài hước, xưng chị gọi em." 
                    },
                    { role: "user", content: `Người dùng ${data.uniqueId} nói: ${data.comment}` }
                ],
                model: "llama-3.3-70b-versatile", // Model nhanh nhất của Groq
                temperature: 0.7,
            });

            const reply = completion.choices[0]?.message?.content;
            if (reply) {
                console.log(`AI đáp: ${reply}`);
                io.emit('speak', { user: data.uniqueId, text: reply });
            }
        } catch (e) {
            console.error("Lỗi xử lý AI:", e.message);
        }
    });
}

// Nhận lệnh từ giao diện web
io.on('connection', (socket) => {
    socket.on('set-id', (username) => {
        connectTikTok(username);
    });
});

app.use(express.static('public'));
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server chạy tại port ${PORT}`));
