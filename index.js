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
mongoose.connect(MONGODB_URI).then(() => console.log("✅ MongoDB Connected"));

const Config = mongoose.model('Config', { key: String, value: String });
const BannedWord = mongoose.model('BannedWord', { word: String });

// --- CẤU HÌNH 5 API KEY GROQ ---
const API_KEYS = [
    process.env.GROQ_KEY_1,
    process.env.GROQ_KEY_2,
    process.env.GROQ_KEY_3,
    process.env.GROQ_KEY_4,
    process.env.GROQ_KEY_5
].filter(k => k);

let currentKeyIndex = 0;

// --- HÀM TẢI AUDIO GOOGLE (CÓ TÙY CHỈNH TỐC ĐỘ) ---
async function getGoogleAudio(text, speed = 1) {
    try {
        // Chị Google hỗ trợ tham số ttsspeed (từ 0 đến 1, 1 là bình thường, nhỏ hơn là chậm)
        // Tuy nhiên cách tốt nhất để chỉnh tốc độ trên trình duyệt là dùng thuộc tính .playbackRate
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text.substring(0, 200))}&tl=vi&client=tw-ob`;
        const res = await axios.get(url, { responseType: 'arraybuffer' });
        return `data:audio/mp3;base64,${Buffer.from(res.data, 'binary').toString('base64')}`;
    } catch (e) { return null; }
}

// --- XỬ LÝ KẾT NỐI ---
io.on('connection', (socket) => {
    let tiktok;
    let voiceSpeed = 1; // Mặc định tốc độ 1.0

    // Nhận tốc độ từ thanh trượt giao diện
    socket.on('change-speed', (speed) => {
        voiceSpeed = speed;
        console.log(`🚀 Đã đổi tốc độ giọng nói: ${speed}`);
    });

    socket.on('set-username', (username) => {
        if (tiktok) tiktok.disconnect();
        tiktok = new WebcastPushConnection(username, { processInitialData: false });
        
        tiktok.connect().then(() => socket.emit('status', `✅ Đã kết nối: ${username}`))
              .catch(err => socket.emit('status', `❌ Lỗi: ${err.message}`));

        tiktok.on('chat', async (data) => {
            try {
                const banned = await BannedWord.find();
                if (banned.some(b => data.comment.toLowerCase().includes(b.word))) return;

                const promptDoc = await Config.findOne({ key: 'prompt' });
                const sysPrompt = promptDoc ? promptDoc.value : "Bạn là Mina. Trả lời cực ngắn dưới 10 từ.";

                const callGroq = async (retryCount = 0) => {
                    try {
                        const groq = new Groq({ apiKey: API_KEYS[currentKeyIndex] });
                        const completion = await groq.chat.completions.create({
                            messages: [
                                { role: "system", content: sysPrompt + " QUY TẮC: Trả lời ngắn hơn 10 từ, không chào hỏi dài dòng." },
                                { role: "user", content: `Người dùng ${data.nickname} nói: ${data.comment}. Trả lời nhanh:` }
                            ],
                            model: "llama-3.1-8b-instant",
                            max_tokens: 40, // Ép AI không được viết dài
                            temperature: 0.8
                        });
                        return completion.choices[0]?.message?.content;
                    } catch (err) {
                        if (err.status === 429 && retryCount < API_KEYS.length - 1) {
                            currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
                            return callGroq(retryCount + 1);
                        }
                        throw err;
                    }
                };

                const reply = await callGroq();
                if (reply) {
                    const audio = await getGoogleAudio(reply);
                    socket.emit('audio-data', { 
                        user: data.nickname, 
                        comment: data.comment, 
                        reply: reply, 
                        audio: audio,
                        speed: voiceSpeed // Gửi kèm tốc độ về để trình duyệt phát
                    });
                }
            } catch (err) { console.error("Lỗi:", err.message); }
        });
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`🚀 Mina Ready on Port ${PORT}`));
