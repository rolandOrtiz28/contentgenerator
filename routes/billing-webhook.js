const express = require('express');
const router = express.Router();
const stripe = require('../config/stripe');
const User = require('../models/User');
require('dotenv').config();

router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  console.log('Raw request body:', req.body);
  console.log('Request headers:', req.headers);

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

  console.log('Received webhook event:', JSON.stringify(event, null, 2));

  try {
    switch (event.type) {
      case 'invoice.payment_succeeded':
        const invoice = event.data.object;
        console.log('Processing invoice.payment_succeeded for customer:', invoice.customer);
        const user = await User.findOne({ stripeCustomerId: invoice.customer });
        if (user) {
          console.log('User found:', user._id.toString());
          const existingEntry = user.billingHistory.find(
            entry => entry.invoiceId === invoice.id
          );
          if (!existingEntry) {
            user.billingHistory.push({
              invoiceId: invoice.id,
              amount: invoice.amount_paid / 100,
              currency: invoice.currency,
              status: invoice.status,
              date: new Date(invoice.created * 1000),
              description: `Payment for ${user.subscription} plan`,
            });
            user.subscriptionStatus = 'active';
            await user.save();
            console.log(`Updated billing history for user with stripeCustomerId: ${invoice.customer}`);
          } else {
            console.log(`Duplicate invoiceId ${invoice.id} found, skipping update`);
          }
        } else {
          console.log('User not found for stripeCustomerId:', invoice.customer);
        }
        break;

      case 'invoice.updated':
        const updatedInvoice = event.data.object;
        console.log('Processing invoice.updated for invoice:', updatedInvoice.id);
        const invoiceUpdatedUser = await User.findOne({ stripeCustomerId: updatedInvoice.customer });
        if (invoiceUpdatedUser) {
          console.log('User found for invoice.updated:', invoiceUpdatedUser._id.toString());
          if (updatedInvoice.status === 'paid') {
            invoiceUpdatedUser.subscriptionStatus = 'active';
          } else if (updatedInvoice.status === 'void' || updatedInvoice.status === 'uncollectible') {
            invoiceUpdatedUser.subscriptionStatus = 'canceled';
          }
          await invoiceUpdatedUser.save();
          console.log(`Updated subscription status for user with stripeCustomerId: ${updatedInvoice.customer}`);
        } else {
          console.log('User not found for stripeCustomerId:', updatedInvoice.customer);
        }
        break;

      case 'invoice.paid':
        const paidInvoice = event.data.object;
        console.log('Processing invoice.paid for invoice:', paidInvoice.id);
        const invoicePaidUser = await User.findOne({ stripeCustomerId: paidInvoice.customer });
        if (invoicePaidUser) {
          console.log('User found for invoice.paid:', invoicePaidUser._id.toString());
          invoicePaidUser.subscriptionStatus = 'active';
          await invoicePaidUser.save();
          console.log(`Set subscription status to active for user with stripeCustomerId: ${paidInvoice.customer}`);
        } else {
          console.log('User not found for stripeCustomerId:', paidInvoice.customer);
        }
        break;

      case 'customer.subscription.updated':
        const subscription = event.data.object;
        console.log('Processing customer.subscription.updated for subscription:', subscription.id);
        const subscriptionUpdatedUser = await User.findOne({ stripeSubscriptionId: subscription.id });
        if (subscriptionUpdatedUser) {
          console.log('User found for subscription.updated:', subscriptionUpdatedUser._id.toString());
          subscriptionUpdatedUser.subscriptionStatus = subscription.status;

          if (subscription.cancel_at_period_end) {
            subscriptionUpdatedUser.subscriptionStatus = 'canceled';
          }

          if (subscription.status === 'trialing') {
            subscriptionUpdatedUser.subscriptionStatus = 'trialing';
          }

          const currentPriceId = subscription.items.data[0]?.price.id;
          const planMapping = {
            'price_1R5kVHKIAap6PevkT0ZKfLj7': 'Basic',
            'price_1R5kasKIAap6PevkaJJQQcEX': 'Pro',
            'price_1R5kp4KIAap6PevkFWnij2js': 'Enterprise',
          };
          const newPlan = planMapping[currentPriceId] || subscriptionUpdatedUser.subscription;
          if (newPlan !== subscriptionUpdatedUser.subscription) {
            subscriptionUpdatedUser.subscription = newPlan;
            console.log(`User plan changed to: ${newPlan}`);
          }

          await subscriptionUpdatedUser.save();
          console.log(`Updated subscription status for user with stripeSubscriptionId: ${subscription.id}`);
        } else {
          console.log('User not found for stripeSubscriptionId:', subscription.id);
        }
        break;

      case 'customer.subscription.deleted':
        const deletedSubscription = event.data.object;
        console.log('Processing customer.subscription.deleted for subscription:', deletedSubscription.id);
        let deletedUser = await User.findOne({ stripeSubscriptionId: deletedSubscription.id });
        if (!deletedUser) {
          deletedUser = await User.findOne({ stripeCustomerId: deletedSubscription.customer });
        }
        if (deletedUser) {
          console.log('User found for subscription.deleted:', deletedUser._id.toString());
          deletedUser.subscription = 'None';
          deletedUser.stripeSubscriptionId = null;
          deletedUser.subscriptionStatus = 'canceled';
          deletedUser.articleGenerationCount = 0;
          deletedUser.socialMediaGenerationCount = 0;
          deletedUser.contentGenerationResetDate = null;
          await deletedUser.save();
          console.log(`Deleted subscription for user with stripeCustomerId: ${deletedSubscription.customer}`);
        } else {
          console.log('User not found for stripeCustomerId:', deletedSubscription.customer);
        }
        break;

      default:
        console.log(`Unhandled event type ${event.type}`);
    }
  } catch (error) {
    console.error('Error processing webhook event:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }

  res.json({ received: true });
});

module.exports = router;