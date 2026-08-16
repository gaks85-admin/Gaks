/**
 * Admin Notification Email Service
 * Handles delivering admin notifications via email using Resend or SendGrid APIs
 * or standard SMTP webhook when configured.
 */

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export async function sendNotificationEmail(
  toEmail: string,
  messageText: string
): Promise<SendEmailResult> {
  const recipient = toEmail.trim();
  if (!recipient || !recipient.includes('@')) {
    return { success: false, error: 'Invalid recipient email address.' };
  }

  const resendKey = process.env.RESEND_API_KEY;
  const sendgridKey = process.env.SENDGRID_API_KEY;
  const customEmailEndpoint = process.env.EMAIL_WEBHOOK_URL;

  const emailSubject = 'Gaks AI — Administrative Notification';
  const htmlBody = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #09090b; color: #f4f4f5; border-radius: 12px;">
      <div style="border-bottom: 1px solid #27272a; padding-bottom: 16px; margin-bottom: 20px;">
        <h2 style="color: #38bdf8; margin: 0; font-size: 18px; font-weight: 700;">Gaks AI Administrator Notification</h2>
      </div>
      <div style="font-size: 14px; line-height: 1.6; color: #e4e4e7; white-space: pre-wrap; padding: 16px; background-color: #18181b; border-radius: 8px; border: 1px solid #27272a;">
${escapeHtml(messageText)}
      </div>
      <div style="margin-top: 24px; font-size: 11px; color: #71717a; border-top: 1px solid #27272a; padding-top: 16px; text-align: center;">
        This message was dispatched directly by a system administrator.
      </div>
    </div>
  `;

  // 1. Send via Resend API if key is set
  if (resendKey) {
    try {
      const fromEmail = process.env.EMAIL_FROM || 'Gaks AI Admin <notifications@gaks.ai>';
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [recipient],
          subject: emailSubject,
          html: htmlBody,
          text: messageText,
        }),
      });

      const data = await resp.json();
      if (resp.ok && data.id) {
        return { success: true, messageId: data.id };
      }
      return { success: false, error: data.message || data.error || 'Resend API returned an error.' };
    } catch (err: any) {
      console.error('[Email Service Error - Resend]:', err);
      return { success: false, error: err.message || 'Failed to communicate with Resend API.' };
    }
  }

  // 2. Send via SendGrid API if key is set
  if (sendgridKey) {
    try {
      const fromEmail = process.env.EMAIL_FROM || 'notifications@gaks.ai';
      const resp = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${sendgridKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: recipient }] }],
          from: { email: fromEmail, name: 'Gaks AI Admin' },
          subject: emailSubject,
          content: [
            { type: 'text/plain', value: messageText },
            { type: 'text/html', value: htmlBody },
          ],
        }),
      });

      if (resp.status >= 200 && resp.status < 300) {
        return { success: true, messageId: `sg_${Date.now()}` };
      }

      const errText = await resp.text();
      return { success: false, error: `SendGrid API error (${resp.status}): ${errText}` };
    } catch (err: any) {
      console.error('[Email Service Error - SendGrid]:', err);
      return { success: false, error: err.message || 'Failed to communicate with SendGrid API.' };
    }
  }

  // 3. Send via custom Email Webhook URL if set
  if (customEmailEndpoint) {
    try {
      const resp = await fetch(customEmailEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: recipient,
          subject: emailSubject,
          text: messageText,
          html: htmlBody,
        }),
      });

      if (resp.ok) {
        const data = await resp.json().catch(() => ({}));
        return { success: true, messageId: data.id || `webhook_${Date.now()}` };
      }
      return { success: false, error: `Email webhook returned status ${resp.status}` };
    } catch (err: any) {
      console.error('[Email Service Error - Webhook]:', err);
      return { success: false, error: err.message || 'Failed to reach email webhook.' };
    }
  }

  // Fallback mode when no external API key is configured
  console.log(`[Email Service Simulated Delivery] To: ${recipient} | Message: ${messageText.substring(0, 50)}...`);
  return {
    success: true,
    messageId: `simulated_${Date.now()}`,
  };
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
