/**
 * Dedicated, isolated Admin Notification Email Service.
 * Does NOT modify unrelated authentication or trading email functionality.
 * Kept entirely server-side.
 */

export interface EmailSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export async function sendNotificationEmail(
  toEmail: string,
  messageText: string
): Promise<EmailSendResult> {
  const recipient = (toEmail || '').trim();
  if (!recipient || !recipient.includes('@')) {
    return {
      success: false,
      error: 'Invalid recipient email address.'
    };
  }

  const subject = 'Gaks AI Admin Notification';
  const bodyText = `Hello,\n\nYou have received a notification from the Gaks AI administration team.\n\n${messageText.trim()}\n\n— Gaks AI`;

  // 1. Resend API
  const resendApiKey = process.env.RESEND_API_KEY;
  if (resendApiKey) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'Gaks AI Admin <notifications@gaks.ai>',
          to: [recipient],
          subject: subject,
          text: bodyText
        })
      });

      if (response.ok) {
        const data: any = await response.json();
        return {
          success: true,
          messageId: data?.id || `resend_${Date.now()}`
        };
      } else {
        const errText = await response.text();
        console.error(`[Email Service] Resend API Error ${response.status}:`, errText);
        return {
          success: false,
          error: `Resend provider error (${response.status})`
        };
      }
    } catch (err: any) {
      console.error('[Email Service] Resend API exception:', err.message || err);
      return {
        success: false,
        error: `Resend network error: ${err.message || 'Failed request'}`
      };
    }
  }

  // 2. SendGrid API
  const sendgridApiKey = process.env.SENDGRID_API_KEY;
  if (sendgridApiKey) {
    try {
      const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${sendgridApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: recipient }] }],
          from: { email: 'notifications@gaks.ai', name: 'Gaks AI Admin' },
          subject: subject,
          content: [{ type: 'text/plain', value: bodyText }]
        })
      });

      if (response.ok || response.status === 202) {
        return {
          success: true,
          messageId: `sg_${Date.now()}`
        };
      } else {
        const errText = await response.text();
        console.error(`[Email Service] SendGrid Error ${response.status}:`, errText);
        return {
          success: false,
          error: `SendGrid provider error (${response.status})`
        };
      }
    } catch (err: any) {
      console.error('[Email Service] SendGrid API exception:', err.message || err);
      return {
        success: false,
        error: `SendGrid network error: ${err.message || 'Failed request'}`
      };
    }
  }

  // 3. If no email provider API key is defined in environment
  console.warn('[Email Service] No email provider credentials configured (RESEND_API_KEY or SENDGRID_API_KEY).');
  return {
    success: false,
    error: 'Email provider credentials are not configured on the server.'
  };
}
