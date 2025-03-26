const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { ensureAuthenticated } = require('../middleware/auth');
const { storage, cloudinary } = require('../config/cloudinary'); // Import your Cloudinary config
const multer = require('multer');
const bcrypt = require('bcryptjs');

// Configure multer with Cloudinary storage
const upload = multer({ storage });

router.get('/me', ensureAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select('-password')
      .populate('businesses')
      .populate('personalContent');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: 'Failed to fetch user', details: error.message });
  }
});

// Update user details (including image)
router.put('/me', ensureAuthenticated, upload.single('image'), async (req, res) => {
  try {
    const userId = req.user._id;
    const { name, email, password } = req.body;

    const updateData = { name, email };
    if (password) {
      updateData.password = await bcrypt.hash(password, 10);
    }
    if (req.file) {
      // Cloudinary upload result is available in req.file
      updateData.image = req.file.path; // This is the Cloudinary URL
    }

    const user = await User.findByIdAndUpdate(userId, updateData, { new: true })
      .select('-password'); // Exclude password from response
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: 'User updated successfully', user });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: 'Failed to update user', details: error.message });
  }
});

// Keep your other route (/:id) unchanged unless you want image upload there too
router.put('/:id', ensureAuthenticated, async (req, res) => {
  try {
    const userId = req.params.id;
    const currentUser = req.user;

    if (userId !== currentUser._id.toString()) {
      return res.status(403).json({ error: 'You can only update your own profile' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { isEditEdgeUser, articleGenerationCount, socialMediaGenerationCount, contentGenerationResetDate, freeTrialUsed, subscription } = req.body;

    const updateData = {};
    if (typeof isEditEdgeUser === 'boolean') updateData.isEditEdgeUser = isEditEdgeUser;
    if (typeof articleGenerationCount === 'number') updateData.articleGenerationCount = articleGenerationCount;
    if (typeof socialMediaGenerationCount === 'number') updateData.socialMediaGenerationCount = socialMediaGenerationCount;
    if (contentGenerationResetDate) updateData.contentGenerationResetDate = new Date(contentGenerationResetDate);
    if (typeof freeTrialUsed === 'boolean') updateData.freeTrialUsed = freeTrialUsed;
    if (subscription && ['None', 'Basic', 'Pro', 'Enterprise'].includes(subscription)) updateData.subscription = subscription;

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { 
        $set: updateData,
        $unset: { companyName: "" }
      },
      { new: true }
    );

    res.json({ message: 'User updated successfully', user: updatedUser });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: 'Error updating user', details: error.message });
  }
});

module.exports = router;