import app from './app.js';

const port = process.env.PORT || 3000;
app.listen(port, (err) => {
  if (err) {
    console.error(`Could not start on port ${port}: ${err.message}`);
    process.exit(1);
  }
  console.log(`API running on http://localhost:${port}`);
});