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
    res.json({
      subscription: {
        plan: user.subscription,
        status: subscription.status, // Use Stripe's status
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



// router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
//   const sig = req.headers['stripe-signature'];
//   let event;

//   try {
//     event = stripe.webhooks.constructEvent(
//       req.body,
//       sig,
//       process.env.STRIPE_WEBHOOK_SECRET
//     );
//   } catch (error) {
//     console.error('Webhook signature verification failed:', error);
//     return res.status(400).json({ error: 'Webhook error', details: error.message });
//   }

//   console.log('Received webhook event:', JSON.stringify(event, null, 2));

//   // Handle the event
//   switch (event.type) {
//     case 'invoice.payment_succeeded':
//       const invoice = event.data.object;
//       console.log('Processing invoice.payment_succeeded for customer:', invoice.customer);
//       const user = await User.findOne({ stripeCustomerId: invoice.customer });
//       if (user) {
//         console.log('User found:', user._id);
//         // Check for duplicate invoiceId
//         const existingEntry = user.billingHistory.find(
//           entry => entry.invoiceId === invoice.id
//         );
//         if (!existingEntry) {
//           user.billingHistory.push({
//             invoiceId: invoice.id,
//             amount: invoice.amount_paid / 100, // Convert from cents to dollars
//             currency: invoice.currency,
//             status: invoice.status,
//             date: new Date(invoice.created * 1000),
//             description: `Payment for ${user.subscription} plan`,
//           });
//           user.subscriptionStatus = 'active';
//           await user.save();
//           console.log(`Updated billing history for user with stripeCustomerId: ${invoice.customer}`);
//         } else {
//           console.log(`Duplicate invoiceId ${invoice.id} found, skipping update`);
//         }
//       } else {
//         console.log('User not found for stripeCustomerId:', invoice.customer);
//       }
//       break;
//     case 'customer.subscription.updated':
//       const subscription = event.data.object;
//       console.log('Processing customer.subscription.updated for subscription:', subscription.id);
//       const updatedUser = await User.findOne({ stripeSubscriptionId: subscription.id });
//       if (updatedUser) {
//         updatedUser.subscriptionStatus = subscription.status;
//         if (subscription.cancel_at_period_end) {
//           updatedUser.subscriptionStatus = 'canceled';
//         }
//         await updatedUser.save();
//         console.log(`Updated subscription status for user with stripeSubscriptionId: ${subscription.id}`);
//       } else {
//         console.log('User not found for stripeSubscriptionId:', subscription.id);
//       }
//       break;
//     case 'customer.subscription.deleted':
//       const deletedSubscription = event.data.object;
//       console.log('Processing customer.subscription.deleted for subscription:', deletedSubscription.id);
//       const deletedUser = await User.findOne({ stripeSubscriptionId: deletedSubscription.id });
//       if (deletedUser) {
//         deletedUser.subscription = 'None';
//         deletedUser.stripeSubscriptionId = null;
//         deletedUser.subscriptionStatus = 'canceled';
//         await deletedUser.save();
//         console.log(`Deleted subscription for user with stripeSubscriptionId: ${deletedSubscription.id}`);
//       } else {
//         console.log('User not found for stripeSubscriptionId:', deletedSubscription.id);
//       }
//       break;
//     default:
//       console.log(`Unhandled event type ${event.type}`);
//   }

//   res.json({ received: true });
// });


module.exports = router;