const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
  },
  password: {
    type: String,
    required: true,
  },
  name: {
    type: String,
    required: true,
  },
  businesses: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
    },
  ],
  image: { type: String, default: "/Avatar.png" },
  personalContent: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Content',
    },
  ],
  subscription: {
    type: String,
    enum: ['None', 'Basic', 'Pro', 'Enterprise'],
    default: 'None',
  },
  stripeCustomerId: {
    type: String,
    default: null,
  },
  stripeSubscriptionId: {
    type: String,
    default: null,
  },
  subscriptionStatus: {
    type: String,
    enum: ['active', 'past_due', 'canceled', 'unpaid', 'trialing', 'incomplete', 'incomplete_expired'],
    default: null,
  },
  billingHistory: [
    {
      invoiceId: String,
      amount: Number,
      currency: String,
      status: String,
      date: Date,
      description: String,
    },
  ],
  freeTrialUsed: {
    type: Boolean,
    default: false,
  },
  isEditEdgeUser: {
    type: Boolean,
    default: false,
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user',
  },
  articleGenerationCount: {
    type: Number,
    default: 0,
  },
  socialMediaGenerationCount: {
    type: Number,
    default: 0,
  },
  contentGenerationResetDate: {
    type: Date,
  },
  resetPasswordToken: { type: String },
  resetPasswordExpires: { type: Date },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

UserSchema.pre('save', async function (next) {
  if (this.isModified('password') && !this.password.startsWith('$2b$')) {
    this.password = await bcrypt.hash(this.password, 10);
  }
  this.updatedAt = Date.now();
  next();
});

UserSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', UserSchema);
