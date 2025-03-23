const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { ensureAuthenticated } = require('../middleware/auth');

// Update user details
router.put('/:id', ensureAuthenticated, async (req, res) => {
    try {
      const userId = req.params.id;
      const currentUser = req.user;
  
      // Ensure the user can only update their own profile
      if (userId !== currentUser._id.toString()) {
        return res.status(403).json({ error: 'You can only update your own profile' });
      }
  
      // Fetch the user
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
  
      // Fields that can be updated
      const { isEditEdgeUser, articleGenerationCount, socialMediaGenerationCount, contentGenerationResetDate, freeTrialUsed, subscription } = req.body;
  
      // Update the user with the provided fields
      const updateData = {};
      if (typeof isEditEdgeUser === 'boolean') updateData.isEditEdgeUser = isEditEdgeUser;
      if (typeof articleGenerationCount === 'number') updateData.articleGenerationCount = articleGenerationCount;
      if (typeof socialMediaGenerationCount === 'number') updateData.socialMediaGenerationCount = socialMediaGenerationCount;
      if (contentGenerationResetDate) updateData.contentGenerationResetDate = new Date(contentGenerationResetDate);
      if (typeof freeTrialUsed === 'boolean') updateData.freeTrialUsed = freeTrialUsed;
      if (subscription && ['None', 'Basic', 'Pro', 'Enterprise'].includes(subscription)) updateData.subscription = subscription;
  
      // Remove the companyName field if it exists
      const updatedUser = await User.findByIdAndUpdate(
        userId,
        { 
          $set: updateData,
          $unset: { companyName: "" } // Remove the companyName field
        },
        { new: true } // Return the updated document
      );
  
      res.json({ message: 'User updated successfully', user: updatedUser });
    } catch (error) {
      console.error('Error updating user:', error);
      res.status(500).json({ error: 'Error updating user', details: error.message });
    }
  });

module.exports = router;