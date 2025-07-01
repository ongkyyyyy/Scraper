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

    console.log("Launching Puppeteer with Stealth Plugin...");
    const browser = await puppeteer.launch({ 
        headless: "new",  
        defaultViewport: null, 
        args: [
            "--start-maximized",
            "--disable-notifications", 
            "--disable-infobars", 
            "--disable-popup-blocking"
        ] 
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36');

    page.on('dialog', async dialog => {
        console.log(`Dismissing popup: ${dialog.message()}`);
        await dialog.dismiss();
    });

    console.log(`Opening the hotel page: ${hotelUrl}`);
    await page.goto(hotelUrl, { waitUntil: 'domcontentloaded' });

    const hotelName = await page.evaluate(() => {
        const hotelNameElem = document.querySelector('h1[data-testid="name"]');
        return hotelNameElem ? hotelNameElem.innerText.trim() : 'Unknown Hotel';
    });
    
    console.log(`Hotel Name: ${hotelName}`);

    console.log("Searching for 'Lihat Semua' button...");
    const seeAllButton = await page.$('span[data-testid="see-all"]');

    if (seeAllButton) {
        console.log("Scrolling to 'Lihat Semua' button...");
        await page.evaluate(element => {
            element.scrollIntoView({ behavior: "smooth", block: "center" });
        }, seeAllButton);

        await new Promise(resolve => setTimeout(resolve, 1000));

        console.log("Clicking 'Lihat Semua' button...");
        await page.evaluate(element => {
            if (element.innerText.trim() === "Lihat semua") {
                element.click();
            }
        }, seeAllButton);

        console.log("✅ Successfully clicked 'Lihat Semua'!");
    } else {
        console.log("❌ Error: 'Lihat Semua' button not found.");
    }

    console.log("Searching for 'Sort' text...");

    await page.waitForFunction(() => {
        return [...document.querySelectorAll("button span")]
            .some(span => span.textContent.trim() === "Sort");
    }, { timeout: 10000 }).catch(() => console.log("❌ 'Sort' text not found."));

    const sortText = await page.evaluateHandle(() => {
        return [...document.querySelectorAll("button span")]
            .find(span => span.textContent.trim() === "Sort");
    });

    if (sortText) {
        console.log("Scrolling to 'Sort' text...");
        await page.evaluate(element => {
            element.scrollIntoView({ behavior: "smooth", block: "center" });
        }, sortText);

        await new Promise(resolve => setTimeout(resolve, 1000)); 

        console.log("Clicking 'Sort' text...");
        await page.evaluate(element => element.click(), sortText);

        console.log("✅ Successfully clicked 'Sort' text!");
    } else {
        console.log("❌ Error: 'Sort' text not found.");
    }

    console.log("Searching for 'Latest Review' option...");

    await page.waitForFunction(() => {
        return [...document.querySelectorAll("span")]
            .some(span => span.textContent.trim() === "Latest Review");
    }, { timeout: 10000 }).catch(() => console.log("❌ 'Latest Review' option not found."));

    const latestReviewOption = await page.evaluateHandle(() => {
        return [...document.querySelectorAll("span")]
            .find(span => span.textContent.trim() === "Latest Review");
    });

    if (latestReviewOption) {
        console.log("Scrolling to 'Latest Review' option...");
        await page.evaluate(element => {
            element.scrollIntoView({ behavior: "smooth", block: "center" });
        }, latestReviewOption);

        await new Promise(resolve => setTimeout(resolve, 1000)); 

        console.log("Clicking 'Latest Review' option...");
        await page.evaluate(element => element.click(), latestReviewOption);

        console.log("✅ Successfully clicked 'Latest Review' option!");
    } else {
        console.log("❌ Error: 'Latest Review' option not found.");
    }

    let allReviews = [];
    let pageCounter = 1;
    let lastReviewText = "";
    let retryAttempt = 0;

    while (true) {
        console.log(`Scraping page ${pageCounter}...`);
        await new Promise(resolve => setTimeout(resolve, 3000)); 

        let reviews = [];

        try {
            reviews = await page.evaluate((hotelName) => {
                return Array.from(document.querySelectorAll('[data-testid="review-card"]')).map(review => {
                    const usernameElem = review.querySelector('[class*="ReviewCard_customer_name"]');
                    const ratingElem = review.querySelector('.ReviewCard_user_review__HvsOH');
                    const commentElem = review.querySelector('.ReadMoreComments_review_card_comment__R_W2B');
            
                    const timestampElem = Array.from(review.querySelectorAll("span"))
                        .find(span => span.innerText.match(/\d{1,2} \w{3,} \d{4}/));
            
                    return {
                        username: usernameElem ? usernameElem.innerText.trim() : 'Anonymous',
                        rating: ratingElem ? parseFloat(ratingElem.innerText.trim().replace(',', '.')) * 2 : null,
                        comment: commentElem && commentElem.innerText.trim() ? commentElem.innerText.trim() : '-',
                        timestamp: (() => {
                            if (!timestampElem) return 'Unknown Date';
                            const months = {
                                Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
                                Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11
                            };
                            const match = timestampElem.innerText.trim().match(/(\d{1,2}) (\w{3}) (\d{4})/);
                            if (!match) return 'Unknown Date';
                            const [_, day, monthAbbrev, year] = match;
                            const dateObj = new Date(year, months[monthAbbrev], day);
                            const dd = String(dateObj.getDate()).padStart(2, '0');
                            const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
                            const yyyy = String(dateObj.getFullYear());
                            return `${dd}-${mm}-${yyyy}`;
                        })(),
                        hotel_name: hotelName,
                        OTA: 'Ticket.com'
                    };
                }).filter(review => review.comment && review.rating !== null && review.rating > 0);
            }, hotelName);            
        } catch (err) {
            console.log("❌ Error during review extraction. Retrying...");
            retryAttempt++;
            if (retryAttempt >= 3) {
                console.log("❌ Maximum retry attempts reached. Stopping.");
                break;
            }
            continue;
        }

        if (reviews.length > 0 && reviews[0].comment === lastReviewText) {
            console.log("⚠️ Detected repeated review page. Retrying...");
            retryAttempt++;
            if (retryAttempt >= 3) {
                console.log("❌ Maximum retry attempts due to repetition reached. Stopping.");
                break;
            }
            continue;
        } else {
            retryAttempt = 0;
            lastReviewText = reviews.length > 0 ? reviews[0].comment : lastReviewText;
        }

        let foundOldReview = false;

        for (const review of reviews) {
            const year = parseInt(review.timestamp.split("-")[2], 10);
            if (!year || year < 2024) {
                console.log("Encountered review before 2024. Stopping.");
                foundOldReview = true;
                break;
            }
            allReviews.push(review);
        }

        console.log(`Collected ${reviews.length} reviews from page ${pageCounter}.`);

        if (foundOldReview) {
            console.log("Total Reviews Scraped:", allReviews.length);
            await sendReviews(allReviews, hotelId);
            console.log("Closing browser...");
            await browser.close();
            return;
        }

        const nextPageButton = await page.$('div[data-testid="chevron-right-pagination"]');

        if (!nextPageButton) {
            console.log("❌ No 'Next Page' button found. Ending scraping.");
            break;
        }

        const isDisabled = await page.evaluate(button => {
            return button.getAttribute('aria-disabled') === "true";
        }, nextPageButton);

        if (isDisabled) {
            console.log("❌ 'Next Page' button is disabled. Stopping pagination.");
            break;
        }

        console.log("Navigating to the next page...");
        await nextPageButton.click();

        await new Promise(resolve => setTimeout(resolve, 3000));
        pageCounter++;
    }     

    console.log("Total Reviews Scraped:", allReviews.length);
    await sendReviews(allReviews, hotelId);
    console.log("Closing browser...");
    await browser.close();
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
            console.log('Hotel ID:', hotelId);
        } else {
            console.log('ℹ️ No valid reviews found.');
        }
    } catch (error) {
        console.error('❌ Error sending data:', error.message);
    }
}

scrapeReviews();
