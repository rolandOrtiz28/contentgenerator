const mongoose = require('mongoose');

const ContentSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['Article', 'SocialMedia', 'Leads'],
    required: true,
  },
  businessId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Business',
    required: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  assignee: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false,
  }],
  reminderNotes: {
    type: String,
    required: false, 
  },
  data: {
    type: Object, 
    required: true,
  },
  status: {
    type: String,
    enum: ['Draft', 'Scheduled', 'Published', 'Archived'],
    default: 'Draft',
  },
  scheduledDate: {
    type: Date,
    required: false, 
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

ContentSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

// Explicitly set the collection name to 'content'
module.exports = mongoose.model('Content', ContentSchema);