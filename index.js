const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

const scraperMap = {
  traveloka: 'traveloka_scrape_reviews.js',
  ticketcom: 'ticketcom_scrape_reviews.js',
  agoda: 'agoda_scrape_reviews.js',
  tripcom: 'tripcom_scrape_reviews.js'
};

app.get('/api/:source', (req, res) => {
  const source = req.params.source;
  const hotelUrl = req.query.url;
  const hotelId = req.query.hotel_id;

  if (!scraperMap[source]) {
    return res.status(400).json({ error: `Unsupported source: ${source}` });
  }

  if (!hotelUrl || !hotelId) {
    return res.status(400).json({ error: 'Missing url or hotel_id' });
  }

  const scriptPath = path.join(__dirname, scraperMap[source]);
  const scraper = spawn('node', [scriptPath, hotelUrl, hotelId]);

  let stdout = '';
  let stderr = '';

  scraper.stdout.on('data', (data) => {
    stdout += data.toString();
  });

  scraper.stderr.on('data', (data) => {
    stderr += data.toString();
  });

  scraper.on('close', (code) => {
    if (code === 0) {
      res.json({
        message: `${source} scraping completed. Data has been sent to /reviews endpoint.`,
        stdout: stdout.trim()
      });
    } else {
      res.status(500).json({
        error: `${source} scraping failed with code ${code}`,
        stderr: stderr.trim()
      });
    }
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Scraper API running on http://localhost:${PORT}`);
});
