import express from 'express';

const app = express();

// Placeholder. Making sure it works.
app.get('/search', (req, res) => res.json([]));

app.listen(3000, () => console.log('Server running on http://localhost:3000'));