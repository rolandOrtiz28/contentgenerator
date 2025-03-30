const express = require('express');
const router = express.Router();
const User = require('../models/User'); // Adjust path to your User model
const mongoose = require('mongoose');
const { getIO } = require('../socket');


// Middleware to ensure admin access
function ensureAdmin(req, res, next) {
  if (req.isAuthenticated() && req.user.role === 'admin') {
    return next();
  }
  res.status(403).json({ error: 'Admin access required' });
}

router.use(ensureAdmin);

// Test route
router.get('/', (req, res) => {
  res.json({ message: 'Welcome to the Admin Panel' });
});

// CRUD for Users (admin managing all users)
// Create a new user
router.post('/users', async (req, res) => {
    try {
      const { email, password, name, role } = req.body;
      const user = new User({ email, password, name, role });
      await user.save();
  
      getIO().emit("userCreated", {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
      });

      getIO().emit("userActivity", {
        action: "create",
        userId: user._id,
        name: user.name,
        email: user.email,
        timestamp: new Date(),
        details: req.body,
      });
  
      res.status(201).json({ message: 'User created', userId: user._id });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

// Read all users (admin overview)
router.get('/users', async (req, res) => {
  try {
    const users = await User.find()
      .select('-password -resetPasswordToken -resetPasswordExpires') // Exclude sensitive fields
      .populate('businesses', 'name') // Optional: adjust fields as needed
      .populate('personalContent', 'title'); // Optional: adjust fields as needed
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Read single user by ID (admin view)
router.get('/users/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select('-password -resetPasswordToken -resetPasswordExpires')
      .populate('businesses', 'name')
      .populate('personalContent', 'title');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update a user (admin edits any user)
router.put('/users/:id', async (req, res) => {
  try {
    const allowedFields = {
      email: req.body.email,
      name: req.body.name,
      role: req.body.role,
      subscription: req.body.subscription,
      stripeCustomerId: req.body.stripeCustomerId,
      stripeSubscriptionId: req.body.stripeSubscriptionId,
      subscriptionStatus: req.body.subscriptionStatus,
      freeTrialUsed: req.body.freeTrialUsed,
      isEditEdgeUser: req.body.isEditEdgeUser,
      articleGenerationCount: req.body.articleGenerationCount,
      socialMediaGenerationCount: req.body.socialMediaGenerationCount,
    };

    if (req.body.password) {
      allowedFields.password = req.body.password; // Hashed by pre-save hook
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      allowedFields,
      { new: true, runValidators: true }
    )
      .select('-password -resetPasswordToken -resetPasswordExpires')
      .populate('businesses', 'name')
      .populate('personalContent', 'title');

    if (!user) return res.status(404).json({ error: 'User not found' });

    // 🔴 Real-time emit to all connected admins (or whoever needs it)
    getIO().emit("userUpdated", user);

    getIO().emit("userActivity", {
        action: "update",
        userId: user._id,
        name: user.name,
        email: user.email,
        timestamp: new Date(),
        details: req.body,
      });
      

    res.json({ message: 'User updated', user });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});


// Delete a user (admin deletes any user)
router.delete('/users/:id', async (req, res) => {
    try {
      const user = await User.findByIdAndDelete(req.params.id);
      if (!user) return res.status(404).json({ error: 'User not found' });
  
      getIO().emit("userDeleted", { userId: req.params.id });

      getIO().emit("userActivity", {
        action: "delete",
        userId: req.params.id,
        name: user.name,
        email: user.email,
        timestamp: new Date(),
        details: user,
      });
      
  
      res.json({ message: 'User deleted' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });


// SATATICS
// Admin dashboard stats
router.get('/stats', async (req, res) => {
    try {
      const [
        totalUsers,
        adminCount,
        newUsers,
        activeUsers,
        totalBusinesses,
        totalContents,
        totalComments,
        totalImages,
        totalSessions,
        allUsers
      ] = await Promise.all([
        User.countDocuments(),
        User.countDocuments({ role: 'admin' }),
        User.countDocuments({ createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } }),
        User.countDocuments({ updatedAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } }),
        mongoose.model('Business').countDocuments(),
        mongoose.model('Content').countDocuments(),
        mongoose.model('Comment').countDocuments(),
        mongoose.model('Image').countDocuments(),
        mongoose.connection.db.collection('sessions').countDocuments(),
        User.find()
      ]);
  
      const totalArticleGenerations = allUsers.reduce((sum, user) => sum + (user.articleGenerationCount || 0), 0);
      const totalSocialGenerations = allUsers.reduce((sum, user) => sum + (user.socialMediaGenerationCount || 0), 0);
  
      res.json({
        users: {
          total: totalUsers,
          admins: adminCount,
          newThisWeek: newUsers,
          activeThisWeek: activeUsers,
        },
        content: {
          total: totalContents,
          articles: totalArticleGenerations,
          social: totalSocialGenerations,
        },
        businesses: {
          total: totalBusinesses,
        },
        comments: totalComments,
        images: totalImages,
        sessions: totalSessions,
      });
    } catch (error) {
      console.error("Failed to fetch stats:", error);
      res.status(500).json({ error: "Failed to load stats" });
    }
  });

  // GET /api/admin/user-activity
router.get('/user-activity', async (req, res) => {
    try {
        const now = new Date();
        let filter = {};
        
        const timeframe = req.query.timeframe;
        
        if (timeframe === "week") {
          const sevenDaysAgo = new Date(now);
          sevenDaysAgo.setDate(now.getDate() - 7);
          filter.createdAt = { $gte: sevenDaysAgo };
        } else if (timeframe === "month") {
          const thirtyDaysAgo = new Date(now);
          thirtyDaysAgo.setDate(now.getDate() - 30);
          filter.createdAt = { $gte: thirtyDaysAgo };
        }
        
        const users = await User.find(filter)
          .select("name email image personalContent createdAt updatedAt")
          .lean();
  
      const processedUsers = users.map(user => ({
        name: user.name,
        image: user.image,
        email: user.email,
        contentCount: user.personalContent?.length || 0,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      }));
  
      res.json({ users: processedUsers });
    } catch (err) {
      console.error("Error in /admin/user-activity:", err);
      res.status(500).json({ error: "Failed to fetch user activity" });
    }
  });
  
  

module.exports = router;