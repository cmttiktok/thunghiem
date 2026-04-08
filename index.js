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

// --- KẾT NỐI MONGODB ---
const MONGODB_URI = "mongodb+srv://baoboi97:baoboi97@cluster0.skkajlz.mongodb.net/tiktok_tts?retryWrites=true&w=majority&appName=Cluster0";
mongoose.connect(MONGODB_URI)
    .then(() => console.log("✅ MongoDB đã sẵn sàng!"))
    .catch(err => console.error("❌ Lỗi Database:", err));

const Config = mongoose.model('Config', { key: String, value: String });
const BannedWord = mongoose.model('BannedWord', { word: String });

// --- CẤU HÌNH GEMINI AI ---
// Đảm bảo bạn đã thêm GEMINI_API_KEY vào Environment Variables trên Render
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const aiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// --- HÀM TẠO ÂM THANH GOOGLE ---
async function getGoogleAudio(text) {
    try {
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text.substring(0, 200))}&tl=vi&client=tw-ob`;
        const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 5000 });
        return `data:audio/mp3;base64,${Buffer.from(res.data, 'binary').toString('base64')}`;
    } catch (e) {
        console.error("❌ Lỗi lấy âm thanh:", e.message);
        return null;
    }
}

// --- XỬ LÝ KẾT NỐI TIKTOK ---
io.on('connection', (socket) => {
    let tiktok;

    socket.on('set-username', (username) => {
        if (tiktok) tiktok.disconnect();
        tiktok = new WebcastPushConnection(username, { processInitialData: false });
        
        tiktok.connect().then(() => {
            socket.emit('status', `✅ Đã kết nối Live: ${username}`);
            console.log(`✅ Kết nối thành công tới: ${username}`);
        }).catch(err => {
            socket.emit('status', `❌ Lỗi kết nối: ${err.message}`);
        });

        tiktok.on('chat', async (data) => {
            try {
                // 1. Kiểm tra từ cấm (Chạy thầm lặng)
                const banned = await BannedWord.find();
                if (banned.some(b => data.comment.toLowerCase().includes(b.word))) return;

                // 2. Lấy Prompt từ DB
                const promptDoc = await Config.findOne({ key: 'prompt' });
                const sysPrompt = promptDoc ? promptDoc.value : "Bạn là Mina, trợ lý của Chi Bánh Bèo.";

                // 3. Gọi Gemini AI
                const userMessage = `Người dùng tên "${data.nickname}" nói: ${data.comment}. Hãy phản hồi họ cực ngắn gọn dưới 20 từ.`;
                
                // Gộp Prompt hệ thống và câu hỏi để AI hiểu ngữ cảnh
                const result = await aiModel.generateContent(sysPrompt + "\n\n" + userMessage);
                const response = await result.response;
                const reply = response.text().trim();

                if (reply) {
                    const audio = await getGoogleAudio(reply);
                    socket.emit('audio-data', { 
                        user: data.nickname, 
                        comment: data.comment, 
                        reply: reply, 
                        audio: audio 
                    });
                }
            } catch (err) {
                console.error("❌ Lỗi Gemini:", err.message);
                // Nếu lỗi 404, hãy kiểm tra lại GEMINI_API_KEY trên Render
            }
        });
    });

    socket.on('disconnect', () => {
        if (tiktok) tiktok.disconnect();
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`🚀 Mina đang trực tại Port ${PORT}`));
