const express = require('express');
const { exec } = require('child_process');
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
  const command = `node "${scriptPath}" "${hotelUrl}" "${hotelId}"`;

  console.log(`🚀 Executing: ${command}`);

  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error(`❌ Scraper error: ${stderr || error.message}`);
      return res.status(500).json({ error: `Scraper failed: ${error.message}` });
    }

    console.log(`✅ Scraper completed:\n${stdout}`);

    const outputLines = stdout.trim().split('\n');
    const lastLine = outputLines[outputLines.length - 1];

    return res.status(200).json({
      message: lastLine || 'Scraper finished.',
      raw_output: stdout
    });
  });
});

app.listen(PORT, () => console.log(`🚀 Scraper API running on http://localhost:${PORT}`));
