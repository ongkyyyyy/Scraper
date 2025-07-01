const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');
const crypto = require('crypto');
const { BACKEND_URL } = require('./config');

puppeteer.use(StealthPlugin());

function randomDelay(min = 200, max = 1000) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function humanScroll(page) {
    const scrollStep = 300 + Math.random() * 300;
    const scrollDelay = randomDelay(100, 400);
    let totalHeight = 0;
    let distance = scrollStep;

    while (totalHeight < await page.evaluate('document.body.scrollHeight')) {
        await page.evaluate(`window.scrollBy(0, ${distance})`);
        totalHeight += distance;
        await sleep(scrollDelay);
    }
}

async function clickElement(page, selector) {
    const element = await page.$(selector);
    if (element) {
        const box = await element.boundingBox();
        if (box) {
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 15 });
            await sleep(randomDelay(200, 800));
            await element.click();
        }
    }
}

async function scrapeReviews(retryAttempt = 0) {
    const hotelUrl = process.argv[2];
    const hotelId = process.argv[3];  

    if (!hotelUrl || !hotelId) {
        console.error("❌ Usage: node script.js <hotelUrl> <hotelId>");
        process.exit(1);
    }

    const MAX_RETRIES = 3;
    const userAgents = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko)"
    ];

    console.log(`Launching Puppeteer (Attempt ${retryAttempt + 1})...`);
    const browser = await puppeteer.launch({
        headless: "new",
        defaultViewport: {
            width: 1280 + Math.floor(Math.random() * 100),
            height: 720 + Math.floor(Math.random() * 100),
            deviceScaleFactor: 1
        },
        args: ["--start-maximized", "--disable-notifications", "--disable-infobars", "--disable-popup-blocking"]
    });

    try {
        const page = await browser.newPage();
        const userAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
        await page.setUserAgent(userAgent);
        await page.setCacheEnabled(true);

        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
            Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
        });

        await page.goto(hotelUrl, { waitUntil: 'networkidle2' });
        await sleep(randomDelay(1000, 2000));

        await page.waitForSelector('[data-element-name="check-in-box"]', { timeout: 5000 });
        await clickElement(page, '[data-element-name="check-in-box"]');
        await sleep(randomDelay(800, 1200));

        await page.waitForSelector('[data-selenium="hotel-header-name"]');
        const hotelName = await page.evaluate(() => {
            const hotelNameElem = document.querySelector('[data-selenium="hotel-header-name"]');
            return hotelNameElem ? hotelNameElem.innerText.trim() : 'Unknown Hotel';
        });

        await page.waitForSelector('#review-sort-id', { timeout: 10000 });
        await page.evaluate(() => {
            const select = document.querySelector('#review-sort-id');
            if (select) {
                select.scrollIntoView();
                select.value = "1";
                select.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });

        await sleep(randomDelay(2000, 3000));

        let allReviews = [];
        let pageCounter = 1;
        let previousHash = null;
        let sameContentCount = 0;

        while (true) {
            console.log(`Scraping page ${pageCounter}...`);
            await humanScroll(page);
            await sleep(randomDelay(1500, 2500));

            const reviews = await page.evaluate((hotelName) => {
                return Array.from(document.querySelectorAll('div.Review-comment[data-element-name="review-comment"][role="group"][aria-label]'))
                    .filter(el => el.offsetParent !== null)
                    .map(review => {
                        const reviewerContainer = review.querySelector('[data-info-type="reviewer-name"]');
                        const usernameElem = reviewerContainer ? reviewerContainer.querySelector('strong') : null;

                        const ratingElem = Array.from(review.querySelectorAll('div'))
                            .find(div => div.className.includes('Review-comment-leftScore'));

                        const commentElem = review.querySelector('p[data-testid="review-comment"]');

                        const timestampElem = Array.from(review.querySelectorAll('span'))
                            .find(span => span.innerText && span.innerText.trim().startsWith('Diulas pada'));
                        const timestampText = timestampElem ? timestampElem.innerText.replace('Diulas pada', '').trim() : 'Unknown Date';

                        return {
                            username: usernameElem ? usernameElem.innerText.trim() : 'Anonymous',
                            rating: ratingElem ? parseFloat(ratingElem.innerText.trim().replace(',', '.')) : null,
                            comment: commentElem && commentElem.innerText.trim() ? commentElem.innerText.trim() : '-',
                            timestamp: (() => {
                                const months = {
                                    Januari: '01', Februari: '02', Maret: '03', April: '04', Mei: '05', Juni: '06',
                                    Juli: '07', Agustus: '08', September: '09', Oktober: '10', November: '11', Desember: '12'
                                };
                                const parts = timestampText.split(' ');
                                if (parts.length === 3) {
                                    const day = parts[0].padStart(2, '0');
                                    const month = months[parts[1]] || '01';
                                    const year = parts[2];
                                    return `${day}-${month}-${year}`;
                                }
                                return '01-01-1970';
                            })(),
                            hotel_name: hotelName,
                            OTA: 'Agoda'
                        };
                    }).filter(review => review.comment && review.rating !== null && review.rating > 0);
            }, hotelName);

            if (reviews.length === 0) {
                console.warn("⚠️ No reviews found. Restarting process...");
                throw new Error("No reviews found.");
            }

            const currentHash = crypto.createHash('md5').update(JSON.stringify(reviews)).digest('hex');
            if (currentHash === previousHash) {
                sameContentCount++;
                console.warn(`⚠️ Same content detected (${sameContentCount} times).`);
                if (sameContentCount >= 3) {
                    throw new Error("Same reviews repeated too many times. Restarting.");
                }
            } else {
                sameContentCount = 0;
                previousHash = currentHash;
            }

            for (const review of reviews) {
                const [day, month, year] = review.timestamp.split('-').map(val => parseInt(val, 10));
                if (!year || year < 2024) {
                    console.log("Encountered 2023 or earlier review or invalid date. Stopping scraping.");
                    await sendReviews(allReviews, hotelId);
                    await browser.close();
                    return;
                }
            }

            console.log(`✅ Collected ${reviews.length} reviews from page ${pageCounter}.`);
            allReviews.push(...reviews);

            const nextPageButtons = await page.$$('button[data-element-name="review-paginator-next"]');
            const nextPageButton = nextPageButtons[nextPageButtons.length - 1];

            const isDisabled = await page.evaluate(button => {
                return button.getAttribute('aria-disabled') === "true";
            }, nextPageButton);

            if (isDisabled) {
                console.log("🚫 Next page button is disabled. Stopping pagination.");
                break;
            }

            await humanScroll(page);
            await sleep(randomDelay(800, 1500));
            await nextPageButton.click();
            await sleep(randomDelay(2000, 3000));
            pageCounter++;
        }

        console.log("✅ Total Reviews Scraped:", allReviews.length);
        await sendReviews(allReviews, hotelId);
    } catch (err) {
        console.error(`❌ Error: ${err.message}`);
        await browser.close();
        if (retryAttempt + 1 < MAX_RETRIES) {
            console.log("🔁 Retrying scrape...");
            await sleep(Math.pow(2, retryAttempt + 1) * 1000 + randomDelay(0, 1000));
            return scrapeReviews(retryAttempt + 1);
        }
    }
    await browser.close();
}

async function sendReviews(reviews, hotelId) {
    try {
        if (reviews.length > 0) {
            await axios.post(`${BACKEND_URL}/reviews`, {
                reviews,
                hotel_id: hotelId,
                ota: "agoda"
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
