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

    await new Promise(resolve => setTimeout(resolve, 2000));

    const hotelNameSelector = 'h1[class^="headInit_headInit-title_name"]';

        await page.waitForSelector(hotelNameSelector, { timeout: 2000 });

        await page.click(hotelNameSelector);
        console.log('Clicked the hotel name element once');

        await new Promise(resolve => setTimeout(resolve, 1000));

        const hotelName = await page.evaluate((selector) => {
            const hotelNameElem = document.querySelector(selector);
            return hotelNameElem ? hotelNameElem.innerText.trim() : 'Unknown Hotel';
        }, hotelNameSelector);

        console.log(`Hotel Name: ${hotelName}`);

    await new Promise(resolve => setTimeout(resolve, 1000));

    try {
        await page.waitForFunction(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            return buttons.some(btn => btn.textContent.includes('All reviews') || btn.textContent.includes('Semua ulasan'));
        }, { timeout: 8000 });
    
        await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const target = buttons.find(btn => 
                btn.textContent.includes('All reviews') || btn.textContent.includes('Semua ulasan')
            );
            if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                target.click();
            }
        });
    
        console.log('✅ Clicked the "All reviews" / "Semua ulasan" button');
        await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (err) {
        console.error('❌ Failed to click "All reviews" button:', err.message);
    }    

    await new Promise(resolve => setTimeout(resolve, 2000));

        try {
            await page.waitForSelector('li.ceOnXE_xI6aGRTgG_wCS', { timeout: 10000 });
        
            const clicked = await page.evaluate(() => {
                const items = Array.from(document.querySelectorAll('li.ceOnXE_xI6aGRTgG_wCS span'));
                for (const item of items) {
                    const text = item.innerText.trim().toLowerCase();
                    if (text === 'most recent' || text === 'terbaru') {
                        item.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        item.click();
                        return true;
                    }
                }
                return false;
            });
        
            if (clicked) {
                console.log('✅ Selected "Most Recent" or "Terbaru" from sort options');
            } else {
                console.warn('⚠️ Could not find the "Most Recent" or "Terbaru" option to click');
            }
        
            await new Promise(resolve => setTimeout(resolve, 3000));
        } catch (error) {
            console.error('❌ Failed to click on sort option:', error.message);
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
                const container = document.querySelector('div.drawer_drawerContainer__6G_8M');
                if (!container) return [];
            
                return Array.from(container.querySelectorAll('div.yRvZgc0SICPUbmdb2L2a')).map(review => {
                    const usernameElem = review.querySelector('.yCIHzFRsP6Tzk7Kia6Qo');
                    const ratingElem = review.querySelector('.xt_R_A70sdDRsOgExJWw');
                    const commentElem = review.querySelector('.UXjSnokalMIS5CzMtLSM');
                    const timestampElem = review.querySelector('.LPPTO8g2RH0Fk19jYMOQ');
            
                    return {
                        username: usernameElem ? usernameElem.innerText.trim() : 'Anonymous',
                        rating: ratingElem ? parseFloat(ratingElem.innerText.trim().replace(',', '.')) : null,
                        comment: commentElem && commentElem.innerText.trim() ? commentElem.innerText.trim() : '-',
                        timestamp: (() => {
                            if (!timestampElem) return 'Unknown Date';
                            const raw = timestampElem.innerText.trim();

                            const months = {
                                jan: 0, januari: 0,
                                feb: 1, februari: 1,
                                mar: 2, maret: 2,
                                apr: 3, april: 3,
                                may: 4, mei: 4,
                                jun: 5, juni: 5,
                                jul: 6, juli: 6,
                                aug: 7, agustus: 7,
                                sep: 8, september: 8,
                                oct: 9, oktober: 9,
                                nov: 10, november: 10,
                                dec: 11, desember: 11
                            };

                            let match = raw.match(/(?:Posted\s*)?(\w+)\s+(\d{1,2}),?\s+(\d{4})/i);
                            if (match) {
                                const [, monthName, day, year] = match;
                                const monthIndex = months[monthName.toLowerCase()];
                                if (monthIndex !== undefined) {
                                    const dateObj = new Date(year, monthIndex, day);
                                    const dd = String(dateObj.getDate()).padStart(2, '0');
                                    const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
                                    const yyyy = String(dateObj.getFullYear());
                                    return `${dd}-${mm}-${yyyy}`;
                                }
                            }

                            match = raw.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/i);
                            if (match) {
                                const [, day, monthName, year] = match;
                                const monthIndex = months[monthName.toLowerCase()];
                                if (monthIndex !== undefined) {
                                    const dateObj = new Date(year, monthIndex, day);
                                    const dd = String(dateObj.getDate()).padStart(2, '0');
                                    const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
                                    const yyyy = String(dateObj.getFullYear());
                                    return `${dd}-${mm}-${yyyy}`;
                                }
                            }

                            console.log('❌ Could not parse timestamp:', raw);
                            return 'Unknown Date';
                        })(),
                        hotel_name: hotelName,
                        OTA: 'Trip.com'
                    };
                }).filter(review => review.comment && review.rating !== null && review.rating > 0);
            }, hotelName); 
            
        } catch (err) {
            console.log("❌ Error during review extraction:", err.message);
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
        
            if (year && year < 2024) {
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

        const nextPageButton = await page.$('li.nF6SWkdU6FLIzjoCbLMF.KtjTmkGBZvROMSO8zK_Q > a.pQoxbX5l0DdjPttuVUQx');

        if (!nextPageButton) {
            console.log("❌ No 'Next Page' button found. Ending scraping.");
            break;
        }

        const isDisabled = await page.evaluate(button => {
            const parentLi = button.closest('li');
            return parentLi && parentLi.classList.contains('disabled');
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
                ota: "trip.com"
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
