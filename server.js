// --- CẤU HÌNH GEMINI AI (FIX LỖI VÙNG MIỀN) ---
const genAI = new GoogleGenerativeAI("AIzaSyB4tu0J3c2LbpsrTH43BtaD9Y_fiMUTHII");

async function askGemini(userName, question) {
    try {
        // Sử dụng model 1.5-flash với cấu hình an toàn hơn
        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash",
        }, { apiVersion: 'v1' }); 

        const prompt = `Bạn là trợ lý ảo của Idol TikTok Chi Bèo. Trả lời dưới 20 từ. ${userName} hỏi: ${question}`;
        
        // Thêm cấu hình chịu lỗi
        const result = await model.generateContent({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
                maxOutputTokens: 50,
                temperature: 0.7,
            },
        });

        const response = await result.response;
        return response.text();
    } catch (e) {
        console.error("LỖI GEMINI CHI TIẾT:", e.message);
        
        // MẸO: Nếu vẫn lỗi vùng miền, mình sẽ dùng một câu trả lời "thông minh giả" 
        // để không bị đứng máy khi Idol đang live
        if (e.message.includes("location")) {
            return "Dạ em nghe đây ạ, nhưng mạng chỗ em đang hơi lag, anh gọi lại sau nhé!";
        }
        return "Em đang bận xíu, anh hỏi lại sau nha!";
    }
}
