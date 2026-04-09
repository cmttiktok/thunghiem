const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector');
const axios = require('axios');
const mongoose = require('mongoose');
const Groq = require('groq-sdk');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(express.static('public'));

// --- KẾT NỐI DATABASE ---
const MONGODB_URI = "mongodb+srv://baoboi97:baoboi97@cluster0.skkajlz.mongodb.net/tiktok_tts?retryWrites=true&w=majority&appName=Cluster0";
mongoose.connect(MONGODB_URI)
    .then(() => console.log("✅ MongoDB đã sẵn sàng"))
    .catch(err => console.error("❌ Lỗi DB:", err));

const Config = mongoose.model('Config', { key: String, value: String });
const BannedWord = mongoose.model('BannedWord', { word: String });

// --- CẤU HÌNH XOAY VÒNG 5 API KEY ---
const API_KEYS = [
    process.env.GROQ_KEY_1,
    process.env.GROQ_KEY_2,
    process.env.GROQ_KEY_3,
    process.env.GROQ_KEY_4,
    process.env.GROQ_KEY_5
].filter(k => k); // Chỉ lấy những key đã điền giá trị

let currentKeyIndex = 0;

// Hàm lấy Audio từ Google Translate (Base64)
async function getGoogleAudio(text) {
    try {
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text.substring(0, 200))}&tl=vi&client=tw-ob`;
        const res = await axios.get(url, { responseType: 'arraybuffer' });
        return `data:audio/mp3;base64,${Buffer.from(res.data, 'binary').toString('base64')}`;
    } catch (e) {
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
        }).catch(err => {
            socket.emit('status', `❌ Lỗi: ${err.message}`);
        });

        tiktok.on('chat', async (data) => {
            try {
                // 1. Kiểm tra từ cấm
                const banned = await BannedWord.find();
                if (banned.some(b => data.comment.toLowerCase().includes(b.word))) return;

                // 2. Lấy Prompt xưng hô
                const promptDoc = await Config.findOne({ key: 'prompt' });
                const sysPrompt = promptDoc ? promptDoc.value : "Bạn là Mina, trợ lý ảo.";

                // 3. Hàm gọi Groq có cơ chế tự đổi Key khi lỗi 429
                const callGroqAI = async (retryCount = 0) => {
                    try {
                        const groq = new Groq({ apiKey: API_KEYS[currentKeyIndex] });
                        const completion = await groq.chat.completions.create({
                            messages: [
                                { role: "system", content: sysPrompt },
                                { role: "user", content: `Người dùng tên "${data.nickname}" nói: ${data.comment}. Hãy trả lời họ.` }
                            ],
                            model: "llama-3.1-8b-instant",
                            temperature: 0.7
                        });
                        return completion.choices[0]?.message?.content;
                    } catch (err) {
                        // Nếu hết hạn mức (429) và vẫn còn key dự phòng
                        if (err.status === 429 && retryCount < API_KEYS.length - 1) {
                            console.log(`⚠️ Key số ${currentKeyIndex + 1} hết lượt. Đang chuyển sang Key số ${currentKeyIndex + 2}...`);
                            currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
                            return callGroqAI(retryCount + 1);
                        }
                        throw err;
                    }
                };

                const reply = await callGroqAI();

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
                console.error("❌ Lỗi xử lý AI:", err.message);
            }
        });
    });

    socket.on('disconnect', () => { if (tiktok) tiktok.disconnect(); });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`🚀 Mina đang chạy với 5 Key tại Port ${PORT}`));
