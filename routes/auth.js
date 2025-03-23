const express = require('express');
const router = express.Router();
const passport = require('passport');
const User = require('../models/User');
const { ensureAuthenticated } = require('../middleware/auth');
const bcrypt = require('bcryptjs')
// Register
router.post('/register', async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  try {
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already exists' });
    }
    const user = new User({ email, password, name });
    await user.save();
    req.login(user, (err) => {
      if (err) return res.status(500).json({ error: 'Login failed' });
      return res.json({ user: { id: user._id, email: user.email, name: user.name } });
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Login
router.post('/login', passport.authenticate('local'), (req, res) => {
  res.json({ user: { id: req.user._id, email: req.user.email, name: req.user.name } });
});

// Logout
router.post('/logout', (req, res) => {
  req.logout((err) => {
    if (err) return res.status(500).json({ error: 'Logout failed' });
    req.session.destroy();
    res.json({ message: 'Logged out successfully' });
  });
});



// Get Current User
router.get('/me', (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  res.json({ user: { id: req.user._id, email: req.user.email, name: req.user.name } });
});

router.put('/update-password', ensureAuthenticated, async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  // Validate input
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current password and new password are required' });
  }

  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify the current password
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    // Update with the new password (will be hashed by the pre('save') middleware)
    user.password = newPassword;
    await user.save();

    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('Error updating password:', error);
    res.status(500).json({ error: 'Error updating password', details: error.message });
  }
});


router.post('/reset-password-test-user', async (req, res) => {
  const { newPassword } = req.body;

  if (!newPassword) {
    return res.status(400).json({ error: 'New password is required' });
  }

  try {
    const user = await User.findOne({ email: 'newtestuser@example.com' });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    res.json({ message: 'Password reset successfully for newtestuser@example.com' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to reset password', details: error.message });
  }
});

module.exports = router;