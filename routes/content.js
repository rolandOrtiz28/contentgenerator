const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const ObjectId = mongoose.Types.ObjectId;
const Content = require('../models/Content');
const Business = require('../models/Business');
const User = require('../models/User');
const Image = require('../models/Image');
const Comment = require('../models/Comment');
const { ensureAuthenticated } = require('../middleware/auth');
const { ensureBusinessRole } = require('../middleware/businessAccess');
const { sendEmail } = require('../utils/email');
const { jsPDF } = require('jspdf'); // For generating PDFs (we'll use docx instead for Word)
const { Document, Packer, Paragraph, TextRun, HeadingLevel } = require('docx'); // For generating Word documents

// Get analytics data for the user's content
// Get all content within a date range (for ContentCalendar)
router.get('/', ensureAuthenticated, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const userId = req.user._id;

    const user = await User.findById(userId).populate('businesses');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const query = {
      $or: [
        { userId },
        { businessId: { $in: user.businesses.map(b => b._id) } },
      ],
    };

    if (startDate && endDate) {
      query.createdAt = { $gte: new Date(startDate), $lte: new Date(endDate) };
    }

    const content = await Content.find(query)
      .populate('businessId', 'companyName')
      .populate('userId', 'email name image')
      .populate('assignee', 'name image') // Ensure assignee is populated
      .exec();

    res.status(200).json({ content });
  } catch (error) {
    console.error('Error in GET /api/content:', error);
    res.status(404).json({ error: 'Not Found', details: error.message });
  }
});

router.get('/id/:contentId', ensureAuthenticated, async (req, res) => {
  try {
    const { contentId } = req.params;
    const userId = req.user._id;

    console.log("Fetching content by ID:", { contentId, userId });

    if (!contentId || contentId === 'undefined') {
      return res.status(400).json({ error: 'Invalid content ID' });
    }

    if (!mongoose.isValidObjectId(contentId)) {
      return res.status(400).json({ error: 'Invalid content ID format' });
    }

    const content = await Content.findById(contentId)
      .populate('businessId', 'companyName')
      .populate('userId', 'email name image')
      .populate('assignee', 'name image') // Ensure assignee is populated
      .exec();

    if (!content) {
      return res.status(404).json({ error: 'Content not found' });
    }

    const user = await User.findById(userId).populate('businesses').exec();
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const contentBusinessId = content.businessId?._id?.toString?.() || content.businessId?.toString();
    const hasAccess =
      content.userId.toString() === userId.toString() ||
      user.businesses.some((b) => b._id.toString() === contentBusinessId);

    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have access to this content' });
    }

    res.json({ content });
  } catch (error) {
    console.error('Error in GET /api/content/id/:contentId:', error);
    res.status(500).json({ error: 'Failed to fetch content', details: error.message });
  }
});


router.get('/analytics', ensureAuthenticated, async (req, res) => {
  try {
    const userId = req.user._id;
    const { startDate, endDate, businessId } = req.query;

    const user = await User.findById(userId).populate('businesses');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const query = {
      $or: [
        { userId: userId },
        { businessId: { $in: user.businesses.map(b => b._id) } },
      ],
    };

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

    const content = await Content.find(query);

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

    const scheduledContent = await Content.find({
      ...query,
      status: 'Scheduled',
    }).countDocuments();

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

    const user = await User.findById(userId).populate('businesses');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const query = {
      $or: [
        { userId: userId },
        { businessId: { $in: user.businesses.map(b => b._id) } },
      ],
      status: 'Scheduled',
      scheduledDate: { $exists: true },
    };

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

    const scheduledContent = await Content.find(query)
      .sort({ scheduledDate: 1 })
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
    const { type, status, businessId } = req.query;

    const user = await User.findById(userId).populate('businesses');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const query = {
      $or: [
        { userId: userId },
        { businessId: { $in: user.businesses.map(b => b._id) } },
      ],
    };

    if (type) {
      query.type = type;
    }
    if (status) {
      query.status = status;
    }
    if (businessId) {
      const hasAccess = user.businesses.some(b => b._id.toString() === businessId);
      if (!hasAccess) {
        return res.status(403).json({ error: 'You do not have access to this business' });
      }
      query.businessId = businessId;
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const content = await Content.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('businessId', 'companyName')
      .populate('userId', 'email name image')
      .populate('assignee', 'name image')

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
router.get('/id/:contentId', ensureAuthenticated, async (req, res) => {
  try {
    const { contentId } = req.params;
    const userId = req.user._id;

    console.log("Fetching content by ID:", { contentId, userId });
    if (!contentId || contentId === 'undefined') {
      return res.status(400).json({ error: 'Invalid content ID' });
    }

    if (!mongoose.isValidObjectId(contentId)) {
      return res.status(400).json({ error: 'Invalid content ID format' });
    }

    const content = await Content.findById(contentId)
      .populate('businessId', 'companyName')
      .populate('userId', 'email name image')
      .exec();

    if (!content) {
      return res.status(404).json({ error: 'Content not found' });
    }

    const user = await User.findById(userId).populate('businesses').exec();
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const contentBusinessId = content.businessId?._id?.toString?.() || content.businessId?.toString();

    const hasAccess =
      content.userId.toString() === userId.toString() ||
      user.businesses.some((b) => b._id.toString() === contentBusinessId);

    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have access to this content' });
    }

    res.json({ content });
  } catch (error) {
    console.error('Error in GET /api/content/id/:contentId:', error);
    res.status(500).json({ error: 'Failed to fetch content', details: error.message });
  }
});

// Copy content
router.post('/copy/:contentId', ensureAuthenticated, async (req, res) => {
  try {
    const { contentId } = req.params;
    const userId = req.user._id;

    if (!contentId || contentId === 'undefined') {
      return res.status(400).json({ error: 'Invalid content ID' });
    }

    if (!mongoose.isValidObjectId(contentId)) {
      return res.status(400).json({ error: 'Invalid content ID format' });
    }

    const originalContent = await Content.findById(contentId)
      .populate('businessId', 'companyName')
      .populate('userId', 'email name')
      .exec();

    if (!originalContent) {
      return res.status(404).json({ error: 'Content not found' });
    }

    const user = await User.findById(userId).populate('businesses').exec();
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const contentBusinessId = originalContent.businessId?._id?.toString?.() || originalContent.businessId?.toString();
    const hasAccess =
      originalContent.userId.toString() === userId.toString() ||
      user.businesses.some((b) => b._id.toString() === contentBusinessId);

    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have access to this content' });
    }

    // Create a new content document with the same data, but exclude business details
    const newContent = new Content({
      type: originalContent.type,
      businessId: originalContent.businessId, // Keep the same businessId
      userId: userId,
      data: { ...originalContent.data }, // Copy the content data (e.g., title, sections, etc.)
      status: 'Draft', // Set as draft
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await newContent.save();

    // Add to user's personalContent
    await User.findByIdAndUpdate(userId, {
      $push: { personalContent: newContent._id },
    });

    // Add to business's contentHistory if applicable
    if (newContent.businessId) {
      await Business.findByIdAndUpdate(newContent.businessId, {
        $push: { contentHistory: newContent._id },
      });
    }

    res.status(201).json({ message: 'Content copied successfully', content: newContent });
  } catch (error) {
    console.error('Error in POST /api/content/copy/:contentId:', error);
    res.status(500).json({ error: 'Failed to copy content', details: error.message });
  }
});


// Inside content.js, within the downloadContent route
router.get('/download/:contentId', ensureAuthenticated, async (req, res) => {
  try {
    const { contentId } = req.params;
    const userId = req.user._id;

    if (!contentId || contentId === 'undefined') {
      return res.status(400).json({ error: 'Invalid content ID' });
    }

    if (!mongoose.isValidObjectId(contentId)) {
      return res.status(400).json({ error: 'Invalid content ID format' });
    }

    const content = await Content.findById(contentId)
      .populate('businessId', 'companyName')
      .populate('userId', 'email name')
      .exec();

    if (!content) {
      return res.status(404).json({ error: 'Content not found' });
    }

    const user = await User.findById(userId).populate('businesses').exec();
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const contentBusinessId = content.businessId?._id?.toString?.() || content.businessId?.toString();
    const hasAccess =
      content.userId.toString() === userId.toString() ||
      user.businesses.some((b) => b._id.toString() === contentBusinessId);

    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have access to this content' });
    }

    // Array to hold all paragraphs for a single section
    const documentChildren = [];

    // Helper function to add a paragraph with spacing
    const addParagraph = (text, options = {}) => {
      return new Paragraph({
        text: text || '',
        heading: options.heading,
        bullet: options.bullet,
        spacing: { after: options.spacingAfter || 200 },
        children: options.children || [],
      });
    };

    // Add content based on type
    if (content.type === 'Article') {
      // Add Title (H1)
      documentChildren.push(
        addParagraph(content.data.title || 'Untitled', { heading: HeadingLevel.HEADING_1, spacingAfter: 400 })
      );
      
      // Add Slug / Proposed URL
      if (content.data.proposedUrl) {
        documentChildren.push(
          addParagraph('Proposed URL', { heading: HeadingLevel.HEADING_2 }),
          addParagraph(content.data.proposedUrl)
        );
      }

      // Add Meta Description
      if (content.data.metaDescription) {
        documentChildren.push(
          addParagraph('Meta Description', { heading: HeadingLevel.HEADING_2 }),
          addParagraph(content.data.metaDescription)
        );
      }

      // Add Introduction
      if (content.data.introduction) {
        documentChildren.push(
          addParagraph('Introduction', { heading: HeadingLevel.HEADING_2 }),
          addParagraph(content.data.introduction)
        );
      }

      // Add Sections
      if (content.data.sections && content.data.sections.length > 0) {
        content.data.sections.forEach((section) => {
          documentChildren.push(
            addParagraph(section.heading, { heading: HeadingLevel.HEADING_2 })
          );

          section.subheadings.forEach((subheading, subIndex) => {
            documentChildren.push(
              addParagraph(subheading, { heading: HeadingLevel.HEADING_3 }),
              addParagraph(section.content[subIndex])
            );
          });
        });
      }

      // Add Key Takeaways
      if (content.data.keyTakeaways && content.data.keyTakeaways.length > 0) {
        documentChildren.push(
          addParagraph('Key Takeaways', { heading: HeadingLevel.HEADING_2 })
        );

        content.data.keyTakeaways.forEach((takeaway) => {
          documentChildren.push(
            addParagraph(takeaway, { bullet: { level: 0 }, spacingAfter: 100 })
          );
        });
      }

      // Add FAQs
      if (content.data.faqs && content.data.faqs.length > 0) {
        documentChildren.push(
          addParagraph('FAQs', { heading: HeadingLevel.HEADING_2 })
        );

        content.data.faqs.forEach((faq) => {
          documentChildren.push(
            addParagraph(faq.question, { heading: HeadingLevel.HEADING_3 }),
            addParagraph(faq.answer)
          );
        });
      }

      // Add Conclusion
      if (content.data.conclusion) {
        documentChildren.push(
          addParagraph('Conclusion', { heading: HeadingLevel.HEADING_2 }),
          addParagraph(content.data.conclusion)
        );
      }

      if (content.data.internalLinks?.length) {
        documentChildren.push(
          addParagraph('Internal Links', { heading: HeadingLevel.HEADING_2 })
        );
        content.data.internalLinks.forEach(link => {
          documentChildren.push(addParagraph(link, { bullet: { level: 0 } }));
        });
      }
    
      // Schema Markup
      if (content.data.schemaMarkup) {
        documentChildren.push(
          addParagraph('Schema Markup', { heading: HeadingLevel.HEADING_2 }),
          addParagraph(content.data.schemaMarkup)
        );
      }

      if (content.data.images?.length) {
        documentChildren.push(
          addParagraph('Images', { heading: HeadingLevel.HEADING_2 })
        );
        content.data.images.forEach((img, i) => {
          documentChildren.push(
            addParagraph(`Image ${i + 1}: ${img.url}`),
            addParagraph(`Alt Text: ${img.altText || 'N/A'}`)
          );
        });
      }
    } else if (content.type === 'SocialMedia') {
      // Add Caption (H1)
      documentChildren.push(
        addParagraph(content.data.caption || 'Untitled', { heading: HeadingLevel.HEADING_1, spacingAfter: 400 })
      );

      // Add Hashtags
      if (content.data.hashtags && content.data.hashtags.length > 0) {
        documentChildren.push(
          addParagraph('Hashtags', { heading: HeadingLevel.HEADING_2 }),
          addParagraph(content.data.hashtags.join(' '))
        );
      }

      // Add Main Content
      if (content.data.mainContent) {
        documentChildren.push(
          addParagraph('Main Content', { heading: HeadingLevel.HEADING_2 }),
          addParagraph(content.data.mainContent)
        );
      }

      // Add Call to Action
      if (content.data.cta) {
        documentChildren.push(
          addParagraph('Call to Action', { heading: HeadingLevel.HEADING_2 }),
          addParagraph(content.data.cta)
        );
      }

      // Add Text on Poster
      if (content.data.posterText) {
        documentChildren.push(
          addParagraph('Text on Poster', { heading: HeadingLevel.HEADING_2 }),
          addParagraph(content.data.posterText)
        );
      }

      // Add Video Concept
      if (content.data.videoConcept) {
        documentChildren.push(
          addParagraph('Video Concept', { heading: HeadingLevel.HEADING_2 }),
          addParagraph(content.data.videoConcept)
        );
      }

      // Add Video Script
      if (content.data.script && content.data.script.length > 0) {
        documentChildren.push(
          addParagraph('Video Script', { heading: HeadingLevel.HEADING_2 })
        );

        content.data.script.forEach((scene) => {
          documentChildren.push(
            addParagraph(scene.timestamp, { heading: HeadingLevel.HEADING_3 }),
            addParagraph(scene.sceneDescription, { spacingAfter: 100 }),
            addParagraph(`Assets: ${scene.assetsToUse}`, { spacingAfter: 100 }),
            addParagraph(`Animation: ${scene.animationStyle}`)
          );
        });
      }
    }

    // Create the document with a single section containing all children
    const doc = new Document({
      sections: [
        {
          properties: {},
          children: documentChildren,
        },
      ],
    });

    // Generate the Word document
    const buffer = await Packer.toBuffer(doc);
    res.setHeader('Content-Disposition', `attachment; filename=Content_${contentId}.docx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.send(buffer);
  } catch (error) {
    console.error('Error in GET /api/content/download/:contentId:', error);
    res.status(500).json({ error: 'Failed to download content', details: error.message });
  }
});

// Update content (e.g., status, scheduled date, data)
router.put('/:contentId', ensureAuthenticated, async (req, res) => {
  const { contentId } = req.params;
  const userId = req.user._id;
  const { status, scheduledDate, data, assignee, reminderNotes } = req.body;

  if (status && !['Draft', 'Published', 'Scheduled', 'Archived'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  try {
    const content = await Content.findById(contentId);
    if (!content) return res.status(404).json({ error: 'Content not found' });

    const user = await User.findById(userId).populate('businesses');
    if (!user) return res.status(404).json({ error: 'User not found' });

    const isOwner = content.userId.toString() === userId.toString();
    const isBusinessContent = !!content.businessId;
    let isBusinessMember = false;

    if (isBusinessContent) {
      const business = await Business.findById(content.businessId);
      if (!business) return res.status(404).json({ error: 'Business not found' });

      isBusinessMember =
        business.owner.toString() === userId.toString() ||
        business.members.some(m => m.user.toString() === userId.toString());

      if (!isBusinessMember) {
        return res.status(403).json({ error: 'You do not have access to this business content' });
      }

      // Validate and update multiple assignees
      if (req.body.hasOwnProperty('assignee')) {
        const assignees = Array.isArray(assignee) ? assignee : assignee ? [assignee] : [];
      
        const validAssignees = assignees.every(id =>
          business.owner.toString() === id ||
          business.members.some(m => m.user.toString() === id)
        );
      
        if (!validAssignees) {
          return res.status(400).json({ error: 'All assignees must be members of the business' });
        }
      
        const previousAssignees = content.assignee || [];
        content.assignee = assignees;
      
        // Email notifications only for new ones
        const newAssignees = assignees.filter(id => !previousAssignees.includes(id));
        if (newAssignees.length > 0) {
          const usersToNotify = await User.find({ _id: { $in: newAssignees } });
          for (const assigneeUser of usersToNotify) {
            const subject = `Assigned to Content: ${content.data.title || content.data.caption || 'Untitled'}`;
            const plainText = `Hello ${assigneeUser.name},\n\nYou have been assigned to "${content.data.title || content.data.caption || 'Untitled'}" by ${user.name}.\n\nBest regards,\nTeam`;
            const html = `<p>Hello ${assigneeUser.name},</p><p>You have been assigned to "<strong>${content.data.title || content.data.caption || 'Untitled'}</strong>" by <strong>${user.name}</strong>.</p>`;
            await sendEmail(assigneeUser.email, subject, plainText, html);
          }
        }
      }
      
    } else if (!isOwner) {
      return res.status(403).json({ error: 'You do not have access to this personal content' });
    }

    if (status) content.status = status;
    if (scheduledDate) content.scheduledDate = new Date(scheduledDate);
    if (data) content.data = { ...content.data, ...data };
    if (reminderNotes !== undefined) content.reminderNotes = reminderNotes;

    await content.save();
    res.json({ message: 'Content updated successfully', content });
  } catch (error) {
    console.error("Error updating content:", error);
    res.status(500).json({ error: 'Failed to update content', details: error.message });
  }
});


router.get('/:businessId/members', ensureAuthenticated, async (req, res) => {
  const { businessId } = req.params;
  const userId = req.user._id;

  try {
    const business = await Business.findById(businessId);
    if (!business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    const user = await User.findById(userId).populate('businesses');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const hasAccess = user.businesses.some(b => b._id.toString() === businessId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have access to this business' });
    }

    // Fetch all members, including the owner
    const memberIds = business.members.map(m => m.user).concat(business.owner);
    const members = await User.find({ _id: { $in: memberIds } }).select('name image');
    res.json({ members });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch members', details: error.message });
  }
});

// Delete content
router.delete('/:contentId', ensureAuthenticated, async (req, res) => {
  const { contentId } = req.params;
  const userId = req.user._id;

  try {
    const content = await Content.findById(contentId);
    if (!content) {
      return res.status(404).json({ error: 'Content not found' });
    }

    const user = await User.findById(userId).populate('businesses');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if the content belongs to a business the user is a member of
    const hasAccess = user.businesses.some(b => b._id.toString() === content.businessId?.toString());
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have access to this content' });
    }

    if (content.businessId) {
      await Business.findByIdAndUpdate(content.businessId, {
        $pull: { contentHistory: contentId },
      });
    }

    await User.findByIdAndUpdate(userId, {
      $pull: { personalContent: contentId },
    });

    await Content.deleteOne({ _id: contentId });

    res.json({ message: 'Content deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete content', details: error.message });
  }
});

router.post('/:contentId/comment', ensureAuthenticated, async (req, res) => {
  
  const { contentId } = req.params;
  const userId = req.user._id;
  const { text, imageUrl } = req.body;

  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Comment text is required' });
  }

  const trimmedText = text.trim();

  try {
    const content = await Content.findById(contentId);
    if (!content) {
      console.log("Content not found for contentId:", contentId);
      return res.status(404).json({ error: 'Content not found' });
    }
    

    const user = await User.findById(userId).populate('businesses');
    if (!user) {
      console.log("User not found for userId:", userId);
      return res.status(404).json({ error: 'User not found' });
    }

    const hasAccess = content.userId.toString() === userId.toString() || 
      user.businesses.some(b => b._id.toString() === content.businessId?.toString());
    if (!hasAccess) {
      console.log("Access denied for userId:", userId, "on contentId:", contentId);
      return res.status(403).json({ error: 'You do not have access to this content' });
    }

    if (content.businessId) {
      const business = await Business.findById(content.businessId);
      if (business) {
        const isOwner = business.owner.toString() === userId.toString();
        const member = business.members.find(m => m.user.toString() === userId.toString());
        if (!isOwner && !member) {
          return res.status(403).json({ error: 'You do not have permission to comment on this content' });
        }
      }
    }

    const comment = new Comment({
      contentId,
      userId,
      text: trimmedText,
      ...(imageUrl && typeof imageUrl === 'string' && { imageUrl }),
    });

    await comment.save();
    const populatedComment = await Comment.findById(comment._id).populate('userId', 'email name image');
   

    // Optional: Send email notifications
    if (content.businessId) {
      const business = await Business.findById(content.businessId);
      if (business) {
        const membersToNotify = business.members.filter(m => m.user.toString() !== userId.toString());
        const ownerId = business.owner.toString();
        if (ownerId !== userId.toString()) {
          membersToNotify.push({ user: business.owner });
        }

        const usersToNotify = await User.find({ _id: { $in: membersToNotify.map(m => m.user) } });
        for (const member of usersToNotify) {
          const subject = `New Comment on Content in ${business.companyName}`;
          const plainText = `Hello ${member.name},\n\n${user.name} added a new comment to a piece of content in ${business.companyName}:\n\n"${trimmedText}"\n\nLog in to view the content and reply.\n\nBest regards,\nNew Test Business Team`;
          const html = `
            <h2>Hello ${member.name},</h2>
            <p><strong>${user.name}</strong> added a new comment to a piece of content in <strong>${business.companyName}</strong>:</p>
            <blockquote>${trimmedText}</blockquote>
            <p>Log in to view the content and reply.</p>
            <p>Best regards,<br>New Test Business Team</p>
          `;
          await sendEmail(member.email, subject, plainText, html);
        }
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
  console.log("GET /api/content/:contentId/comments hit with contentId:", req.params.contentId);
  const { contentId } = req.params;
  const userId = req.user._id;

  try {
    const content = await Content.findById(contentId);
    if (!content) {
      console.log("Content not found for contentId:", contentId);
      return res.status(404).json({ error: 'Content not found' });
    }
 

    const user = await User.findById(userId).populate('businesses');
    if (!user) {
      console.log("User not found for userId:", userId);
      return res.status(404).json({ error: 'User not found' });
    }

    const hasAccess = content.userId.toString() === userId.toString() || 
      user.businesses.some(b => b._id.toString() === content.businessId?.toString());

    if (!hasAccess) {
      console.log("Access denied for userId:", userId, "on contentId:", contentId);
      return res.status(403).json({ error: 'You do not have access to this content' });
    }

    if (content.businessId) {
      const business = await Business.findById(content.businessId);
      if (business) { // Only check permissions if business exists
        const isOwner = business.owner.toString() === userId.toString();
        const member = business.members.find(m => m.user.toString() === userId.toString());

        if (!isOwner && !member) {
          console.log("Permission denied for userId:", userId, "on businessId:", content.businessId);
          return res.status(403).json({ error: 'You do not have permission to view comments on this content' });
        }
      } else {
        console.log("Business not found for businessId:", content.businessId, "proceeding as personal content");
      }
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const comments = await Comment.find({ contentId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('userId', 'email name image');


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

router.put('/:contentId/comments/:commentId', ensureAuthenticated, async (req, res) => {
  const { contentId, commentId } = req.params;
  const userId = req.user._id;

  const text = typeof req.body.text === 'string' ? req.body.text.trim() : '';
  const imageUrl = req.body.hasOwnProperty('imageUrl') ? req.body.imageUrl : undefined;

  if (!text && imageUrl === undefined) {
    return res.status(400).json({ error: 'Comment must have text or image' });
  }

  try {
    const comment = await Comment.findOne({ _id: commentId, contentId });
    if (!comment) return res.status(404).json({ error: 'Comment not found' });

    if (comment.userId.toString() !== userId.toString()) {
      return res.status(403).json({ error: 'Unauthorized to edit this comment' });
    }

    if (text) comment.text = text;
    if (imageUrl === null) comment.imageUrl = undefined; // Clear image
    else if (typeof imageUrl === 'string') comment.imageUrl = imageUrl;

    await comment.save();

    const updatedComment = await Comment.findById(comment._id).populate('userId', 'email name image');
    res.json({ message: 'Comment updated', comment: updatedComment });
  } catch (error) {
    console.error('Error updating comment:', error);
    res.status(500).json({ error: 'Failed to update comment', details: error.message });
  }
});


router.delete('/:contentId/comments/:commentId', ensureAuthenticated, async (req, res) => {
  const { contentId, commentId } = req.params;
  const userId = req.user._id;

  try {
    const comment = await Comment.findOne({ _id: commentId, contentId });
    if (!comment) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    if (comment.userId.toString() !== userId.toString()) {
      return res.status(403).json({ error: 'Unauthorized to delete this comment' });
    }

    await Comment.deleteOne({ _id: commentId });
    res.json({ message: 'Comment deleted successfully' });
  } catch (error) {
    console.error('Error deleting comment:', error);
    res.status(500).json({ error: 'Failed to delete comment', details: error.message });
  }
});

// Update Content with Selected Image (for social media posts)
router.patch("/select-image/:contentId", ensureAuthenticated, async (req, res) => {
  try {
    const { imageId } = req.body;

    if (!imageId) {
      return res.status(400).json({ error: "No image ID provided" });
    }

    if (!mongoose.Types.ObjectId.isValid(imageId)) {
      return res.status(400).json({ error: "Invalid image ID" });
    }

    const image = await Image.findById(imageId);
    if (!image) {
      return res.status(404).json({ error: "Image not found" });
    }

    const content = await Content.findById(req.params.contentId);
    if (!content) {
      return res.status(404).json({ error: "Content not found" });
    }

    if (content.businessId.toString() !== req.session.businessId) {
      return res.status(403).json({ error: "Unauthorized to update this content" });
    }

    content.data.imageUrl = image.url;
    content.markModified('data');
    await content.save();

    res.status(200).json({ content });
  } catch (err) {
    console.error("Error selecting image for social content:", err);
    res.status(500).json({ error: "Failed to update content with image" });
  }
});




router.patch("/select-images/:contentId", ensureAuthenticated, async (req, res) => {
  try {
    const { imageIds } = req.body;

    if (!imageIds || !Array.isArray(imageIds) || imageIds.length === 0) {
      return res.status(400).json({ error: "No image IDs provided" });
    }

    const invalidIds = imageIds.filter(id => !mongoose.Types.ObjectId.isValid(id));
    if (invalidIds.length > 0) {
      return res.status(400).json({ error: "One or more image IDs are invalid" });
    }

    const images = await Image.find({ _id: { $in: imageIds } });
    if (images.length !== imageIds.length) {
      return res.status(404).json({ error: "One or more images not found" });
    }

    const content = await Content.findById(req.params.contentId);
    if (!content) {
      return res.status(404).json({ error: "Content not found" });
    }

    if (content.businessId.toString() !== req.session.businessId) {
      return res.status(403).json({ error: "Unauthorized to update this content" });
    }

    content.data.images = images.map((img) => ({
      url: img.url,
      altText: img.label || "Article image"
    }));
    content.markModified('data');
    await content.save();

    // Update session data
    req.session.generatedContent = {
      ...req.session.generatedContent,
      images: content.data.images,
    };

    res.status(200).json({ content });
  } catch (err) {
    console.error("Error selecting images for article:", err);
    res.status(500).json({ error: "Failed to update content with images" });
  }
});


module.exports = router;