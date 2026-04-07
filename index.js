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
    .then(() => console.log("✅ MongoDB đã thông suốt!"))
    .catch(err => console.error("❌ Lỗi Database:", err));

const Config = mongoose.model('Config', { key: String, value: String });
const BannedWord = mongoose.model('BannedWord', { word: String });

// --- AI GROQ ---
// Đảm bảo bạn đã thêm GROQ_API_KEY vào Environment Variables trên Render
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY || 'NHẬP_KEY_CỦA_BẠN_NẾU_CHẠY_LOCAL' });
let tiktokConn = null;

// --- API HỆ THỐNG ---
app.get('/api/config', async (req, res) => {
    try {
        const data = await Config.findOne({ key: 'prompt' });
        res.json(data || { value: "Bạn là chị Google hài hước. Trả lời dưới 10 từ." });
    } catch (e) { res.status(500).send(e.message); }
});

app.post('/api/config', async (req, res) => {
    try {
        await Config.findOneAndUpdate({ key: 'prompt' }, { value: req.body.value }, { upsert: true });
        res.sendStatus(200);
    } catch (e) { res.status(500).send(e.message); }
});

app.get('/api/words', async (req, res) => {
    try {
        const words = await BannedWord.find();
        res.json(words);
    } catch (e) { res.status(500).send(e.message); }
});

app.post('/api/words', async (req, res) => {
    try {
        if (req.body.word) await BannedWord.create({ word: req.body.word.toLowerCase().trim() });
        res.sendStatus(200);
    } catch (e) { res.status(500).send(e.message); }
});

app.delete('/api/words/:id', async (req, res) => {
    try {
        await BannedWord.findByIdAndDelete(req.params.id);
        res.sendStatus(200);
    } catch (e) { res.status(500).send(e.message); }
});

// --- LẤY AUDIO TỪ GOOGLE TẠI SERVER ---
async function getGoogleAudio(text) {
    try {
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text.substring(0, 200))}&tl=vi&client=tw-ob`;
        const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 5000 });
        return `data:audio/mp3;base64,${Buffer.from(res.data, 'binary').toString('base64')}`;
    } catch (e) {
        console.error("Lỗi Google TTS:", e.message);
        return null;
    }
}

// --- SOCKET.IO & TIKTOK ---
io.on('connection', (socket) => {
    socket.on('set-username', (username) => {
        if (tiktokConn) tiktokConn.disconnect();

        tiktokConn = new WebcastPushConnection(username, { processInitialData: false });

        tiktokConn.connect().then(() => {
            socket.emit('status', `✅ Đã kết nối: ${username}`);
        }).catch(err => {
            socket.emit('status', `❌ Lỗi: ${err.message}`);
        });

        tiktokConn.on('chat', async (data) => {
            try {
                // 1. Check từ cấm
                const banned = await BannedWord.find();
                if (banned.some(b => data.comment.toLowerCase().includes(b.word))) return;

                // 2. Lấy Prompt xưng hô
                const promptDoc = await Config.findOne({ key: 'prompt' });
                const sysPrompt = promptDoc ? promptDoc.value : "Bạn là chị Google. Trả lời dưới 10 từ.";

                // 3. Gọi AI Groq
                const completion = await groq.chat.completions.create({
                    messages: [
                        { role: "system", content: sysPrompt },
                        { role: "user", content: data.comment }
                    ],
                    model: "llama-3.3-70b-versatile",
                });

                const reply = completion.choices[0]?.message?.content;
                if (reply) {
                    const audio = await getGoogleAudio(reply);
                    socket.emit('audio-data', {
                        user: data.nickname,
                        comment: data.comment,
                        reply: reply,
                        audio: audio
                    });
                }
            } catch (err) { console.error("Lỗi xử lý chat:", err.message); }
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server đang chạy tại Port ${PORT}`));
