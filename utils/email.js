const nodemailer = require('nodemailer');

// Configure the email transporter
const transporter = nodemailer.createTransport({
  service: process.env.EMAIL_SERVICE || 'Gmail',
  auth: {
    user: process.env.GMAIL_EMAIL, // Your email address (e.g., Gmail address)
    pass: process.env.GMAIL_PASSWORD, // Your email password or app-specific password
  },
});

// Send email utility function
const sendEmail = async (to, subject, text, html) => {
  try {
    const mailOptions = {
      from: process.env.GMAIL_EMAIL,
      to,
      subject,
      text,
      html,
    };

    await transporter.sendMail(mailOptions);
    console.log(`Email sent successfully to ${to}`);
  } catch (error) {
    console.error('Error sending email:', error);
    throw new Error(`Failed to send email: ${error.message}`);
  }
};

module.exports = { sendEmail };