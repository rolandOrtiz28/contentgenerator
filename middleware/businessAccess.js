const Business = require('../models/Business');
const Content = require('../models/Content');

// Basic access check: is the user an owner or member?
const hasBusinessAccess = async (req, res, next) => {
  const businessId = req.params.businessId || req.body.businessId;

  console.log('[Access Check] Business ID:', businessId);
  console.log('[Access Check] User ID:', req.user?._id);

  // 1. Validate ID format
  if (!mongoose.Types.ObjectId.isValid(businessId)) {
    return res.status(400).json({ error: 'Invalid business ID format' });
  }

  try {
    // 2. Fetch business with owner and members populated
    const business = await Business.findById(businessId)
      .populate('owner', 'email name')
      .populate('members.user', 'email name image');

    if (!business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    // 3. Defensive check on owner
    const ownerId = business?.owner?._id?.toString();
    const currentUserId = req.user?._id?.toString();

    const isOwner = ownerId === currentUserId;

    // 4. Check if current user is in members list
    const isMember = business.members?.some((member) => {
      const memberId = member?.user?._id?.toString();
      return memberId === currentUserId;
    });

    if (!isOwner && !isMember) {
      return res.status(403).json({ error: 'You do not have access to this business' });
    }

    // 5. Attach data to request object
    req.business = business;
    req.isOwner = isOwner;
    req.isMember = isMember;

    next();
  } catch (error) {
    console.error('[Access Error] Failed to verify business access:', error);
    res.status(500).json({
      error: 'Internal server error while checking business access',
      details: error.message,
    });
  }
};
// Role-based check: is the user Admin/Editor/Viewer?
const ensureBusinessRole = (requiredRole) => {
  return async (req, res, next) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const userId = req.user._id;
    let businessId = req.params.businessId || req.session.businessId || req.body.businessId;

    if (req.params.contentId) {
      const content = await Content.findById(req.params.contentId);
      if (!content) {
        return res.status(404).json({ error: 'Content not found' });
      }
      businessId = content.businessId;
    }

    if (!businessId) {
      return res.status(400).json({ error: 'Business ID is required for this action' });
    }

    try {
      const business = await Business.findById(businessId);

      if (!business) {
        return res.status(404).json({ error: 'Business not found' });
      }

      const isOwner = business.owner?.toString() === userId.toString();
      if (isOwner) return next(); // Owners bypass role checks

      const member = business.members?.find(m => m.user?.toString() === userId.toString());
      if (!member) {
        return res.status(403).json({ error: 'You are not a member of this business' });
      }

      const roleHierarchy = {
        Viewer: 1,
        Editor: 2,
        Admin: 3,
      };

      const userRoleValue = roleHierarchy[member.role] || 0;
      const requiredRoleValue = roleHierarchy[requiredRole] || 0;

      if (userRoleValue < requiredRoleValue) {
        return res.status(403).json({
          error: `Insufficient permissions. Required: ${requiredRole}, Your role: ${member.role}`
        });
      }

      next();
    } catch (error) {
      console.error('Error in ensureBusinessRole middleware:', error);
      res.status(500).json({ error: 'Failed to check business role', details: error.message });
    }
  };
};

module.exports = {
  hasBusinessAccess,
  ensureBusinessRole
};
