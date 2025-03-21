const express = require('express');
const router = express.Router();
const Business = require('../models/Business');

// Fetch businesses for both flows
router.get('/businesses', async (req, res) => {
  try {
    const businesses = await Business.find({}, 'companyName description services focusService targetAudience demographic address email phoneNumber brandTone socialMediaType hasWebsite companyWebsite');
    res.json({ businesses, error: null });
  } catch (error) {
    console.error('❌ Error fetching businesses:', error);
    res.status(500).json({ businesses: [], error: 'Failed to fetch businesses' });
  }
});

// Handle business selection or new details for both Article and Social Media flows
// Handle business selection or new details for both Article and Social Media flows
router.post('/branding-details', async (req, res) => {
  try {
    const {
      contentType,
      selectedBusiness,
      companyName,
      description,
      services,
      focusService, // Still collected from the form
      audience,
      targetAudience,
      demographic,
      address,
      email,
      phoneNumber,
      brandTone,
      socialMediaType,
      hasWebsite,
      companyWebsite,
      password,
    } = req.body;

    if (!contentType || !['article', 'social'].includes(contentType)) {
      return res.status(400).json({
        error: 'Invalid content type. Must be "article" or "social".',
        businesses: await Business.find({}, 'companyName'),
      });
    }

    // Reset session data for a new flow
    req.session.generatedContent = null; // Clear previous generated content
    req.session.tempBusinessDetails = null; // Clear previous temp business details
    req.session.businessDetails = null; // Clear previous business details
    req.session.contentType = contentType; // Store the current content type

    console.log('🔄 Session reset for new flow:', req.session);

    const finalTargetAudience = contentType === 'article' ? audience : targetAudience;

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

        req.session.businessDetails = {
          companyName: business.companyName,
          description: business.description || 'No description provided.',
          services: business.services || 'General services',
          focusService: focusService || '', // Use the form's focusService since it's not in the database anymore
          targetAudience: business.targetAudience || 'General audience',
          demographic: business.demographic || '',
          address: business.address || '',
          email: business.email || '',
          phoneNumber: business.phoneNumber || '',
          brandTone: business.brandTone || 'professional',
          socialMediaType: contentType === 'social' ? (business.socialMediaType || 'post') : undefined,
          hasWebsite: business.hasWebsite || 'no',
          companyWebsite: business.companyWebsite || '',
        };

        return res.json({ redirect: `/blog-article/content-details` });
      } else {
        return res.json({ redirect: `/blog-article/business-password-prompt/${selectedBusiness}` });
      }
    }

    req.session.tempBusinessDetails = {
      companyName: companyName || 'Unnamed Company',
      description: description || 'No description provided.',
      services: services || 'General services',
      focusService: focusService || 'All services', // Still store focusService in the session for temporary use
      targetAudience: finalTargetAudience || 'General audience',
      demographic: demographic || '',
      address: address || '',
      email: email || '',
      phoneNumber: phoneNumber || '',
      brandTone: brandTone || 'professional',
      socialMediaType: contentType === 'social' ? (socialMediaType || 'post') : undefined,
      hasWebsite: hasWebsite || 'no',
      companyWebsite: hasWebsite === 'yes' ? companyWebsite : '',
    };

    console.log('After storing temp business details:', req.session);

    if (hasWebsite === 'yes' && companyWebsite) {
      return res.json({
        redirect: `/blog-article/extract-branding-${contentType}?website=${encodeURIComponent(companyWebsite)}`,
      });
    } else if (hasWebsite === 'no') {
      return res.json({ redirect: `/blog-article/save-details-prompt` });
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

router.post('/verify-password', async (req, res) => {
  const { businessId, password } = req.body;

  if (!businessId || !password) {
    return res.status(400).json({ error: 'Business ID and password are required' });
  }

  try {
    const business = await Business.findById(businessId);
    if (!business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    const isMatch = await business.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Incorrect password' });
    }

    req.session.businessDetails = {
      companyName: business.companyName,
      description: business.description,
      services: business.services,
      // focusService is not in the database anymore, so we set it to empty or get it from the form if needed
      focusService: req.session.tempBusinessDetails?.focusService || '',
      targetAudience: business.targetAudience,
      demographic: business.demographic,
      address: business.address,
      email: business.email,
      phoneNumber: business.phoneNumber,
      brandTone: business.brandTone,
      companyWebsite: business.companyWebsite,
    };

    const contentType = req.session.contentType || 'article';
    res.json({
      redirect: `/blog-article/content-details`,
      business: req.session.businessDetails,
    });
  } catch (error) {
    console.error('Error verifying password:', error);
    res.status(500).json({ error: 'Failed to verify password' });
  }
});

router.post('/save-details', async (req, res) => {
  const { saveChoice, password } = req.body;
  const { tempBusinessDetails, contentType } = req.session;

  console.log('📥 /save-details route called');
  console.log('Request body:', req.body);
  console.log('Session tempBusinessDetails:', tempBusinessDetails);
  console.log('Session contentType:', contentType);

  if (!tempBusinessDetails) {
    console.error('❌ No tempBusinessDetails found in session');
    return res.status(400).json({ error: 'No business details found in session.' });
  }

  try {
    if (saveChoice === 'yes') {
      if (!password) {
        console.error('❌ Password is required to save business details');
        return res.status(400).json({ error: 'Password is required to save business details.' });
      }

      // Exclude focusService when saving to the database
      const { focusService, ...businessDetailsToSave } = tempBusinessDetails;

      console.log('Creating new business with details:', businessDetailsToSave);
      const newBusiness = new Business({
        ...businessDetailsToSave,
        password: await Business.hashPassword(password),
      });

      console.log('New business object before saving:', newBusiness);
      await newBusiness.save();
      console.log('✅ Business saved successfully:', newBusiness);

      req.session.businessDetails = tempBusinessDetails; // Keep focusService in the session
    } else {
      console.log('Not saving business details, proceeding with temp details');
      req.session.businessDetails = tempBusinessDetails; // Keep focusService in the session
    }

    req.session.tempBusinessDetails = null; // Clear tempBusinessDetails
    console.log('After saving business details, session:', req.session);

    return res.json({
      redirect: `/${contentType === 'article' ? 'blog-article' : 'social-media'}/content-details`,
    });
  } catch (error) {
    console.error('❌ Error saving business details:', error);
    return res.status(500).json({ error: 'Failed to save business details: ' + error.message });
  }
});

module.exports = router;