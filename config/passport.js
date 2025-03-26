const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const User = require('../models/User');

passport.use(new LocalStrategy(
  { usernameField: 'email' },
  async (email, password, done) => {
    try {
      console.log('🚀 Email received:', email);
      console.log('🔑 Password entered:', password);

      const user = await User.findOne({ email: email.toLowerCase() });
      if (!user) {
        console.log('❌ User not found');
        return done(null, false, { message: 'Invalid email or password' });
      }

      console.log('🧠 Password hash from DB:', user.password);

      const isMatch = await user.comparePassword(password);
      console.log('🔍 bcrypt.compare result:', isMatch);

      if (!isMatch) {
        console.log('❌ Passwords do not match');
        return done(null, false, { message: 'Invalid email or password' });
      }

      console.log('✅ Password match, logging in user');
      return done(null, user);
    } catch (err) {
      console.error('🔥 Error in local strategy:', err);
      return done(err);
    }
  }
));


passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err);
  }
});

module.exports = passport;