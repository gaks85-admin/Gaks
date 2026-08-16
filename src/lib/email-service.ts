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

  const emailSubject = process.env.EMAIL_SUBJECT || 'Gaks AI Notification';
  const htmlBody = `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #18181b; white-space: pre-wrap;">${escapeHtml(messageText)}</div>`;

  // 1. Send via Resend API if key is set
  if (resendKey) {
    try {
      const fromEmail = process.env.EMAIL_FROM || 'Gaks AI <onboarding@resend.dev>';
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

      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data?.id) {
        return { success: true, messageId: data.id };
      }
      const errMsg = data?.message || data?.error?.message || (typeof data?.error === 'string' ? data.error : null) || `Resend API error (${resp.status})`;
      return { success: false, error: errMsg };
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
        return { success: true, messageId: data?.id || `webhook_${Date.now()}` };
      }
      return { success: false, error: `Email webhook returned status ${resp.status}` };
    } catch (err: any) {
      console.error('[Email Service Error - Webhook]:', err);
      return { success: false, error: err.message || 'Failed to reach email webhook.' };
    }
  }

  // Return failure when no provider is configured
  console.warn('[Email Service] No email provider configured (RESEND_API_KEY, SENDGRID_API_KEY, or EMAIL_WEBHOOK_URL).');
  return {
    success: false,
    error: 'Email delivery provider is not configured on the server. Please configure RESEND_API_KEY or SENDGRID_API_KEY in environment variables.',
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
