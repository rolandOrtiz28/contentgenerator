// models/UserActivity.js
const mongoose = require('mongoose');

const userActivitySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'User',
  },
  name: String,
  email: String,
  action: String, // login, logout, reset-password, etc.
  details: Object,
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('UserActivity', userActivitySchema);
