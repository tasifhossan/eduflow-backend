import nodemailer from 'nodemailer';

/**
 * Sends an email using Brevo HTTP API if BREVO_API_KEY is set,
 * otherwise falls back to SMTP (e.g. Mailtrap for local dev).
 * Never throws — errors are caught and logged so the calling operation
 * always succeeds regardless of email delivery.
 */
export async function sendEmail(
  to: string[],
  subject: string,
  html: string
): Promise<void> {
  if (!to.length) return;

  try {
    if (process.env.BREVO_API_KEY && process.env.BREVO_SENDER_EMAIL) {
      // --- Brevo HTTP API (production) ---
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'api-key': process.env.BREVO_API_KEY,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          sender: { name: 'EduFlow', email: process.env.BREVO_SENDER_EMAIL },
          to: to.map((email) => ({ email })),
          subject,
          htmlContent: html,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        console.error('[mailer] Brevo API error:', body);
      }
    } else if (process.env.SMTP_HOST) {
      // --- SMTP fallback (local dev / Mailtrap) ---
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: parseInt(process.env.SMTP_PORT || '587', 10) === 465,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });

      await transporter.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: to.join(', '),
        subject,
        html,
      });
    } else {
      // No email provider configured — silently skip
      console.warn('[mailer] No email provider configured. Set BREVO_API_KEY or SMTP_HOST.');
    }
  } catch (error) {
    // Log but never propagate — email failure must not break the API response
    console.error('[mailer] Failed to send email:', error);
  }
}
