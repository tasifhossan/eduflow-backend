import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: parseInt(process.env.SMTP_PORT || '587', 10) === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

/**
 * Sends an email to one or more recipients.
 * Never throws — errors are caught and logged so the calling operation
 * (e.g. marking attendance) always succeeds regardless of email delivery.
 */
export async function sendEmail(
  to: string[],
  subject: string,
  html: string
): Promise<void> {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
    // SMTP not configured — silently skip
    return;
  }

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: to.join(', '),
      subject,
      html,
    });
  } catch (error) {
    // Log but never propagate — email failure must not break the API response
    console.error('[mailer] Failed to send email:', error);
  }
}
