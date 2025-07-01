const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');
const { BACKEND_URL } = require('./config');

puppeteer.use(StealthPlugin());

async function scrapeReviews(retryAttempt = 0) {
    const MAX_RETRIES = 3;

    const hotelUrl = process.argv[2];
    const hotelId = process.argv[3];

    if (!hotelUrl || !hotelId) {
        console.error("❌ Usage: node script.js <hotelUrl> <hotelId>");
        process.exit(1);
    }

    console.log(`Launching Puppeteer (Attempt ${retryAttempt + 1})...`);
    const browser = await puppeteer.launch({
        headless: "new",
        defaultViewport: null,
        args: ["--start-maximized"]
    });

    try {
        console.log("✅ Opened browser, creating new page...");
        const page = await browser.newPage();

        console.log("✅ Setting user agent...");
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)...');

        console.log(`✅ Going to URL: ${hotelUrl}`);
        await page.goto(hotelUrl, { waitUntil: 'domcontentloaded' });

        const hotelName = await page.evaluate(() => {
            const hotelNameElem = document.querySelector('[data-testid="display_name_label"]');
            return hotelNameElem ? hotelNameElem.innerText.trim() : 'Unknown Hotel';
        });

        console.log(`Hotel Name: ${hotelName}`);

        let allReviews = [];
        let pageCounter = 1;

        while (true) {
            console.log(`Scraping page ${pageCounter}...`);
            await new Promise(resolve => setTimeout(resolve, 3000));

            const reviews = await page.evaluate((hotelName) => {
                function convertToDate(relativeDate) {
                    const now = new Date();
                    const weekMatch = relativeDate.match(/Diulas\s+(\d+)\s+minggu\s+lalu/);
                    const dayMatch = relativeDate.match(/Diulas\s+(\d+)\s+hari\s+lalu/);

                    if (weekMatch) {
                        const weeksAgo = parseInt(weekMatch[1]);
                        now.setDate(now.getDate() - weeksAgo * 7);
                        return now;
                    }

                    if (dayMatch) {
                        const daysAgo = parseInt(dayMatch[1]);
                        now.setDate(now.getDate() - daysAgo);
                        return now;
                    }

                    return null;
                }

                return Array.from(document.querySelectorAll('.css-1dbjc4n.r-14lw9ot.r-h1746q.r-kdyh1x.r-d045u9.r-1udh08x.r-d23pfw')).map(review => {
                    const usernameElem = Array.from(review.querySelectorAll('div.css-901oao'))
                    .find(el => el.innerText && !el.innerText.match(/Diulas\s+\d+\s+(minggu|hari)\s+lalu/) && el.innerText.length <= 10);
                    const ratingElem = review.querySelector('[data-testid="tvat-ratingScore"]');
                    const commentElem = review.querySelector('.css-901oao.css-cens5h');
                    const timestampElem = Array.from(review.querySelectorAll("div.css-901oao"))
                        .find(div => div.innerText.match(/Diulas\s+\d+\s+(minggu\s+lalu|hari\s+lalu)/));

                    return {
                        username: usernameElem ? usernameElem.innerText.trim() : 'Anonymous',
                        rating: ratingElem ? parseFloat(ratingElem.innerText.trim().replace(',', '.')) : null,
                        comment: commentElem && commentElem.innerText.trim() ? commentElem.innerText.trim() : '-',
                        timestamp: (() => {
                            if (!timestampElem) return 'Unknown Date';

                            const dateObj = convertToDate(timestampElem.innerText.trim());
                            if (!dateObj) return 'Unknown Date';

                            const dd = String(dateObj.getDate()).padStart(2, '0');
                            const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
                            const yyyy = String(dateObj.getFullYear());
                            return `${dd}-${mm}-${yyyy}`;
                        })(),
                        hotel_name: hotelName,
                        OTA: 'Traveloka'
                    };
                }).filter(review => review.comment && review.rating !== null && review.rating > 0);
            }, hotelName);

            for (const review of reviews) {
                const [day, month, year] = review.timestamp.split('-').map(val => parseInt(val, 10));
                if (!year || year < 2024) {
                    console.log("Encountered 2023 or earlier review or invalid date. Stopping scraping.");
                    console.log("Total Reviews Scraped:", allReviews.length);
                    await sendReviews(allReviews, hotelId);
                    await browser.close();
                    return;
                }
                allReviews.push(review);
            }

            console.log(`Collected ${reviews.length} reviews from page ${pageCounter}.`);

            const nextPageButton = await page.$('img[src*="ff1bf47098bb677fe4ba66933f585fab.svg"]');
            if (!nextPageButton) {
                console.log("No more pages to scrape.");
                break;
            }

            const isDisabled = await page.evaluate(button => {
                return button.closest('div[role="button"]').getAttribute('aria-disabled') === "true";
            }, nextPageButton);

            if (isDisabled) {
                console.log("Next page button is disabled. Stopping pagination.");
                break;
            }

            console.log("Navigating to the next page...");
            await nextPageButton.click();
            await new Promise(resolve => setTimeout(resolve, 3000));
            pageCounter++;
        }

        console.log("Total Reviews Scraped:", allReviews.length);
        await sendReviews(allReviews, hotelId);
    } catch (err) {
        console.error(`❌ Error during scraping: ${err.message}`);
        await browser.close();
        if (retryAttempt + 1 < MAX_RETRIES) {
            console.log("🔁 Retrying scrape...");
            await new Promise(resolve => setTimeout(resolve, 5000));
            return scrapeReviews(retryAttempt + 1);
        } else {
            console.error("❌ Max retry attempts reached. Giving up.");
        }
        return;
    }

    console.log("Closing browser...");
    await browser.close();
}

async function sendReviews(reviews, hotelId) {
    try {
        if (reviews.length > 0) {
            await axios.post(`${BACKEND_URL}/reviews`, {
                reviews,
                hotel_id: hotelId,
                ota: "traveloka"
            });
            console.log('✅ Data sent to backend successfully');
            console.log('Total Reviews Sent:', reviews.length);
            console.log('Hotel ID:', hotelId);
        } else {
            console.log('ℹ️ No valid reviews found.');
        }
    } catch (error) {
        console.error('❌ Error sending data:', error.message);
    }
}

scrapeReviews();
