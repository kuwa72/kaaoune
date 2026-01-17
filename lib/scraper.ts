import { chromium } from 'playwright';

export interface PropertyData {
    title: string;
    price: string;
    monthlyPayment?: string;
    url: string;
    // New fields
    images: string[];
    station?: string; // New field for Station Name/Line
    stationMinute?: number;
    yearBuilt?: number;
    area?: number;
    isFreehold?: boolean;
    units?: number;
    fees?: {
        management?: number;
        repair?: number;
        parking?: number;
    };
    parkingStatus?: string;
    renovated?: boolean;
}

// Helper to parse Japanese numbers like "1万3740" or "3080"
function parseJapaneseNumber(val: string): number {
    if (!val) return 0;
    // Find the first sequence of numbers/kanji that looks like a price
    const match = val.replace(/,/g, '').match(/([0-9\.]+)\s*万\s*([0-9\.]*)|([0-9\.]+)/);
    if (!match) return 0;

    if (match[1]) { // Case: 1万3740
        const man = parseFloat(match[1]) * 10000;
        const remainder = match[2] ? parseFloat(match[2]) : 0;
        return man + remainder;
    }
    return parseFloat(match[3]) || 0; // Case: 8000
}

export async function scrapeProperty(url: string): Promise<PropertyData> {
    // Launch a headful browser so it mimics a real user
    const browser = await chromium.launch({
        headless: false,
        args: [
            '--disable-blink-features=AutomationControlled',
            '--no-sandbox',
            '--disable-infobars',
            '--window-position=0,0',
            '--ignore-certificate-errors',
            '--ignore-certificate-errors-spki-list',
        ]
    });

    // Create a context with a realistic User-Agent
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
    });

    // Mask navigator.webdriver
    await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', {
            get: () => undefined,
        });
    });

    const page = await context.newPage();

    // Default data structure
    const data: PropertyData = {
        title: '',
        price: '不明',
        url,
        images: [],
    };

    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

        // --- Block Detection & Manual Verification Wait ---
        const isBlocked = async () => {
            const content = await page.content();
            return content.includes('人間であることを確認してください') ||
                content.includes('Verify you are human') ||
                content.includes('ロボットではありません') ||
                content.includes('アクセスがブロックされました');
        };

        if (await isBlocked()) {
            console.log('Detection: Blocked or Verification required. Waiting for manual resolution...');
            try {
                await page.waitForFunction(async () => {
                    const content = document.body.innerText;
                    return !content.includes('人間であることを確認してください') &&
                        !content.includes('Verify you are human') &&
                        !content.includes('ロボットではありません') &&
                        content.length > 1000;
                }, { timeout: 60000, polling: 2000 });
                console.log('Verification cleared!');
            } catch (e) {
                console.error('Verification timeout. Proceeding anyway.');
            }
        }

        // 1. Basic Metadata
        data.title = await page.title();
        const getRobustTitle = async () => {
            const h1 = await page.innerText('h1').catch(() => '');
            const currentTitle = await page.title();
            if (!currentTitle || currentTitle.includes('LIFULL HOME\'S') || currentTitle.includes('Human Verification')) {
                return h1.trim() || currentTitle;
            }
            return currentTitle;
        };
        data.title = await getRobustTitle();

        // Image Extraction Strategy
        try {
            const ogImage = await page.getAttribute('meta[property="og:image"]', 'content', { timeout: 2000 }).catch(() => null);
            if (ogImage) data.images.push(ogImage);
        } catch (e) { }

        const gallerySelectors = [
            '.p-article-pc-hero__image',
            '.p-timeline__photoImage img',
            '.p-article-pc-info-summary__layout img',
            '.property_view_main-item-img img',
            '.property_view_object-img img',
            '.bh-detailSummary_image img',
            '.mod-packData img',
            '.img_box img',
            '.lazyloader img'
        ];

        for (const sel of gallerySelectors) {
            if (data.images.length >= 12) break;
            try {
                const imgs = await page.locator(sel).all();
                for (const img of imgs) {
                    const src = await img.getAttribute('rel') || await img.getAttribute('data-src') || await img.getAttribute('data-original') || await img.getAttribute('src');
                    if (src && src.startsWith('http') && !data.images.includes(src) && !src.includes('spacer.gif')) {
                        data.images.push(src);
                    }
                }
            } catch (e) { }
        }

        const bodyText = await page.innerText('body');

        // --- 2. Regex / Heuristic Extraction ---
        const priceMatch = bodyText.match(/価格.*?([0-9,]+万円)/) || bodyText.match(/([0-9,]+万円)/);
        if (priceMatch) data.price = priceMatch[1];

        const monthlyMatch = bodyText.match(/月[々]*.*?([0-9,]+円)/);
        if (monthlyMatch) data.monthlyPayment = monthlyMatch[1];

        const titleStationMatch = data.title.match(/([^\s|｜,、]+?駅)\s*[徒歩歩]\s*([0-9]+)分/);
        if (titleStationMatch) {
            data.station = titleStationMatch[1].trim();
            data.stationMinute = parseInt(titleStationMatch[2], 10);
        }

        if (!data.station || !data.stationMinute) {
            const stationMatch = bodyText.match(/徒歩\s*([0-9]+)分/) || bodyText.match(/[歩]\s*([0-9]+)分/);
            if (stationMatch) {
                data.stationMinute = parseInt(stationMatch[1], 10);
                if (stationMatch.index && stationMatch.index > 50) {
                    const prefix = bodyText.substring(stationMatch.index - 50, stationMatch.index).trim();
                    const lines = prefix.split('\n').filter(l => l.trim().length > 0);
                    if (lines.length > 0) {
                        let candidate = lines[lines.length - 1].trim();
                        candidate = candidate.replace(/^(交通|アクセス)[:：]*/, '').trim();
                        candidate = candidate.replace(/[徒]$/, '').trim();
                        if (candidate.length > 2) data.station = candidate;
                    }
                }
            }
        }

        const specificYearMatch = bodyText.match(/(?:築年月|竣工|建築).*?([0-9]{4})/);
        if (specificYearMatch) {
            data.yearBuilt = parseInt(specificYearMatch[1], 10);
        } else {
            const allYears = bodyText.matchAll(/([0-9]{4})年/g);
            const validYears: number[] = [];
            for (const m of allYears) {
                const y = parseInt(m[1], 10);
                if (y > 1900 && y <= new Date().getFullYear()) validYears.push(y);
            }
            if (validYears.length > 0) {
                data.yearBuilt = Math.min(...validYears);
            } else {
                const yearRelativeMatch = bodyText.match(/築([0-9]+)年/);
                if (yearRelativeMatch) {
                    const age = parseInt(yearRelativeMatch[1], 10);
                    data.yearBuilt = new Date().getFullYear() - age;
                }
            }
        }

        const areaMatch = bodyText.match(/([0-9\.]+)\s*(m²|㎡|平米|m2)/);
        if (areaMatch) data.area = parseFloat(areaMatch[1]);

        data.isFreehold = true;
        if (bodyText.includes('借地権') && !bodyText.includes('所有権')) {
            data.isFreehold = false;
        }

        const unitsMatch = bodyText.match(/総戸数.*?([0-9]+)戸/);
        if (unitsMatch) data.units = parseInt(unitsMatch[1], 10);

        data.fees = {};
        const mgmtMatch = bodyText.match(/管理費.*?([0-9,万\.]+)円/);
        if (mgmtMatch) data.fees.management = parseJapaneseNumber(mgmtMatch[1]);

        const repairMatch = bodyText.match(/修繕.*?([0-9,万\.]+)円/);
        if (repairMatch) data.fees.repair = parseJapaneseNumber(repairMatch[1]);

        const parkingMatch = bodyText.match(/駐車場.*?([0-9,万\.]+)円/);
        if (parkingMatch) data.fees.parking = parseJapaneseNumber(parkingMatch[1]);

        const parkingStatusMatch = bodyText.match(/駐車場[:：\s]*([^。\n]*?(?:空有|空きあり|空無|空きなし|なし|近隣|要確認)[^。\n]*)/);
        if (parkingStatusMatch) data.parkingStatus = parkingStatusMatch[1].trim();

        if (bodyText.includes('リフォーム') || bodyText.includes('リノベ')) data.renovated = true;

        // --- 3. Site-Specific Logic (SUUMO / Homes) ---
        if (url.includes('suumo.jp')) {
            try {
                // Fetch all table data at once
                const tableMap = await page.evaluate(() => {
                    const map: Record<string, string> = {};
                    document.querySelectorAll('th').forEach(th => {
                        const header = th.innerText.trim();
                        if (header) {
                            const td = th.nextElementSibling;
                            if (td && td.tagName === 'TD') {
                                map[header] = (td as HTMLElement).innerText.trim();
                            }
                        }
                    });
                    return map;
                });

                const getTableValue = (header: string) => {
                    for (const key in tableMap) {
                        if (key.includes(header)) return tableMap[key];
                    }
                    return null;
                };

                const accessVal = getTableValue('交通');
                if (accessVal) {
                    const lines = accessVal.split('\n').filter(l => (l.includes('徒歩') || l.includes('歩')) && l.includes('分'));
                    if (lines.length > 0) {
                        const m = lines[0].match(/([^\s|｜]+?)\s*[徒歩歩]\s*([0-9]+)分/);
                        if (m) {
                            data.station = m[1].trim();
                            data.stationMinute = parseInt(m[2], 10);
                        } else {
                            data.station = lines[0].trim().substring(0, 30);
                        }
                    }
                }

                const priceVal = getTableValue('価格');
                if (priceVal && (data.price === '不明' || !data.price)) {
                    const m = priceVal.match(/([0-9,万\.]+)円/);
                    if (m) data.price = m[1].includes('万') ? m[1] : m[1] + '円';
                }

                const rightsVal = getTableValue('権利形态') || getTableValue('土地権利') || getTableValue('権利');
                if (rightsVal) data.isFreehold = !rightsVal.includes('借地');

                const unitsVal = getTableValue('総戸数');
                if (unitsVal) data.units = parseInt(unitsVal, 10) || data.units;

                const mgmtVal = getTableValue('管理費');
                if (mgmtVal) data.fees.management = parseJapaneseNumber(mgmtVal);

                const repairVal = getTableValue('修繕積立金');
                if (repairVal) data.fees.repair = parseJapaneseNumber(repairVal);

                const parkingVal = getTableValue('駐車場');
                if (parkingVal) {
                    data.fees.parking = parseJapaneseNumber(parkingVal);
                    data.parkingStatus = parkingVal.trim();
                }

            } catch (e) { }
        }

        if (url.includes('mansion-note.com')) {
            try {
                // Wait for potential dynamic loading
                await page.waitForLoadState('load', { timeout: 30000 }).catch(() => { });

                // If we are on a mansion top page, try to find and click the "物件" (House/Unit) tab
                if (!url.includes('/house')) {
                    const houseTabSelector = 'a[href*="/house"]';
                    const hasHouseTab = await page.$(houseTabSelector);
                    if (hasHouseTab) {
                        console.log('Mansion Note: Navigating to house details tab...');
                        await Promise.all([
                            page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => { }),
                            hasHouseTab.click()
                        ]);
                    }
                }

                // Methodical scroll to trigger lazy loading
                await page.evaluate(async () => {
                    window.scrollBy(0, 800);
                    await new Promise(r => setTimeout(r, 500));
                    window.scrollBy(0, 800);
                });
                await page.waitForTimeout(2000);

                const tableMap = await page.evaluate(() => {
                    const map: Record<string, string> = {};
                    document.querySelectorAll('tr').forEach(tr => {
                        const th = tr.querySelector('th');
                        const td = tr.querySelector('td');
                        if (th && td) {
                            map[th.innerText.trim()] = (td as HTMLElement).innerText.trim();
                        }
                    });
                    return map;
                });

                const getTableValue = (header: string) => {
                    for (const key in tableMap) {
                        if (key.includes(header)) return tableMap[key];
                    }
                    return null;
                };

                const mgmtVal = getTableValue('管理費等') || getTableValue('管理費');
                if (mgmtVal) {
                    data.fees.management = parseJapaneseNumber(mgmtVal);
                }

                const repairVal = getTableValue('修繕積立金') || getTableValue('修繕');
                if (repairVal) {
                    data.fees.repair = parseJapaneseNumber(repairVal);
                }

                const parkingVal = getTableValue('駐車場');
                if (parkingVal) {
                    data.fees.parking = parseJapaneseNumber(parkingVal);
                    data.parkingStatus = parkingVal.trim();
                }

                const unitsVal = getTableValue('総戸数');
                if (unitsVal) {
                    const unitsMatch = unitsVal.match(/([0-9]+)/);
                    if (unitsMatch) data.units = parseInt(unitsMatch[1], 10);
                }

                const areaVal = getTableValue('専有面積');
                if (areaVal) {
                    const areaMatch = areaVal.match(/([0-9\.]+)\s*(m²|㎡|平米|m2)/);
                    if (areaMatch) data.area = parseFloat(areaMatch[1]);
                }

                const builtVal = getTableValue('築年月') || getTableValue('完成時期');
                if (builtVal) {
                    const yearMatch = builtVal.match(/([0-9]{4})年/);
                    if (yearMatch) data.yearBuilt = parseInt(yearMatch[1], 10);
                }

                console.log(`Mansion Note Extraction: mgmt=${data.fees.management}, repair=${data.fees.repair}, area=${data.area}`);
            } catch (e) {
                console.error('Mansion Note extraction error:', e);
            }
        }

        if (url.includes('homes.co.jp')) {
            try {
                const detailMap = await page.evaluate(() => {
                    const map: Record<string, string> = {};
                    document.querySelectorAll('dt').forEach(dt => {
                        const dd = dt.nextElementSibling;
                        if (dd && dd.tagName === 'DD') map[dt.innerText.trim()] = (dd as HTMLElement).innerText.trim();
                    });
                    document.querySelectorAll('tr').forEach(row => {
                        const th = row.querySelector('th')?.innerText.trim() || '';
                        const td = row.querySelector('td')?.innerText.trim() || '';
                        if (th) map[th] = td;
                    });
                    return map;
                });

                const getHomesValue = (header: string) => {
                    for (const key in detailMap) {
                        if (key.includes(header)) return detailMap[key];
                    }
                    return null;
                };

                const accessVal = getHomesValue('交通');
                if (accessVal && (!data.station || !data.stationMinute)) {
                    const match = accessVal.match(/([^\s]+?)[徒歩歩]\s*([0-9]+)分/);
                    if (match) {
                        data.station = data.station || match[1].trim();
                        data.stationMinute = data.stationMinute || parseInt(match[2], 10);
                    } else if (!data.station) {
                        data.station = accessVal.split('\n')[0].trim();
                    }
                }

                const priceVal = getHomesValue('価格');
                if (priceVal && data.price === '不明') {
                    const m = priceVal.match(/([0-9,万\.]+)円/);
                    if (m) data.price = m[1].includes('万') ? m[1] : m[1] + '円';
                }

                const areaVal = getHomesValue('専有面積');
                if (areaVal && !data.area) {
                    const m = areaVal.match(/([0-9\.]+)m²/);
                    if (m) data.area = parseFloat(m[1]);
                }

                const ageVal = getHomesValue('築年月');
                if (ageVal) {
                    const m = ageVal.match(/([0-9]{4})年/);
                    if (m) data.yearBuilt = parseInt(m[1], 10);
                }
            } catch (e) {
                console.log('Homes extraction error', e);
            }
        }

        if (url.includes('cowcamo.jp')) {
            try {
                // Wait for load
                await page.waitForLoadState('load', { timeout: 30000 }).catch(() => { });

                // Check current URL after potential redirects
                const currentUrl = page.url();

                // If not on detail page
                if (!currentUrl.endsWith('/detail')) {
                    // 1. Try finding the detail link by partial href
                    const detailLinkSelector = 'a[href$="/detail"]';
                    const detailLink = await page.$(detailLinkSelector);

                    if (detailLink) {
                        console.log('Cowcamo: Navigating to detail page via link...');
                        await Promise.all([
                            page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => { }),
                            detailLink.click()
                        ]);
                    } else {
                        // 2. Try finding by text content (e.g. "間取り・概要")
                        const linkByText = await page.evaluateHandle(() => {
                            const anchors = Array.from(document.querySelectorAll('a'));
                            return anchors.find(a => a.innerText.includes('間取り') || a.innerText.includes('概要'));
                        });

                        if (linkByText.asElement()) {
                            console.log('Cowcamo: Navigating to detail page via link.href...');
                            const href = await page.evaluate(el => (el as HTMLAnchorElement).href, linkByText);
                            await page.goto(href, { waitUntil: 'domcontentloaded' }).catch(() => { });
                        } else {
                            // 3. Fallback: Only append /detail if it looks like a standard article URL (not a short link)
                            if (!currentUrl.includes('/c/') && !currentUrl.includes('/detail')) {
                                const detailUrl = currentUrl.endsWith('/') ? `${currentUrl}detail` : `${currentUrl}/detail`;
                                console.log(`Cowcamo: Trying direct navigation to ${detailUrl}`);
                                await page.goto(detailUrl, { waitUntil: 'domcontentloaded' }).catch(() => { });
                            } else {
                                console.warn('Cowcamo: Could not find detail page link and URL structure is unsure.');
                            }
                        }
                    }
                }

                // Scroll to trigger lazy loads
                await page.evaluate(async () => {
                    window.scrollBy(0, 1000);
                    await new Promise(r => setTimeout(r, 500));
                    window.scrollBy(0, 1000);
                });
                await page.waitForTimeout(1000);

                // Extract data from standard tables and DLs
                const cowcamoMap = await page.evaluate(() => {
                    const map: Record<string, string> = {};
                    // Try standard tables
                    document.querySelectorAll('tr').forEach(tr => {
                        const th = tr.querySelector('th') as HTMLElement | null;
                        const td = tr.querySelector('td') as HTMLElement | null;
                        if (th && td) map[th.innerText.trim()] = td.innerText.trim();
                    });
                    // Try Definition Lists (dl/dt/dd) - Handle multiple pairs
                    document.querySelectorAll('dl').forEach(dl => {
                        const dts = dl.querySelectorAll('dt');
                        dts.forEach(dt => {
                            const dd = dt.nextElementSibling;
                            if (dd && dd.tagName === 'DD') {
                                map[(dt as HTMLElement).innerText.trim()] = (dd as HTMLElement).innerText.trim();
                            }
                        });
                    });
                    // Extra heuristic for fields that might be in divs/spans
                    const labelsToFind = ['管理費', '修繕積立金', '駐車場'];
                    const elements = Array.from(document.querySelectorAll('div, span, p, dt, th, li, label, b'));

                    labelsToFind.forEach(label => {
                        if (map[label]) return;
                        const labelEl = elements.find(el => {
                            const text = (el as HTMLElement).innerText?.trim();
                            if (!text) return false;
                            return text === label || text === `${label}：` || text === `${label}:` || (text.includes(label) && text.length < label.length + 3);
                        });

                        if (labelEl) {
                            let next = labelEl.nextElementSibling;
                            if (next) {
                                map[label] = (next as HTMLElement).innerText.trim();
                            } else {
                                let pNext = labelEl.parentElement?.nextElementSibling;
                                if (pNext) map[label] = (pNext as HTMLElement).innerText.trim();
                            }
                        }
                    });

                    return map;
                });

                const getVal = (keys: string[]) => {
                    for (const k of keys) {
                        const match = Object.keys(cowcamoMap).find(key => key.includes(k));
                        if (match) return cowcamoMap[match];
                    }
                    return null;
                };

                const mgmt = getVal(['管理費']);
                if (mgmt) data.fees.management = parseJapaneseNumber(mgmt);

                const repair = getVal(['修繕積立金']);
                if (repair) data.fees.repair = parseJapaneseNumber(repair);

                const parking = getVal(['駐車場']);
                if (parking) {
                    data.fees.parking = parseJapaneseNumber(parking);
                    data.parkingStatus = parking; // "空きあり 20,000円" etc.
                }

                const units = getVal(['総戸数']);
                if (units) {
                    const m = units.match(/(\d+)/);
                    if (m) data.units = parseInt(m[1]);
                }

                const built = getVal(['築年月', '竣工']);
                if (built) {
                    const m = built.match(/([0-9]{4})年/);
                    if (m) data.yearBuilt = parseInt(m[1]);
                }

                const area = getVal(['専有面積', '面積']);
                if (area) {
                    const m = area.match(/([0-9\.]+)/);
                    if (m) data.area = parseFloat(m[1]);
                }

                // Try to find station info if missing
                if (!data.station || !data.stationMinute) {
                    const access = getVal(['交通', '最寄り駅', 'アクセス']);
                    if (access) {
                        data.station = access;
                        const m = access.match(/徒歩(\d+)分/);
                        if (m) data.stationMinute = parseInt(m[1]);
                    }
                }

                console.log('Cowcamo Map Keys:', Object.keys(cowcamoMap));
                console.log(`Cowcamo Extraction: mgmt=${data.fees.management}, repair=${data.fees.repair}, station=${data.station}`);
            } catch (e: any) {
                console.error('Cowcamo extraction error:', e.message || e);
            }
        }

    } catch (e) {
        console.error('Scraping failed:', e);
    } finally {
        await browser.close();
    }
    return data;
}
