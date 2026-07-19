const { GoogleGenAI } = require('@google/genai');

async function run() {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    try {
        const response = await ai.models.list();
        const models = [];
        for await (const model of response) {
            models.push(model.name);
        }
        console.log("Models:", models);
    } catch (e) {
        console.error("Error:", e);
    }
}
run();
