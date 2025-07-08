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

    const browser = await puppeteer.launch({
        headless: "new",
        defaultViewport: null,
        args: ["--start-maximized", "--no-sandbox", "--disable-setuid-sandbox"]
    });

    try {
        const page = await browser.newPage();
        await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");

        await page.goto(hotelUrl, { waitUntil: "domcontentloaded" });

        const hotelName = await page.evaluate(() => {
            const elem = document.querySelector('h1[data-testid="name"]');
            return elem ? elem.innerText.trim() : 'Unknown Hotel';
        });

        const seeAllBtn = await page.$('span[data-testid="see-all"]');
        if (seeAllBtn) {
            await seeAllBtn.evaluate(el => el.scrollIntoView({ behavior: "smooth" }));
            await new Promise(r => setTimeout(r, 500));
            await seeAllBtn.click();
            await new Promise(r => setTimeout(r, 1000));
        }

        let allReviews = [];
        let pageCounter = 1;
        let retry = 0;

        while (true) {
            console.log(`🔄 Scraping page ${pageCounter}...`);
            await new Promise(r => setTimeout(r, 2000));

            const reviews = await page.evaluate(hotelName => {
                return Array.from(document.querySelectorAll('[data-testid="review-card"]')).map(card => {
                    const username = card.querySelector('.ReviewCard_customer_name__mwGEt')?.innerText.trim() || 'Anonymous';
                    const ratingRaw = card.querySelector('.ReviewCard_user_review__HvsOH')?.innerText.trim() || '';
                    const comment = card.querySelector('.ReadMoreComments_review_card_comment__R_W2B')?.innerText.trim() || '-';
                    const dateText = card.querySelector('.ReviewCard_date__Nr8Lq')?.innerText.trim() || '';

                    const months = {
                        Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
                        Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12"
                    };
                    let formattedDate = "Unknown Date";
                    const dateMatch = dateText.match(/(\d{1,2}) (\w{3}) (\d{4})/);
                    if (dateMatch) {
                        const [_, day, mon, year] = dateMatch;
                        formattedDate = `${day.padStart(2, '0')}-${months[mon]}-${year}`;
                    }

                    return {
                        username,
                        rating: parseFloat(ratingRaw.replace(',', '.')) * 2 || null,
                        comment,
                        timestamp: formattedDate,
                        hotel_name: hotelName,
                        OTA: "Ticket.com"
                    };
                }).filter(r => r.rating !== null && r.comment);
            }, hotelName);

            if (reviews.length === 0) {
                if (++retry >= MAX_RETRIES) {
                    console.warn("⚠️ No reviews found repeatedly. Stopping.");
                    break;
                }
                continue;
            }

            let stop = false;
            for (const review of reviews) {
                const year = parseInt(review.timestamp.split("-")[2], 10);
                if (isNaN(year) || year < 2024) {
                    console.log("🛑 Found old review. Stopping.");
                    stop = true;
                    break;
                }
                allReviews.push(review);
            }

            if (stop) break;
            console.log(`✅ Page ${pageCounter} collected ${reviews.length} reviews.`);

            const nextPageBtn = await page.$('div[data-testid="chevron-right-pagination"]');
            if (!nextPageBtn) break;

            const disabled = await nextPageBtn.evaluate(el => el.getAttribute("aria-disabled") === "true");
            if (disabled) break;

            await nextPageBtn.click();
            await new Promise(r => setTimeout(r, 2000));
            pageCounter++;
        }

        console.log(`📦 Total reviews collected: ${allReviews.length}`);
        await sendReviews(allReviews, hotelId);
        await browser.close();
    } catch (err) {
        console.error("❌ Error:", err.message);
        await browser.close();
        if (retryAttempt + 1 < MAX_RETRIES) {
            console.log("🔁 Retrying...");
            await new Promise(r => setTimeout(r, 3000));
            return scrapeReviews(retryAttempt + 1);
        }
    }
}

async function sendReviews(reviews, hotelId) {
    try {
        if (reviews.length > 0) {
            await axios.post(`${BACKEND_URL}/reviews`, {
                reviews,
                hotel_id: hotelId,
                ota: "ticket"
            });
            console.log("✅ Sent reviews to backend.");
        } else {
            console.log("ℹ️ No valid reviews to send.");
        }
    } catch (err) {
        console.error("❌ Failed to send data:", err.message);
    }
}

scrapeReviews();
