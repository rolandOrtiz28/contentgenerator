const express = require('express');
const router = express.Router();
const Business = require('../models/Business');
const User = require('../models/User');
const { ensureAuthenticated } = require('../middleware/auth');
const mongoose = require("mongoose");
const axios = require('axios');
const { sendEmail } = require('../utils/email');
const NodeCache = require('node-cache');
const { storage } = require('../config/cloudinary'); // Your Cloudinary config
const multer = require('multer');
const upload = multer({ storage });
const { hasBusinessAccess, ensureBusinessRole } = require('../middleware/businessAccess');


const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:8080';

// Initialize in-memory cache with a TTL of 1 hour (3600 seconds)
const cache = new NodeCache({ stdTTL: 3600 });

// Initialize Perplexity API
const perplexityApi = axios.create({
  baseURL: 'https://api.perplexity.ai',
  headers: {
    'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`,
    'Content-Type': 'application/json',
  },
});

router.get('/extract-branding', ensureAuthenticated, async (req, res) => {
  const websiteURL = req.query.website;

  if (!websiteURL) {
    return res.status(400).json({
      error: 'Website URL is required.',
    });
  }

  try {
    // Check in-memory cache
    if (cache.has(websiteURL)) {
      const extractedBranding = cache.get(websiteURL);
      return res.json({
        ...extractedBranding,
        isRegistered: false,
      });
    }
    const prompt = `
      Analyze the website at ${websiteURL} and extract the following business details. If a detail is not available, use "N/A". Respond in a structured JSON format without markdown code fences:

      {
        "companyName": "Name of the company",
        "description": "A brief description of the company (50-100 words)",
        "services": "A comma-separated list of services offered by the company",
        "targetAudience": "The primary target audience of the company (e.g., e-commerce businesses, young professionals)",
        "demographic": "The demographic profile of the target audience (e.g., 25-34 years, urban professionals)",
        "address": "The physical address of the company",
        "email": "The contact email address of the company",
        "phoneNumber": "The contact phone number of the company",
        "brandTone": "The brand tone or voice of the company (e.g., professional, casual, friendly)",
        "hasWebsite": "Whether the company has a website (true/false)",
        "companyWebsite": "The URL of the company's website"
      }
    `;

    const response = await perplexityApi.post('/chat/completions', {
      model: 'sonar-pro',
      messages: [
        { role: 'system', content: 'Extract branding info from a website and respond in JSON format. Do not use markdown code fences.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 250,
      temperature: 0.5,
    });

    const perplexityResponse = response.data.choices[0].message.content.trim();
    // Remove markdown code fences if present
    const jsonString = perplexityResponse.replace(/^``````$/, '');

    let extractedData;
    try {
      extractedData = JSON.parse(jsonString);
    } catch (error) {
      console.error('Failed to parse JSON response:', error);
      extractedData = {
        companyName: 'Unknown Company',
        description: 'No description available.',
        services: 'No services found.',
        targetAudience: 'N/A',
        demographic: 'N/A',
        address: 'N/A',
        email: 'N/A',
        phoneNumber: 'N/A',
        brandTone: 'N/A',
        hasWebsite: true,
        companyWebsite: websiteURL,
      };
    }

    const {
      companyName,
      description,
      services,
      targetAudience,
      demographic,
      address,
      email,
      phoneNumber,
      brandTone,
      hasWebsite,
      companyWebsite,
    } = extractedData;

    // Cache the extracted data
    cache.set(websiteURL, {
      companyName,
      description,
      services,
      targetAudience,
      demographic,
      address,
      email,
      phoneNumber,
      brandTone,
      hasWebsite,
      companyWebsite,
      websiteURL,
    });

    return res.json({
      companyName,
      description,
      services,
      targetAudience,
      demographic,
      address,
      email,
      phoneNumber,
      brandTone,
      hasWebsite,
      companyWebsite,
      websiteURL,
      isRegistered: false,
    });
  } catch (error) {
    console.error('Error with Perplexity API:', error.response?.data || error.message);
    const urlFallback = new URL(websiteURL);
    const fallbackData = {
      companyName: urlFallback.hostname.replace('www.', '').split('.')[0] || 'Unknown Company',
      description: 'No description available due to extraction error.',
      services: 'No services found.',
      targetAudience: 'N/A',
      demographic: 'N/A',
      address: 'N/A',
      email: 'N/A',
      phoneNumber: 'N/A',
      brandTone: 'N/A',
      hasWebsite: true,
      companyWebsite: websiteURL,
      websiteURL,
    };

    return res.status(500).json({
      ...fallbackData,
      error: 'Failed to extract website data. Using fallback values.',
    });
  }
});

  // Get all businesses for the authenticated user
  router.get('/', ensureAuthenticated, async (req, res) => {
    try {
      const businesses = await Business.find({
        $or: [
          { owner: req.user._id },
          { 'members.user': req.user._id },
        ],
      }).populate('owner', 'email name').populate('members.user', 'email name');
      res.json({ businesses });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch businesses' });
    }
  });

// Get all businesses for the authenticated user
router.get('/:businessId', ensureAuthenticated, async (req, res) => {
  const { businessId } = req.params;

  // ✅ 1. Log the incoming params to inspect the ID
  console.log('🔍 GET /business/:businessId triggered');
  console.log('Params:', req.params); // Should show { businessId: '...' }
  console.log('User trying to access:', req.user?._id);

  // ✅ 2. Check if the businessId is valid
  if (!mongoose.Types.ObjectId.isValid(businessId)) {
    console.warn('⚠️ Invalid businessId format:', businessId);
    return res.status(400).json({ error: 'Invalid business ID' });
  }

  try {
    // ✅ 3. Fetch the business and log it
    const business = await Business.findById(businessId)
      .populate('owner', 'email name')
      .populate('members.user', 'email name image');

    if (!business) {
      console.warn('❌ Business not found:', businessId);
      return res.status(404).json({ error: 'Business not found' });
    }

    console.log('✅ Business fetched:', business._id);

    // ✅ 4. Check if business owner is corrupted/missing
    if (!business.owner || !business.owner._id) {
      console.error('💥 Business owner data is corrupted:', business.owner);
      return res.status(500).json({ error: 'Business owner data is corrupted or missing' });
    }

    // ✅ 5. Ownership + Membership check
    const isOwner = business.owner._id.toString() === req.user._id.toString();
    const isMember = business.members?.some(
      (member) => member?.user?._id?.toString() === req.user._id.toString()
    );

    console.log('🧠 Access check:', { isOwner, isMember });

    if (!isOwner && !isMember) {
      console.warn('🚫 Unauthorized access attempt by:', req.user._id);
      return res.status(403).json({ error: 'Not authorized to view this business' });
    }

    res.json({ business, currentUserId: req.user._id.toString() });
  } catch (error) {
    // ✅ 6. Catch block must always log errors clearly
    console.error('❌ Error fetching business:', error);
    res.status(500).json({ error: 'Failed to fetch business', details: error.message });
  }
});


// Add a new business
router.post('/', ensureAuthenticated, upload.single('image'), async (req, res) => {
  const {
    companyName, description, services, targetAudience, demographic, address,
    email, phoneNumber, brandTone, hasWebsite, companyWebsite
  } = req.body;

  if (!companyName || !description || !services || !targetAudience) {
    return res.status(400).json({ error: 'Required fields are missing' });
  }

  try {
    const newBusiness = new Business({
      companyName,
      description,
      services,
      targetAudience,
      demographic: demographic || '',
      address: address || '',
      email: email || '',
      phoneNumber: phoneNumber || '',
      brandTone: brandTone || '',
      hasWebsite: hasWebsite ?? true,
      companyWebsite: companyWebsite || '',
      image: req.file?.path || null,
      owner: req.user._id,
      members: [{ user: req.user._id, role: 'Admin' }],
    });

    await newBusiness.save();

    await User.findByIdAndUpdate(req.user._id, {
      $push: { businesses: newBusiness._id },
    });

    req.session.businessId = newBusiness._id;

    res.status(201).json({ business: newBusiness });
  } catch (error) {
    console.error('Error creating business:', error);
    res.status(500).json({ error: 'Failed to create business', details: error.message });
  }
});


// Display business
router.get('/:businessId', ensureAuthenticated, hasBusinessAccess, (req, res) => {
  try {
    const business = req.business;

    res.json({
      business: {
        ...business.toObject(),
        members: business.members?.filter((m) => m?.user),
      },
      currentUserId: req.user._id.toString(),
    });
  } catch (error) {
    console.error('Error in GET /business/:businessId:', error);
    res.status(500).json({ error: 'Failed to fetch business', details: error.message });
  }
});



// Update a business
router.put('/:businessId', ensureAuthenticated, ensureBusinessRole('Admin'), hasBusinessAccess, upload.single('image'), async (req, res) => {
  const { businessId } = req.params;
  const updateFields = [
    'companyName', 'description', 'services', 'targetAudience', 'demographic',
    'address', 'email', 'phoneNumber', 'brandTone', 'hasWebsite', 'companyWebsite'
  ];

  try {
    const business = req.business;

    updateFields.forEach((field) => {
      if (req.body[field]) business[field] = req.body[field];
    });

    if (req.file) {
      business.image = req.file.path;
    }

    await business.save();
    res.json({ business });
  } catch (error) {
    console.error('Error updating business:', error);
    res.status(500).json({ error: 'Failed to update business', details: error.message });
  }
});


// Delete a business
router.delete('/:businessId', ensureAuthenticated, ensureBusinessRole('Admin'), hasBusinessAccess, async (req, res) => {
  const { businessId } = req.params;

  try {
    const business = req.business;
    if (business.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Only the owner can delete this business' });
    }

    await Business.deleteOne({ _id: businessId });
    await User.findByIdAndUpdate(req.user._id, {
      $pull: { businesses: businessId },
    });

    res.json({ message: 'Business deleted successfully' });
  } catch (error) {
    console.error('Error deleting business:', error);
    res.status(500).json({ error: 'Failed to delete business', details: error.message });
  }
});


// Invite a member to a business
router.post('/:businessId/invite', ensureAuthenticated, ensureBusinessRole('Admin'), hasBusinessAccess, async (req, res) => {
  const { email, role } = req.body;
  const business = req.business;
  const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:8080';

  if (
    !email ||
    !role ||
    !['Admin', 'Editor', 'Viewer'].includes(role) ||
    !email.includes('@')
  ) {
    return res.status(400).json({ error: 'Email and valid role are required' });
  }

  try {
    const userToInvite = await User.findOne({ email: email.toLowerCase() });

    if (userToInvite) {
      const isAlreadyMember = business.members?.some(
        (member) => member?.user?.toString() === userToInvite._id.toString()
      );

      if (isAlreadyMember) {
        return res.status(400).json({ error: 'User is already a member of this business' });
      }

      business.members.push({ user: userToInvite._id, role });
      await business.save();

      await User.findByIdAndUpdate(userToInvite._id, {
        $addToSet: { businesses: business._id },
      });

      const subject = `You're Invited to Join ${business.companyName} on EditEdge Multimedia`;
      const text = `Hello ${userToInvite.name},\n\nYou have been invited to join ${business.companyName} as an ${role} on EditEdge Multimedia. Log in here: ${FRONTEND_URL}/login\n\nBest regards,\nThe EditEdge Multimedia Team`;

      const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>You're Invited to Join ${business.companyName}</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f4f4f4; padding: 20px;">
          <tr>
            <td align="center">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; background-color: #ffffff; border: 1px solid #e0e0e0; border-radius: 8px;">
                <tr>
                  <td align="center" style="padding: 20px;">
                    <img src="https://res.cloudinary.com/dowyujl8h/image/upload/v1738490869/5_bbrzhk.png" alt="EditEdge Multimedia Logo" style="max-width: 150px; margin-bottom: 20px; display: block;" />
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding: 0 20px;">
                    <h2 style="color: #333333; font-size: 24px; margin: 0 0 20px;">You're Invited to Join ${business.companyName}</h2>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 0 20px 20px;">
                    <p style="color: #555555; font-size: 16px; line-height: 1.6; margin: 0 0 10px;">Hello ${userToInvite.name},</p>
                    <p style="color: #555555; font-size: 16px; line-height: 1.6; margin: 0 0 20px;">
                      You have been invited to join <strong>${business.companyName}</strong> as an <strong>${role}</strong> on EditEdge Multimedia, a platform for generating and managing content for your business.
                    </p>
                    <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 30px auto;">
                      <tr>
                        <td align="center" style="background-color: #303030; border-radius: 5px;">
                          <a href="${FRONTEND_URL}/login" style="display: inline-block; padding: 12px 24px; color: #ffffff; font-size: 16px; font-weight: bold; text-decoration: none;">Log In to Join</a>
                        </td>
                      </tr>
                    </table>
                    <p style="color: #555555; font-size: 16px; line-height: 1.6; margin: 0 0 10px;">
                      If you have any questions, feel free to reply to this email or contact our support team at <a href="mailto:support@editedgemultimedia.com" style="color: #303030; text-decoration: none;">support@editedgemultimedia.com</a>.
                    </p>
                    <p style="color: #555555; font-size: 16px; line-height: 1.6; margin: 0;">
                      Best regards,<br>The EditEdge Multimedia Team
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 20px; border-top: 1px solid #e0e0e0;">
                    <p style="color: #999999; font-size: 12px; text-align: center; margin: 0;">
                      © 2025 EditEdge Multimedia. All rights reserved.<br>
                      <a href="${FRONTEND_URL}/privacy" style="color: #303030; text-decoration: none;">Privacy Policy</a> | <a href="${FRONTEND_URL}/terms" style="color: #999999; text-decoration: none;">Terms of Service</a>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;

      await sendEmail(email, subject, text, html);
      return res.json({ message: 'Member invited successfully' });
    }

    // If user is not registered
    const registrationLink = `${FRONTEND_URL}/register?email=${encodeURIComponent(email)}&businessId=${business._id}&role=${role}`;
    const subject = `You're Invited to Join ${business.companyName} on EditEdge Multimedia`;
    const text = `Hello,\n\nYou have been invited to join ${business.companyName} as an ${role} on EditEdge Multimedia. Please register to join: ${registrationLink}\n\nBest regards,\nThe EditEdge Multimedia Team`;

    const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>You're Invited to Join ${business.companyName}</title>
        </head>
        <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f4f4f4; padding: 20px;">
            <tr>
              <td align="center">
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; background-color: #ffffff; border: 1px solid #e0e0e0; border-radius: 8px;">
                  <tr>
                    <td align="center" style="padding: 20px;">
                      <img src="https://res.cloudinary.com/dowyujl8h/image/upload/v1738490869/5_bbrzhk.png" alt="EditEdge Multimedia Logo" style="max-width: 150px; margin-bottom: 20px; display: block;" />
                    </td>
                  </tr>
                  <tr>
                    <td align="center" style="padding: 0 20px;">
                      <h2 style="color: #333333; font-size: 24px; margin: 0 0 20px;">You're Invited to Join ${business.companyName}</h2>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 0 20px 20px;">
                      <p style="color: #555555; font-size: 16px; line-height: 1.6; margin: 0 0 10px;">Hello,</p>
                      <p style="color: #555555; font-size: 16px; line-height: 1.6; margin: 0 0 20px;">
                        You have been invited to join <strong>${business.companyName}</strong> as an <strong>${role}</strong> on EditEdge Multimedia, a platform for generating and managing content for your business.
                      </p>
                      <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 30px auto;">
                        <tr>
                          <td align="center" style="background-color: #303030; border-radius: 5px;">
                            <a href="${registrationLink}" style="display: inline-block; padding: 12px 24px; color: #ffffff; font-size: 16px; font-weight: bold; text-decoration: none;">Register Now</a>
                          </td>
                        </tr>
                      </table>
                      <p style="color: #555555; font-size: 16px; line-height: 1.6; margin: 0 0 10px;">
                        If you have any questions, feel free to reply to this email or contact our support team at <a href="mailto:support@editedgemultimedia.com" style="color: #303030; text-decoration: none;">support@editedgemultimedia.com</a>.
                      </p>
                      <p style="color: #555555; font-size: 16px; line-height: 1.6; margin: 0;">
                        Best regards,<br>The EditEdge Multimedia Team
                      </p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 20px; border-top: 1px solid #e0e0e0;">
                      <p style="color: #999999; font-size: 12px; text-align: center; margin: 0;">
                        © 2025 EditEdge Multimedia. All rights reserved.<br>
                        <a href="${FRONTEND_URL}/privacy" style="color: #999999; text-decoration: none;">Privacy Policy</a> | <a href="${FRONTEND_URL}/terms" style="color: #999999; text-decoration: none;">Terms of Service</a>
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `;

    await sendEmail(email, subject, text, html);
    res.json({ message: 'Invitation email sent successfully' });
  } catch (error) {
    console.error('Error inviting member:', error);
    res.status(500).json({ error: 'Failed to invite member', details: error.message });
  }
});


// Select a business
router.post('/select-business', ensureAuthenticated, async (req, res) => {
  const { businessId } = req.body;

  if (!mongoose.Types.ObjectId.isValid(businessId)) {
    return res.status(400).json({ error: 'Invalid business ID' });
  }

  try {
    const user = await User.findById(req.user._id).populate('businesses');
    if (!user) return res.status(404).json({ error: 'User not found' });

    const hasAccess = user.businesses.some(
      (b) => b._id.toString() === businessId
    );

    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have access to this business' });
    }

    req.session.businessId = businessId;
    res.json({ message: 'Business selected successfully', businessId });
  } catch (error) {
    console.error('Error in POST /select-business:', error);
    res.status(500).json({ error: 'Failed to select business', details: error.message });
  }
});




// DELETE /api/business/:businessId/members/:memberId
router.delete('/:businessId/members/:memberId', ensureAuthenticated, hasBusinessAccess, async (req, res) => {
  const { businessId, memberId } = req.params;

  try {
    const business = req.business;

    // Only owner can remove members
    if (business.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Only the owner can remove members' });
    }

    // Prevent self-removal
    if (memberId === req.user._id.toString()) {
      return res.status(400).json({ error: 'Owner cannot remove themselves' });
    }

    // Remove member from business.members
    const originalLength = business.members.length;
    business.members = business.members.filter(
      (m) => m?.user?.toString() !== memberId
    );

    if (business.members.length === originalLength) {
      return res.status(404).json({ error: 'Member not found in business' });
    }

    await business.save();

    // Remove business from user's businesses list
    await User.findByIdAndUpdate(memberId, {
      $pull: { businesses: businessId },
    });

    res.json({ message: 'Member removed successfully' });
  } catch (error) {
    console.error('Error removing member:', error);
    res.status(500).json({ error: 'Failed to remove member', details: error.message });
  }
});


router.put('/:businessId/members/:memberId/role', ensureAuthenticated, async (req, res) => {
  const { businessId, memberId } = req.params;
  const { role } = req.body;
  if (req.user._id.toString() !== (await Business.findById(businessId)).owner.toString()) {
    return res.status(403).json({ error: 'Only owner can update roles' });
  }
  const business = await Business.findOneAndUpdate(
    { _id: businessId, 'members.user': memberId },
    { $set: { 'members.$.role': role } },
    { new: true }
  );
  res.json(business);
});

module.exports = router;