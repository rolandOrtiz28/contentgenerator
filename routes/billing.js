const express = require('express');
const router = express.Router();
const stripe = require('../config/stripe');
const { ensureAuthenticated } = require('../middleware/auth');
const User = require('../models/User');

// Subscription plans and prices
const PLANS = {
  Basic: {
    priceId: 'price_1R5kVHKIAap6PevkT0ZKfLj7',
    articleLimit: 2,
    socialMediaLimit: 3,
    level: 1,
  },
  Pro: {
    priceId: 'price_1R5kasKIAap6PevkaJJQQcEX',
    articleLimit: 5,
    socialMediaLimit: 5,
    level: 2,
  },
  Enterprise: {
    productId: 'prod_RzkJJpO8AwyEbp',
    priceId: 'price_1R5kp4KIAap6PevkFWnij2js',
    level: 3,
  },
};

// Subscribe to a plan
router.post('/subscribe', ensureAuthenticated, async (req, res) => {
  const { plan, paymentMethodId, customPrice } = req.body;

  if (!plan || !['Basic', 'Pro', 'Enterprise'].includes(plan)) {
    return res.status(400).json({ error: 'Invalid plan' });
  }

  if (!paymentMethodId) {
    return res.status(400).json({ error: 'Payment method ID is required' });
  }

  if (plan === 'Enterprise' && !customPrice) {
    return res.status(400).json({ error: 'Custom price is required for Enterprise plan' });
  }

  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if the user already has an active subscription
    if (user.stripeSubscriptionId) {
      const existingSubscription = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
      if (existingSubscription.status === 'active' || existingSubscription.status === 'trialing') {
        // Cancel the existing subscription before creating a new one
        await stripe.subscriptions.cancel(user.stripeSubscriptionId);
        user.stripeSubscriptionId = null;
        user.subscriptionStatus = 'canceled';
        user.subscription = 'None';
        await user.save();
      }
    }

    // Create or retrieve Stripe customer
    let stripeCustomer;
    if (!user.stripeCustomerId) {
      stripeCustomer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: { userId: user._id.toString() },
      });
      user.stripeCustomerId = stripeCustomer.id;
    } else {
      stripeCustomer = await stripe.customers.retrieve(user.stripeCustomerId);
    }

    // Attach the payment method to the customer
    await stripe.paymentMethods.attach(paymentMethodId, {
      customer: stripeCustomer.id,
    });

    // Set the default payment method for the customer
    await stripe.customers.update(stripeCustomer.id, {
      invoice_settings: {
        default_payment_method: paymentMethodId,
      },
    });

    // Create a subscription
    let subscription;
    if (plan === 'Enterprise') {
      // For Enterprise, create a custom price
      const price = await stripe.prices.create({
        product: PLANS[plan].productId,
        unit_amount: customPrice * 100, // Convert to cents
        currency: 'usd',
        recurring: { interval: 'month' },
      });

      subscription = await stripe.subscriptions.create({
        customer: stripeCustomer.id,
        items: [{ price: price.id }],
        payment_behavior: 'default_incomplete',
        payment_settings: {
          payment_method_types: ['card'],
          save_default_payment_method: 'on_subscription',
        },
        expand: ['latest_invoice.payment_intent'],
      });
    } else {
      // For Basic and Pro, use the predefined price
      subscription = await stripe.subscriptions.create({
        customer: stripeCustomer.id,
        items: [{ price: PLANS[plan].priceId }],
        payment_behavior: 'default_incomplete',
        payment_settings: {
          payment_method_types: ['card'],
          save_default_payment_method: 'on_subscription',
        },
        expand: ['latest_invoice.payment_intent'],
      });
    }

    // Update user with subscription details
    user.subscription = plan;
    user.stripeSubscriptionId = subscription.id;
    user.subscriptionStatus = subscription.status;
    await user.save();

    // Check if payment_intent exists
    const clientSecret = subscription.latest_invoice.payment_intent
      ? subscription.latest_invoice.payment_intent.client_secret
      : null;

    res.json({
      subscriptionId: subscription.id,
      clientSecret: clientSecret,
    });
  } catch (error) {
    console.error('Error creating subscription:', error);
    res.status(500).json({ error: 'Failed to create subscription', details: error.message });
  }
});


// Get current subscription details
router.get('/subscription', ensureAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.stripeSubscriptionId) {
      return res.json({ subscription: null });
    }

    const subscription = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
    // Update user status in case it has changed in Stripe
    user.subscriptionStatus = subscription.status;
    await user.save();

    res.json({
      subscription: {
        plan: user.subscription,
        status: subscription.status,
        currentPeriodEnd: subscription.current_period_end,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      },
    });
  } catch (error) {
    console.error('Error fetching subscription:', error);
    res.status(500).json({ error: 'Failed to fetch subscription', details: error.message });
  }
});

// Get billing history
router.get('/history', ensureAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ billingHistory: user.billingHistory });
  } catch (error) {
    console.error('Error fetching billing history:', error);
    res.status(500).json({ error: 'Failed to fetch billing history', details: error.message });
  }
});


router.post('/cancel', ensureAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.stripeSubscriptionId) {
      return res.status(400).json({ error: 'No active subscription to cancel' });
    }

    // Cancel the subscription in Stripe
    const subscription = await stripe.subscriptions.cancel(user.stripeSubscriptionId);

    // Update user in the database
    user.subscription = 'None';
    user.stripeSubscriptionId = null;
    user.subscriptionStatus = 'canceled';
    user.articleGenerationCount = 0;
    user.socialMediaGenerationCount = 0;
    user.contentGenerationResetDate = null;
    await user.save();

    res.json({ message: 'Subscription canceled successfully' });
  } catch (error) {
    console.error('Error canceling subscription:', error);
    res.status(500).json({ error: 'Failed to cancel subscription', details: error.message });
  }
});

router.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} - Body:`, req.body);
  next();
});

// Upgrade subscription
router.post('/upgrade', ensureAuthenticated, async (req, res) => {
  const { plan, paymentMethodId, customPrice } = req.body; // Changed newPlan to plan
  console.log('Upgrade request received:', { plan, paymentMethodId, customPrice });

  if (!plan || !['Basic', 'Pro', 'Enterprise'].includes(plan)) {
    console.log('Invalid plan:', plan);
    return res.status(400).json({ error: 'Invalid plan' });
  }

  if (!paymentMethodId) {
    console.log('Missing payment method ID');
    return res.status(400).json({ error: 'Payment method ID is required' });
  }

  if (plan === 'Enterprise' && (customPrice === undefined || isNaN(customPrice))) {
    console.log('Missing or invalid custom price for Enterprise:', customPrice);
    return res.status(400).json({ error: 'Custom price is required for Enterprise plan and must be a valid number' });
  }

  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      console.log('User not found:', req.user._id);
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.stripeSubscriptionId) {
      console.log('No active subscription to upgrade for user:', user._id);
      return res.status(400).json({ error: 'No active subscription to upgrade' });
    }

    // Check if the new plan is an upgrade
    const currentPlanLevel = PLANS[user.subscription]?.level || 0;
    const newPlanLevel = PLANS[plan].level;
    if (newPlanLevel <= currentPlanLevel) {
      console.log(`Downgrade attempt: Current plan level ${currentPlanLevel}, New plan level ${newPlanLevel}`);
      return res.status(400).json({
        error: 'Downgrading is not allowed. Please cancel your current subscription and subscribe to a new plan.',
      });
    }

    // Retrieve the current subscription
    const currentSubscription = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
    console.log('Current subscription retrieved:', currentSubscription.id);

    // Cancel the current subscription
    await stripe.subscriptions.cancel(user.stripeSubscriptionId);
    console.log('Current subscription canceled:', user.stripeSubscriptionId);

    // Create a new subscription for the upgraded plan
    let subscription;
    if (plan === 'Enterprise') {
      const price = await stripe.prices.create({
        product: PLANS[plan].productId,
        unit_amount: customPrice * 100,
        currency: 'usd',
        recurring: { interval: 'month' },
      });
      console.log('Created new price for Enterprise:', price.id);

      subscription = await stripe.subscriptions.create({
        customer: user.stripeCustomerId,
        items: [{ price: price.id }],
        payment_behavior: 'default_incomplete',
        payment_settings: {
          payment_method_types: ['card'],
          save_default_payment_method: 'on_subscription',
        },
        expand: ['latest_invoice.payment_intent'],
      });
    } else {
      subscription = await stripe.subscriptions.create({
        customer: user.stripeCustomerId,
        items: [{ price: PLANS[plan].priceId }],
        payment_behavior: 'default_incomplete',
        payment_settings: {
          payment_method_types: ['card'],
          save_default_payment_method: 'on_subscription',
        },
        expand: ['latest_invoice.payment_intent'],
      });
    }
    console.log('New subscription created:', subscription.id);

    // Update user with new subscription details
    user.subscription = plan;
    user.stripeSubscriptionId = subscription.id;
    user.subscriptionStatus = subscription.status;
    await user.save();
    console.log('User updated with new subscription:', user._id);

    const clientSecret = subscription.latest_invoice.payment_intent
      ? subscription.latest_invoice.payment_intent.client_secret
      : null;

    res.json({
      subscriptionId: subscription.id,
      clientSecret: clientSecret,
    });
  } catch (error) {
    console.error('Error upgrading subscription:', error);
    res.status(500).json({ error: 'Failed to upgrade subscription', details: error.message });
  }
});

// Add this at the bottom of billing.js (or anywhere in your router file)
router.get('/stripe-publishable-key', (req, res) => {
  res.json({
    key: process.env.PUBLISHKEY
  });
});



module.exports = router;