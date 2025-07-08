const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');
const { BACKEND_URL } = require('./config');

puppeteer.use(StealthPlugin());

async function scrapeReviews() {
    const hotelUrl = process.argv[2];
    const hotelId = process.argv[3];

    if (!hotelUrl || !hotelId) {
        console.error("❌ Usage: node script.js <hotelUrl> <hotelId>");
        process.exit(1);
    }

    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: null,
        args: ["--start-maximized", "--no-sandbox", "--disable-setuid-sandbox"]
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36');

    try {
        await page.goto(hotelUrl, { waitUntil: 'domcontentloaded' });

        const hotelName = await page.evaluate(() => {
            const el = document.querySelector('h1[data-testid="name"]');
            return el ? el.innerText.trim() : 'Unknown Hotel';
        });

        // Click "Lihat semua"
        const seeAll = await page.$('span[data-testid="see-all"]');
        if (seeAll) {
            await page.evaluate(el => el.scrollIntoView({ behavior: 'smooth' }), seeAll);
            await page.waitForTimeout(1000);
            await seeAll.click();
            await page.waitForTimeout(2000);
        }

        // Click "Sort"
        await page.waitForSelector("button span", { timeout: 10000 });
        const sortBtnHandle = await page.evaluateHandle(() => {
            return Array.from(document.querySelectorAll("button span"))
                .find(el => el.innerText.trim() === "Sort");
        });

        if (sortBtnHandle) {
            await page.evaluate(el => el.scrollIntoView({ behavior: 'smooth' }), sortBtnHandle);
            await page.waitForTimeout(1000);
            await page.evaluate(el => el.click(), sortBtnHandle);
            await page.waitForTimeout(1000);
        }

        // Click "Latest Review"
        const latestReviewHandle = await page.evaluateHandle(() => {
            return Array.from(document.querySelectorAll("span"))
                .find(el => el.innerText.trim() === "Latest Review");
        });

        if (latestReviewHandle) {
            await page.evaluate(el => el.scrollIntoView({ behavior: 'smooth' }), latestReviewHandle);
            await page.waitForTimeout(1000);
            await page.evaluate(el => el.click(), latestReviewHandle);
            await page.waitForTimeout(2000);
        }

        let allReviews = [];
        let pageCounter = 1;
        let lastComment = '';
        let retryCount = 0;

        while (true) {
            console.log(`Scraping page ${pageCounter}...`);
            await page.waitForTimeout(2000);

            const reviews = await page.evaluate(hotelName => {
                const monthMap = {
                    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
                    Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11
                };

                return Array.from(document.querySelectorAll('[data-testid="review-card"]')).map(card => {
                    const name = card.querySelector('[class*="ReviewCard_customer_name"]');
                    const rating = card.querySelector('.ReviewCard_user_review__HvsOH');
                    const comment = card.querySelector('.ReadMoreComments_review_card_comment__R_W2B');
                    const dateText = Array.from(card.querySelectorAll('span'))
                        .find(s => s.innerText.match(/\d{1,2} \w+ \d{4}/));

                    let formattedDate = 'Unknown Date';
                    if (dateText) {
                        const match = dateText.innerText.match(/(\d{1,2}) (\w+) (\d{4})/);
                        if (match) {
                            const [_, day, month, year] = match;
                            const date = new Date(year, monthMap[month.substring(0, 3)], day);
                            formattedDate = `${String(date.getDate()).padStart(2, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${date.getFullYear()}`;
                        }
                    }

                    return {
                        username: name ? name.innerText.trim() : 'Anonymous',
                        rating: rating ? parseFloat(rating.innerText.replace(',', '.')) * 2 : null,
                        comment: comment ? comment.innerText.trim() : '-',
                        timestamp: formattedDate,
                        hotel_name: hotelName,
                        OTA: 'Tiket.com'
                    };
                }).filter(r => r.comment && r.rating !== null && r.rating > 0);
            }, hotelName);

            if (reviews.length === 0 || (reviews[0].comment === lastComment && retryCount++ >= 2)) {
                console.log("No new reviews or duplicate page, stopping.");
                break;
            }

            lastComment = reviews[0].comment;
            retryCount = 0;

            for (const review of reviews) {
                const year = parseInt(review.timestamp.split("-")[2], 10);
                if (year < 2024) {
                    console.log("Found review before 2024, stopping.");
                    await sendReviews(allReviews, hotelId);
                    await browser.close();
                    return;
                }
                allReviews.push(review);
            }

            console.log(`Collected ${reviews.length} reviews from page ${pageCounter}.`);

            const nextBtn = await page.$('div[data-testid="chevron-right-pagination"]');
            if (!nextBtn) {
                console.log("No more pages.");
                break;
            }

            const isDisabled = await page.evaluate(btn => btn.getAttribute('aria-disabled') === 'true', nextBtn);
            if (isDisabled) {
                console.log("Next button is disabled.");
                break;
            }

            await nextBtn.click();
            await page.waitForTimeout(3000);
            pageCounter++;
        }

        console.log("Total Reviews:", allReviews.length);
        await sendReviews(allReviews, hotelId);
    } catch (err) {
        console.error("❌ Scraper failed:", err.message);
    } finally {
        await browser.close();
    }
}

async function sendReviews(reviews, hotelId) {
    if (!reviews.length) {
        console.log("No reviews to send.");
        return;
    }

    try {
        const response = await axios.post(`${BACKEND_URL}/reviews`, {
            reviews,
            hotel_id: hotelId,
            ota: "tiket.com"
        });
        console.log("✅ Sent", reviews.length, "reviews to backend.");
    } catch (err) {
        console.error("❌ Failed to send reviews:", err.message);
    }
}

scrapeReviews();
