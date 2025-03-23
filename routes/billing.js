const express = require('express');
const router = express.Router();
const stripe = require('../config/stripe');
const { ensureAuthenticated } = require('../middleware/auth');
const User = require('../models/User');

// Subscription plans (configure these in your Stripe Dashboard)
const PLANS = {
    Basic: {
      priceId: 'price_1R5kVHKIAap6PevkT0ZKfLj7', // Basic plan Price ID
      articleLimit: 2,
      socialMediaLimit: 3,
    },
    Pro: {
      priceId: 'price_1R5kasKIAap6PevkaJJQQcEX', // Pro plan Price ID
      articleLimit: 5,
      socialMediaLimit: 5,
    },
    Enterprise: {
      productId: 'prod_RzkJJpO8AwyEbp', // Enterprise Product ID
      priceId: 'price_1R5kp4KIAap6PevkFWnij2js', // Enterprise placeholder Price ID
    },
  };

// Subscribe to a plan
router.post('/subscribe', ensureAuthenticated, async (req, res) => {
  const { plan, paymentMethodId } = req.body;

  if (!plan || !['Basic', 'Pro', 'Enterprise'].includes(plan)) {
    return res.status(400).json({ error: 'Invalid plan' });
  }

  if (!paymentMethodId) {
    return res.status(400).json({ error: 'Payment method ID is required' });
  }

  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
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
    const subscription = await stripe.subscriptions.create({
      customer: stripeCustomer.id,
      items: [{ price: PLANS[plan].priceId }],
      payment_behavior: 'default_incomplete',
      expand: ['latest_invoice.payment_intent'],
    });

    // Update user with subscription details
    user.subscription = plan;
    user.stripeSubscriptionId = subscription.id;
    user.subscriptionStatus = subscription.status;
    await user.save();

    res.json({
      subscriptionId: subscription.id,
      clientSecret: subscription.latest_invoice.payment_intent.client_secret,
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

// Webhook endpoint for Stripe events
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (error) {
    console.error('Webhook signature verification failed:', error);
    return res.status(400).json({ error: 'Webhook error', details: error.message });
  }

  // Handle the event
  switch (event.type) {
    case 'invoice.payment_succeeded':
      const invoice = event.data.object;
      const user = await User.findOne({ stripeCustomerId: invoice.customer });
      if (user) {
        user.billingHistory.push({
          invoiceId: invoice.id,
          amount: invoice.amount_paid / 100, // Convert from cents to dollars
          currency: invoice.currency,
          status: invoice.status,
          date: new Date(invoice.created * 1000),
          description: `Payment for ${user.subscription} plan`,
        });
        user.subscriptionStatus = 'active';
        await user.save();
      }
      break;
    case 'customer.subscription.updated':
      const subscription = event.data.object;
      const updatedUser = await User.findOne({ stripeSubscriptionId: subscription.id });
      if (updatedUser) {
        updatedUser.subscriptionStatus = subscription.status;
        if (subscription.cancel_at_period_end) {
          updatedUser.subscriptionStatus = 'canceled';
        }
        await updatedUser.save();
      }
      break;
    case 'customer.subscription.deleted':
      const deletedSubscription = event.data.object;
      const deletedUser = await User.findOne({ stripeSubscriptionId: deletedSubscription.id });
      if (deletedUser) {
        deletedUser.subscription = 'None';
        deletedUser.stripeSubscriptionId = null;
        deletedUser.subscriptionStatus = 'canceled';
        await deletedUser.save();
      }
      break;
    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.json({ received: true });
});

module.exports = router;