require('dotenv').config();
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const twilio = require('twilio');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'brand-it-all-api' });
});

function buildMessage(data) {
  return [
    'New Brand It All inquiry',
    '',
    `Full Name: ${data.fullName}`,
    `Brand Name: ${data.brandName}`,
    `Phone Number: ${data.phoneNumber}`,
    `Email: ${data.email}`,
    `Instagram Handle: ${data.instagramHandle || 'N/A'}`,
    `Services Needed: ${data.servicesNeeded}`,
    `Message: ${data.message}`
  ].join('\n');
}

function validatePayload(body) {
  const requiredFields = ['fullName', 'brandName', 'phoneNumber', 'email', 'servicesNeeded', 'message'];
  const missingFields = requiredFields.filter((field) => !String(body[field] || '').trim());
  return missingFields;
}

async function sendEmail(message, data) {
  const {
    EMAIL_PROVIDER,
    RESEND_API_KEY,
    MAIL_FROM,
    MAIL_TO
  } = process.env;

  if (String(EMAIL_PROVIDER || '').toLowerCase() === 'resend') {
    if (!RESEND_API_KEY || !MAIL_FROM || !MAIL_TO) {
      throw new Error('Resend environment variables are missing. Set RESEND_API_KEY, MAIL_FROM, and MAIL_TO.');
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: MAIL_FROM,
        to: [MAIL_TO],
        subject: `Brand It All Inquiry - ${data.fullName}`,
        text: message
      })
    });

    if (!response.ok) {
      const resendBody = await response.text();
      throw new Error(`Resend API error (${response.status}): ${resendBody}`);
    }

    return;
  }

  const {
    SMTP_HOST,
    SMTP_PORT,
    SMTP_USER,
    SMTP_PASS,
    MAIL_FROM: smtpFrom,
    MAIL_TO: smtpTo
  } = process.env;

  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS || !smtpFrom || !smtpTo) {
    throw new Error('SMTP environment variables are missing. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM, and MAIL_TO.');
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465 || String(process.env.SMTP_SECURE) === 'true',
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS
    }
  });

  await transporter.sendMail({
    from: smtpFrom,
    to: smtpTo,
    subject: `Brand It All Inquiry - ${data.fullName}`,
    text: message
  });
}

async function sendSms(message) {
  const {
    TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN,
    TWILIO_SMS_FROM,
    TWILIO_SMS_TO
  } = process.env;

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_SMS_FROM || !TWILIO_SMS_TO) {
    throw new Error('Twilio SMS environment variables are missing. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_SMS_FROM, and TWILIO_SMS_TO.');
  }

  const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

  await client.messages.create({
    from: TWILIO_SMS_FROM,
    to: TWILIO_SMS_TO,
    body: message
  });
}

app.post('/api/submit', async (req, res) => {
  try {
    const missingFields = validatePayload(req.body || {});

    if (missingFields.length > 0) {
      return res.status(400).json({
        error: `Missing required fields: ${missingFields.join(', ')}`
      });
    }

    const data = {
      fullName: String(req.body.fullName).trim(),
      brandName: String(req.body.brandName).trim(),
      phoneNumber: String(req.body.phoneNumber).trim(),
      email: String(req.body.email).trim(),
      instagramHandle: String(req.body.instagramHandle || '').trim(),
      servicesNeeded: String(req.body.servicesNeeded).trim(),
      message: String(req.body.message).trim()
    };

    const message = buildMessage(data);

    const results = await Promise.allSettled([
      sendEmail(message, data),
      sendSms(message)
    ]);

    const emailResult = results[0];
    const smsResult = results[1];

    if (emailResult.status === 'rejected') {
      const emailErr = emailResult.reason?.message || String(emailResult.reason);
      console.error('[Email error]', emailErr);
      return res.status(500).json({ error: `Email failed: ${emailErr}` });
    }

    if (smsResult.status === 'rejected') {
      console.warn('[SMS warning]', smsResult.reason?.message || smsResult.reason);
    }

    return res.json({ ok: true });
  } catch (error) {
    console.error('[Submit error]', error);
    return res.status(500).json({
      error: error.message || 'Failed to submit the form.'
    });
  }
});

app.listen(port, () => {
  console.log(`Brand It All form server running on http://localhost:${port}`);
});