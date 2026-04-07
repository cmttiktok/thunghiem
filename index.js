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

// Kết nối Database (Dùng lại link cũ của bạn)
const MONGODB_URI = "mongodb+srv://baoboi97:baoboi97@cluster0.skkajlz.mongodb.net/tiktok_tts?retryWrites=true&w=majority&appName=Cluster0";
mongoose.connect(MONGODB_URI);

const Config = mongoose.model('Config', { key: String, value: String });
const BannedWord = mongoose.model('BannedWord', { word: String });

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
let tiktokConn = null;

// API Quản lý
app.get('/api/config', async (req, res) => res.json(await Config.findOne({ key: 'prompt' })));
app.post('/api/config', async (req, res) => {
    await Config.findOneAndUpdate({ key: 'prompt' }, { value: req.body.value }, { upsert: true });
    res.sendStatus(200);
});

app.get('/api/words', async (req, res) => res.json(await BannedWord.find()));
app.post('/api/words', async (req, res) => {
    await BannedWord.create({ word: req.body.word.toLowerCase() });
    res.sendStatus(200);
});
app.delete('/api/words/:id', async (req, res) => {
    await BannedWord.findByIdAndDelete(req.params.id);
    res.sendStatus(200);
});

async function getGoogleAudio(text) {
    try {
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text.substring(0, 200))}&tl=vi&client=tw-ob`;
        const res = await axios.get(url, { responseType: 'arraybuffer' });
        return `data:audio/mp3;base64,${Buffer.from(res.data, 'binary').toString('base64')}`;
    } catch (e) { return null; }
}

io.on('connection', (socket) => {
    socket.on('set-username', (username) => {
        if (tiktokConn) tiktokConn.disconnect();
        tiktokConn = new WebcastPushConnection(username, { processInitialData: false });
        tiktokConn.connect().then(() => socket.emit('status', `✅ Đã kết nối: ${username}`));

        tiktokConn.on('chat', async (data) => {
            // Kiểm tra từ cấm
            const banned = await BannedWord.find();
            if (banned.some(b => data.comment.toLowerCase().includes(b.word))) return;

            // Lấy prompt xưng hô từ database
            const customPrompt = await Config.findOne({ key: 'prompt' });
            const systemRole = customPrompt ? customPrompt.value : "Bạn là chị Google. Trả lời ngắn dưới 10 từ.";

            try {
                const completion = await groq.chat.completions.create({
                    messages: [
                        { role: "system", content: systemRole },
                        { role: "user", content: data.comment }
                    ],
                    model: "llama-3.3-70b-versatile",
                });
                const reply = completion.choices[0]?.message?.content;
                if (reply) {
                    const audio = await getGoogleAudio(reply);
                    socket.emit('audio-data', { user: data.nickname, comment: data.comment, reply, audio });
                }
            } catch (e) { console.log("Lỗi AI"); }
        });
    });
});

server.listen(process.env.PORT || 3000, () => console.log("Server đang chạy..."));
