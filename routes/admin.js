const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Business = require('../models/Business');
const mongoose = require('mongoose');
const { getIO } = require('../socket');
const UserActivity = require('../models/UserActivity');


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
router.post('/users', async (req, res) => {
  try {
    const { email, password, name, role, subscription } = req.body;
    const user = new User({ email, password, name, role, subscription });
    await user.save();

    getIO().emit("userCreated", {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
      subscription: user.subscription,
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

router.get('/users', async (req, res) => {
  try {
    const users = await User.find()
      .select('-password -resetPasswordToken -resetPasswordExpires')
      .populate('businesses', 'companyName') // Use 'companyName' instead of 'name'
      .populate({
        path: 'personalContent',
        select: 'type data.title data.caption', // Select relevant fields
      });
    res.json(users);
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/users/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select('-password -resetPasswordToken -resetPasswordExpires')
      .populate('businesses', 'companyName')
      .populate({
        path: 'personalContent',
        select: 'type data.title data.caption',
      });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (error) {
    console.error("Error fetching user:", error);
    res.status(500).json({ error: error.message });
  }
});

router.put('/users/:id', async (req, res) => {
  try {
    console.log("Update user request body:", req.body);

    const allowedFields = {
      email: req.body.email,
      name: req.body.name,
      role: req.body.role,
      image: req.body.image,
      subscription: req.body.subscription,
      stripeCustomerId: req.body.stripeCustomerId,
      stripeSubscriptionId: req.body.stripeSubscriptionId,
      subscriptionStatus: req.body.subscriptionStatus === 'null' ? null : req.body.subscriptionStatus,
      freeTrialUsed: req.body.freeTrialUsed === 'true',
      isEditEdgeUser: req.body.isEditEdgeUser === 'true',
      articleGenerationCount: parseInt(req.body.articleGenerationCount) || 0,
      socialMediaGenerationCount: parseInt(req.body.socialMediaGenerationCount) || 0,
      businesses: Array.isArray(req.body.businesses) ? req.body.businesses : [],
      personalContent: Array.isArray(req.body.personalContent) ? req.body.personalContent : [],
    };

    if (req.body.password) {
      allowedFields.password = req.body.password;
    }

    const user = await User.findByIdAndUpdate(req.params.id, allowedFields, {
      new: true,
      runValidators: true,
    })
      .select('-password -resetPasswordToken -resetPasswordExpires')
      .populate('businesses', 'companyName')
      .populate({
        path: 'personalContent',
        select: 'type data.title data.caption',
      });

    if (!user) return res.status(404).json({ error: 'User not found' });

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
    console.error("Error updating user:", error);
    res.status(400).json({ error: error.message });
  }
});

router.delete('/users/:id', async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Remove user from associated businesses
    await Business.updateMany(
      { "members.user": user._id },
      { $pull: { members: { user: user._id } } }
    );

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

// Business Management Routes
router.post('/businesses', async (req, res) => {
  try {
    const { name, userId } = req.body;
    const business = new Business({ name, members: [{ user: userId, role: 'Admin' }] });
    await business.save();

    await User.findByIdAndUpdate(userId, { $push: { businesses: business._id } });

    res.status(201).json({ message: 'Business created', business });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.delete('/businesses/:id', async (req, res) => {
  try {
    const business = await Business.findByIdAndDelete(req.params.id);
    if (!business) return res.status(404).json({ error: 'Business not found' });

    await User.updateMany(
      { businesses: business._id },
      { $pull: { businesses: business._id } }
    );

    res.json({ message: 'Business deleted' });
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
      let userFilter = {};
      let activityFilter = {};
  
      const timeframe = req.query.timeframe;
  
      if (timeframe === "week") {
        const sevenDaysAgo = new Date(now);
        sevenDaysAgo.setDate(now.getDate() - 7);
        userFilter.createdAt = { $gte: sevenDaysAgo };
        activityFilter.timestamp = { $gte: sevenDaysAgo };
      } else if (timeframe === "month") {
        const thirtyDaysAgo = new Date(now);
        thirtyDaysAgo.setDate(now.getDate() - 30);
        userFilter.createdAt = { $gte: thirtyDaysAgo };
        activityFilter.timestamp = { $gte: thirtyDaysAgo };
      }
  
      const [users, activities] = await Promise.all([
        User.find(userFilter)
          .select("name email image personalContent createdAt updatedAt")
          .lean(),
        UserActivity.find(activityFilter)
          .sort({ timestamp: -1 })
          .lean(),
      ]);
  
      // Group all activity logs by userId
      const groupedActivities = {};
      for (const log of activities) {
        const uid = log.userId?.toString();
        if (!groupedActivities[uid]) groupedActivities[uid] = [];
        groupedActivities[uid].push(log);
      }
  
      const processedUsers = users.map((user) => ({
        _id: user._id.toString(), // Ensure _id is a string for consistency
        name: user.name,
        email: user.email,
        image: user.image,
        contentCount: user.personalContent?.length || 0,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        activityLogs: groupedActivities[user._id?.toString()] || [],
      }));
  
      // Emit to all connected clients (optional enhancement)
      getIO().emit('userActivityUpdate', { users: processedUsers });
  
      res.json({ users: processedUsers });
    } catch (err) {
      console.error("Error in /admin/user-activity:", err);
      res.status(500).json({ error: "Failed to fetch user activity" });
    }
  });
  

module.exports = router;