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
mongoose.connect(MONGODB_URI).then(() => console.log("✅ Database Connected"));

const Config = mongoose.model('Config', { key: String, value: String });
const BannedWord = mongoose.model('BannedWord', { word: String });

// --- CẤU HÌNH ĐA API KEY GROQ ---
const API_KEYS = [
    process.env.GROQ_KEY_1,
    process.env.GROQ_KEY_2,
    process.env.GROQ_API_KEY // Key cũ của bạn (nếu còn)
].filter(k => k); // Lọc bỏ các key trống

let currentKeyIndex = 0;

// Hàm khởi tạo client Groq theo key hiện tại
function getGroqClient() {
    return new Groq({ apiKey: API_KEYS[currentKeyIndex] });
}

// --- HÀM TẢI AUDIO GOOGLE (BASE64) ---
async function getGoogleAudio(text) {
    try {
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text.substring(0, 200))}&tl=vi&client=tw-ob`;
        const res = await axios.get(url, { responseType: 'arraybuffer' });
        return `data:audio/mp3;base64,${Buffer.from(res.data, 'binary').toString('base64')}`;
    } catch (e) { return null; }
}

// --- XỬ LÝ CHAT ---
io.on('connection', (socket) => {
    let tiktok;

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
                const sysPrompt = promptDoc ? promptDoc.value : "Bạn là Mina, trợ lý ảo.";

                // Gửi tin nhắn cho Groq
                const callGroq = async (retryCount = 0) => {
                    try {
                        const groq = getGroqClient();
                        const completion = await groq.chat.completions.create({
                            messages: [
                                { role: "system", content: sysPrompt },
                                { role: "user", content: `Người dùng tên "${data.nickname}" nói: ${data.comment}. Hãy phản hồi họ.` }
                            ],
                            model: "llama-3.1-8b-instant", // Dùng bản 8b để ít bị giới hạn hơn 70b
                        });
                        return completion.choices[0]?.message?.content;
                    } catch (err) {
                        // Nếu gặp lỗi Rate Limit (429) và còn key dự phòng
                        if (err.status === 429 && retryCount < API_KEYS.length - 1) {
                            console.log(`⚠️ Key ${currentKeyIndex + 1} hết hạn mức, đang đổi key...`);
                            currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
                            return callGroq(retryCount + 1); // Thử lại với key mới
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
                        audio: audio 
                    });
                }
            } catch (err) {
                console.error("❌ Lỗi xử lý Chat:", err.message);
            }
        });
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`🚀 Mina quay lại với Groq Đa-Key tại Port ${PORT}`));
