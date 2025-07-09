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
        headless: true,  // 👈 HEADLESS FOR RAILWAY
        defaultViewport: null,
        args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36');

    try {
        console.log(`🌐 Navigating to: ${hotelUrl}`);
        await page.goto(hotelUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);
        console.log("✅ Page loaded");

        // 🔍 DEBUG: Check initial render
        const contentLength = (await page.content()).length;
        console.log("🪵 Page content length:", contentLength);

        // ⛔ Promo popup check
        const promoBtn = await page.$('button[data-role="secondaryCtaClose"]');
        if (promoBtn) {
            console.log("✅ Promo popup detected, clicking close button...");
            await promoBtn.click();
            await page.waitForTimeout(1000);
        } else {
            console.log("ℹ️ No promo popup found");
        }

        // ⛔ 'Lihat semua' button check
        const seeAllBtn = await page.$('span[data-testid="see-all"]');
        if (seeAllBtn) {
            console.log("✅ 'Lihat semua' button found. Clicking...");
            await page.evaluate(() => {
                const seeAll = document.querySelector('span[data-testid="see-all"]');
                if (seeAll) {
                    seeAll.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    seeAll.click();
                }
            });
            await page.waitForTimeout(2000);
        } else {
            throw new Error("❌ 'Lihat semua' button not found — page may not have loaded reviews");
        }

        // ⛔ Click Sort -> Latest Review
        try {
            await page.evaluate(() => {
                const sortBtn = Array.from(document.querySelectorAll("button span"))
                    .find(el => el.innerText.trim() === "Sort");
                if (sortBtn) sortBtn.click();
            });
            await page.waitForTimeout(1000);
            await page.evaluate(() => {
                const latestBtn = Array.from(document.querySelectorAll("span"))
                    .find(el => el.innerText.trim() === "Latest Review");
                if (latestBtn) latestBtn.click();
            });
            console.log("✅ Sorted by latest reviews");
        } catch (err) {
            console.warn("⚠️ Sort interaction failed:", err.message);
        }

        let allReviews = [];
        let pageCounter = 1;
        let lastComment = '';
        let retryCount = 0;

        while (true) {
            console.log(`📄 Scraping page ${pageCounter}...`);
            await page.waitForTimeout(2000);

            const reviews = await page.evaluate(() => {
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
                        hotel_name: document.querySelector('h1[data-testid="name"]')?.innerText || 'Unknown Hotel',
                        OTA: 'Tiket.com'
                    };
                }).filter(r => r.comment && r.rating !== null && r.rating > 0);
            });

            if (reviews.length === 0 || (reviews[0].comment === lastComment && retryCount++ >= 2)) {
                console.log("⚠️ No new reviews or repeated content, stopping.");
                break;
            }

            lastComment = reviews[0].comment;
            retryCount = 0;

            for (const review of reviews) {
                const year = parseInt(review.timestamp.split("-")[2], 10);
                if (year < 2024) {
                    console.log("🛑 Found old review before 2024, stopping.");
                    await sendReviews(allReviews, hotelId);
                    await browser.close();
                    return;
                }
                allReviews.push(review);
            }

            console.log(`✅ Collected ${reviews.length} reviews from page ${pageCounter}.`);

            const hasNext = await page.evaluate(() => {
                const nextBtn = document.querySelector('[data-testid="chevron-right-pagination"]');
                return nextBtn && nextBtn.getAttribute('aria-disabled') !== 'true';
            });

            if (!hasNext) {
                console.log("🚫 No more pages.");
                break;
            }

            await page.evaluate(() => {
                document.querySelector('[data-testid="chevron-right-pagination"]').click();
            });
            await page.waitForTimeout(3000);
            pageCounter++;
        }

        console.log("🎉 Total Reviews Scraped:", allReviews.length);
        await sendReviews(allReviews, hotelId);

    } catch (err) {
        console.error("❌ Scraper failed:", err.message);
    } finally {
        console.log("🔒 Browser closed");
        await browser.close();
    }
}

async function sendReviews(reviews, hotelId) {
    try {
        if (reviews.length > 0) {
            await axios.post(`${BACKEND_URL}/reviews`, {
                reviews,
                hotel_id: hotelId,
                ota: "ticket.com"
            });
            console.log('✅ Data sent to backend successfully');
            console.log('Total Reviews Sent:', reviews.length);
        } else {
            console.log('ℹ️ No valid reviews found.');
        }
    } catch (error) {
        console.error('❌ Error sending data:', error.message);
    }
}

scrapeReviews();
