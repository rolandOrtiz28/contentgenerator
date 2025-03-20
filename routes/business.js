const express = require('express');
const router = express.Router();
const Business = require('../models/Business');

// Fetch businesses for both flows
router.get('/businesses', async (req, res) => {
  try {
    const businesses = await Business.find({}, 'companyName description services focusService targetAudience brandTone socialMediaType hasWebsite companyWebsite');
    res.json({ businesses, error: null });
  } catch (error) {
    console.error('❌ Error fetching businesses:', error);
    res.status(500).json({ businesses: [], error: 'Failed to fetch businesses' });
  }
});

// Handle business selection or new details for both Article and Social Media flows
router.post('/branding-details', async (req, res) => {
  try {
    const {
      contentType, // "article" or "social"
      selectedBusiness,
      companyName,
      description,
      services,
      focusService,
      audience, // Used for Article flow (will map to targetAudience)
      targetAudience, // Used for Social Media flow
      brandTone,
      keyword, // Used for Article flow
      socialMediaType, // Used for Social Media flow
      hasWebsite,
      companyWebsite,
      password,
    } = req.body;

    // Validate contentType
    if (!contentType || !['article', 'social'].includes(contentType)) {
      return res.status(400).json({
        error: 'Invalid content type. Must be "article" or "social".',
        businesses: await Business.find({}, 'companyName'),
      });
    }

    // Map audience to targetAudience for consistency with the schema
    const finalTargetAudience = contentType === 'article' ? audience : targetAudience;

    // Clear session if a new business is being created
    if (!selectedBusiness || selectedBusiness === "new") {
      req.session.businessDetails = null;
      console.log('🔄 Session cleared for new business entry.');
    }

    console.log('Before storing temp business details:', req.session);

    // Handle existing business selection
    if (selectedBusiness && selectedBusiness !== "new") {
      const business = await Business.findById(selectedBusiness);
      if (!business) {
        return res.status(404).json({
          error: 'Selected business not found.',
          businesses: await Business.find({}, 'companyName'),
        });
      }

      if (password) {
        const isMatch = await business.comparePassword(password);
        if (!isMatch) {
          return res.status(401).json({
            error: 'Incorrect password for the selected business.',
            businesses: await Business.find({}, 'companyName'),
          });
        }

        // Store business details in session
        req.session.businessDetails = {
          companyName: business.companyName,
          description: business.description || 'No description provided.',
          services: business.services || 'General services',
          focusService: business.focusService || '',
          targetAudience: business.targetAudience || 'General audience', // Use targetAudience
          brandTone: business.brandTone || 'professional',
          keyword: contentType === 'article' ? (keyword || '') : undefined,
          socialMediaType: contentType === 'social' ? (business.socialMediaType || 'post') : undefined,
          hasWebsite: business.hasWebsite || 'no',
          companyWebsite: business.companyWebsite || '',
        };

        // Redirect to DetailsConfirmation
        return res.json({ redirect: `/${contentType === 'article' ? 'article' : 'social-media'}/branding-${contentType}-details` });
      } else {
        return res.json({ redirect: `/${contentType === 'article' ? 'blog-article' : 'social-media'}/business-password-prompt/${selectedBusiness}` });
      }
    }

    // Handle new business creation
    req.session.tempBusinessDetails = {
      companyName: companyName || 'Unnamed Company',
      description: description || 'No description provided.',
      services: services || 'General services',
      focusService: focusService || 'All services',
      targetAudience: finalTargetAudience || 'General audience', // Use targetAudience
      brandTone: brandTone || 'professional',
      keyword: contentType === 'article' ? (keyword || 'SEO optimization') : undefined,
      socialMediaType: contentType === 'social' ? (socialMediaType || 'post') : undefined,
      hasWebsite: hasWebsite || 'no',
      companyWebsite: hasWebsite === 'yes' ? companyWebsite : '',
    };

    console.log('After storing temp business details:', req.session);

    // Redirect based on whether the user has a website
    if (hasWebsite === 'yes' && companyWebsite) {
      return res.json({
        redirect: `/${contentType === 'article' ? 'blog-article' : 'social-media'}/extract-branding-${contentType}?website=${encodeURIComponent(companyWebsite)}`,
      });
    } else if (hasWebsite === 'no') {
      // For new businesses, redirect to SaveDetailsPrompt
      return res.json({ redirect: `/${contentType === 'article' ? 'article' : 'social-media'}/save-details-prompt` });
    } else {
      return res.status(400).json({
        error: 'Please select whether you have a website.',
        businesses: await Business.find({}, 'companyName'),
      });
    }
  } catch (error) {
    console.error('❌ Error in branding-details:', error);
    return res.status(500).json({
      error: 'Server error',
      businesses: await Business.find({}, 'companyName'),
    });
  }
});

module.exports = router;