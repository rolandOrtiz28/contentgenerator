const bcrypt = require('bcryptjs');

const tempPassword = 'temp123';

bcrypt.hash(tempPassword, 10, (err, hash) => {
  if (err) {
    console.error('Error hashing password:', err);
    return;
  }
  console.log('Hashed Password:', hash);
});