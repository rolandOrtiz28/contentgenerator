const express = require('express');
const router = express.Router();
const stripe = require('../config/stripe');
require('dotenv').config(); // just in case

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
  
    console.log('Received webhook event:', JSON.stringify(event, null, 2));
  
    // Handle the event
    switch (event.type) {
      case 'invoice.payment_succeeded':
        const invoice = event.data.object;
        console.log('Processing invoice.payment_succeeded for customer:', invoice.customer);
        const user = await User.findOne({ stripeCustomerId: invoice.customer });
        if (user) {
          console.log('User found:', user._id);
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
      case 'customer.subscription.updated':
        const subscription = event.data.object;
        console.log('Processing customer.subscription.updated for subscription:', subscription.id);
        const updatedUser = await User.findOne({ stripeSubscriptionId: subscription.id });
        if (updatedUser) {
          updatedUser.subscriptionStatus = subscription.status;
          if (subscription.cancel_at_period_end) {
            updatedUser.subscriptionStatus = 'canceled';
          }
          await updatedUser.save();
          console.log(`Updated subscription status for user with stripeSubscriptionId: ${subscription.id}`);
        } else {
          console.log('User not found for stripeSubscriptionId:', subscription.id);
        }
        break;
      case 'customer.subscription.deleted':
        const deletedSubscription = event.data.object;
        console.log('Processing customer.subscription.deleted for subscription:', deletedSubscription.id);
        const deletedUser = await User.findOne({ stripeSubscriptionId: deletedSubscription.id });
        if (deletedUser) {
          deletedUser.subscription = 'None';
          deletedUser.stripeSubscriptionId = null;
          deletedUser.subscriptionStatus = 'canceled';
          await deletedUser.save();
          console.log(`Deleted subscription for user with stripeSubscriptionId: ${deletedSubscription.id}`);
        } else {
          console.log('User not found for stripeSubscriptionId:', deletedSubscription.id);
        }
        break;
      default:
        console.log(`Unhandled event type ${event.type}`);
    }
  
    res.json({ received: true });
  });



module.exports = router;
