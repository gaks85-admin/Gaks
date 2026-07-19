import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';

export default async function debugGeminiHandler(req: any, res: any) {
  try {
    const googleApiKeyExists = !!process.env.GOOGLE_API_KEY;
    const geminiApiKeyExists = !!process.env.GEMINI_API_KEY;
    
    let envVarUsed = "None";
    let ai: any = null;

    if (process.env.GEMINI_API_KEY) {
        envVarUsed = "GEMINI_API_KEY";
        ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    } else if (process.env.GOOGLE_API_KEY) {
        envVarUsed = "GOOGLE_API_KEY";
        ai = new GoogleGenAI({});
    }

    let packageVersion = "unknown";
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8'));
        packageVersion = pkg.dependencies['@google/genai'] || pkg.devDependencies['@google/genai'] || "not found";
    } catch (e) {
        packageVersion = "error reading package.json";
    }

    const modelName = "gemini-2.5-flash"; // Purposefully testing the old one, but we might want to let the user pass it? No, just keep what the code had. The user requested: "If the model is invalid, automatically list the available Gemini models (if supported by the SDK) or clearly report the invalid model error."
    // Let's first test the default model, but wait, if it's invalid, list models and return that.

    let geminiResponse = null;
    let geminiError = null;
    let httpStatus = 200;
    let stackTrace = null;
    let availableModels: string[] | undefined = undefined;

    if (!ai) {
        return res.status(500).json({
            success: false,
            googleApiKeyExists,
        geminiApiKeyExists,
        apiKeyPresent: googleApiKeyExists || geminiApiKeyExists,
            envVarUsed,
            packageVersion,
            model: modelName,
            error: "No API key available to initialize GoogleGenAI",
            status: 500,
            stack: null,
            geminiResponse: null
        });
    }

    try {
        const response = await ai.models.generateContent({
            model: modelName,
            contents: "Reply only with OK",
        });
        geminiResponse = response;
    } catch (err: any) {
        geminiError = err.message || String(err);
        httpStatus = err.status || 500;
        stackTrace = err.stack;
        
        if (geminiError.includes('not found') || geminiError.includes('invalid') || geminiError.includes('not supported')) {
            try {
                const listResp = await ai.models.list();
                const models = [];
                for await (const m of listResp) {
                    models.push(m.name);
                }
                availableModels = models;
            } catch (e: any) {
                // Ignore if we can't fetch list
            }
        }
    }

    return res.status(httpStatus === 200 ? 200 : 500).json({
        success: !geminiError,
        googleApiKeyExists,
        geminiApiKeyExists,
        apiKeyPresent: googleApiKeyExists || geminiApiKeyExists,
        envVarUsed,
        packageVersion,
        model: modelName,
        geminiResponse,
        error: geminiError,
        availableModels,
        status: httpStatus,
        stack: stackTrace
    });
  } catch (err: any) {
    return res.status(500).json({
        success: false,
        error: "Fatal error in debug endpoint: " + err.message,
        stack: err.stack
    });
  }
}
