const User = require("../models/User");

const requireSubscription = async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const user = await User.findById(req.user._id);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  // Allow EditEdge users to bypass subscription check
  if (user.isEditEdgeUser) {
    return next();
  }

  // Check if user has an active subscription
  if (
    user.subscription !== "None" &&
    ["active", "trialing"].includes(user.subscriptionStatus)
  ) {
    return next();
  }

  return res.status(403).json({ error: "Active subscription required" });
};

module.exports = { requireSubscription };