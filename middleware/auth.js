const User = require('../models/User');
const Business = require('../models/Business'); // Add this import
const Content = require('../models/Content');

const ensureAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: 'Not authenticated' });
};



module.exports = { ensureAuthenticated };