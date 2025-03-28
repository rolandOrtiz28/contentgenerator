const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const passport = require('passport');
const mongoose = require('mongoose');
const crypto = require('crypto'); // For generating reset tokens
const User = require('../models/User');
const Business = require('../models/Business');
const { sendEmail } = require('../utils/email');


// Register a new user
router.post('/register', async (req, res) => {
  const { email, password, name, businessId, role } = req.body;

  if (!email || !password || !name) {
    return res.status(400).json({ error: 'Email, password, and name are required' });
  }

  try {
    // Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already exists' });
    }
    // Create new user with plain password
    const newUser = new User({
      email: email.toLowerCase(),
      password: password, // Let schema handle hashing
      name,
    });

    // Handle invitation if provided
    if (businessId && role && ['Admin', 'Editor', 'Viewer'].includes(role)) {
      if (!mongoose.Types.ObjectId.isValid(businessId)) {
        return res.status(400).json({ error: 'Invalid business ID' });
      }

      const business = await Business.findById(businessId);
      if (!business) {
        return res.status(404).json({ error: 'Business not found' });
      }

      // Add user to business
      business.members.push({ user: newUser._id, role });
      await business.save();
      newUser.businesses.push(business._id);
    }

    // Save user once
    await newUser.save();
    
    // 🔥 Refetch from DB to avoid stale or overwritten state
    const freshUser = await User.findOne({ email: newUser.email });

    req.login(freshUser, (err) => {
      if (err) {
        console.error('❌ Error logging in after registration:', err);
        return res.status(500).json({ error: 'Failed to log in after registration' });
      }

      return res.json({ message: 'Registration successful', user: freshUser });
    });
  } catch (error) {
    console.error('❌ Registration error:', error);
    res.status(500).json({ error: 'Failed to register user', details: error.message });
  }
});



// Login a user
router.post('/login', (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) {
      return res.status(500).json({ error: 'Authentication error', details: err.message });
    }
    if (!user) {
      return res.status(401).json({ error: info.message || 'Login failed' });
    }
    req.logIn(user, (err) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to log in', details: err.message });
      }
      return res.json({ message: 'Login successful', user });
    });
  })(req, res, next);
});

// Forgot Password - Request a reset link
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(404).json({ error: 'User with this email does not exist' });
    }

    // Generate a reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
    const resetTokenExpiry = Date.now() + 3600000; // 1 hour expiry

    // Save the reset token and expiry to the user
    user.resetPasswordToken = resetTokenHash;
    user.resetPasswordExpires = resetTokenExpiry;
    await user.save();

    // Send reset email
    const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:8080';
    const resetLink = `${FRONTEND_URL}/reset-password?token=${resetToken}&email=${encodeURIComponent(email)}`;
    const subject = 'Password Reset Request for ContentEdge';
    const text = `Hello ${user.name},\n\nYou have requested to reset your password for ContentEdge. Please click the link below to reset your password:\n\n${resetLink}\n\nThis link will expire in 1 hour. If you did not request a password reset, please ignore this email.\n\nBest regards,\nThe ContentEdge Team`;
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Password Reset Request</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f4f4f4; padding: 20px;">
          <tr>
            <td align="center">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; background-color: #ffffff; border: 1px solid #e0e0e0; border-radius: 8px;">
                <tr>
                  <td align="center" style="padding: 20px;">
                    <img src="https://res.cloudinary.com/dowyujl8h/image/upload/v1738490869/5_bbrzhk.png" alt="ContentEdge Logo" style="max-width: 150px; margin-bottom: 20px; display: block;" />
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding: 0 20px;">
                    <h2 style="color: #333333; font-size: 24px; margin: 0 0 20px;">Password Reset Request</h2>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 0 20px 20px;">
                    <p style="color: #555555; font-size: 16px; line-height: 1.6; margin: 0 0 10px;">Hello ${user.name},</p>
                    <p style="color: #555555; font-size: 16px; line-height: 1.6; margin: 0 0 20px;">
                      You have requested to reset your password for ContentEdge. Please click the button below to reset your password:
                    </p>
                    <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 30px auto;">
                      <tr>
                        <td align="center" style="background-color: #303030; border-radius: 5px;">
                          <a href="${resetLink}" style="display: inline-block; padding: 12px 24px; color: #ffffff; font-size: 16px; font-weight: bold; text-decoration: none;">Reset Password</a>
                        </td>
                      </tr>
                    </table>
                    <p style="color: #555555; font-size: 16px; line-height: 1.6; margin: 0 0 10px;">
                      This link will expire in 1 hour. If you did not request a password reset, please ignore this email.
                    </p>
                    <p style="color: #555555; font-size: 16px; line-height: 1.6; margin: 0;">
                      Best regards,<br>The ContentEdge Team
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 20px; border-top: 1px solid #e0e0e0;">
                    <p style="color: #999999; font-size: 12px; text-align: center; margin: 0;">
                      © 2025 ContentEdge. All rights reserved.<br>
                      <a href="${FRONTEND_URL}/privacy" style="color: #999999; text-decoration: none;">Privacy Policy</a> | <a href="${FRONTEND_URL}/terms" style="color: #999999; text-decoration: none;">Terms of Service</a>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;

    await sendEmail(email, subject, text, html);
    res.json({ message: 'Password reset link sent to your email' });
  } catch (error) {
    console.error('Error sending password reset email:', error);
    res.status(500).json({ error: 'Failed to send password reset email', details: error.message });
  }
});

// Reset Password - Handle the reset link
router.post('/reset-password', async (req, res) => {
  const { token, email, newPassword } = req.body;

  if (!token || !email || !newPassword) {
    return res.status(400).json({ error: 'Token, email, and new password are required' });
  }

  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(404).json({ error: 'User with this email does not exist' });
    }

    // Verify the reset token
    const resetTokenHash = crypto.createHash('sha256').update(token).digest('hex');
    if (user.resetPasswordToken !== resetTokenHash) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    if (user.resetPasswordExpires < Date.now()) {
      return res.status(400).json({ error: 'Reset token has expired' });
    }

    // Hash the new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);
    // Update the user's password and clear the reset token
    user.password = hashedPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();
    res.json({ message: 'Password reset successful' });
  } catch (error) {
    console.error('Error resetting password:', error);
    res.status(500).json({ error: 'Failed to reset password', details: error.message });
  }
});

// Logout a user
router.post('/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to log out', details: err.message });
    }
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to destroy session', details: err.message });
      }
      res.clearCookie('_editEdge');
      res.json({ message: 'Logout successful' });
    });
  });
});

// Get current user
router.get('/current-user', (req, res) => {
  if (req.isAuthenticated()) {
    res.json({ user: req.user });
  } else {
    res.status(401).json({ error: 'Not authenticated' });
  }
});

module.exports = router;