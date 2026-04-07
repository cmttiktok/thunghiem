const express = require('express');
const { WebcastPushConnection } = require('tiktok-live-connector');
const Groq = require('groq-sdk');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server);

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const tiktokUsername = "ID_TIKTOK_CUA_BAN"; 

let tiktokConn = new WebcastPushConnection(tiktokUsername);
tiktokConn.connect().then(() => console.log("Đã kết nối TikTok")).catch(console.error);

tiktokConn.on('chat', async (data) => {
    try {
        const completion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: "Bạn là Chị Google livestream. Trả lời cực ngắn, hài hước, xưng chị gọi em." },
                { role: "user", content: `Bình luận từ ${data.uniqueId}: ${data.comment}` }
            ],
            model: "llama-3.3-70b-versatile",
        });
        const reply = completion.choices[0]?.message?.content;
        if (reply) io.emit('speak', { text: reply });
    } catch (e) { console.log("Lỗi AI"); }
});

app.use(express.static('public'));
server.listen(process.env.PORT || 3000);
