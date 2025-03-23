const User = require('../models/User');
const Business = require('../models/Business'); // Add this import
const Content = require('../models/Content');

const ensureAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: 'Not authenticated' });
};

const ensureBusinessRole = (requiredRole) => {
  return async (req, res, next) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const userId = req.user._id;
    let businessId = req.params.businessId || req.session.businessId || req.body.businessId;

    // If the route involves content, fetch the businessId from the content
    if (req.params.contentId) {
      const content = await Content.findById(req.params.contentId);
      if (!content) {
        return res.status(404).json({ error: 'Content not found' });
      }
      businessId = content.businessId;
    }

    // If no businessId is provided, return an error
    if (!businessId) {
      return res.status(400).json({ error: 'Business ID is required for this action' });
    }

    try {
      const business = await Business.findById(businessId);
      if (!business) {
        return res.status(404).json({ error: 'Business not found' });
      }

      // Check if the user is the owner
      const isOwner = business.owner.toString() === userId.toString();
      if (isOwner) {
        return next(); // Owners have full permissions
      }

      // Check if the user is a member of the business
      const member = business.members.find(m => m.user.toString() === userId.toString());
      if (!member) {
        return res.status(403).json({ error: 'You are not a member of this business' });
      }

      // Define role hierarchy (higher number = more permissions)
      const roleHierarchy = {
        Viewer: 1,
        Editor: 2,
        Admin: 3,
      };

      const userRoleValue = roleHierarchy[member.role] || 0;
      const requiredRoleValue = roleHierarchy[requiredRole] || 0;

      if (userRoleValue < requiredRoleValue) {
        return res.status(403).json({ 
          error: `Insufficient permissions. Required role: ${requiredRole}, Your role: ${member.role}` 
        });
      }

      next();
    } catch (error) {
      console.error('Error in ensureBusinessRole middleware:', error);
      res.status(500).json({ error: 'Failed to check business role', details: error.message });
    }
  };
};

module.exports = { ensureAuthenticated, ensureBusinessRole };