import { validateFinalTelegramTradePayload, computeTradeFingerprint } from './final-telegram-gate.js';
import { buildTelegramAlertMessage } from './telegram-formatter.js';

export async function sendTelegramMessage(chatId: string | number, text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn("TELEGRAM_BOT_TOKEN is not defined in environment variables.");
    return false;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: "Markdown"
      })
    });
    if (!response.ok) {
      const errText = await response.text();
      console.error(`Telegram API Error: ${response.status} - ${errText}`);
      return false;
    }
    return true;
  } catch (error: any) {
    console.error("Error sending Telegram message:", error);
    return false;
  }
}

export async function dispatchTradeAlert(chatId: string | number, payload: any): Promise<{ sent: boolean; reason: string }> {
  const initialFp = computeTradeFingerprint(payload);
  
  const gateResult = validateFinalTelegramTradePayload(payload);

  console.log(`[TELEGRAM OBJECT FINGERPRINT]
Direction: ${payload.direction}
Entry: ${payload.entryPrice}
SL: ${payload.stopLoss}
TP: ${payload.takeProfit}
RR: ${payload.riskRewardRatio || 'N/A'}
Fingerprint: ${initialFp}`);

  const postFp = computeTradeFingerprint(payload);
  if (initialFp !== postFp) {
    console.error(`[TELEGRAM GATE BLOCKED] REASON: TRADE_OBJECT_MUTATED_AFTER_VALIDATION`);
    return { sent: false, reason: 'TRADE_OBJECT_MUTATED_AFTER_VALIDATION' };
  }

  if (!gateResult.valid) {
    console.error(`[TELEGRAM GATE BLOCKED] REASON: ${gateResult.reason}`);
    return { sent: false, reason: gateResult.reason };
  }

  const message = buildTelegramAlertMessage(payload);
  const success = await sendTelegramMessage(chatId, message);
  return { sent: success, reason: success ? 'SUCCESS' : 'TELEGRAM_API_ERROR' };
}

