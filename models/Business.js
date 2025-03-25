const mongoose = require('mongoose');

const BusinessSchema = new mongoose.Schema({
  companyName: {
    type: String,
    required: true,
    trim: true,
  },
  description: {
    type: String,
    required: true,
    trim: true,
  },
  services: {
    type: String,
    required: true,
    trim: true,
  },
  targetAudience: {
    type: String,
    required: true,
    trim: true,
  },
  demographic: {
    type: String,
    default: '',
    trim: true,
  },
  address: {
    type: String,
    default: '',
    trim: true,
  },
  email: {
    type: String,
    default: '',
    trim: true,
  },
  phoneNumber: {
    type: String,
    default: '',
    trim: true,
  },
  brandTone: {
    type: String,
    default: 'professional',
    trim: true,
  },
  hasWebsite: {
    type: String,
    default: 'no',
    trim: true,
  },
  companyWebsite: {
    type: String,
    default: '',
    trim: true,
  },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  members: [
    {
      user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
      },
      role: {
        type: String,
        enum: ['Admin', 'Editor', 'Viewer'],
        default: 'Editor',
      },
    },
  ],
  contentHistory: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Content',
    },
  ],
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

BusinessSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Business', BusinessSchema);