const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector');
const axios = require('axios');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());

// --- CẤU HÌNH AI (HUGGING FACE) ---
const HF_TOKEN = "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"; 
const AI_MODEL = "HuggingFaceH4/zephyr-7b-beta"; 

async function askAI(userName, question) {
    try {
        const response = await axios.post(
            `https://api-inference.huggingface.co/models/${AI_MODEL}`,
            { 
                inputs: `<|system|>\nBạn là trợ lý ảo của Chi Bèo. Trả lời cực ngắn dưới 15 từ.</s>\n<|user|>\n${userName} hỏi: ${question}</s>\n<|assistant|>\n`,
                parameters: { max_new_tokens: 30 }
            },
            { headers: { Authorization: `Bearer ${HF_TOKEN}` }, timeout: 5000 }
        );
        let text = Array.isArray(response.data) ? response.data[0].generated_text : response.data.generated_text;
        return text.split("<|assistant|>\n")[1]?.trim() || "Em nghe đây ạ!";
    } catch (e) {
        return `Chào ${userName}, em nghe đây!`;
    }
}

// --- KẾT NỐI MONGODB ---
const MONGODB_URI = "mongodb+srv://baoboi97:baoboi97@cluster0.skkajlz.mongodb.net/tiktok_tts?retryWrites=true&w=majority&appName=Cluster0";
mongoose.connect(MONGODB_URI).then(() => console.log("✅ MongoDB Connected"));

const BotAnswer = mongoose.model('BotAnswer', { keyword: String, response: String });

// --- XỬ LÝ ÂM THANH ---
async function getGoogleAudio(text) {
    try {
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text.substring(0, 200))}&tl=vi&client=tw-ob`;
        const res = await axios.get(url, { responseType: 'arraybuffer' });
        return `data:audio/mp3;base64,${Buffer.from(res.data).toString('base64')}`;
    } catch (e) { return null; }
}

// --- LOGIC TIKTOK (QUAN TRỌNG: ĐÃ SỬA ĐỂ HIỆN CMT) ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

let tiktok = null;

io.on('connection', (socket) => {
    socket.on('set-username', (username) => {
        if (tiktok) tiktok.disconnect();
        tiktok = new WebcastPushConnection(username);
        
        tiktok.connect()
            .then(() => socket.emit('status', `✅ Đã nối: ${username}`))
            .catch(err => socket.emit('status', `❌ Lỗi: ${err.message}`));

        // LUÔN LUÔN ĐẨY COMMENT LÊN GIAO DIỆN
        tiktok.on('chat', async (data) => {
            // 1. Gửi comment thô lên web ngay lập tức để màn hình nhảy chữ
            socket.emit('chat-message', data); 

            const commentLower = data.comment.toLowerCase();
            
            // 2. Kiểm tra kịch bản cứng
            const botRules = await BotAnswer.find();
            const match = botRules.find(r => commentLower.includes(r.keyword.toLowerCase()));

            if (match) {
                const audio = await getGoogleAudio(`Anh ${data.nickname} ơi, ${match.response}`);
                socket.emit('audio-data', { type: 'bot', user: "TRỢ LÝ", comment: match.response, audio });
            } 
            // 3. AI trả lời
            else if (commentLower.includes("bot ơi") || commentLower.includes("bèo ơi")) {
                const aiReply = await askAI(data.nickname, data.comment);
                const audio = await getGoogleAudio(aiReply);
                socket.emit('audio-data', { type: 'bot', user: "AI", comment: aiReply, audio });
            }
            // 4. Đọc chat bình thường (Nếu Tùng Anh bật tính năng đọc chat trên web)
            else {
                const audio = await getGoogleAudio(`${data.nickname} nói: ${data.comment}`);
                socket.emit('audio-data', { type: 'chat', user: data.nickname, comment: data.comment, audio });
            }
        });

        tiktok.on('member', async (data) => {
            const audio = await getGoogleAudio(`Chào ${data.nickname} vào xem live`);
            socket.emit('audio-data', { type: 'welcome', user: "Hệ thống", comment: `${data.nickname} vào`, audio });
        });

        tiktok.on('gift', async (data) => {
            if (data.repeatEnd) {
                const audio = await getGoogleAudio(`Cảm ơn ${data.nickname} đã tặng ${data.giftName}`);
                socket.emit('audio-data', { type: 'gift', user: "QUÀ", comment: `${data.nickname} tặng ${data.giftName}`, audio });
            }
        });
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`🚀 Bot hoạt động tại port ${PORT}`));
