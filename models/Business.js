const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const BusinessSchema = new mongoose.Schema({
  companyName: {
    type: String,
    required: true,
    trim: true,
  },
  description: {
    type: String,
    default: '',
  },
  services: {
    type: String,
    default: '',
  },
  targetAudience: {
    type: String,
    default: '',
  },
  demographic: {
    type: String,
    default: '',
  },
  address: {
    type: String,
    default: '',
  },
  email: {
    type: String,
    default: '',
  },
  phoneNumber: {
    type: String,
    default: '',
  },
  brandTone: {
    type: String,
    default: 'professional',
  },
  socialMediaType: {
    type: String,
    default: '',
  },
  hasWebsite: {
    type: String,
    default: 'no',
  },
  companyWebsite: {
    type: String,
    default: '',
  },
  password: {
    type: String,
    required: true,
  },
});

// Static method to hash password
BusinessSchema.statics.hashPassword = async function (password) {
  console.log('hashPassword method called with password:', password);
  return await bcrypt.hash(password, 10);
};

// Instance method to compare password
BusinessSchema.methods.comparePassword = async function (candidatePassword) {
  console.log('comparePassword method called with candidatePassword:', candidatePassword);
  console.log('Stored hashed password:', this.password);
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('Business', BusinessSchema);