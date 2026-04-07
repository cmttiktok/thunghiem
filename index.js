const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector');
const axios = require('axios'); // Quan trọng để lấy audio
const Groq = require('groq-sdk');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Cấu hình AI Groq (Nhớ thêm Key vào biến môi trường trên Render)
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
let tiktokConn = null;

// Hàm Server đi lấy Audio từ Google và chuyển sang Base64
async function getGoogleAudio(text) {
    try {
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text.substring(0, 200))}&tl=vi&client=tw-ob`;
        const res = await axios.get(url, { responseType: 'arraybuffer' });
        return `data:audio/mp3;base64,${Buffer.from(res.data, 'binary').toString('base64')}`;
    } catch (e) { 
        console.error("Lỗi lấy Audio tại Server:", e.message);
        return null; 
    }
}

io.on('connection', (socket) => {
    socket.on('set-username', (username) => {
        if (tiktokConn) tiktokConn.disconnect();
        
        tiktokConn = new WebcastPushConnection(username, { processInitialData: false });
        
        tiktokConn.connect().then(() => {
            socket.emit('status', `✅ Đã kết nối: ${username}`);
        }).catch(err => {
            socket.emit('status', `❌ Lỗi kết nối: ${err.message}`);
        });

        tiktokConn.on('chat', async (data) => {
            try {
                // 1. Gọi AI Groq trả lời
                const completion = await groq.chat.completions.create({
                    messages: [
                        { role: "system", content: "Bạn là chị Google hài hước. Trả lời dưới 12 từ." },
                        { role: "user", content: data.comment }
                    ],
                    model: "llama-3.3-70b-versatile",
                });
                
                const reply = completion.choices[0]?.message?.content;
                
                if (reply) {
                    // 2. Server tự lấy audio cho câu trả lời này
                    const audioBase64 = await getGoogleAudio(reply);
                    
                    // 3. Gửi cả chữ và âm thanh về trình duyệt
                    socket.emit('audio-data', { 
                        user: data.nickname, 
                        comment: data.comment, 
                        reply: reply,
                        audio: audioBase64 
                    });
                }
            } catch (e) {
                console.error("Lỗi AI hoặc lấy Audio");
            }
        });
    });
});

app.use(express.static('public'));
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server chạy tại port ${PORT}`));
