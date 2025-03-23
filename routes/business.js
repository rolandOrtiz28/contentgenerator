const express = require('express');
const router = express.Router();
const Business = require('../models/Business');
const User = require('../models/User');
const { ensureAuthenticated, ensureBusinessRole } = require('../middleware/auth');
const mongoose = require("mongoose");
const axios = require('axios');
const { sendEmail } = require('../utils/email');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:8080';

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
    console.log('Processing website:', websiteURL);

    // Check if the business already exists for this user
    let business = await Business.findOne({ companyWebsite: websiteURL, owner: req.user._id });
    if (business) {
      req.session.businessId = business._id;
      return res.json({
        companyName: business.companyName,
        description: business.description,
        services: business.services,
        targetAudience: business.targetAudience || 'Describe Your Target Audience',
        focusService: business.focusService || 'Describe what service you want to focus on',
        websiteURL,
        isRegistered: true,
      });
    }

    // Check in-memory cache
    if (cache.has(websiteURL)) {
      const extractedBranding = cache.get(websiteURL);
      business = new Business({
        ...extractedBranding,
        owner: req.user._id,
        members: [{ user: req.user._id, role: 'Admin' }],
      });
      await business.save();
      req.session.businessId = business._id;
      await User.findByIdAndUpdate(req.user._id, { $push: { businesses: business._id } });

      return res.json({
        ...extractedBranding,
        isRegistered: true,
      });
    }

    // Query Perplexity API
    console.log('Fetching data from Perplexity for:', websiteURL);

    const prompt = `
      Analyze the website at ${websiteURL} and provide:
      1. Company Name
      2. Description (50-100 words)
      3. Services (comma-separated)
      Use placeholders like "Unknown Company" if data is unavailable.
    `;

    const response = await perplexityApi.post('/chat/completions', {
      model: 'mistral-7b-instruct',
      messages: [
        { role: 'system', content: 'Extract branding info concisely.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 150,
      temperature: 0.5,
    });

    const perplexityResponse = response.data.choices[0].message.content.trim();
    console.log('Perplexity Response:', perplexityResponse);

    let companyName = 'Unknown Company';
    let description = 'No description available.';
    let services = 'No services found.';

    const lines = perplexityResponse.split('\n');
    lines.forEach(line => {
      if (line.startsWith('1. Company Name')) {
        companyName = line.replace('1. Company Name', '').replace(':', '').trim() || 'Unknown Company';
      } else if (line.startsWith('2. Description')) {
        description = line.replace('2. Description', '').replace(':', '').trim() || 'No description available.';
      } else if (line.startsWith('3. Services')) {
        services = line.replace('3. Services', '').replace(':', '').trim() || 'No services found.';
      }
    });

    // Save the extracted branding as a new Business
    business = new Business({
      companyName,
      description,
      services,
      companyWebsite: websiteURL,
      owner: req.user._id,
      members: [{ user: req.user._id, role: 'Admin' }],
    });
    await business.save();
    req.session.businessId = business._id;
    await User.findByIdAndUpdate(req.user._id, { $push: { businesses: business._id } });

    cache.set(websiteURL, { companyName, description, services, websiteURL });

    return res.json({
      companyName,
      description,
      services,
      targetAudience: 'Describe Your Target Audience',
      focusService: 'Describe what service you want to focus on',
      websiteURL,
      isRegistered: true,
    });
  } catch (error) {
    console.error('Error with Perplexity API:', error.response?.data || error.message);
    const urlFallback = new URL(websiteURL);
    const fallbackData = {
      companyName: urlFallback.hostname.replace('www.', '').split('.')[0] || 'Unknown Company',
      description: 'No description available due to extraction error.',
      services: 'No services found.',
      targetAudience: 'Describe Your Target Audience',
      focusService: 'Describe what service you want to focus on',
      websiteURL,
    };

    // Save fallback data as a new Business
    const business = new Business({
      ...fallbackData,
      owner: req.user._id,
      members: [{ user: req.user._id, role: 'Admin' }],
    });
    await business.save();
    req.session.businessId = business._id;
    await User.findByIdAndUpdate(req.user._id, { $push: { businesses: business._id } });

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

// Add a new business
router.post('/', ensureAuthenticated, async (req, res) => {
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
    socialMediaType,
    hasWebsite,
    companyWebsite,
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
      demographic,
      address,
      email,
      phoneNumber,
      brandTone,
      socialMediaType,
      hasWebsite,
      companyWebsite,
      owner: req.user._id,
      members: [{ user: req.user._id, role: 'Admin' }],
    });

    await newBusiness.save();

    // Add business to user's businesses array
    await User.findByIdAndUpdate(req.user._id, {
      $push: { businesses: newBusiness._id },
    });

    // Set the businessId in the session
    req.session.businessId = newBusiness._id;
    console.log('Session updated with businessId:', req.session.businessId);

    res.json({ business: newBusiness });
  } catch (error) {
    console.error('Error creating business:', error);
    res.status(500).json({ error: 'Failed to create business' });
  }
});

// Update a business
router.put('/:businessId', ensureAuthenticated, ensureBusinessRole('Admin'), async (req, res) => {
  const { businessId } = req.params;
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
    socialMediaType,
    hasWebsite,
    companyWebsite,
  } = req.body;

  try {
    // Validate businessId
    if (!mongoose.Types.ObjectId.isValid(businessId)) {
      return res.status(400).json({ error: 'Invalid business ID' });
    }

    const business = await Business.findById(businessId);
    if (!business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    // Update fields
    business.companyName = companyName || business.companyName;
    business.description = description || business.description;
    business.services = services || business.services;
    business.targetAudience = targetAudience || business.targetAudience;
    business.demographic = demographic || business.demographic;
    business.address = address || business.address;
    business.email = email || business.email;
    business.phoneNumber = phoneNumber || business.phoneNumber;
    business.brandTone = brandTone || business.brandTone;
    business.socialMediaType = socialMediaType || business.socialMediaType;
    business.hasWebsite = hasWebsite || business.hasWebsite;
    business.companyWebsite = companyWebsite || business.companyWebsite;

    await business.save();
    res.json({ business });
  } catch (error) {
    console.error('Error updating business:', error);
    res.status(500).json({ error: 'Failed to update business', details: error.message });
  }
});

// Delete a business
router.delete('/:businessId', ensureAuthenticated, ensureBusinessRole('Admin'), async (req, res) => {
  const { businessId } = req.params;

  try {
    const business = await Business.findById(businessId);
    if (!business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    // Only the owner can delete the business
    if (business.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Not authorized to delete this business' });
    }

    await Business.deleteOne({ _id: businessId });

    // Remove business from user's businesses array
    await User.findByIdAndUpdate(req.user._id, {
      $pull: { businesses: businessId },
    });

    res.json({ message: 'Business deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete business' });
  }
});

// Invite a member to a business
router.post('/:businessId/invite', ensureAuthenticated, ensureBusinessRole('Admin'), async (req, res) => {
  const { businessId } = req.params;
  const { email, role } = req.body;

  if (!email || !role || !['Admin', 'Editor', 'Viewer'].includes(role) || !email.includes('@')) {
    return res.status(400).json({ error: 'Email and valid role are required' });
  }

  try {
    const business = await Business.findById(businessId);
    if (!business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    const userToInvite = await User.findOne({ email: email.toLowerCase() });

    const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:8080';

    if (userToInvite) {
      const isAlreadyMember = business.members.some(
        (member) => member.user.toString() === userToInvite._id.toString()
      );
      if (isAlreadyMember) {
        return res.status(400).json({ error: 'User is already a member of this business' });
      }

      business.members.push({ user: userToInvite._id, role });
      await business.save();

      await User.findByIdAndUpdate(userToInvite._id, {
        $push: { businesses: business._id },
      });

      // Send email invitation to existing user
      const subject = `You're Invited to Join ${business.companyName} on EditEdge Multimedia`;
      const text = `Hello ${userToInvite.name},\n\nYou have been invited to join ${business.companyName} as an ${role} on EditEdge Multimedia, a platform for generating and managing content for your business. Please log in to your account to access the business: ${FRONTEND_URL}/login\n\nBest regards,\nThe EditEdge Multimedia Team`;
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
                      <img src="https://via.placeholder.com/150x50?text=EditEdge+Multimedia" alt="EditEdge Multimedia Logo" style="max-width: 150px; margin-bottom: 20px; display: block;" />
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
                          <td align="center" style="background-color: #007bff; border-radius: 5px;">
                            <a href="${FRONTEND_URL}/login" style="display: inline-block; padding: 12px 24px; color: #ffffff; font-size: 16px; font-weight: bold; text-decoration: none;">Log In to Join</a>
                          </td>
                        </tr>
                      </table>
                      <p style="color: #555555; font-size: 16px; line-height: 1.6; margin: 0 0 10px;">
                        If you have any questions, feel free to reply to this email or contact our support team at <a href="mailto:support@editedgemultimedia.com" style="color: #007bff; text-decoration: none;">support@editedgemultimedia.com</a>.
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
      return res.json({ message: 'Member invited successfully' });
    }

    // User doesn't exist, send an invitation to register
    const registrationLink = `${FRONTEND_URL}/register?email=${encodeURIComponent(email)}&businessId=${businessId}&role=${role}`;
    const subject = `You're Invited to Join ${business.companyName} on EditEdge Multimedia`;
    const text = `Hello,\n\nYou have been invited to join ${business.companyName} as an ${role} on EditEdge Multimedia, a platform for generating and managing content for your business. Please register to join: ${registrationLink}\n\nBest regards,\nThe EditEdge Multimedia Team`;
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
                    <img src="https://via.placeholder.com/150x50?text=EditEdge+Multimedia" alt="EditEdge Multimedia Logo" style="max-width: 150px; margin-bottom: 20px; display: block;" />
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
                        <td align="center" style="background-color: #007bff; border-radius: 5px;">
                          <a href="${registrationLink}" style="display: inline-block; padding: 12px 24px; color: #ffffff; font-size: 16px; font-weight: bold; text-decoration: none;">Register Now</a>
                        </td>
                      </tr>
                    </table>
                    <p style="color: #555555; font-size: 16px; line-height: 1.6; margin: 0 0 10px;">
                      If you have any questions, feel free to reply to this email or contact our support team at <a href="mailto:support@editedgemultimedia.com" style="color: #007bff; text-decoration: none;">support@editedgemultimedia.com</a>.
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
    res.status(500).json({ error: 'Failed to invite member', details: error.message });
  }
});

// Select a business
router.post('/select-business', ensureAuthenticated, async (req, res) => {
  const { businessId } = req.body;

  // Validate input
  if (!businessId) {
    return res.status(400).json({ error: 'Business ID is required' });
  }

  try {
    // Validate businessId format
    if (!mongoose.Types.ObjectId.isValid(businessId)) {
      return res.status(400).json({ error: 'Invalid business ID' });
    }

    // Fetch the user with their businesses
    const user = await User.findById(req.user._id).populate('businesses');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if the businessId belongs to the user's businesses
    const businessExists = user.businesses.some(business => business._id.toString() === businessId);
    if (!businessExists) {
      return res.status(403).json({ error: 'You do not have access to this business' });
    }

    // Set the businessId in the session
    req.session.businessId = businessId;
    console.log('Session updated with businessId:', req.session.businessId);

    res.json({ message: 'Business selected successfully', businessId });
  } catch (error) {
    console.error('Error selecting business:', error);
    res.status(500).json({ error: 'Error selecting business', details: error.message });
  }
});

module.exports = router;