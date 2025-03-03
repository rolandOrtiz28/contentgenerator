/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
      './views/**/*.ejs', // Scan all EJS files in the views folder
      './public/**/*.html', // Scan HTML files if any
      './src/**/*.css' // Scan CSS files, including src/input.css
    ],
    theme: {
      extend: {},
    },
    plugins: [],
  }