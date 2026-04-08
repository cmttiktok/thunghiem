const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector');
const axios = require('axios');
const mongoose = require('mongoose');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(express.static('public'));

// --- KẾT NỐI DATABASE ---
const MONGODB_URI = "mongodb+srv://baoboi97:baoboi97@cluster0.skkajlz.mongodb.net/tiktok_tts?retryWrites=true&w=majority&appName=Cluster0";
mongoose.connect(MONGODB_URI).then(() => console.log("✅ MongoDB Sẵn Sàng"));

const Config = mongoose.model('Config', { key: String, value: String });
const BannedWord = mongoose.model('BannedWord', { word: String });

// --- CẤU HÌNH GEMINI AI (Sửa lỗi 404) ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const aiModel = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash",
    apiVersion: "v1beta" // Đảm bảo dùng đúng phiên bản API để không bị 404
});

// --- HÀM TẠO ÂM THANH (Dạng Base64 để tránh lỗi CORS) ---
async function getGoogleAudio(text) {
    try {
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text.substring(0, 200))}&tl=vi&client=tw-ob`;
        const res = await axios.get(url, { responseType: 'arraybuffer' });
        return `data:audio/mp3;base64,${Buffer.from(res.data, 'binary').toString('base64')}`;
    } catch (e) { return null; }
}

// --- XỬ LÝ TIKTOK ---
io.on('connection', (socket) => {
    let tiktok;

    socket.on('set-username', (username) => {
        if (tiktok) tiktok.disconnect();
        tiktok = new WebcastPushConnection(username, { processInitialData: false });
        
        tiktok.connect().then(() => socket.emit('status', `✅ Đã kết nối: ${username}`))
              .catch(err => socket.emit('status', `❌ Lỗi: ${err.message}`));

        tiktok.on('chat', async (data) => {
            try {
                // 1. Lọc từ cấm
                const banned = await BannedWord.find();
                if (banned.some(b => data.comment.toLowerCase().includes(b.word))) return;

                // 2. Lấy thiết lập Mina
                const promptDoc = await Config.findOne({ key: 'prompt' });
                const sysPrompt = promptDoc ? promptDoc.value : "Bạn là trợ lý Mina.";

                // 3. Gửi lệnh cho Gemini (Bắt AI chào tên người dùng)
                const userMsg = `Người dùng tên "${data.nickname}" nói: ${data.comment}. Hãy phản hồi ngắn gọn dưới 20 từ.`;
                
                const result = await aiModel.generateContent([sysPrompt, userMsg]);
                const reply = result.response.text().trim();

                if (reply) {
                    const audio = await getGoogleAudio(reply);
                    socket.emit('audio-data', { 
                        user: data.nickname, 
                        comment: data.comment, 
                        reply: reply, 
                        audio: audio 
                    });
                }
            } catch (err) { console.error("❌ Lỗi Gemini:", err.message); }
        });
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`🚀 Server chạy tại port ${PORT}`));
