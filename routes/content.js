const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const ObjectId = mongoose.Types.ObjectId;
const Content = require('../models/Content');
const Business = require('../models/Business');
const User = require('../models/User');
const Comment = require('../models/Comment');
const { ensureAuthenticated, ensureBusinessRole } = require('../middleware/auth');
const { sendEmail } = require('../utils/email');

// Get analytics data for the user's content
router.get('/analytics', ensureAuthenticated, async (req, res) => {
  try {
    const userId = req.user._id;
    const { startDate, endDate, businessId } = req.query;

    // Fetch the user with their businesses
    const user = await User.findById(userId).populate('businesses');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Build the query for content
    const query = {
      $or: [
        { userId: userId }, // Personal content
        { businessId: { $in: user.businesses.map(b => b._id) } }, // Business content
      ],
    };

    // Apply filters if provided
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) {
        query.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        query.createdAt.$lte = new Date(endDate);
      }
    }
    if (businessId) {
      const hasAccess = user.businesses.some(b => b._id.toString() === businessId);
      if (!hasAccess) {
        return res.status(403).json({ error: 'You do not have access to this business' });
      }
      query.businessId = businessId;
    }

    // Fetch content for analytics
    const content = await Content.find(query);

    // Calculate analytics metrics
    const totalContent = content.length;
    const contentByType = {
      Article: content.filter(c => c.type === 'Article').length,
      SocialMedia: content.filter(c => c.type === 'SocialMedia').length,
      Leads: content.filter(c => c.type === 'Leads').length,
    };
    const contentByStatus = {
      Draft: content.filter(c => c.status === 'Draft').length,
      Published: content.filter(c => c.status === 'Published').length,
      Scheduled: content.filter(c => c.status === 'Scheduled').length,
      Archived: content.filter(c => c.status === 'Archived').length,
    };

    // Fetch scheduled content count separately
    const scheduledContent = await Content.find({
      ...query,
      status: 'Scheduled',
    }).countDocuments();

    // Fetch comments count
    const contentIds = content.map(c => c._id);
    const commentsCount = await Comment.countDocuments({ contentId: { $in: contentIds } });

    res.json({
      analytics: {
        totalContent,
        contentByType,
        contentByStatus,
        scheduledContent,
        commentsCount,
      },
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({ error: 'Failed to fetch analytics', details: error.message });
  }
});

// Get scheduled content for calendar view
router.get('/scheduled', ensureAuthenticated, async (req, res) => {
  try {
    const userId = req.user._id;
    const { startDate, endDate, businessId } = req.query;

    // Fetch the user with their businesses
    const user = await User.findById(userId).populate('businesses');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Build the query for scheduled content
    const query = {
      $or: [
        { userId: userId }, // Personal content
        { businessId: { $in: user.businesses.map(b => b._id) } }, // Business content
      ],
      status: 'Scheduled',
      scheduledDate: { $exists: true },
    };

    // Apply filters if provided
    if (startDate || endDate) {
      query.scheduledDate = {};
      if (startDate) {
        query.scheduledDate.$gte = new Date(startDate);
      }
      if (endDate) {
        query.scheduledDate.$lte = new Date(endDate);
      }
    }
    if (businessId) {
      const hasAccess = user.businesses.some(b => b._id.toString() === businessId);
      if (!hasAccess) {
        return res.status(403).json({ error: 'You do not have access to this business' });
      }
      query.businessId = businessId;
    }

    // Fetch scheduled content
    const scheduledContent = await Content.find(query)
      .sort({ scheduledDate: 1 }) // Sort by scheduled date, ascending
      .populate('businessId', 'companyName')
      .populate('userId', 'email name');

    res.json({ scheduledContent });
  } catch (error) {
    console.error('Error fetching scheduled content:', error);
    res.status(500).json({ error: 'Failed to fetch scheduled content', details: error.message });
  }
});

// Get content history (personal and business content)
router.get('/history', ensureAuthenticated, async (req, res) => {
  try {
    const userId = req.user._id;
    const { type, status, businessId } = req.query; // Optional query parameters for filtering

    // Fetch the user with their businesses
    const user = await User.findById(userId).populate('businesses');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Build the query for content
    const query = {
      $or: [
        { userId: userId }, // Personal content
        { businessId: { $in: user.businesses.map(b => b._id) } }, // Business content
      ],
    };

    // Apply filters if provided
    if (type) {
      query.type = type; // e.g., "Article", "SocialMedia"
    }
    if (status) {
      query.status = status; // e.g., "Draft", "Scheduled", "Published"
    }
    if (businessId) {
      // Ensure the user has access to the specified business
      const hasAccess = user.businesses.some(b => b._id.toString() === businessId);
      if (!hasAccess) {
        return res.status(403).json({ error: 'You do not have access to this business' });
      }
      query.businessId = businessId;
    }

    // Fetch content with pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const content = await Content.find(query)
      .sort({ createdAt: -1 }) // Sort by creation date, newest first
      .skip(skip)
      .limit(limit)
      .populate('businessId', 'companyName') // Populate business name
      .populate('userId', 'email name'); // Populate user details

    const totalContent = await Content.countDocuments(query);

    res.json({
      content,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalContent / limit),
        totalItems: totalContent,
        itemsPerPage: limit,
      },
    });
  } catch (error) {
    console.error('Error fetching content history:', error);
    res.status(500).json({ error: 'Failed to fetch content history', details: error.message });
  }
});

// Get all content for a business
router.get('/:businessId', ensureAuthenticated, async (req, res) => {
  const { businessId } = req.params;

  try {
    const business = await Business.findById(businessId);
    if (!business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    // Check if user is the owner or a member
    const isOwner = business.owner.toString() === req.user._id.toString();
    const isMember = business.members.some(
      (member) => member.user.toString() === req.user._id.toString()
    );
    if (!isOwner && !isMember) {
      return res.status(403).json({ error: 'Not authorized to view content for this business' });
    }

    const content = await Content.find({ businessId })
      .populate('userId', 'email name')
      .sort({ createdAt: -1 });
    res.json({ content });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch content', details: error.message });
  }
});

// Get content by ID
router.get('/:contentId', ensureAuthenticated, async (req, res) => {
  try {
    const { contentId } = req.params;
    const userId = req.user._id;

    console.log("Fetching content with ID:", contentId, "for user ID:", userId);

    // Validate contentId
    if (!contentId || contentId === 'undefined') {
      console.log("Invalid content ID provided");
      return res.status(400).json({ error: 'Invalid content ID' });
    }

    // Ensure contentId is a valid ObjectId
    if (!mongoose.isValidObjectId(contentId)) {
      console.log("Invalid ObjectId format for contentId:", contentId);
      return res.status(400).json({ error: 'Invalid content ID format' });
    }

    // Cast contentId to ObjectId
    const objectId = new ObjectId(contentId);
    console.log("Querying Content collection with ObjectId:", objectId.toString());

    // Log the database and collection being queried
    console.log("Database:", mongoose.connection.db.databaseName);
    console.log("Collection:", Content.collection.collectionName);

    // Fetch the content
    const content = await Content.findById(objectId)
      .populate('businessId', 'companyName')
      .populate('userId', 'email name')
      .exec();
    if (!content) {
      console.log("Content not found in database for ID:", contentId);
      return res.status(404).json({ error: 'Content not found' });
    }
    console.log("Content found:", content._id.toString(), "Type:", content.type);

    // Check if the user has access to the content
    const user = await User.findById(userId).populate('businesses').exec();
    if (!user) {
      console.log("User not found for ID:", userId);
      return res.status(404).json({ error: 'User not found' });
    }
    console.log("User found:", user._id.toString(), "Businesses:", user.businesses.map(b => b._id.toString()));

    const hasAccess = content.userId.toString() === userId.toString() || 
      (content.businessId && user.businesses.some(b => b._id.toString() === content.businessId.toString()));
    if (!hasAccess) {
      console.log("User does not have access to content. Content userId:", content.userId.toString(), "Content businessId:", content.businessId?.toString());
      return res.status(403).json({ error: 'You do not have access to this content' });
    }

    // If the content belongs to a business, check the user's role (any role can view)
    if (content.businessId) {
      const business = await Business.findById(content.businessId).exec();
      if (!business) {
        console.log("Business not found for ID:", content.businessId.toString());
        // Allow access if the user is the creator, even if the business is missing
        if (content.userId.toString() !== userId.toString()) {
          return res.status(403).json({ error: 'Business not found and you are not the creator of this content' });
        }
        console.log("Business not found, but user is the creator, allowing access");
      } else {
        console.log("Business found:", business._id.toString(), "Owner:", business.owner.toString(), "Members:", business.members.map(m => m.user.toString()));
        const isOwner = business.owner.toString() === userId.toString();
        const member = business.members.find(m => m.user.toString() === userId.toString());
        if (!isOwner && !member) {
          console.log("User is neither owner nor member of the business. Owner:", business.owner.toString(), "User ID:", userId.toString());
          return res.status(403).json({ error: 'You do not have permission to view this content' });
        }
      }
    }

    res.json({ content });
  } catch (error) {
    console.error('Error in GET /:contentId route:', error);
    res.status(500).json({ error: 'Failed to fetch content', details: error.message });
  }
});

// Update content (e.g., status, scheduled date)
router.put('/:contentId', ensureAuthenticated, ensureBusinessRole('Editor'), async (req, res) => {
  const { contentId } = req.params;
  const userId = req.user._id;
  const { status, scheduledDate } = req.body;

  // Validate status if provided
  if (status && !['Draft', 'Published', 'Scheduled', 'Archived'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  try {
    // Fetch the content
    const content = await Content.findById(contentId);
    if (!content) {
      return res.status(404).json({ error: 'Content not found' });
    }

    // Check if the user has access to the content
    const user = await User.findById(userId).populate('businesses');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const hasAccess = content.userId.toString() === userId.toString() || 
      user.businesses.some(b => b._id.toString() === content.businessId?.toString());
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have access to this content' });
    }

    // Update the content
    if (status) {
      content.status = status; // e.g., "Draft", "Scheduled", "Published", "Archived"
    }
    if (scheduledDate) {
      content.scheduledDate = new Date(scheduledDate);
    }

    await content.save();
    res.json({ message: 'Content updated successfully', content });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update content', details: error.message });
  }
});

// Delete content
router.delete('/:contentId', ensureAuthenticated, ensureBusinessRole('Editor'), async (req, res) => {
  const { contentId } = req.params;
  const userId = req.user._id;

  try {
    // Fetch the content
    const content = await Content.findById(contentId);
    if (!content) {
      return res.status(404).json({ error: 'Content not found' });
    }

    // Check if the user has access to the content
    const user = await User.findById(userId).populate('businesses');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const hasAccess = content.userId.toString() === userId.toString() || 
      user.businesses.some(b => b._id.toString() === content.businessId?.toString());
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have access to this content' });
    }

    // If the content belongs to a business, the ensureBusinessRole middleware already checked the user's role

    // Remove the content from the business's contentHistory if applicable
    if (content.businessId) {
      await Business.findByIdAndUpdate(content.businessId, {
        $pull: { contentHistory: contentId },
      });
    }

    // Remove the content from the user's personalContent
    await User.findByIdAndUpdate(userId, {
      $pull: { personalContent: contentId },
    });

    // Delete the content
    await Content.deleteOne({ _id: contentId });

    res.json({ message: 'Content deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete content', details: error.message });
  }
});

// Add a comment to a piece of content
router.post('/:contentId/comment', ensureAuthenticated, async (req, res) => {
  const { contentId } = req.params;
  const userId = req.user._id;
  const { text } = req.body;

  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'Comment text is required' });
  }

  try {
    // Fetch the content
    const content = await Content.findById(contentId);
    if (!content) {
      return res.status(404).json({ error: 'Content not found' });
    }

    // Check if the user has access to the content
    const user = await User.findById(userId).populate('businesses');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const hasAccess = content.userId.toString() === userId.toString() || 
      user.businesses.some(b => b._id.toString() === content.businessId?.toString());
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have access to this content' });
    }

    // If the content belongs to a business, check the user's role (any role can comment)
    let business = null;
    if (content.businessId) {
      business = await Business.findById(content.businessId);
      if (!business) {
        return res.status(404).json({ error: 'Business not found' });
      }

      const isOwner = business.owner.toString() === userId.toString();
      const member = business.members.find(m => m.user.toString() === userId.toString());
      if (!isOwner && !member) {
        return res.status(403).json({ error: 'You do not have permission to comment on this content' });
      }
    }

    // Create the comment
    const comment = new Comment({
      contentId,
      userId,
      text: text.trim(),
    });
    await comment.save();

    // Populate the user details for the response
    const populatedComment = await Comment.findById(comment._id).populate('userId', 'email name');

    // Send email notifications to business members (if applicable)
    if (business) {
      const membersToNotify = business.members.filter(m => m.user.toString() !== userId.toString());
      const ownerId = business.owner.toString();
      if (ownerId !== userId.toString()) {
        membersToNotify.push({ user: business.owner });
      }

      const usersToNotify = await User.find({ _id: { $in: membersToNotify.map(m => m.user) } });
      for (const member of usersToNotify) {
        const subject = `New Comment on Content in ${business.companyName}`;
        const text = `Hello ${member.name},\n\n${user.name} added a new comment to a piece of content in ${business.companyName}:\n\n"${text}"\n\nLog in to view the content and reply.\n\nBest regards,\nNew Test Business Team`;
        const html = `
          <h2>Hello ${member.name},</h2>
          <p><strong>${user.name}</strong> added a new comment to a piece of content in <strong>${business.companyName}</strong>:</p>
          <blockquote>${text}</blockquote>
          <p>Log in to view the content and reply.</p>
          <p>Best regards,<br>New Test Business Team</p>
        `;
        await sendEmail(member.email, subject, text, html);
      }
    }

    res.status(201).json({ message: 'Comment added successfully', comment: populatedComment });
  } catch (error) {
    console.error('Error adding comment:', error);
    res.status(500).json({ error: 'Failed to add comment', details: error.message });
  }
});

// View comments for a piece of content
router.get('/:contentId/comments', ensureAuthenticated, async (req, res) => {
  const { contentId } = req.params;
  const userId = req.user._id;

  try {
    // Fetch the content
    const content = await Content.findById(contentId);
    if (!content) {
      return res.status(404).json({ error: 'Content not found' });
    }

    // Check if the user has access to the content
    const user = await User.findById(userId).populate('businesses');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const hasAccess = content.userId.toString() === userId.toString() || 
      user.businesses.some(b => b._id.toString() === content.businessId?.toString());
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have access to this content' });
    }

    // If the content belongs to a business, check the user's role (any role can view comments)
    if (content.businessId) {
      const business = await Business.findById(content.businessId);
      if (!business) {
        return res.status(404).json({ error: 'Business not found' });
      }

      const isOwner = business.owner.toString() === userId.toString();
      const member = business.members.find(m => m.user.toString() === userId.toString());
      if (!isOwner && !member) {
        return res.status(403).json({ error: 'You do not have permission to view comments on this content' });
      }
    }

    // Fetch comments with pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const comments = await Comment.find({ contentId })
      .sort({ createdAt: -1 }) // Sort by creation date, newest first
      .skip(skip)
      .limit(limit)
      .populate('userId', 'email name'); // Populate user details

    const totalComments = await Comment.countDocuments({ contentId });

    res.json({
      comments,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalComments / limit),
        totalItems: totalComments,
        itemsPerPage: limit,
      },
    });
  } catch (error) {
    console.error('Error fetching comments:', error);
    res.status(500).json({ error: 'Failed to fetch comments', details: error.message });
  }
});

module.exports = router;