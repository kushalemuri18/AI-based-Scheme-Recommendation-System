export const sendOTPEmail = async (email, otp) => {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.log(`\n==================================================`);
    console.log(`[EMAIL SERVICE] Warning: EMAIL_USER or EMAIL_PASS not configured in environment.`);
    console.log(`[EMAIL SERVICE] Generated OTP for ${email}: ${otp}`);
    console.log(`==================================================\n`);
    return { simulated: true, otp };
  }

  // Dynamically import nodemailer to prevent startup import crashes
  const nodemailerModule = await import('nodemailer')
  const nodemailer = nodemailerModule.default || nodemailerModule

  // Create transporter using Gmail SMTP
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS // Gmail App Password
    }
  })

  const mailOptions = {
    from: `"SchemeAI Support" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: 'SchemeAI Password Reset OTP',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <h2 style="color: #1e3a8a; text-align: center;">SchemeAI Password Reset</h2>
        <p>Hello,</p>
        <p>We received a request to reset the password for your SchemeAI account. Please use the following 6-digit One-Time Password (OTP) to complete the reset process:</p>
        <div style="text-align: center; margin: 30px 0;">
          <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #2563eb; background-color: #f3f4f6; padding: 10px 20px; border-radius: 6px; border: 1px dashed #d1d5db;">${otp}</span>
        </div>
        <p style="color: #ef4444; font-weight: bold;">This OTP is valid for 15 minutes. Do not share this OTP with anyone.</p>
        <p>If you did not request a password reset, please ignore this email.</p>
        <hr style="border: 0; border-top: 1px solid #e0e0e0; margin: 20px 0;" />
        <p style="font-size: 12px; color: #6b7280; text-align: center;">This is an automated email sent by SchemeAI. Please do not reply directly.</p>
      </div>
    `
  }

  await transporter.sendMail(mailOptions)
  return { simulated: false }
}
